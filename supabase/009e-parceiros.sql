-- =====================================================================
-- 009e: Parceiros (segundo processo de ativação) e tarefas que contam sozinhas.
--
-- * parceiros: registro direto (quem ativou registra; todos os papéis), com
--   estabelecimento, cidade e observação. Nome repetido na mesma cidade é recusado.
--   Avisa os moderadores e o responsável da cidade (categoria "ativacao").
-- * Tarefas "Aprovar entregadores" e "Aprovar parceiros" (os tipos
--   ativar_entregadores e ativar_parceiro ganham esses nomes): o progresso conta
--   sozinho as aprovações FEITAS por quem está com a tarefa, na cidade da tarefa,
--   depois que pegou (entregadores = cadastros que a pessoa aprovou e continuam
--   aprovados; parceiros = parceiros que a pessoa registrou). Toda tarefa desses
--   tipos no nome da pessoa conta junto. Continuam podendo ser concluídas à mão.
--   "Registrar o que já fiz" desses tipos conta a quantidade informada.
-- * Metas pessoais desses dois tipos contam as aprovações direto (não as tarefas).
-- * tarefas_que_contam(p_tipo, p_cidade): o front mostra, depois de aprovar,
--   em quais tarefas a aprovação entrou.
-- Pode rodar mais de uma vez. Rodar depois da 009d3.
-- =====================================================================

create table if not exists public.parceiros (
  id               bigint generated always as identity primary key,
  estabelecimento  text not null check (length(btrim(estabelecimento)) between 1 and 150),
  cidade           text not null check (cidade ~ '^\S.* - [A-Z]{2}$' and length(cidade) <= 80),
  observacao       text check (length(observacao) <= 600),
  criado_por       uuid not null,
  criado_por_nome  text,
  criado_em        timestamptz not null default now()
);
create unique index if not exists parceiros_unico on public.parceiros (lower(btrim(estabelecimento)), cidade);
create index if not exists parceiros_quem on public.parceiros (criado_por, cidade, criado_em);
alter table public.parceiros enable row level security;
revoke all on public.parceiros from anon, authenticated;

-- nomes novos dos tipos (só se ninguém mudou o nome)
update public.tipos_tarefa set nome = 'Aprovar entregadores' where tipo = 'ativar_entregadores' and nome = 'Ativar entregadores';
update public.tipos_tarefa set nome = 'Aprovar parceiros' where tipo = 'ativar_parceiro' and nome = 'Ativar parceiro';
update public.atividades set titulo = regexp_replace(titulo, '^Ativar ', 'Aprovar ')
 where tipo in ('ativar_entregadores', 'ativar_parceiro') and titulo like 'Ativar %';

create or replace function public.titulo_tarefa(p_tipo text, c jsonb, p_titulo text default null)
returns text language sql stable set search_path = public as $$
  select left(case p_tipo
    when 'ativar_entregadores' then format('Aprovar %s entregador(es) · %s', c->>'quantidade', c->>'cidade')
    when 'ativar_parceiro' then format('Aprovar %s parceiro(s) · %s', c->>'quantidade', c->>'cidade')
    when 'fazer_contato' then format('Fazer contato: %s · %s', c->>'contato', c->>'cidade')
    when 'contato_entregador' then format('Contato com entregador %s%s', coalesce((select e.nome from public.entregadores e where e.id_app = c->>'id_app'), c->>'id_app'),
                                          case when (c->>'tratativa')::boolean then ' · tratativa' else ' · ' || (c->>'motivo') end)
    when 'pedido_problema' then format('Pedido com problema: %s · %s', c->>'pedido', c->>'cidade')
    when 'pagamento_entregador' then format('Pagamento ao entregador %s · R$ %s', coalesce((select e.nome from public.entregadores e where e.id_app = c->>'id_app'), c->>'id_app'),
                                            replace(to_char((c->>'valor')::numeric, 'FM999990.00'), '.', ','))
    when 'revisar_registro' then format('Revisar registro: %s', c->>'referencia')
    when 'criar_comunicado' then format('Criar comunicado para entregadores · %s', c->>'cidade')
    when 'procurar_entregador' then format('Procurar entregador · %s', c->>'cidade')
    else btrim(coalesce(p_titulo, '')) end, 150)
$$;

-- quantas aprovações a pessoa fez na cidade, num intervalo
create or replace function public.aprovacoes_de(p_tipo text, p_quem uuid, p_cidade text, p_de timestamptz, p_ate timestamptz default null)
returns int language sql stable security definer set search_path = public as $$
  select case p_tipo
    when 'ativar_entregadores' then (select count(distinct c.id)::int from public.cadastros c
        where c.status = 'aprovado' and (p_cidade is null or c.cidade = p_cidade)
          and exists (select 1 from public.eventos e where e.cadastro_id = c.id and e.tipo = 'aprovado' and e.por = p_quem
                        and e.em >= p_de and (p_ate is null or e.em <= p_ate)))
    when 'ativar_parceiro' then (select count(*)::int from public.parceiros p
        where p.criado_por = p_quem and (p_cidade is null or p.cidade = p_cidade) and p.criado_em >= p_de and (p_ate is null or p.criado_em <= p_ate))
    else 0 end
$$;

create or replace function public.progresso_tarefa(a public.atividades)
returns int language sql stable security definer set search_path = public as $$
  select case
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.modo = 'registro' then coalesce(a.meta, a.progresso)
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.aceita_por is not null then
      public.aprovacoes_de(a.tipo, a.aceita_por, a.cidade, a.aceita_em, a.concluida_em)
    else a.progresso end
$$;

create or replace function public.avancar_tarefa(p_id uuid, p_delta int default 1)
returns int language plpgsql security definer set search_path = public as $$
declare a public.atividades; novo int;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Tarefa não encontrada.'; end if;
  if a.meta is null then raise exception 'Esta tarefa não tem meta.'; end if;
  if a.tipo in ('ativar_entregadores', 'ativar_parceiro') then raise exception 'O progresso desta tarefa conta sozinho (as aprovações de quem está com ela).'; end if;
  if a.status = 'aberta' then raise exception 'Pegue a tarefa antes de marcar o progresso.'; end if;
  if not public.pode_mexer_tarefa(a) then raise exception 'Só quem está com a tarefa marca o progresso.' using errcode = '42501'; end if;
  novo := greatest(0, least(a.meta * 10, a.progresso + coalesce(p_delta, 1)));
  update public.atividades set progresso = novo where id = a.id;
  return novo;
end $$;

-- o card avisa que os dois tipos contam sozinhos
do $$
declare def text;
begin
  def := pg_get_functiondef('public.json_atividade(public.atividades)'::regprocedure);
  if position('''progresso_automatico'', a.tipo = ''ativar_entregadores''' in def) > 0 then
    def := replace(def, '''progresso_automatico'', a.tipo = ''ativar_entregadores''',
                        '''progresso_automatico'', a.tipo in (''ativar_entregadores'', ''ativar_parceiro'') and a.modo = ''solicitacao''');
    execute def;
  end if;
end $$;

-- metas: os dois tipos de aprovação contam as aprovações direto
create or replace function public.minhas_metas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := public.hoje_brasilia();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'tipo_nome', coalesce(t.nome, 'Qualquer tarefa'), 'icone', coalesce(t.icone, '🎯'),
      'quantidade', x.quantidade, 'periodo', x.periodo, 'desde', d.desde,
      'conta', case when x.tipo in ('ativar_entregadores', 'ativar_parceiro') then 'aprovacoes' else 'tarefas' end,
      'feitas', case when x.tipo in ('ativar_entregadores', 'ativar_parceiro')
        then public.aprovacoes_de(x.tipo, auth.uid(), null, (d.desde::timestamp at time zone 'America/Sao_Paulo'))
        else (select count(*) from public.atividades a
               where a.status = 'concluida' and a.aceita_por = auth.uid() and (x.tipo is null or coalesce(a.tipo, 'livre') = x.tipo)
                 and (a.concluida_em at time zone 'America/Sao_Paulo')::date >= d.desde) end)
      order by x.id)
    from public.metas x left join public.tipos_tarefa t on t.tipo = x.tipo
    cross join lateral (select case x.periodo when 'dia' then hoje else public.inicio_semana(hoje) end desde) d
   where x.para = auth.uid()), '[]');
end $$;

-- as minhas tarefas em andamento em que uma aprovação conta (para o aviso depois de aprovar)
create or replace function public.tarefas_que_contam(p_tipo text, p_cidade text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'titulo', a.titulo, 'meta', a.meta, 'progresso', public.progresso_tarefa(a)) order by a.aceita_em)
    from public.atividades a
   where a.status = 'aceita' and a.aceita_por = auth.uid() and a.tipo = p_tipo and a.modo = 'solicitacao' and a.cidade = upper(btrim(p_cidade))), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Parceiros
-- ---------------------------------------------------------------------
create or replace function public.parceiro_json(p public.parceiros)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'criado_por' || jsonb_build_object('meu', p.criado_por = auth.uid(),
    'pode_excluir', p.criado_por = auth.uid() or public.sou_moderador())
$$;

create or replace function public.registrar_parceiro(p_estabelecimento text, p_cidade text, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.parceiros; quem text := public.nome_de(auth.uid()); cid text := upper(btrim(coalesce(p_cidade, '')));
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
  return jsonb_build_object('parceiro', public.parceiro_json(p), 'tarefas', public.tarefas_que_contam('ativar_parceiro', p.cidade));
end $$;

create or replace function public.listar_parceiros(p_busca text default null, p_cidade text default null, p_meus boolean default false, p_limite int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'itens', coalesce((select jsonb_agg(public.parceiro_json(p) order by p.criado_em desc) from (
        select * from public.parceiros x
         where (p_cidade is null or x.cidade = p_cidade) and (not coalesce(p_meus, false) or x.criado_por = auth.uid())
           and (q is null or x.estabelecimento ilike '%' || q || '%' or x.observacao ilike '%' || q || '%')
         order by x.criado_em desc limit greatest(1, least(coalesce(p_limite, 200), 2000))) p), '[]'),
    'total', (select count(*) from public.parceiros),
    'por_cidade', coalesce((select jsonb_agg(jsonb_build_object('cidade', cidade, 'n', n) order by n desc, cidade)
        from (select cidade, count(*) n from public.parceiros group by cidade) c), '[]'),
    'meus_30d', (select count(*) from public.parceiros where criado_por = auth.uid() and criado_em > now() - interval '30 days'));
end $$;

create or replace function public.excluir_parceiro(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare p public.parceiros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into p from public.parceiros where id = p_id;
  if p.id is null then raise exception 'Parceiro não encontrado.'; end if;
  if p.criado_por <> auth.uid() and not public.sou_moderador() then raise exception 'Só quem registrou ou um moderador exclui.' using errcode = '42501'; end if;
  delete from public.parceiros where id = p.id;
end $$;

-- ---------------------------------------------------------------------
-- Permissões e tráfego
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = 'parceiros' and g.tgname = 'marcar_mudanca_ins') then
    create trigger marcar_mudanca_ins after insert on public.parceiros referencing new table as novas for each statement execute function public.marcar_mudanca_linhas();
    create trigger marcar_mudanca_upd after update on public.parceiros referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas();
    create trigger marcar_mudanca_del after delete on public.parceiros referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas();
  end if;
end $$;

revoke all on function public.titulo_tarefa(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.aprovacoes_de(text, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.progresso_tarefa(public.atividades) from public, anon, authenticated;
revoke all on function public.parceiro_json(public.parceiros) from public, anon, authenticated;
revoke all on function public.json_atividade(public.atividades) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.avancar_tarefa(uuid, int)', 'public.minhas_metas()', 'public.tarefas_que_contam(text, text)',
                           'public.registrar_parceiro(text, text, text)', 'public.listar_parceiros(text, text, boolean, int)', 'public.excluir_parceiro(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
