-- 009z10 "Análises dos pedidos" (22/11/2026, spec aprovada pelo usuário). Pode rodar de novo.
-- Os pedidos sem nenhum sinal são apagados em 7 dias, mas as porcentagens precisam do total. Então, a cada envio,
-- fechar_importacao_pedidos guarda um RESUMO por dia × hora × cidade × loja em pedidos_resumo (só números, nada
-- pessoal). Um dia é refeito só quando o envio traz pelo menos tantos pedidos quantos o resumo já tinha (reenviar uma
-- semana antiga, cujos pedidos normais já foram apagados, não estraga o resumo). O site fecha o envio por dias
-- inteiros de Brasília. analise_pedidos(p_dias, p_cidade) monta os cards da aba Análises → Pedidos.

create table if not exists public.pedidos_resumo (
  dia                 date not null,
  hora                smallint not null check (hora between 0 and 23),
  cidade              text not null,
  loja                text not null,
  pedidos             integer not null default 0,
  acima45             integer not null default 0,   -- chamado → entregue > 45 min
  chegada15           integer not null default 0,   -- aceite → chegou na loja > 15 min
  entrega35           integer not null default 0,   -- aceite → entregue > 35 min numa rota só dele
  causa_entregador    integer not null default 0,   -- acima de 45 por causa do entregador
  causa_rota          integer not null default 0,
  causa_aceite        integer not null default 0,
  causa_loja          integer not null default 0,
  causa_outras        integer not null default 0,
  em_rota             integer not null default 0,   -- saiu da loja junto com outro pedido
  em_rota_acima45     integer not null default 0,
  sozinho_acima45     integer not null default 0,
  n_preparo           integer not null default 0,   -- pedido do cliente → chamado (0 a 180 min)
  soma_preparo        numeric not null default 0,
  preparo30           integer not null default 0,
  n_espera            integer not null default 0,   -- chegou na loja → saiu
  soma_espera         numeric not null default 0,
  espera10            integer not null default 0,
  n_cliente_rota      integer not null default 0,   -- saiu → entregue, em rota
  soma_cliente_rota   numeric not null default 0,
  n_cliente_so        integer not null default 0,   -- saiu → entregue, sozinho
  soma_cliente_so     numeric not null default 0,
  primary key (dia, hora, cidade, loja)
);
create index if not exists pedidos_resumo_dia_idx on public.pedidos_resumo (dia);
alter table public.pedidos_resumo enable row level security;   -- sem políticas: só por função

-- refaz o resumo dos dias (de Brasília) chamados entre p_de e p_ate, cidade a cidade, quando o dia está completo no
-- banco (tantos pedidos quanto pedidos_dia contou) e tem pelo menos os pedidos que o resumo já contava
create or replace function public.resumir_pedidos(p_de timestamptz, p_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  select * into par from public.parametros_pedidos where unico;
  create temporary table if not exists _resumo_novo (like public.pedidos_resumo) on commit drop;
  delete from _resumo_novo where true;
  insert into _resumo_novo
  select (p.chamado_em at time zone 'America/Sao_Paulo')::date, extract(hour from p.chamado_em at time zone 'America/Sao_Paulo')::smallint,
         p.cidade, coalesce(p.loja, 'Sem loja'),
         count(*),
         count(*) filter (where p.sinal_total),
         count(*) filter (where p.sinal_chegada),
         count(*) filter (where coalesce(p.t_entrega > par.entrega_min, false) and p.rota_n <= 1),
         count(*) filter (where p.causa = 'entregador'), count(*) filter (where p.causa = 'rota'),
         count(*) filter (where p.causa = 'aceite'), count(*) filter (where p.causa = 'loja'), count(*) filter (where p.causa = 'outras'),
         count(*) filter (where p.rota_n > 1),
         count(*) filter (where p.rota_n > 1 and p.sinal_total),
         count(*) filter (where p.rota_n <= 1 and p.sinal_total),
         count(*) filter (where public.minutos_entre(p.pedido_em, p.chamado_em) between 0 and 180),
         coalesce(sum(public.minutos_entre(p.pedido_em, p.chamado_em)) filter (where public.minutos_entre(p.pedido_em, p.chamado_em) between 0 and 180), 0),
         count(*) filter (where public.minutos_entre(p.pedido_em, p.chamado_em) between 30 and 180),
         count(*) filter (where p.t_espera >= 0),
         coalesce(sum(p.t_espera) filter (where p.t_espera >= 0), 0),
         count(*) filter (where p.t_espera > par.espera_min),
         count(*) filter (where p.rota_n > 1 and public.minutos_entre(p.saiu_em, p.entregue_em) >= 0),
         coalesce(sum(public.minutos_entre(p.saiu_em, p.entregue_em)) filter (where p.rota_n > 1 and public.minutos_entre(p.saiu_em, p.entregue_em) >= 0), 0),
         count(*) filter (where p.rota_n <= 1 and public.minutos_entre(p.saiu_em, p.entregue_em) >= 0),
         coalesce(sum(public.minutos_entre(p.saiu_em, p.entregue_em)) filter (where p.rota_n <= 1 and public.minutos_entre(p.saiu_em, p.entregue_em) >= 0), 0)
    from public.pedidos_log p
   where p.chamado_em is not null and p.cidade is not null
     and (p.chamado_em at time zone 'America/Sao_Paulo')::date between (p_de at time zone 'America/Sao_Paulo')::date and (p_ate at time zone 'America/Sao_Paulo')::date
   group by 1, 2, 3, 4;
  -- só troca o dia da cidade quando o banco tem pelo menos os pedidos que o resumo já contava
  with novo as (select dia, cidade, sum(pedidos) n from _resumo_novo group by 1, 2),
       velho as (select dia, cidade, sum(pedidos) n from public.pedidos_resumo r
                  where (r.dia, r.cidade) in (select dia, cidade from novo) group by 1, 2),
       troca as (select n.dia, n.cidade from novo n left join velho v using (dia, cidade)
                  left join public.pedidos_dia pd on pd.dia = n.dia and pd.cidade = n.cidade
                 -- dia completo (todos os pedidos do dia ainda estão no banco) e com pelo menos o que o resumo já tinha
                 where n.n >= coalesce(v.n, 0) and n.n >= coalesce(pd.pedidos, 0))
  delete from public.pedidos_resumo r using troca t where r.dia = t.dia and r.cidade = t.cidade;
  insert into public.pedidos_resumo
  select x.* from _resumo_novo x
   where not exists (select 1 from public.pedidos_resumo r where r.dia = x.dia and r.cidade = x.cidade);
end $$;

-- o fechamento do envio guarda o resumo antes de apagar os pedidos sem sinal (corpo inteiro: a 009z8 + resumir)
create or replace function public.fechar_importacao_pedidos(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos; apagados integer;
begin
  perform public.exigir_bloq('moderador');
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido.'; end if;
  perform public.classificar_pedidos(p_de, p_ate);
  select * into par from public.parametros_pedidos where unico;
  insert into public.pedidos_dia (dia, cidade, pedidos)
  select (chamado_em at time zone 'America/Sao_Paulo')::date, cidade, count(*) from public.pedidos_log
   where chamado_em between p_de and p_ate and cidade is not null group by 1, 2
  on conflict (dia, cidade) do update set pedidos = greatest(public.pedidos_dia.pedidos, excluded.pedidos);
  perform public.resumir_pedidos(p_de, p_ate);
  -- só o período calculado agora: o resto do envio ainda não tem os sinais
  delete from public.pedidos_log
   where chamado_em between p_de and p_ate
     and not tem_sinal and decisao is null
     and coalesce(finalizado_em, entregue_em, chamado_em, importado_em) < now() - par.guardar_dias * interval '1 day';
  get diagnostics apagados = row_count;
  return (select jsonb_build_object(
      'pedidos', count(*), 'com_sinal', count(*) filter (where tem_sinal), 'atencao', count(*) filter (where atencao),
      'chegada', count(*) filter (where sinal_chegada), 'total', count(*) filter (where sinal_total),
      'finalizacao', count(*) filter (where sinal_finalizacao),
      'sem_id', count(*) filter (where tem_sinal and entregador_situacao in ('escolher', 'sem_id')),
      'apagados', apagados)
    from public.pedidos_log where chamado_em between p_de and p_ate);
end $$;

-- os cards da aba Análises → Pedidos. O período termina no último dia que tem dados (os dados chegam com atraso).
create or replace function public.analise_pedidos(p_dias integer default 30, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ate date; de date; dias integer := least(greatest(coalesce(p_dias, 3650), 1), 3650);
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select max(dia) into ate from public.pedidos_resumo where p_cidade is null or cidade = p_cidade;
  if ate is null then return jsonb_build_object('vazio', true, 'cidades',
      coalesce((select jsonb_agg(distinct cidade order by cidade) from public.pedidos_resumo), '[]')); end if;
  de := ate - dias + 1;
  return (with r as (select * from public.pedidos_resumo where dia between de and ate and (p_cidade is null or cidade = p_cidade)),
    -- o período de antes, do mesmo tamanho, para a tendência das lojas
    ant as (select * from public.pedidos_resumo where dia between de - dias and de - 1 and (p_cidade is null or cidade = p_cidade)),
    lojas as (select loja, sum(pedidos) pedidos, sum(acima45) acima45, sum(causa_loja) causa_loja,
                sum(n_preparo) n_preparo, sum(soma_preparo) soma_preparo, sum(preparo30) preparo30,
                sum(n_espera) n_espera, sum(soma_espera) soma_espera, sum(espera10) espera10
                from r group by loja having sum(pedidos) >= 30),
    lojas_ant as (select loja, sum(pedidos) pedidos, sum(acima45) acima45, sum(n_preparo) n_preparo, sum(soma_preparo) soma_preparo,
                sum(n_espera) n_espera, sum(soma_espera) soma_espera from ant group by loja),
    -- a hora em que o preparo da loja é mais longo (com pelo menos 5 pedidos naquela hora)
    pior_hora as (select distinct on (loja) loja, hora, round(sum(soma_preparo) / nullif(sum(n_preparo), 0), 1) media
                  from r group by loja, hora having sum(n_preparo) >= 5 order by loja, sum(soma_preparo) / nullif(sum(n_preparo), 0) desc)
    select jsonb_build_object(
      'de', de, 'ate', ate, 'dias', dias,
      'cidades', coalesce((select jsonb_agg(distinct cidade order by cidade) from public.pedidos_resumo), '[]'),
      'totais', (select jsonb_build_object('pedidos', coalesce(sum(pedidos), 0), 'acima45', coalesce(sum(acima45), 0),
          'chegada15', coalesce(sum(chegada15), 0), 'entrega35', coalesce(sum(entrega35), 0)) from r),
      -- A. dia da semana (0 = domingo) × hora
      'mapa', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'hora', hora, 'pedidos', p, 'acima45', a))
          from (select extract(dow from dia)::int d, hora, sum(pedidos) p, sum(acima45) a from r group by 1, 2) x), '[]'),
      'por_dia_semana', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'pedidos', p, 'acima45', a) order by d)
          from (select extract(dow from dia)::int d, sum(pedidos) p, sum(acima45) a from r group by 1) x), '[]'),
      -- B. rota com vários pedidos
      'rota', (select jsonb_build_object(
          'pedidos', coalesce(sum(pedidos), 0), 'em_rota', coalesce(sum(em_rota), 0),
          'em_rota_acima45', coalesce(sum(em_rota_acima45), 0), 'sozinho_acima45', coalesce(sum(sozinho_acima45), 0),
          'acima45', coalesce(sum(acima45), 0), 'causa_rota', coalesce(sum(causa_rota), 0),
          'media_cliente_rota', round(sum(soma_cliente_rota) / nullif(sum(n_cliente_rota), 0), 1),
          'media_cliente_so', round(sum(soma_cliente_so) / nullif(sum(n_cliente_so), 0), 1),
          'por_hora', coalesce((select jsonb_agg(jsonb_build_object('hora', hora, 'pedidos', p, 'em_rota', e, 'causa_rota', c) order by hora)
              from (select hora, sum(pedidos) p, sum(em_rota) e, sum(causa_rota) c from r group by hora) h), '[]')) from r),
      -- C. atraso do entregador (os casos com nome vêm dos pedidos com sinal, que não são apagados)
      'entregador', jsonb_build_object(
          'chegada15', (select coalesce(sum(chegada15), 0) from r), 'entrega35', (select coalesce(sum(entrega35), 0) from r),
          'por_hora', coalesce((select jsonb_agg(jsonb_build_object('hora', hora, 'chegada15', c, 'entrega35', e) order by hora)
              from (select hora, sum(chegada15) c, sum(entrega35) e from r group by hora) h), '[]'),
          'por_dia_semana', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'chegada15', c, 'entrega35', e) order by d)
              from (select extract(dow from dia)::int d, sum(chegada15) c, sum(entrega35) e from r group by 1) x), '[]'),
          'quem', coalesce((select jsonb_agg(q order by q.casos desc, q.nome) from (
              select p.entregador_id id, max(p.entregador_nome) nome, count(*) casos,
                     count(*) filter (where p.sinal_chegada) chegada, count(*) filter (where not p.sinal_chegada) entrega,
                     (select count(*) from public.bloqueios b where lower(b.id_app) = lower(p.entregador_id)) restricoes
                from public.pedidos_log p
               where p.atencao and p.entregador_id is not null
                 and (p.chamado_em at time zone 'America/Sao_Paulo')::date between de and ate
                 and (p_cidade is null or p.cidade = p_cidade)
               group by p.entregador_id order by count(*) desc, max(p.entregador_nome) limit 10) q), '[]')),
      -- D. lojas lentas
      'lojas', coalesce((select jsonb_agg(jsonb_build_object(
          'loja', l.loja, 'pedidos', l.pedidos, 'acima45', l.acima45, 'causa_loja', l.causa_loja,
          'preparo_medio', round(l.soma_preparo / nullif(l.n_preparo, 0), 1), 'preparo30', l.preparo30, 'n_preparo', l.n_preparo,
          'espera_media', round(l.soma_espera / nullif(l.n_espera, 0), 1), 'espera10', l.espera10, 'n_espera', l.n_espera,
          'pior_hora', ph.hora, 'pior_hora_preparo', ph.media,
          'antes', case when a.pedidos >= 10 then jsonb_build_object('pedidos', a.pedidos, 'acima45', a.acima45,
              'preparo_medio', round(a.soma_preparo / nullif(a.n_preparo, 0), 1), 'espera_media', round(a.soma_espera / nullif(a.n_espera, 0), 1)) end))
          from lojas l left join lojas_ant a using (loja) left join pior_hora ph using (loja)), '[]'),
      -- E. de onde veio o atraso, por semana (terça a segunda)
      'causas_semana', coalesce((select jsonb_agg(jsonb_build_object('semana', s, 'pedidos', p, 'acima45', a, 'entregador', ce, 'rota', cr,
            'aceite', ca, 'loja', cl, 'outras', co) order by s)
          from (select public.inicio_semana(dia) s, sum(pedidos) p, sum(acima45) a, sum(causa_entregador) ce, sum(causa_rota) cr,
                  sum(causa_aceite) ca, sum(causa_loja) cl, sum(causa_outras) co from r group by 1) w), '[]')));
end $$;

do $$ declare f text; begin
  foreach f in array array['analise_pedidos(integer, text)', 'fechar_importacao_pedidos(timestamp with time zone, timestamp with time zone)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.resumir_pedidos(timestamp with time zone, timestamp with time zone) from public, anon, authenticated';
end $$;

-- o que já está completo no banco entra no resumo agora; os dias antigos, que hoje só têm os pedidos com sinal, entram
-- quando os arquivos forem reenviados (o reenvio traz o dia inteiro de novo)
select public.resumir_pedidos(min(chamado_em), max(chamado_em)) from public.pedidos_log having count(*) > 0;

notify pgrst, 'reload schema';
