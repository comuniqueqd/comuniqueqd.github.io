-- =====================================================================
-- 009g: tarefas de aprovação compartilhadas e a tarefa automática do parceiro.
--
-- * Tarefas compartilháveis = "Aprovar entregadores" e "Aprovar parceiros"
--   (pedidos, não registros). Quem aceita não fecha a tarefa para os outros:
--   ela continua visível nas abertas ("fulano já está trabalhando nela") e
--   qualquer pessoa pode "Entrar junto". atividades.participantes guarda
--   [{id, nome, desde}]; o progresso soma as aprovações de cada participante,
--   na cidade, desde que entrou. Qualquer participante conclui, pausa, mexe no
--   checklist e define a previsão.
-- * Ativar um parceiro: se já existe uma "Aprovar entregadores" ativa (aberta ou
--   em andamento) na cidade, a meta dela sobe 5 (quem está nela é avisado);
--   senão nasce "Aprovar 5 entregadores · cidade", aberta para a equipe, com o
--   prazo padrão do tipo.
-- Pode rodar mais de uma vez. Rodar depois da 009f.
-- =====================================================================

alter table public.atividades add column if not exists participantes jsonb not null default '[]';

create or replace function public.compartilhavel(a public.atividades)
returns boolean language sql immutable as $$
  select a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.modo = 'solicitacao'
$$;

-- participantes (as tarefas aceitas antes da 009g têm só quem aceitou)
create or replace function public.participantes_de(a public.atividades)
returns jsonb language sql stable as $$
  select case when jsonb_array_length(a.participantes) > 0 then a.participantes
              when a.aceita_por is not null then jsonb_build_array(jsonb_build_object('id', a.aceita_por, 'nome', a.aceita_por_nome, 'desde', a.aceita_em))
              else '[]'::jsonb end
$$;

create or replace function public.participa(a public.atividades)
returns boolean language sql stable as $$
  select coalesce(a.aceita_por = auth.uid(), false) or exists (select 1 from jsonb_array_elements(a.participantes) p where (p->>'id')::uuid = auth.uid())
$$;

create or replace function public.progresso_tarefa(a public.atividades)
returns int language sql stable security definer set search_path = public as $$
  select case
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.modo = 'registro' then coalesce(a.meta, a.progresso)
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.aceita_por is not null then
      (select coalesce(sum(public.aprovacoes_de(a.tipo, (p->>'id')::uuid, a.cidade, (p->>'desde')::timestamptz, a.concluida_em)), 0)::int
         from jsonb_array_elements(public.participantes_de(a)) p)
    else a.progresso end
$$;

create or replace function public.pode_mexer_tarefa(a public.atividades)
returns boolean language sql stable security definer set search_path = public as $$
  select a.criada_por = auth.uid() or public.participa(a) or public.meu_papel() = 'moderador'
$$;

-- aceitar: na compartilhável já aceita, "entrar junto"
create or replace function public.aceitar_atividade(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := (select nome from public.membros where email = public.meu_email()); p jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Atividade não encontrada.'; end if;
  if a.status = 'aceita' and public.compartilhavel(a) then
    if public.participa(a) then raise exception 'Você já está nesta tarefa.'; end if;
    update public.atividades set participantes = public.participantes_de(a) || jsonb_build_array(jsonb_build_object('id', auth.uid(), 'nome', quem, 'desde', now()))
     where id = a.id;
    for p in select * from jsonb_array_elements(public.participantes_de(a)) loop
      perform public.notificar((p->>'id')::uuid, format('%s entrou junto na tarefa: %s', quem, a.titulo), '#atividades/sugeridas');
    end loop;
    return;
  end if;
  if a.status <> 'aberta' then raise exception 'Esta atividade já foi aceita por %.', a.aceita_por_nome; end if;
  if not public.atividade_aberta_para_mim(a) then
    raise exception 'Esta atividade foi sugerida para outras pessoas. Se ninguém aceitar em 10 minutos, ela abre para todos.' using errcode = '42501';
  end if;
  update public.atividades set status = 'aceita', aceita_por = auth.uid(), aceita_por_nome = quem, aceita_em = now(),
         participantes = case when public.compartilhavel(a) then jsonb_build_array(jsonb_build_object('id', auth.uid(), 'nome', quem, 'desde', now())) else '[]' end
   where id = a.id;
  if a.criada_por is distinct from auth.uid() then
    perform public.notificar(a.criada_por, format('%s aceitou a atividade: %s', quem, a.titulo), '#atividades/sugeridas');
  end if;
end $$;

-- concluir: quem aceitou, qualquer participante ou moderador
create or replace function public.concluir_atividade(p_id uuid, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := (select nome from public.membros where email = public.meu_email()); p jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Atividade não encontrada.'; end if;
  if a.status <> 'aceita' then raise exception 'Só dá para concluir uma atividade aceita.'; end if;
  if not public.participa(a) and public.meu_papel() <> 'moderador' then
    raise exception 'Só quem está na tarefa (ou um moderador) conclui esta atividade.' using errcode = '42501';
  end if;
  update public.atividades set status = 'concluida', concluida_por = auth.uid(), concluida_por_nome = quem, concluida_em = now(),
         pausa_seg = pausa_seg + coalesce(extract(epoch from now() - aguardando_desde)::int, 0), aguardando_desde = null,
         progresso = case when tipo in ('ativar_entregadores', 'ativar_parceiro') then public.progresso_tarefa(a) else progresso end,
         nota = left(nullif(btrim(coalesce(p_nota, '')), ''), 600) where id = a.id;
  if a.criada_por is distinct from auth.uid() then
    perform public.notificar(a.criada_por, format('%s concluiu a atividade: %s', quem, a.titulo), '#atividades/sugeridas');
  end if;
  for p in select * from jsonb_array_elements(public.participantes_de(a)) loop
    if (p->>'id')::uuid is distinct from auth.uid() and (p->>'id')::uuid is distinct from a.criada_por then
      perform public.notificar((p->>'id')::uuid, format('%s concluiu a tarefa em que você estava: %s', quem, a.titulo), '#atividades/sugeridas');
    end if;
  end loop;
end $$;

-- pausar/retomar: qualquer participante
do $$
declare def text;
begin
  def := pg_get_functiondef('public.aguardar_terceiro(uuid, text)'::regprocedure);
  if position('a.aceita_por is distinct from auth.uid() and public.meu_papel()' in def) > 0 then
    execute replace(def, 'a.aceita_por is distinct from auth.uid() and public.meu_papel()', 'not public.participa(a) and public.meu_papel()');
  end if;
end $$;

-- as minhas tarefas em andamento em que uma aprovação conta (agora também as compartilhadas)
create or replace function public.tarefas_que_contam(p_tipo text, p_cidade text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'titulo', a.titulo, 'meta', a.meta, 'progresso', public.progresso_tarefa(a)) order by a.aceita_em)
    from public.atividades a
   where a.status = 'aceita' and public.participa(a) and a.tipo = p_tipo and a.modo = 'solicitacao' and a.cidade = upper(btrim(p_cidade))), '[]');
end $$;

-- o card: participantes, entrar junto e quem pode concluir/prever
do $$
declare def text;
begin
  def := pg_get_functiondef('public.json_atividade(public.atividades)'::regprocedure);
  if position('''participantes''' in def) = 0 then
    def := replace(def, '''pode_concluir'', a.status = ''aceita'' and (a.aceita_por = auth.uid() or',
                        '''pode_concluir'', a.status = ''aceita'' and (public.participa(a) or');
    def := replace(def, '''pode_prever'', a.status = ''aceita'' and (a.aceita_por = auth.uid() or',
                        '''pode_prever'', a.status = ''aceita'' and (public.participa(a) or');
    -- (o jsonb_build_object aceita até 100 argumentos: os campos novos vão num segundo objeto somado)
    def := replace(def, '''pode_excluir'', a.criada_por = auth.uid()',
      '''compartilhavel'', public.compartilhavel(a)) || jsonb_build_object(
    ''participantes'', coalesce((select jsonb_agg(p->>''nome'') from jsonb_array_elements(public.participantes_de(a)) p), ''[]''),
    ''sou_participante'', coalesce(public.participa(a), false),
    ''pode_entrar'', a.status = ''aceita'' and public.compartilhavel(a) and not coalesce(public.participa(a), false),
    ''pode_excluir'', a.criada_por = auth.uid()');
    if position('''participantes''' in def) = 0 or position('public.participa(a) or public.meu_papel() = ''moderador'')' in def) = 0 then
      raise exception 'Não consegui incluir os participantes no json_atividade.';
    end if;
    execute def;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Ativar parceiro → "Aprovar 5 entregadores" na cidade (ou +5 na que já existe)
-- ---------------------------------------------------------------------
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
  insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, tipo, campos, cidade, modo, meta)
  values (public.titulo_tarefa('ativar_entregadores', c, null), format('Criada sozinha ao ativar o parceiro %s.', p.estabelecimento),
          auth.uid(), quem, '{}', case when tt.prazo_horas is not null then now() + tt.prazo_horas * interval '1 hour' end,
          'ativar_entregadores', c, p.cidade, 'solicitacao', 5)
  returning * into a;
  return jsonb_build_object('titulo', a.titulo, 'meta', a.meta, 'nova', true);
end $$;

create or replace function public.registrar_parceiro(p_estabelecimento text, p_cidade text, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.parceiros; quem text := public.nome_de(auth.uid()); cid text := upper(btrim(coalesce(p_cidade, ''))); t jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if nullif(btrim(coalesce(p_estabelecimento, '')), '') is null then raise exception 'Informe o nome do estabelecimento.'; end if;
  if cid !~ '^\S.* - [A-Z]{2}$' then raise exception 'Informe a cidade no formato CIDADE - UF.'; end if;
  if length(coalesce(p_observacao, '')) > 600 then raise exception 'A observação vai até 600 caracteres.'; end if;
  if exists (select 1 from public.parceiros x where lower(btrim(x.estabelecimento)) = lower(btrim(p_estabelecimento)) and x.cidade = cid) then
    raise exception '% já está registrado como parceiro em %.', btrim(p_estabelecimento), cid;
  end if;
  insert into public.parceiros (estabelecimento, cidade, observacao, criado_por, criado_por_nome)
  values (btrim(p_estabelecimento), cid, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(), quem)
  returning * into p;
  perform public.avisar_registro('ativacao', format('%s ativou o parceiro %s (%s).', quem, p.estabelecimento, p.cidade), '#parceiros/lista', p.cidade, null, false);
  t := public.tarefa_entregadores_do_parceiro(p);
  return jsonb_build_object('parceiro', public.parceiro_json(p), 'tarefas', public.tarefas_que_contam('ativar_parceiro', p.cidade), 'tarefa_entregadores', t);
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function public.compartilhavel(public.atividades) from public, anon, authenticated;
revoke all on function public.participantes_de(public.atividades) from public, anon, authenticated;
revoke all on function public.participa(public.atividades) from public, anon, authenticated;
revoke all on function public.progresso_tarefa(public.atividades) from public, anon, authenticated;
revoke all on function public.pode_mexer_tarefa(public.atividades) from public, anon, authenticated;
revoke all on function public.json_atividade(public.atividades) from public, anon, authenticated;
revoke all on function public.tarefa_entregadores_do_parceiro(public.parceiros) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.aceitar_atividade(uuid)', 'public.concluir_atividade(uuid, text)', 'public.aguardar_terceiro(uuid, text)',
                           'public.tarefas_que_contam(text, text)', 'public.registrar_parceiro(text, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
