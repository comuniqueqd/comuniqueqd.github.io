-- 009z5 "Casa certa" (21/11/2026, spec aprovada pelo usuário). Pode rodar de novo.
--  A5-23: ajuste de bairro repetido pede confirmação (mesmo ID + mesmo código do pedido, ou mesmo ID + mesmos bairros
--         no mesmo dia de Brasília), como o adicional (009x3). registrar_ajuste_bairro ganha p_confirmar (a antiga sai).
--  A12-21: a correção de uma restrição anota "Restrição de … corrigida" (e corrige as anotações antigas).
--  A6-20: regras_equipe não manda mais telefones (nenhuma tela usa).
--  A6-21: casos guardados deixam de ser legíveis pela API; casos_abertos_de perde o acesso.
--  A2-23/A2-20: listar_cadastros fora de 'pendentes' devolve só os 500 mais recentes; listar_tarefas ganha p_minhas
--         (só as que a pessoa trata) e, fora de 'pendente', só os últimos 90 dias.
--  Pedido do usuário: resumo_inicio().atividades.pedidas_por_mim (tarefas que a pessoa criou e ainda não foram concluídas).

-- ---------- A5-23: ajuste de bairro repetido ----------
drop function if exists public.registrar_ajuste_bairro(text, text, text, text, text, text, boolean, text, text, text);
create or replace function public.registrar_ajuste_bairro(p_cidade text, p_informado text, p_real text, p_id_app text, p_nome text,
  p_origem text, p_lancado boolean default false, p_pedido text default null, p_motivo text default null, p_observacao text default null,
  p_confirmar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bi public.bairros; br public.bairros; v record; l public.lancamentos_financeiros; x public.lancamentos_financeiros;
        ped text := nullif(btrim(coalesce(p_pedido, '')), '');
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_cidade is null then raise exception 'Escolha a cidade.'; end if;
  bi := public.achar_bairro(p_cidade, p_informado);
  br := public.achar_bairro(p_cidade, p_real);
  if bi.id is null then raise exception 'Bairro informado pelo cliente não encontrado em %.', p_cidade; end if;
  if br.id is null then raise exception 'Bairro onde a entrega terminou não encontrado em %.', p_cidade; end if;
  if bi.id = br.id then raise exception 'Os dois bairros são iguais: não há ajuste.'; end if;
  if p_origem is null or p_origem not in ('qd', 'outros') then raise exception 'Escolha de onde veio o pedido (QD ou outros).'; end if;
  select * into v from public.validar_entregador_lancamento(p_id_app, p_nome, p_cidade);
  if not coalesce(p_confirmar, false) then
    select * into x from public.lancamentos_financeiros f
     where f.tipo = 'ajuste_bairro' and lower(f.id_app) = lower(v.id_app)
       and ((ped is not null and lower(f.pedido) = lower(ped))
         or (f.bairro_informado = bi.nome and f.bairro_real = br.nome
             and (f.criado_em at time zone 'America/Sao_Paulo')::date = public.hoje_brasilia()))
     order by f.criado_em desc limit 1;
    if x.id is not null then
      return jsonb_build_object('precisa_confirmar', true, 'parecido', public.json_lancamento(x),
        'texto', format('Já existe um ajuste de bairro de %s para %s (%s → %s%s), registrado por %s em %s. Registrar mesmo assim?',
          'R$ ' || replace(to_char(x.valor, 'FM999990.00'), '.', ','), coalesce(x.nome_entregador, 'este entregador'),
          x.bairro_informado, x.bairro_real, case when x.pedido is not null then ', pedido ' || x.pedido else '' end,
          coalesce(x.registrado_por_nome, 'alguém'), to_char(x.criado_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')));
    end if;
  end if;
  insert into public.lancamentos_financeiros (tipo, cidade, id_app, nome_entregador, pedido, origem, motivo,
      bairro_informado, bairro_real, recebe_informado, recebe_real, valor,
      lancado, lancado_em, lancado_por, lancado_por_nome, observacao, registrado_por, registrado_por_nome)
  values ('ajuste_bairro', p_cidade, v.id_app, v.nome, ped, p_origem, nullif(btrim(coalesce(p_motivo, '')), ''),
      bi.nome, br.nome, public.recebe_bairro(bi), public.recebe_bairro(br),
      greatest(public.recebe_bairro(br) - public.recebe_bairro(bi), 0),
      coalesce(p_lancado, false), case when p_lancado then now() end, case when p_lancado then auth.uid() end,
      case when p_lancado then public.nome_de(auth.uid()) end,
      nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(), public.nome_de(auth.uid()))
  returning * into l;
  return public.json_lancamento(l);
end $$;

-- ---------- A12-21: "Restrição de … corrigida" (corpo inteiro; supabase/funcoes/corrigir_bloqueio.sql) ----------
CREATE OR REPLACE FUNCTION public.corrigir_bloqueio(p_bloqueio uuid, p_id_app text, p_nome text, p_cidade text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b        public.bloqueios;
  v_id     text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_cidade text := nullif(upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g')), '');
  v_mot    text := nullif(btrim(coalesce(p_motivo, '')), '');
  quem     text := (select nome from public.membros where email = public.meu_email());
  mudou    boolean;
  partes   text[] := '{}';
  detalhe  text;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into b from public.bloqueios where id = p_bloqueio for update;
  if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;
  if public.meu_papel_bloq() = 'suporte' and b.revisar is null and b.registrado_por is distinct from auth.uid() then
    raise exception 'O suporte corrige só os registros marcados “revisar” ou os que ele mesmo registrou.';
  end if;
  if b.dados_pendentes then raise exception 'Este registro está sem nome e cidade: use "Completar dados" na tarefa.'; end if;
  if length(v_id) < 4 then raise exception 'Preencha o ID do entregador.'; end if;
  if not public.nome_valido(v_nome) or length(v_nome) > 120 then raise exception 'Preencha o nome do entregador.'; end if;
  if v_cidade is null and b.cidade is not null then raise exception 'Escolha a cidade.'; end if;
  if v_cidade is not null and not exists (select 1 from public.cidades where nome = v_cidade) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  mudou := v_id <> b.id_app or v_nome <> b.nome_entregador or v_cidade is distinct from b.cidade;
  if mudou and v_mot is null then raise exception 'Informe o motivo da correção.'; end if;
  if not mudou and b.revisar is null then raise exception 'Nada foi alterado.'; end if;

  if v_id <> b.id_app then partes := partes || format('ID: %s → %s', b.id_app, v_id); end if;
  if v_nome <> b.nome_entregador then partes := partes || format('nome: %s → %s', b.nome_entregador, v_nome); end if;
  if v_cidade is distinct from b.cidade then partes := partes || format('cidade: %s → %s', coalesce(b.cidade, '(sem cidade)'), v_cidade); end if;
  if b.revisar is not null then partes := partes || ('alerta resolvido: ' || b.revisar); end if;
  if v_mot is not null then partes := partes || ('motivo: ' || v_mot); end if;
  detalhe := left(array_to_string(partes, ' · '), 1200);

  update public.bloqueios set id_app = v_id, nome_entregador = v_nome, cidade = v_cidade, revisar = null where id = b.id;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
  values (b.id, case when mudou then 'corrigido' else 'revisado' end, auth.uid(), quem, detalhe);
  if v_cidade is distinct from b.cidade then
    update public.tarefas set cidade = v_cidade, responsavel_email = public.responsavel_da_cidade(v_cidade)
     where bloqueio_id = b.id and status = 'pendente' and tipo <> 'completar_dados';
  end if;
  if mudou then
    perform public.anotar_entregador(v_id, 'alteracao',
      format('Restrição de %s (%s) corrigida. %s', to_char(b.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), b.infracao, detalhe), b.id);
    if lower(v_id) <> lower(b.id_app) then
      perform public.anotar_entregador(b.id_app, 'alteracao',
        format('Restrição de %s (%s) passou para o ID %s. %s', to_char(b.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), b.infracao, v_id, detalhe), b.id);
    end if;
  end if;
  return public.json_bloqueio((select x from public.bloqueios x where x.id = b.id));
end $function$;


update public.comentarios_entregador
   set texto = regexp_replace(regexp_replace(texto, '^Bloqueio de (\S+) \((.*?)\) corrigido\.', 'Restrição de \1 (\2) corrigida.'),
                              '^Bloqueio de (\S+) \((.*?)\) passou para', 'Restrição de \1 (\2) passou para')
 where tipo = 'alteracao' and texto ~ '^Bloqueio de \S+ \(.*?\) (corrigido\.|passou para)';

-- ---------- A6-20: regras_equipe sem telefones ----------
CREATE OR REPLACE FUNCTION public.regras_equipe()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mod boolean := public.meu_papel() = 'moderador';
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'pode_editar', mod,
    'responsavel_operadores', (select jsonb_build_object('email', m.email, 'nome', m.nome,
                                   'recebe_tratativas', m.papel_bloqueios in ('moderador', 'monitorador'))
                                 from public.parametros_equipe p join public.membros m on m.email = p.responsavel_operadores_email),
    'operadores', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'contato', o.contato, 'ativo', o.ativo,
                       'cidades', (select count(*) from public.cidades c where c.operador_id = o.id and c.ativa)) order by o.nome)
                     from public.operadores_logisticos o), '[]'),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', c.nome, 'ativa', c.ativa, 'gestao', c.gestao,
        'operador_id', c.operador_id, 'operador_nome', o.nome, 'operador_contato', o.contato,
        'tarifa_inicial', c.tarifa_inicial, 'tarifa_tipo', c.tarifa_tipo, 'adicional_km', c.adicional_km,
        'responsavel_email', c.responsavel_email,
        'responsavel_efetivo_email', r.email, 'responsavel_nome', r.nome,
        'recebe_tratativas', public.responsavel_da_cidade(c.nome) is not null)
        order by c.ativa desc, c.nome)
      from public.cidades c
      left join public.operadores_logisticos o on o.id = c.operador_id
      left join public.membros r on r.email = public.responsavel_cidade_email(c.nome)), '[]'),
    -- lista de pessoas só para quem edita
    'membros', case when mod then coalesce((select jsonb_agg(jsonb_build_object('email', email, 'nome', nome,
                   'papel_bloqueios', papel_bloqueios) order by nome) from public.membros), '[]') end);
end $function$;

-- ---------- A6-21: casos guardados sem leitura pela API ----------
drop policy if exists casos_leitura on public.casos;
drop policy if exists casos_comentarios_leitura on public.casos_comentarios;
drop policy if exists checklist_casos_leitura on public.checklist_casos;
revoke all on function public.casos_abertos_de(text, text) from public, anon, authenticated;

-- ---------- A2-23: listar_cadastros com teto fora de 'pendentes' ----------
CREATE OR REPLACE FUNCTION public.listar_cadastros(p_escopo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'id_app', c.id_app, 'cpf', c.cpf, 'nome', c.nome, 'cidade', c.cidade, 'observacao', c.observacao,
      'status', c.status, 'enviado_por', c.enviado_por, 'enviado_por_nome', public.nome_de(c.enviado_por),
      'enviado_em', c.enviado_em, 'status_desde', c.status_desde,
      'motivo', c.motivo, 'detalhe', c.detalhe,
      'decidido_por_nome', case when c.decidido_por is not null then public.nome_de(c.decidido_por) end,
      'decidido_em', c.decidido_em,
      'previsao', c.previsao, 'previsao_por_nome', c.previsao_por_nome,
      'revisar', public.motivo_revisar_cadastro(c), 'revisado', c.revisado,
      'caso_aberto', exists (select 1 from public.casos k where k.status = 'aberto' and (k.cadastro_id = c.id or k.novo_cadastro_id = c.id)),
      'tarefa_aberta', exists (select 1 from public.atividades a where a.cadastro_id = c.id and a.status <> 'concluida'),
      'historico', case when p_escopo = 'pendentes' and c.id_app is not null then public.historico_resumo(c.id_app) end,
      'reprovacoes', (select count(*) from public.eventos e where e.cadastro_id = c.id and e.tipo = 'reprovado'),
      'pode_desfazer', (select e.tipo in ('aprovado', 'reprovado', 'encerrado') from public.eventos e
                         where e.cadastro_id = c.id and e.tipo not in ('editado', 'revisado') order by e.id desc limit 1))
      order by c.status_desde)
    from public.cadastros c
    where case p_escopo
            when 'pendentes' then c.status in ('aguardando_analise', 'aguardando_contato')
            when 'meus' then c.enviado_por = auth.uid()
            when 'todos' then true
            else false
          end
      -- 009z5 (A2-23): fora de 'pendentes', só os 500 mais recentes (a chamada antiga devolvia tudo, dezenas de MB)
      and (p_escopo = 'pendentes' or c.id in (select c2.id from public.cadastros c2 order by c2.status_desde desc limit 500))), '[]');
end $function$;

-- ---------- A2-20/A2-23: listar_tarefas com p_minhas e teto fora de 'pendente' ----------
drop function if exists public.listar_tarefas(text);
create or replace function public.listar_tarefas(p_status text default 'pendente', p_minhas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
begin
  return coalesce((
    select jsonb_agg(x.j order by x.criada_em) from (
      select public.json_tarefa(t) || jsonb_build_object(
          'cidade', t.cidade,
          'minha', p = 'moderador' or t.responsavel_email = public.meu_email() or (t.tipo = 'completar_dados' and p = 'monitorador'),
          'bloqueio', public.json_bloqueio(b)) j, t.criada_em
        from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
       where (p_status is null or t.status = p_status)
         -- 009x6: todos veem todas (só leitura); quem age continua sendo decidido por 'minha'
         and (coalesce(p_status, '') = 'pendente' or t.criada_em > now() - interval '90 days')
         and (not coalesce(p_minhas, false) or p = 'moderador' or t.responsavel_email = public.meu_email()
              or (t.tipo = 'completar_dados' and p = 'monitorador'))) x), '[]');
end $$;

-- ---------- pedido do usuário: as tarefas que eu pedi, na tela inicial (resumo_inicio, corpo inteiro; supabase/funcoes/resumo_inicio.sql) ----------
CREATE OR REPLACE FUNCTION public.resumo_inicio()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.papel := public.meu_papel(); pb public.papel := public.meu_papel_bloq(); eu text := public.meu_email();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'papel', p, 'papel_bloqueios', pb,
    'prazo_tratativa_horas', (select tratativa_prazo_horas from public.parametros_bloqueio),
    'ativacao', (select jsonb_build_object(
      'aguardando_analise', count(*) filter (where status = 'aguardando_analise' and (p in ('moderador', 'monitorador') or enviado_por = auth.uid())),
      'aguardando_contato', count(*) filter (where status = 'aguardando_contato' and (p in ('moderador', 'monitorador') or enviado_por = auth.uid())),
      'meus_aguardando_analise', count(*) filter (where status = 'aguardando_analise' and enviado_por = auth.uid()),
      'meus_aguardando_contato', count(*) filter (where status = 'aguardando_contato' and enviado_por = auth.uid()),
      'equipe_aguardando_analise', count(*) filter (where status = 'aguardando_analise'),
      'equipe_aguardando_contato', count(*) filter (where status = 'aguardando_contato'))
      from public.cadastros),
    'bloqueios', case when pb is null then null else (select jsonb_build_object(
      'bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado' and (pb in ('moderador', 'monitorador') or b.registrado_por = auth.uid())),
      'meus_bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado' and b.registrado_por = auth.uid()),
      'equipe_bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado'),
      'tratativas_pendentes', (select count(*) from public.tarefas t join public.bloqueios x on x.id = t.bloqueio_id
                                where t.status = 'pendente' and case pb
                                  when 'moderador' then true
                                  when 'monitorador' then t.responsavel_email = eu or t.tipo = 'completar_dados'
                                  else x.registrado_por = auth.uid() end),
      'equipe_tratativas_pendentes', (select count(*) from public.tarefas t where t.status = 'pendente'),
      'tratativas_atrasadas', (select count(*) from public.tarefas t where public.tarefa_atrasada(t)
                                 and (pb = 'moderador' or (pb = 'monitorador' and t.responsavel_email = eu))),
      'atencao', jsonb_array_length(public.entregadores_atencao()))
      from public.bloqueios b) end,
    'atividades', (select jsonb_build_object(
      'para_aceitar', count(*) filter (where a.status = 'aberta' and public.atividade_aberta_para_mim(a) and a.criada_por is distinct from auth.uid()
                                         and not (a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false))),
      'opcionais', count(*) filter (where a.status = 'aberta' and a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false)),
      'minhas_em_andamento', count(*) filter (where a.status = 'aceita' and public.participa(a)),
      'equipe_abertas', count(*) filter (where a.status in ('aberta', 'aceita')),
      'abertas_para_pegar', count(*) filter (where a.status = 'aberta' and not a.automatica and a.criada_por is distinct from auth.uid() and (p = 'moderador' or public.atividade_aberta_para_mim(a))),
      'pedidas_por_mim', count(*) filter (where a.status in ('aberta', 'aceita') and not a.automatica and a.criada_por = auth.uid() and not public.participa(a)))
      from public.atividades a),
    'notificacoes', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null));
end $function$;

do $$ declare f text; begin
  foreach f in array array['registrar_ajuste_bairro(text, text, text, text, text, text, boolean, text, text, text, boolean)',
                           'regras_equipe()', 'listar_cadastros(text)', 'listar_tarefas(text, boolean)', 'corrigir_bloqueio(uuid, text, text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
