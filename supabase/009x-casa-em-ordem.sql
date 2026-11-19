-- 009x "Casa em ordem" (pedido do usuário, 19/11/2026): listas com limite e o banco mais leve.
--   AT4/A3-03: o Histórico da ativação vem em páginas (listar_cadastros_pagina), as tratativas concluídas vêm
--              as mais recentes com "Ver mais" (listar_tarefas_concluidas) e as Atividades trazem só as N
--              concluídas mais recentes (listar_atividades(p_concluidas)).
--   AT2: índice parcial em bloqueios.gerou_bloqueio (o Resumo semanal varria a tabela inteira para cada bloqueio).
-- Só funções novas (e listar_atividades ganha um parâmetro com padrão: sem ele, devolve o mesmo de antes).
-- Pode rodar de novo.

-- ---------------------------------------------------------------------
-- Histórico da ativação, em páginas (invoker: o RLS de cadastros faz o suporte ver só os que enviou)
-- ---------------------------------------------------------------------
create or replace function public.listar_cadastros_pagina(
  p_pagina integer default 1, p_por integer default 100, p_busca text default null,
  p_status text default null, p_cidade text default null, p_meus boolean default false)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  por integer := least(greatest(coalesce(p_por, 100), 1), 5000);
  pag integer := greatest(coalesce(p_pagina, 1), 1);
  q   text := public.norm_nome(p_busca);
  res jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  with base as (
    select c.* from public.cadastros c
     where not coalesce(p_meus, false) or c.enviado_por = auth.uid()),
  filtrada as (
    select b.* from base b
     where (p_cidade is null or b.cidade = p_cidade)
       and (p_status is null or (p_status = 'revisar' and public.motivo_revisar_cadastro(b) is not null)
            or b.status::text = p_status)
       and (q is null or public.norm_nome(concat_ws(' ', b.id_app, b.nome, b.cidade, public.nome_de(b.enviado_por), b.observacao)) like '%' || q || '%')),
  pagina as (
    select f.* from filtrada f order by f.enviado_em desc, f.id offset (pag - 1) * por limit por)
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'id_app', c.id_app, 'nome', c.nome, 'cidade', c.cidade, 'observacao', c.observacao,
        'status', c.status, 'enviado_por', c.enviado_por, 'enviado_por_nome', public.nome_de(c.enviado_por),
        'enviado_em', c.enviado_em, 'status_desde', c.status_desde,
        'motivo', c.motivo, 'detalhe', c.detalhe,
        'decidido_por_nome', case when c.decidido_por is not null then public.nome_de(c.decidido_por) end,
        'decidido_em', c.decidido_em,
        'revisar', public.motivo_revisar_cadastro(c), 'revisado', c.revisado,
        'reprovacoes', (select count(*) from public.eventos e where e.cadastro_id = c.id and e.tipo = 'reprovado'),
        'pode_desfazer', (select e.tipo in ('aprovado', 'reprovado', 'encerrado') from public.eventos e
                           where e.cadastro_id = c.id and e.tipo not in ('editado', 'revisado') order by e.id desc limit 1))
        order by c.enviado_em desc, c.id) from pagina c), '[]'),
    'total', (select count(*) from filtrada),
    'pagina', pag, 'por', por,
    'contagens', (select jsonb_build_object(
        'cadastros', count(*),
        'aguardando_analise', count(*) filter (where status = 'aguardando_analise'),
        'aguardando_contato', count(*) filter (where status = 'aguardando_contato'),
        'aprovado', count(*) filter (where status = 'aprovado'),
        'encerrado', count(*) filter (where status = 'encerrado')) from base),
    'cidades', coalesce((select jsonb_agg(distinct b.cidade order by b.cidade) from base b where b.cidade is not null), '[]'))
  into res;
  return res;
end $$;

-- ---------------------------------------------------------------------
-- Tratativas concluídas: as mais recentes, com busca e cidade no banco
-- ---------------------------------------------------------------------
create or replace function public.listar_tarefas_concluidas(
  p_limite integer default 100, p_busca text default null, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p   public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
  lim integer := least(greatest(coalesce(p_limite, 100), 1), 2000);
  q   text := public.norm_nome(p_busca);
  res jsonb;
begin
  with visiveis as (
    select t, b from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
     where t.status = 'concluida'
       and case p
             when 'moderador' then true
             when 'monitorador' then t.responsavel_email = public.meu_email() or t.tipo = 'completar_dados'
             else b.registrado_por = auth.uid()
           end),
  filtradas as (
    select v.* from visiveis v
     where (p_cidade is null or (v.b).cidade = p_cidade)
       and (q is null or public.norm_nome(concat_ws(' ', (v.b).id_app, (v.b).nome_entregador, (v.b).infracao, (v.b).cidade)) like '%' || q || '%')
     order by (v.t).concluida_em desc nulls last limit lim + 1)
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(public.json_tarefa(f.t) || jsonb_build_object(
        'cidade', (f.t).cidade,
        'minha', p = 'moderador' or (f.t).responsavel_email = public.meu_email() or ((f.t).tipo = 'completar_dados' and p = 'monitorador'),
        'bloqueio', public.json_bloqueio(f.b)) order by (f.t).concluida_em desc nulls last)
        from (select * from filtradas order by (t).concluida_em desc nulls last limit lim) f), '[]'),
    'mais', (select count(*) from filtradas) > lim,
    'cidades', coalesce((select jsonb_agg(distinct (v.b).cidade order by (v.b).cidade) from visiveis v where (v.b).cidade is not null), '[]'))
  into res;
  return res;
end $$;

-- ---------------------------------------------------------------------
-- Atividades: as concluídas vêm só as N mais recentes (dos últimos 30 dias); nulo = todas, como antes
-- ---------------------------------------------------------------------
drop function if exists public.listar_atividades();
create or replace function public.listar_atividades(p_concluidas integer default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_papel('moderador', 'monitorador', 'suporte');
begin
  return coalesce((select jsonb_agg(public.json_atividade(a) order by a.criada_em desc)
    from (
      select a.* from public.atividades a
       where (a.status = 'aberta' and (p = 'moderador' or a.criada_por = auth.uid() or public.atividade_aberta_para_mim(a)))
          or a.status = 'aceita'
      union all
      (select a.* from public.atividades a
        where a.status = 'concluida' and a.concluida_em > now() - interval '30 days'
          and (p_concluidas is null or p_concluidas > 0)
        order by a.concluida_em desc
        limit p_concluidas)) a), '[]');
end $$;

-- ---------------------------------------------------------------------
-- AT2: o Resumo semanal procura "a leve que gerou este bloqueio" para cada bloqueio
-- ---------------------------------------------------------------------
create index if not exists bloqueios_gerou_bloqueio_idx on public.bloqueios (gerou_bloqueio) where gerou_bloqueio is not null;

revoke all on function public.listar_cadastros_pagina(integer, integer, text, text, text, boolean) from public, anon;
revoke all on function public.listar_tarefas_concluidas(integer, text, text) from public, anon;
revoke all on function public.listar_atividades(integer) from public, anon;
grant execute on function public.listar_cadastros_pagina(integer, integer, text, text, text, boolean) to authenticated;
grant execute on function public.listar_tarefas_concluidas(integer, text, text) to authenticated;
grant execute on function public.listar_atividades(integer) to authenticated;
