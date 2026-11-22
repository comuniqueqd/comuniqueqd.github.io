-- 009z11 "Atraso a partir de 30 min nas Análises" (22/11/2026, pedido do usuário). Pode rodar de novo.
-- Só as Análises → Pedidos mudam; o Monitoramento continua com os sinais de antes (45 min), por enquanto.
--   * Atraso = mais de parametros_pedidos.analise_atraso_min (30) do chamado até a entrega.
--   * Causa do atraso = a etapa que MAIS passou do próprio limite (antes era a primeira de uma lista, e a rota,
--     que acontece em 40% dos pedidos, escondia a espera na loja):
--       entregador = chegada na loja além de 15 min, ou aceite → entrega além de 35 min saindo sozinho;
--       loja       = espera na loja além de 10 min;
--       aceite     = além de 10 min até alguém aceitar;
--       rota       = saiu com outro pedido e levou da loja ao cliente além de percurso_min (15 min);
--       outras     = nenhuma etapa passou do limite: a soma de pequenas demoras.
--     Empate: entregador, loja, aceite, rota.
--   * Além da causa principal, o resumo conta os atrasos em que houve espera na loja acima de 10 min (mesmo com outra
--     causa), para o card das lojas.
-- Os dias antigos guardados no resumo não têm essas contas (atraso_min nulo) e ficam fora das Análises até os
-- arquivos do Tableau serem reenviados (os pedidos entre 30 e 45 min das semanas antigas já foram apagados).

alter table public.parametros_pedidos add column if not exists analise_atraso_min integer not null default 30;
alter table public.parametros_pedidos add column if not exists percurso_min integer not null default 15;

alter table public.pedidos_resumo
  add column if not exists atraso_min       smallint,            -- o limite usado (nulo = resumo antigo, sem estas contas)
  add column if not exists atraso           integer not null default 0,
  add column if not exists at_entregador    integer not null default 0,
  add column if not exists at_loja          integer not null default 0,
  add column if not exists at_aceite        integer not null default 0,
  add column if not exists at_rota          integer not null default 0,
  add column if not exists at_outras        integer not null default 0,
  add column if not exists at_em_rota       integer not null default 0,   -- atrasos de pedidos que saíram em rota
  add column if not exists at_sozinho       integer not null default 0,
  add column if not exists at_espera_loja   integer not null default 0;   -- atrasos com espera na loja > 10 min

-- causa do atraso pela etapa que mais passou do próprio limite
create or replace function public.causa_atraso(p_chegada numeric, p_entrega numeric, p_aceitar numeric, p_espera numeric,
    p_percurso numeric, p_rota_n integer)
returns text language sql stable security definer set search_path = public as $$
  with par as (select * from public.parametros_pedidos where unico),
  ex as (
    select greatest(coalesce(p_chegada - par.chegada_min, -1), case when coalesce(p_rota_n, 1) <= 1 then coalesce(p_entrega - par.entrega_min, -1) else -1 end) e_ent,
           coalesce(p_espera - par.espera_min, -1) e_loja,
           coalesce(p_aceitar - par.aceitar_min, -1) e_aceite,
           case when coalesce(p_rota_n, 1) > 1 then coalesce(p_percurso - par.percurso_min, -1) else -1 end e_rota
      from par)
  select case when greatest(e_ent, e_loja, e_aceite, e_rota) <= 0 then 'outras'
              when e_ent >= greatest(e_loja, e_aceite, e_rota) then 'entregador'
              when e_loja >= greatest(e_aceite, e_rota) then 'loja'
              when e_aceite >= e_rota then 'aceite' else 'rota' end
    from ex
$$;

-- refaz o resumo dos dias (de Brasília) chamados entre p_de e p_ate, cidade a cidade, quando o dia está completo no
-- banco (tantos pedidos quanto pedidos_dia contou) e tem pelo menos os pedidos que o resumo já contava (corpo inteiro)
create or replace function public.resumir_pedidos(p_de timestamptz, p_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  select * into par from public.parametros_pedidos where unico;
  drop table if exists _resumo_novo;
  create temporary table _resumo_novo (like public.pedidos_resumo) on commit drop;
  insert into _resumo_novo (dia, hora, cidade, loja, pedidos, acima45, chegada15, entrega35,
      causa_entregador, causa_rota, causa_aceite, causa_loja, causa_outras, em_rota, em_rota_acima45, sozinho_acima45,
      n_preparo, soma_preparo, preparo30, n_espera, soma_espera, espera10, n_cliente_rota, soma_cliente_rota, n_cliente_so, soma_cliente_so,
      atraso_min, atraso, at_entregador, at_loja, at_aceite, at_rota, at_outras, at_em_rota, at_sozinho, at_espera_loja)
  select q.dia, q.hora, q.cidade, q.loja,
         count(*),
         count(*) filter (where q.sinal_total),
         count(*) filter (where q.sinal_chegada),
         count(*) filter (where coalesce(q.t_entrega > par.entrega_min, false) and q.rota_n <= 1),
         count(*) filter (where q.causa = 'entregador'), count(*) filter (where q.causa = 'rota'),
         count(*) filter (where q.causa = 'aceite'), count(*) filter (where q.causa = 'loja'), count(*) filter (where q.causa = 'outras'),
         count(*) filter (where q.rota_n > 1),
         count(*) filter (where q.rota_n > 1 and q.sinal_total),
         count(*) filter (where q.rota_n <= 1 and q.sinal_total),
         count(*) filter (where q.preparo between 0 and 180),
         coalesce(sum(q.preparo) filter (where q.preparo between 0 and 180), 0),
         count(*) filter (where q.preparo between 30 and 180),
         count(*) filter (where q.t_espera >= 0),
         coalesce(sum(q.t_espera) filter (where q.t_espera >= 0), 0),
         count(*) filter (where q.t_espera > par.espera_min),
         count(*) filter (where q.rota_n > 1 and q.percurso >= 0),
         coalesce(sum(q.percurso) filter (where q.rota_n > 1 and q.percurso >= 0), 0),
         count(*) filter (where q.rota_n <= 1 and q.percurso >= 0),
         coalesce(sum(q.percurso) filter (where q.rota_n <= 1 and q.percurso >= 0), 0),
         par.analise_atraso_min,
         count(*) filter (where q.atrasou),
         count(*) filter (where q.atrasou and q.causa_at = 'entregador'),
         count(*) filter (where q.atrasou and q.causa_at = 'loja'),
         count(*) filter (where q.atrasou and q.causa_at = 'aceite'),
         count(*) filter (where q.atrasou and q.causa_at = 'rota'),
         count(*) filter (where q.atrasou and q.causa_at = 'outras'),
         count(*) filter (where q.atrasou and q.rota_n > 1),
         count(*) filter (where q.atrasou and q.rota_n <= 1),
         count(*) filter (where q.atrasou and q.t_espera > par.espera_min)
    from (select (p.chamado_em at time zone 'America/Sao_Paulo')::date dia,
                 extract(hour from p.chamado_em at time zone 'America/Sao_Paulo')::smallint hora,
                 p.cidade, coalesce(p.loja, 'Sem loja') loja, p.sinal_total, p.sinal_chegada, p.causa, p.rota_n,
                 p.t_entrega, p.t_espera,
                 public.minutos_entre(p.pedido_em, p.chamado_em) preparo,
                 public.minutos_entre(p.saiu_em, p.entregue_em) percurso,
                 coalesce(p.t_total > par.analise_atraso_min, false) atrasou,
                 case when coalesce(p.t_total > par.analise_atraso_min, false)
                      then public.causa_atraso(p.t_chegada, p.t_entrega, p.t_aceitar, p.t_espera,
                             public.minutos_entre(p.saiu_em, p.entregue_em), p.rota_n) end causa_at
            from public.pedidos_log p
           where p.chamado_em is not null and p.cidade is not null
             and (p.chamado_em at time zone 'America/Sao_Paulo')::date
                 between (p_de at time zone 'America/Sao_Paulo')::date and (p_ate at time zone 'America/Sao_Paulo')::date) q
   group by 1, 2, 3, 4;
  -- só troca o dia da cidade quando o dia está completo no banco (tantos pedidos quanto pedidos_dia contou) e tem pelo
  -- menos os pedidos que o resumo já contava; um dia incompleto (só os pedidos com sinal) nunca entra
  drop table if exists _resumo_troca;
  create temporary table _resumo_troca on commit drop as
  with novo as (select dia, cidade, sum(pedidos) n from _resumo_novo group by 1, 2),
       velho as (select dia, cidade, sum(pedidos) n from public.pedidos_resumo r
                  where (r.dia, r.cidade) in (select dia, cidade from novo) group by 1, 2)
  select n.dia, n.cidade from novo n left join velho v using (dia, cidade)
    left join public.pedidos_dia pd on pd.dia = n.dia and pd.cidade = n.cidade
   where n.n >= coalesce(v.n, 0) and n.n >= coalesce(pd.pedidos, 0);
  delete from public.pedidos_resumo r using _resumo_troca t where r.dia = t.dia and r.cidade = t.cidade;
  insert into public.pedidos_resumo
  select x.* from _resumo_novo x join _resumo_troca t on t.dia = x.dia and t.cidade = x.cidade;
end $$;

-- os cards da aba Análises → Pedidos (corpo inteiro). Só os dias resumidos com o limite de hoje entram.
create or replace function public.analise_pedidos(p_dias integer default 30, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ate date; de date; dias integer := least(greatest(coalesce(p_dias, 3650), 1), 3650); lim integer;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select analise_atraso_min into lim from public.parametros_pedidos where unico;
  select max(dia) into ate from public.pedidos_resumo where atraso_min = lim and (p_cidade is null or cidade = p_cidade);
  if ate is null then return jsonb_build_object('vazio', true, 'atraso_min', lim,
      'antigos', exists (select 1 from public.pedidos_resumo where atraso_min is distinct from lim),
      'cidades', coalesce((select jsonb_agg(distinct cidade order by cidade) from public.pedidos_resumo), '[]')); end if;
  de := ate - dias + 1;
  return (with r as (select * from public.pedidos_resumo where atraso_min = lim and dia between de and ate and (p_cidade is null or cidade = p_cidade)),
    ant as (select * from public.pedidos_resumo where atraso_min = lim and dia between de - dias and de - 1 and (p_cidade is null or cidade = p_cidade)),
    lojas as (select loja, sum(pedidos) pedidos, sum(atraso) atraso, sum(at_loja) at_loja, sum(at_espera_loja) at_espera_loja,
                sum(n_preparo) n_preparo, sum(soma_preparo) soma_preparo, sum(preparo30) preparo30,
                sum(n_espera) n_espera, sum(soma_espera) soma_espera, sum(espera10) espera10
                from r group by loja having sum(pedidos) >= 30),
    lojas_ant as (select loja, sum(pedidos) pedidos, sum(atraso) atraso, sum(n_preparo) n_preparo, sum(soma_preparo) soma_preparo,
                sum(n_espera) n_espera, sum(soma_espera) soma_espera from ant group by loja),
    pior_hora as (select distinct on (loja) loja, hora, round(sum(soma_preparo) / nullif(sum(n_preparo), 0), 1) media
                  from r group by loja, hora having sum(n_preparo) >= 5 order by loja, sum(soma_preparo) / nullif(sum(n_preparo), 0) desc)
    select jsonb_build_object(
      'de', de, 'ate', ate, 'dias', dias, 'atraso_min', lim,
      'antigos', exists (select 1 from public.pedidos_resumo where atraso_min is distinct from lim),
      'cidades', coalesce((select jsonb_agg(distinct cidade order by cidade) from public.pedidos_resumo), '[]'),
      'totais', (select jsonb_build_object('pedidos', coalesce(sum(pedidos), 0), 'atraso', coalesce(sum(atraso), 0),
          'chegada15', coalesce(sum(chegada15), 0), 'entrega35', coalesce(sum(entrega35), 0)) from r),
      -- A. dia da semana (0 = domingo) × hora
      'mapa', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'hora', hora, 'pedidos', p, 'atraso', a))
          from (select extract(dow from dia)::int d, hora, sum(pedidos) p, sum(atraso) a from r group by 1, 2) x), '[]'),
      'por_dia_semana', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'pedidos', p, 'atraso', a) order by d)
          from (select extract(dow from dia)::int d, sum(pedidos) p, sum(atraso) a from r group by 1) x), '[]'),
      -- B. rota com vários pedidos
      'rota', (select jsonb_build_object(
          'pedidos', coalesce(sum(pedidos), 0), 'em_rota', coalesce(sum(em_rota), 0),
          'em_rota_atraso', coalesce(sum(at_em_rota), 0), 'sozinho_atraso', coalesce(sum(at_sozinho), 0),
          'atraso', coalesce(sum(atraso), 0), 'causa_rota', coalesce(sum(at_rota), 0),
          'media_cliente_rota', round(sum(soma_cliente_rota) / nullif(sum(n_cliente_rota), 0), 1),
          'media_cliente_so', round(sum(soma_cliente_so) / nullif(sum(n_cliente_so), 0), 1),
          'por_hora', coalesce((select jsonb_agg(jsonb_build_object('hora', hora, 'pedidos', p, 'em_rota', e, 'em_rota_atraso', ea, 'causa_rota', c) order by hora)
              from (select hora, sum(pedidos) p, sum(em_rota) e, sum(at_em_rota) ea, sum(at_rota) c from r group by hora) h), '[]')) from r),
      -- C. atraso do entregador
      'entregador', jsonb_build_object(
          'chegada15', (select coalesce(sum(chegada15), 0) from r), 'entrega35', (select coalesce(sum(entrega35), 0) from r),
          'por_hora', coalesce((select jsonb_agg(jsonb_build_object('hora', hora, 'pedidos', p, 'chegada15', c, 'entrega35', e) order by hora)
              from (select hora, sum(pedidos) p, sum(chegada15) c, sum(entrega35) e from r group by hora) h), '[]'),
          'quem', coalesce((select jsonb_agg(q order by q.casos desc, q.nome) from (
              select p.entregador_id id, max(p.entregador_nome) nome, count(*) casos,
                     count(*) filter (where p.sinal_chegada) chegada, count(*) filter (where not p.sinal_chegada) entrega,
                     (select count(*) from public.bloqueios b where lower(b.id_app) = lower(p.entregador_id)) restricoes
                from public.pedidos_log p
               where p.atencao and p.entregador_id is not null
                 and (p.chamado_em at time zone 'America/Sao_Paulo')::date between de and ate
                 and (p_cidade is null or p.cidade = p_cidade)
               group by p.entregador_id order by count(*) desc, max(p.entregador_nome) limit 10) q), '[]')),
      -- D. lojas
      'lojas', coalesce((select jsonb_agg(jsonb_build_object(
          'loja', l.loja, 'pedidos', l.pedidos, 'atraso', l.atraso, 'causa_loja', l.at_loja, 'espera_loja', l.at_espera_loja,
          'preparo_medio', round(l.soma_preparo / nullif(l.n_preparo, 0), 1), 'preparo30', l.preparo30, 'n_preparo', l.n_preparo,
          'espera_media', round(l.soma_espera / nullif(l.n_espera, 0), 1), 'espera10', l.espera10, 'n_espera', l.n_espera,
          'pior_hora', ph.hora, 'pior_hora_preparo', ph.media,
          'antes', case when a.pedidos >= 10 then jsonb_build_object('pedidos', a.pedidos, 'atraso', a.atraso,
              'preparo_medio', round(a.soma_preparo / nullif(a.n_preparo, 0), 1), 'espera_media', round(a.soma_espera / nullif(a.n_espera, 0), 1)) end))
          from lojas l left join lojas_ant a using (loja) left join pior_hora ph using (loja)), '[]'),
      -- E. de onde veio o atraso, por semana (terça a segunda)
      'causas_semana', coalesce((select jsonb_agg(jsonb_build_object('semana', s, 'pedidos', p, 'atraso', a, 'entregador', ce, 'loja', cl,
            'aceite', ca, 'rota', cr, 'outras', co) order by s)
          from (select public.inicio_semana(dia) s, sum(pedidos) p, sum(atraso) a, sum(at_entregador) ce, sum(at_loja) cl,
                  sum(at_aceite) ca, sum(at_rota) cr, sum(at_outras) co from r group by 1) w), '[]')));
end $$;

do $$ begin
  execute 'revoke all on function public.analise_pedidos(integer, text) from public, anon';
  execute 'grant execute on function public.analise_pedidos(integer, text) to authenticated';
  execute 'revoke all on function public.resumir_pedidos(timestamp with time zone, timestamp with time zone) from public, anon, authenticated';
  execute 'revoke all on function public.causa_atraso(numeric, numeric, numeric, numeric, numeric, integer) from public, anon, authenticated';
end $$;

-- refaz agora o que ainda está completo no banco (os últimos dias); os antigos entram quando os arquivos forem reenviados
select public.resumir_pedidos(min(chamado_em), max(chamado_em)) from public.pedidos_log having count(*) > 0;

notify pgrst, 'reload schema';
