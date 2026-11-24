-- 009z17 "Mais entregadores na análise" (23/11/2026, pedido do usuário). Pode rodar de novo.
-- Análises → Pedidos → "Quem mais repete": a lista dos entregadores com atraso deixa de parar nos 10 primeiros
-- (até 1.000; a tela escolhe quantos mostrar e tem busca por ID e nome).

-- analise_pedidos (corpo inteiro; o resto igual à 009z11)
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
               group by p.entregador_id order by count(*) desc, max(p.entregador_nome) limit 1000) q), '[]')),
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
end $$;

notify pgrst, 'reload schema';
