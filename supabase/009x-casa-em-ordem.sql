-- 009x "Casa em ordem" (pedido do usuário, 19/11/2026): listas com limite e o banco mais leve.
--   AT4/A3-03: o Histórico da ativação vem em páginas (listar_cadastros_pagina), as tratativas concluídas vêm
--              as mais recentes com "Ver mais" (listar_tarefas_concluidas) e as Atividades trazem só as N
--              concluídas mais recentes (listar_atividades(p_concluidas)).
--   AT2: índice parcial em bloqueios.gerou_bloqueio (o Resumo semanal varria a tabela inteira para cada bloqueio).
-- Correções do estudo de nov/2026: PB-1, PB-2 (contadores das tarefas), PB-3 (quem perde o papel nos bloqueios),
--   PB-4 (busca das concluídas), PB-5 e PB-6 (limpeza do código do entregador nos avisos).
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
       and (q is null or public.norm_nome(concat_ws(' ', (v.b).id_app, (v.b).nome_entregador, (v.b).infracao, (v.b).cidade,
              (v.b).registrado_por_nome, public.nome_por_email((v.t).responsavel_email))) like '%' || q || '%')
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

-- ---------------------------------------------------------------------
-- Correções do estudo de nov/2026 (revisor do contra)
-- ---------------------------------------------------------------------
-- PB-1: o número de tarefas em aberto (009v) contava tarefas que a pessoa ainda não vê (sugeridas a outra pessoa
--       nos primeiros 10 min). Agora conta só as que aparecem para ela, como a lista (moderador vê todas).
-- PB-2: quem "entra junto" numa tarefa compartilhada passa a contá-la em minhas_em_andamento.
do $$
declare def text; novo text;
begin
  def := pg_get_functiondef('public.resumo_inicio()'::regprocedure);
  novo := replace(def, $a$'abertas_para_pegar', count(*) filter (where a.status = 'aberta' and a.criada_por is distinct from auth.uid()))$a$,
    $a$'abertas_para_pegar', count(*) filter (where a.status = 'aberta' and a.criada_por is distinct from auth.uid() and (p = 'moderador' or public.atividade_aberta_para_mim(a))))$a$);
  if to_regprocedure('public.participa(public.atividades)') is not null then
    novo := replace(novo, $a$'minhas_em_andamento', count(*) filter (where a.status = 'aceita' and a.aceita_por = auth.uid())$a$,
      $a$'minhas_em_andamento', count(*) filter (where a.status = 'aceita' and public.participa(a))$a$);
  end if;
  if novo <> def then execute novo; end if;
end $$;

-- PB-3: quem perde o papel de monitorador/moderador nos bloqueios (ou sai da equipe) deixava cidades e tratativas
--       no nome dele. Agora: a cidade fica sem responsável (alguém pode pedir), as tratativas pendentes vão para o novo
--       responsável da cidade (ou para os moderadores) e, se a pessoa saiu da equipe, as tarefas que ela tinha
--       aceitado voltam a ficar abertas.
create or replace function public.membro_saiu_dos_bloqueios()
returns trigger language plpgsql security definer set search_path = public as $$
declare cids text[]; sai boolean;
begin
  sai := tg_op = 'DELETE' or (coalesce(old.papel_bloqueios::text, '') in ('moderador', 'monitorador')
                             and coalesce(new.papel_bloqueios::text, '') not in ('moderador', 'monitorador'));
  if sai then
    select coalesce(array_agg(distinct c), '{}') into cids from (
      select nome c from public.cidades where responsavel_email = old.email
      union select cidade from public.tarefas where responsavel_email = old.email and status = 'pendente' and cidade is not null) x;
    if tg_op = 'UPDATE' then
      update public.cidades set responsavel_email = null where responsavel_email = old.email;
      -- realocadas para a pessoa (não seguem a cidade): voltam para os moderadores
      update public.tarefas set responsavel_email = null where responsavel_email = old.email and status = 'pendente';
    end if;
    if cardinality(cids) > 0 then perform public.reatribuir_tarefas(cids); end if;
  end if;
  if tg_op = 'DELETE' and old.user_id is not null then
    update public.atividades set status = 'aberta', aceita_por = null, aceita_em = null,
           participantes = coalesce((select jsonb_agg(x) from jsonb_array_elements(participantes) x where x->>'id' <> old.user_id::text), '[]')
     where status = 'aceita' and aceita_por = old.user_id;
  end if;
  return null;
end $$;
drop trigger if exists zz_membro_saiu_dos_bloqueios on public.membros;
create trigger zz_membro_saiu_dos_bloqueios after update of papel_bloqueios or delete on public.membros
  for each row execute function public.membro_saiu_dos_bloqueios();

-- PB-5 e PB-6: a limpeza do código do entregador nos avisos (009u/009v) mexia em texto escrito pela equipe
--       (a placa "(QWE1A23)" sumia de um pedido de ajuda, "NATAL25" virava "sem nome") e não pegava IDs só de
--       números. Agora: só avisos sobre um entregador (link #ficha/#cadastro ou categoria de ativação, bloqueios,
--       comentários e financeiro); o ID vem do link ou do cadastro, e só é tirado o ID desse entregador. A
--       adivinhação pelo formato só vale quando o código existe numa ficha ou num cadastro.
create or replace function public.aviso_tira_id(t text, p_id text, p_nome text)
returns text language plpgsql immutable set search_path = public as $$
declare quem constant text := replace(coalesce(nullif(btrim(p_nome), ''), 'sem nome'), '\', '\\'); r text := t;
begin
  if r is null or p_id is null or length(p_id) < 4 then return r; end if;
  r := regexp_replace(r, '\s*\((ID\s+)?' || p_id || '\)', '', 'gi');
  r := regexp_replace(r, '\mID\s+' || p_id || '\M', quem, 'gi');
  r := regexp_replace(r, '\m' || p_id || '\M', quem, 'gi');
  return regexp_replace(r, '^👏\s*', '');
end $$;

create or replace function public.notificacao_sem_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare achado text;
begin
  new.texto := regexp_replace(new.texto, '^👏\s*', '');
  if not (new.id_app is not null or coalesce(new.link, '') ~ '^#(ficha|cadastro)/'
          or coalesce(new.categoria, '') in ('ativacao', 'bloqueios', 'comentarios', 'financeiro')) then
    return new;   -- ajuda, aviso geral, passagem de turno, tarefas: o texto fica como a pessoa escreveu
  end if;
  if new.id_app is null and coalesce(new.link, '') ~ '^#cadastro/[0-9a-fA-F-]{36}$' then
    select lower(c.id_app) into new.id_app from public.cadastros c where c.id::text = lower(substring(new.link from 11));
  end if;
  if new.id_app is null and coalesce(new.link, '') ~ '^#ficha/[A-Za-z0-9]{4,40}$' then new.id_app := lower(substring(new.link from 8)); end if;
  if new.id_app is null then
    achado := coalesce(substring(new.texto from '\((?:ID\s+)?([A-Za-z0-9]{4,40})\)'), substring(new.texto from '\mID\s+([A-Za-z0-9]{4,40})'));
    if achado is not null and (exists (select 1 from public.entregadores e where e.id_app = lower(achado))
                               or exists (select 1 from public.cadastros c where lower(c.id_app) = lower(achado))) then
      new.id_app := lower(achado);
    end if;
  end if;
  if new.id_app is not null and new.texto ~* ('\m' || new.id_app || '\M') then
    new.texto := public.aviso_tira_id(new.texto, new.id_app, public.nome_do_id(new.id_app));
  end if;
  return new;
end $$;

revoke all on function public.listar_cadastros_pagina(integer, integer, text, text, text, boolean) from public, anon;
revoke all on function public.listar_tarefas_concluidas(integer, text, text) from public, anon;
revoke all on function public.listar_atividades(integer) from public, anon;
revoke all on function public.membro_saiu_dos_bloqueios() from public, anon, authenticated;
revoke all on function public.aviso_tira_id(text, text, text) from public, anon, authenticated;
revoke all on function public.notificacao_sem_id() from public, anon, authenticated;
grant execute on function public.listar_cadastros_pagina(integer, integer, text, text, text, boolean) to authenticated;
grant execute on function public.listar_tarefas_concluidas(integer, text, text) to authenticated;
grant execute on function public.listar_atividades(integer) to authenticated;
