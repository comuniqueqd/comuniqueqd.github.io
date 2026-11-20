-- 009x3 (20/11/2026): lançamento urgente, pedidos e decisões do usuário de 20/11.
-- 1. Tarefas automáticas contam as aprovações de toda a equipe (pedido do usuário). A tarefa "Aprovar N entregadores
--    · CIDADE" que nasce sozinha ao ativar um parceiro (tarefa_entregadores_do_parceiro, 009g) conta TODOS os cadastros
--    aprovados naquela cidade desde que a tarefa foi criada, não importa quem aprovou nem se alguém já pegou a tarefa.
--    Ao bater a meta ela FECHA SOZINHA e avisa todo mundo que participou (quem aprovou e quem estava nela).
--    As tarefas criadas por uma pessoa continuam contando só as aprovações de quem pegou (e de quem entrou junto).
--    Marca nova: atividades.automatica (as que já existem são reconhecidas pela descrição "Criada sozinha ao ativar o
--    parceiro"). aprovacoes_de() com p_quem nulo = qualquer pessoa. json_atividade ganha 'automatica' (corpo inteiro,
--    regra da 009x: supabase/funcoes/json_atividade.sql atualizado junto).
-- 2. A6-01: quem sai da equipe não lê mais avisos (nem os antigos, nem pelo Realtime) e não recebe avisos novos; os
--    avisos, o "seguindo" e as preferências da pessoa são apagados quando ela é removida.
-- 3. A5-09: reverter um encerramento de parceria fecha a tarefa "Encerramento de parceria" que estava pendente.
-- 4. A8-04: adicional repetido (mesmo ID e mesmo código do pedido, ou mesmo ID e mesmo valor no mesmo dia) pergunta
--    antes de gravar: registrar_adicional ganhou p_confirmar (a versão de 12 argumentos sai).
-- Pode rodar de novo.

alter table public.atividades add column if not exists automatica boolean not null default false;
update public.atividades set automatica = true
 where id is not null and not automatica and tipo = 'ativar_entregadores' and modo = 'solicitacao'
   and descricao like 'Criada sozinha ao ativar o parceiro%';

-- p_quem nulo = aprovações de qualquer pessoa
create or replace function public.aprovacoes_de(p_tipo text, p_quem uuid, p_cidade text, p_de timestamptz, p_ate timestamptz default null)
returns int language sql stable security definer set search_path = public as $$
  select case p_tipo
    when 'ativar_entregadores' then (select count(distinct c.id)::int from public.cadastros c
        where c.status = 'aprovado' and (p_cidade is null or c.cidade = p_cidade)
          and exists (select 1 from public.eventos e where e.cadastro_id = c.id and e.tipo = 'aprovado' and (p_quem is null or e.por = p_quem)
                        and e.em >= p_de and (p_ate is null or e.em <= p_ate)))
    when 'ativar_parceiro' then (select count(*)::int from public.parceiros p
        where (p_quem is null or p.criado_por = p_quem) and (p_cidade is null or p.cidade = p_cidade) and p.criado_em >= p_de and (p_ate is null or p.criado_em <= p_ate))
    else 0 end
$$;

create or replace function public.progresso_tarefa(a public.atividades)
returns int language sql stable security definer set search_path = public as $$
  select case
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.modo = 'registro' then coalesce(a.meta, a.progresso)
    -- automática: toda a equipe, desde que a tarefa nasceu (mesmo sem ninguém ter pegado)
    when a.automatica and a.tipo in ('ativar_entregadores', 'ativar_parceiro') then
      public.aprovacoes_de(a.tipo, null, a.cidade, a.criada_em, a.concluida_em)
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.aceita_por is not null then
      (select coalesce(sum(public.aprovacoes_de(a.tipo, (p->>'id')::uuid, a.cidade, (p->>'desde')::timestamptz, a.concluida_em)), 0)::int
         from jsonb_array_elements(public.participantes_de(a)) p)
    else a.progresso end
$$;

create or replace function public.tarefa_entregadores_do_parceiro(p public.parceiros)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.atividades; tt public.tipos_tarefa; quem text := public.nome_de(auth.uid()); c jsonb; x jsonb;
begin
  select * into a from public.atividades
   where tipo = 'ativar_entregadores' and modo = 'solicitacao' and cidade = p.cidade and status in ('aberta', 'aceita')
   order by criada_em limit 1 for update;
  if a.id is not null then
    c := jsonb_set(a.campos, '{quantidade}', to_jsonb(coalesce(a.meta, 0) + 5));
    update public.atividades set meta = coalesce(meta, 0) + 5, campos = c, titulo = public.titulo_tarefa('ativar_entregadores', c, null),
           descricao = left(concat_ws(E'\n', descricao, format('+5 com o parceiro %s (ativado por %s).', p.estabelecimento, quem)), 1500)
     where id = a.id returning * into a;
    for x in select * from jsonb_array_elements(public.participantes_de(a)) loop
      if (x->>'id')::uuid is distinct from auth.uid() then
        perform public.notificar((x->>'id')::uuid, format('A tarefa subiu para %s entregadores: %s ativou o parceiro %s.', a.meta, quem, p.estabelecimento), '#atividades/sugeridas');
      end if;
    end loop;
    return jsonb_build_object('titulo', a.titulo, 'meta', a.meta, 'nova', false);
  end if;
  select * into tt from public.tipos_tarefa where tipo = 'ativar_entregadores';
  c := jsonb_build_object('cidade', p.cidade, 'quantidade', 5, 'motivo', 'Parceiro novo: ' || p.estabelecimento);
  insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, tipo, campos, cidade, modo, meta, automatica)
  values (public.titulo_tarefa('ativar_entregadores', c, null), format('Criada sozinha ao ativar o parceiro %s.', p.estabelecimento),
          auth.uid(), quem, '{}', case when tt.prazo_horas is not null then now() + tt.prazo_horas * interval '1 hour' end,
          'ativar_entregadores', c, p.cidade, 'solicitacao', 5, true)
  returning * into a;
  return jsonb_build_object('titulo', a.titulo, 'meta', a.meta, 'nova', true);
end $$;

-- "Contou para": as automáticas da cidade contam para qualquer pessoa
create or replace function public.tarefas_que_contam(p_tipo text, p_cidade text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'titulo', a.titulo, 'meta', a.meta, 'progresso', public.progresso_tarefa(a)) order by a.automatica, a.aceita_em)
    from public.atividades a
   where a.tipo = p_tipo and a.modo = 'solicitacao' and a.cidade = upper(btrim(p_cidade))
     and ((a.status = 'aceita' and public.participa(a)) or (a.automatica and a.status in ('aberta', 'aceita')))), '[]');
end $$;

CREATE OR REPLACE FUNCTION public.json_atividade(a atividades)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', a.id, 'titulo', a.titulo, 'descricao', a.descricao,
    'criada_por', a.criada_por, 'criada_por_nome', a.criada_por_nome, 'criada_em', a.criada_em,
    'sugeridas_para', to_jsonb(a.sugeridas_para),
    'sugeridas_nomes', coalesce((select jsonb_agg(m.nome order by m.nome) from public.membros m where m.user_id = any (a.sugeridas_para)), '[]'),
    'para_todos', cardinality(a.sugeridas_para) = 0 or a.criada_em <= now() - interval '10 minutes',
    'para_mim', auth.uid() = any (a.sugeridas_para),
    'opcional', a.opcional, 'opcional_para_mim', a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false),
    'cadastro_id', a.cadastro_id,
    'prazo', a.prazo, 'status', a.status,
    'aceita_por', a.aceita_por, 'aceita_por_nome', a.aceita_por_nome, 'aceita_em', a.aceita_em,
    'concluida_por_nome', a.concluida_por_nome, 'concluida_em', a.concluida_em, 'nota', a.nota,
    'previsao', a.previsao, 'previsao_por_nome', a.previsao_por_nome,
    -- 009d2
    'tipo', coalesce(a.tipo, 'livre'), 'tipo_nome', coalesce(t.nome, 'Outra tarefa'), 'tipo_icone', coalesce(t.icone, '📝'),
    'campos', a.campos, 'cidade', a.cidade, 'modo', a.modo,
    'meta', a.meta, 'progresso', public.progresso_tarefa(a), 'progresso_automatico', a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.modo = 'solicitacao',
    'aguardando_desde', a.aguardando_desde, 'aguardando_motivo', a.aguardando_motivo,
    'checklist', a.checklist,
    'seg_espera', extract(epoch from coalesce(a.aceita_em, now()) - a.criada_em)::int,
    'seg_execucao', public.segundos_execucao(a),
    'atrasada', a.prazo is not null and a.status <> 'concluida' and a.aguardando_desde is null and now() > a.prazo,
    'comentarios', (select count(*) from public.comentarios_tarefa x where x.atividade_id = a.id),
    'agradecimentos', coalesce((select jsonb_agg(g.de_nome order by g.em) from public.agradecimentos g where g.atividade_id = a.id), '[]'),
    'agradeci', exists (select 1 from public.agradecimentos g where g.atividade_id = a.id and g.de = auth.uid()),
    'pode_agradecer', a.status = 'concluida' and a.aceita_por is not null and a.aceita_por <> auth.uid(),
    'pode_mexer', public.pode_mexer_tarefa(a),
    'pode_aceitar', a.status = 'aberta' and public.atividade_aberta_para_mim(a),
    'pode_concluir', a.status = 'aceita' and (public.participa(a) or public.meu_papel() = 'moderador'),
    'pode_prever', a.status = 'aceita' and (public.participa(a) or public.meu_papel() = 'moderador'),
    'compartilhavel', public.compartilhavel(a)) || jsonb_build_object(
    'participantes', coalesce((select jsonb_agg(p->>'nome') from jsonb_array_elements(public.participantes_de(a)) p), '[]'),
    'sou_participante', coalesce(public.participa(a), false),
    'pode_entrar', a.status = 'aceita' and public.compartilhavel(a) and not coalesce(public.participa(a), false),
    'pode_excluir', a.criada_por = auth.uid() or public.meu_papel() = 'moderador',
    'recorrente', a.recorrente_id is not null,
    'automatica', a.automatica,
    'revisao', (select jsonb_build_object('resultado', v.resultado, 'comentario', v.comentario, 'por_nome', v.por_nome, 'em', v.em)
                  from public.revisoes_qualidade v where v.atividade_id = a.id and (a.aceita_por = auth.uid() or public.sou_moderador())))
  from (select 1) _ left join public.tipos_tarefa t on t.tipo = a.tipo
$function$;

-- ---------------------------------------------------------------------
-- 1b. A tarefa automática fecha sozinha ao bater a meta
-- ---------------------------------------------------------------------
create or replace function public.fechar_tarefas_automaticas(p_cidade text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; nomes text; quem uuid;
begin
  for a in select * from public.atividades
            where automatica and status in ('aberta', 'aceita') and cidade = p_cidade and meta is not null
            for update loop
    if public.progresso_tarefa(a) < a.meta then continue; end if;
    -- quem aprovou os cadastros que contaram, mais quem estava na tarefa
    with gente as (
      select distinct e.por as id from public.eventos e join public.cadastros c on c.id = e.cadastro_id
       where e.tipo = 'aprovado' and c.status = 'aprovado' and c.cidade = a.cidade and e.em >= a.criada_em
      union select (p->>'id')::uuid from jsonb_array_elements(public.participantes_de(a)) p)
    select string_agg(m.nome, ', ' order by m.nome) into nomes from gente g join public.membros m on m.user_id = g.id;
    update public.atividades set status = 'concluida', concluida_em = now(), concluida_por_nome = 'Equipe',
           nota = left('Meta atingida pela equipe. Participaram: ' || coalesce(nomes, '-'), 600)
     where id = a.id;
    for quem in
      select distinct e.por from public.eventos e join public.cadastros c on c.id = e.cadastro_id
       where e.tipo = 'aprovado' and c.status = 'aprovado' and c.cidade = a.cidade and e.em >= a.criada_em
      union select (p->>'id')::uuid from jsonb_array_elements(public.participantes_de(a)) p
    loop
      perform public.notificar(quem, format('Meta da equipe atingida: %s. Participaram: %s.', a.titulo, coalesce(nomes, '-')), '#atividades/sugeridas');
    end loop;
  end loop;
end $$;

create or replace function public.aprovacao_fecha_tarefas()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid text;
begin
  if new.tipo = 'aprovado' then
    select cidade into cid from public.cadastros where id = new.cadastro_id;
    if cid is not null then perform public.fechar_tarefas_automaticas(cid); end if;
  end if;
  return null;
end $$;
drop trigger if exists zz_aprovacao_fecha_tarefas on public.eventos;
create trigger zz_aprovacao_fecha_tarefas after insert on public.eventos
  for each row execute function public.aprovacao_fecha_tarefas();

-- ---------------------------------------------------------------------
-- 2. A6-01: ex-membro não lê nem recebe avisos
-- ---------------------------------------------------------------------
drop policy if exists notificacoes_leitura on public.notificacoes;
create policy notificacoes_leitura on public.notificacoes for select to authenticated
  using (para = (select auth.uid()) and exists (select 1 from public.membros m where m.user_id = (select auth.uid())));

-- aviso para quem não é (mais) da equipe não é gravado (vale para notificar, avisar_registro, avisar_equipe...)
create or replace function public.aviso_so_para_membros()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.membros m where m.user_id = new.para) then return null; end if;
  return new;
end $$;
drop trigger if exists aa0_so_para_membros on public.notificacoes;
create trigger aa0_so_para_membros before insert on public.notificacoes
  for each row execute function public.aviso_so_para_membros();

create or replace function public.membro_removido_limpa_avisos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.user_id is not null then
    delete from public.notificacoes where para = old.user_id;
    delete from public.seguindo where para = old.user_id;
    delete from public.preferencias_aviso where para = old.user_id;
  end if;
  return null;
end $$;
drop trigger if exists zz_membro_removido_limpa_avisos on public.membros;
create trigger zz_membro_removido_limpa_avisos after delete on public.membros
  for each row execute function public.membro_removido_limpa_avisos();

-- quem já tinha saído antes desta migração
delete from public.notificacoes n where n.id is not null and not exists (select 1 from public.membros m where m.user_id = n.para);
delete from public.seguindo s where s.para is not null and not exists (select 1 from public.membros m where m.user_id = s.para);
delete from public.preferencias_aviso s where s.para is not null and not exists (select 1 from public.membros m where m.user_id = s.para);

-- ---------------------------------------------------------------------
-- 3. A5-09: reverter um encerramento fecha a tarefa de encerramento pendente
-- ---------------------------------------------------------------------
create or replace function public.reverter_fecha_encerramento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'liberado_antes' then
    update public.tarefas set status = 'concluida', concluida_em = now(), concluida_por = new.por,
           nota = left(coalesce(nullif(new.detalhe, ''), 'Encerramento revertido.'), 600)
     where bloqueio_id = new.bloqueio_id and tipo = 'encerramento_parceria' and status = 'pendente';
  end if;
  return null;
end $$;
drop trigger if exists zz_reverter_fecha_encerramento on public.eventos_bloqueio;
create trigger zz_reverter_fecha_encerramento after insert on public.eventos_bloqueio
  for each row execute function public.reverter_fecha_encerramento();

-- os que já foram revertidos antes desta migração
update public.tarefas t set status = 'concluida', concluida_em = now(), nota = 'Encerramento revertido.'
 where t.tipo = 'encerramento_parceria' and t.status = 'pendente'
   and exists (select 1 from public.bloqueios b where b.id = t.bloqueio_id and b.liberado_em is not null);

-- ---------------------------------------------------------------------
-- 4. A8-04: adicional repetido pergunta antes de gravar
-- ---------------------------------------------------------------------
drop function if exists public.registrar_adicional(text, text, text, text, boolean, text, numeric, numeric, numeric, boolean, text, text);
create or replace function public.registrar_adicional(
  p_cidade text, p_id_app text, p_nome text, p_origem text, p_mercado boolean, p_motivo text,
  p_valor_entrega numeric, p_valor_pedido numeric, p_valor_combinado numeric,
  p_lancado boolean default false, p_pedido text default null, p_observacao text default null,
  p_confirmar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; l public.lancamentos_financeiros; x public.lancamentos_financeiros;
        ped text := nullif(btrim(coalesce(p_pedido, '')), '');
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_origem is null or p_origem not in ('qd', 'outros') then raise exception 'Escolha de onde veio o pedido (QD ou outros).'; end if;
  if p_mercado is null then raise exception 'Diga se o pedido é de mercado.'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escolha o motivo do adicional.'; end if;
  if p_valor_entrega is null or p_valor_pedido is null or p_valor_combinado is null then
    raise exception 'Preencha o valor da entrega, o valor do pedido e o valor combinado.';
  end if;
  if p_valor_entrega < 0 or p_valor_pedido < 0 or p_valor_combinado < 0 then raise exception 'Os valores não podem ser negativos.'; end if;
  if p_valor_combinado <= p_valor_entrega then
    raise exception 'O valor combinado precisa ser maior que o valor da entrega (o adicional é a diferença).';
  end if;
  select * into v from public.validar_entregador_lancamento(p_id_app, p_nome, p_cidade);
  if v.cidade is null then raise exception 'Escolha a cidade.'; end if;
  if not coalesce(p_confirmar, false) then
    select * into x from public.lancamentos_financeiros f
     where f.tipo = 'adicional' and lower(f.id_app) = lower(v.id_app)
       and ((ped is not null and lower(f.pedido) = lower(ped))
         or (f.valor = p_valor_combinado - p_valor_entrega and (f.criado_em at time zone 'America/Sao_Paulo')::date = public.hoje_brasilia()))
     order by f.criado_em desc limit 1;
    if x.id is not null then
      return jsonb_build_object('precisa_confirmar', true, 'parecido', public.json_lancamento(x),
        'texto', format('Já existe um adicional de %s para %s%s, registrado por %s em %s. Registrar mesmo assim?',
          'R$ ' || replace(to_char(x.valor, 'FM999990.00'), '.', ','), coalesce(x.nome_entregador, 'este entregador'),
          case when x.pedido is not null then ' (pedido ' || x.pedido || ')' else '' end,
          coalesce(x.registrado_por_nome, 'alguém'), to_char(x.criado_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')));
    end if;
  end if;
  insert into public.lancamentos_financeiros (tipo, cidade, id_app, nome_entregador, pedido, origem, mercado, motivo,
      valor_entrega, valor_pedido, valor_combinado, valor,
      lancado, lancado_em, lancado_por, lancado_por_nome, observacao, registrado_por, registrado_por_nome)
  values ('adicional', v.cidade, v.id_app, v.nome, ped, p_origem, p_mercado, btrim(p_motivo),
      p_valor_entrega, p_valor_pedido, p_valor_combinado, p_valor_combinado - p_valor_entrega,
      coalesce(p_lancado, false), case when p_lancado then now() end, case when p_lancado then auth.uid() end,
      case when p_lancado then public.nome_de(auth.uid()) end,
      nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(), public.nome_de(auth.uid()))
  returning * into l;
  return public.json_lancamento(l);
end $$;

revoke all on function public.aprovacoes_de(text, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.progresso_tarefa(public.atividades) from public, anon, authenticated;
revoke all on function public.tarefa_entregadores_do_parceiro(public.parceiros) from public, anon, authenticated;
revoke all on function public.json_atividade(public.atividades) from public, anon, authenticated;
revoke all on function public.tarefas_que_contam(text, text) from public, anon;
grant execute on function public.tarefas_que_contam(text, text) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.fechar_tarefas_automaticas(text)', 'public.aprovacao_fecha_tarefas()', 'public.aviso_so_para_membros()',
                           'public.membro_removido_limpa_avisos()', 'public.reverter_fecha_encerramento()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.registrar_adicional(text, text, text, text, boolean, text, numeric, numeric, numeric, boolean, text, text, boolean) from public, anon;
grant execute on function public.registrar_adicional(text, text, text, text, boolean, text, numeric, numeric, numeric, boolean, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
