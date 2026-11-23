-- 009z13 "A rota, o bairro e quem parou de chamar" (23/11/2026, pedidos do usuário). Pode rodar de novo.
--   * pedidos_log.bairro: o bairro da entrega (coluna "Bairro da Entrega" do Tableau), em maiúsculas.
--   * pedidos_log.rota_pedidos: nos pedidos com sinal que saíram em rota, um resumo dos que saíram junto (mesmo
--     entregador, até 5 min de diferença na saída da loja): código, loja, bairro e horários. Montado ao fechar o envio,
--     antes de apagar os pedidos sem sinal, para o cartão mostrar a rota mesmo depois da limpeza.
--   * pedidos_resumo_bairro + analise_pedidos_bairros(): onde a entrega mais demora, por bairro.
--   * parceiros_sem_chamar(): lojas que pararam de chamar (3+ dias sem pedido, chamavam 1 ou mais por dia), que estão
--     chamando menos (última semana abaixo da metade da média das 4 anteriores) e parceiros ativados que ainda não
--     chamaram. Os dias contam até o último dia enviado de cada cidade, não até hoje.
-- Os pedidos antigos ganham bairro e rota quando os arquivos forem reenviados.

alter table public.pedidos_log add column if not exists bairro text;
alter table public.pedidos_log add column if not exists rota_pedidos jsonb;
create index if not exists pedidos_log_rota_idx on public.pedidos_log (lower(entregador_nome), saiu_em);

create table if not exists public.pedidos_resumo_bairro (
  dia          date not null,
  cidade       text not null,
  bairro       text not null,
  atraso_min   smallint,
  pedidos      integer not null default 0,
  atraso       integer not null default 0,
  n_cliente    integer not null default 0,   -- saiu da loja → entregue
  soma_cliente numeric not null default 0,
  primary key (dia, cidade, bairro)
);
alter table public.pedidos_resumo_bairro enable row level security;   -- sem políticas: só por função

-- quem saiu junto: para cada pedido com sinal em rota, os pedidos do mesmo entregador que saíram até 5 min antes ou depois
create or replace function public.montar_rotas(p_de timestamptz, p_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  select * into par from public.parametros_pedidos where unico;
  with r as (
    select p.entrega_id,
           jsonb_agg(jsonb_build_object('entrega_id', q.entrega_id, 'codigo', q.codigo, 'loja', q.loja, 'bairro', q.bairro,
                     'chamado_em', q.chamado_em, 'saiu_em', q.saiu_em, 'entregue_em', q.entregue_em, 't_total', q.t_total,
                     'sinal', coalesce(q.sinal_total, false) or coalesce(q.sinal_chegada, false))
                     order by q.entregue_em nulls last, q.saiu_em) lista
      from public.pedidos_log p
      join public.pedidos_log q on lower(q.entregador_nome) = lower(p.entregador_nome)
                               and q.saiu_em between p.saiu_em - par.rota_janela_min * interval '1 minute'
                                                 and p.saiu_em + par.rota_janela_min * interval '1 minute'
     where p.tem_sinal and p.rota_n > 1 and p.saiu_em is not null and p.entregador_nome is not null
       and p.chamado_em between p_de and p_ate
     group by p.entrega_id)
  update public.pedidos_log p set rota_pedidos = r.lista
    from r where p.entrega_id = r.entrega_id and p.rota_pedidos is distinct from r.lista;
end $$;

-- importar com o bairro (corpo inteiro; o resto igual à 009z6)
create or replace function public.importar_pedidos(p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.exigir_bloq('moderador');
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Envie uma lista de pedidos.'; end if;
  if jsonb_array_length(p_itens) > 2000 then raise exception 'Envie no máximo 2.000 pedidos por vez.'; end if;
  insert into public.pedidos_log as p (entrega_id, codigo, cidade, loja, loja_id, pedido_em, chamado_em, aceite_em, chegou_em,
         saiu_em, entregue_em, finalizado_em, distancia_m, entregador_nome, entregador_id, entregador_situacao, entregador_opcoes, importado_por, bairro)
  select btrim(x.entrega_id), nullif(btrim(x.codigo), ''), nullif(upper(btrim(x.cidade)), ''), nullif(btrim(x.loja), ''),
         nullif(btrim(x.loja_id), ''), x.pedido_em, x.chamado_em, x.aceite_em, x.chegou_em, x.saiu_em, x.entregue_em, x.finalizado_em,
         case when x.distancia_m between 0 and 500000 then x.distancia_m end, nullif(btrim(x.entregador_nome), ''), nullif(regexp_replace(coalesce(x.entregador_id, ''), '[^A-Za-z0-9]', '', 'g'), ''),
         case when x.entregador_situacao in ('ok', 'conferir', 'escolher', 'sem_id') then x.entregador_situacao else 'sem_id' end,
         coalesce(x.entregador_opcoes, '[]'), auth.uid(), nullif(upper(regexp_replace(btrim(coalesce(x.bairro, '')), '\s+', ' ', 'g')), '')
    from jsonb_to_recordset(p_itens) as x(entrega_id text, codigo text, cidade text, loja text, loja_id text, pedido_em timestamptz,
         chamado_em timestamptz, aceite_em timestamptz, chegou_em timestamptz, saiu_em timestamptz, entregue_em timestamptz,
         finalizado_em timestamptz, distancia_m integer, entregador_nome text, entregador_id text, entregador_situacao text, entregador_opcoes jsonb, bairro text)
   where length(btrim(coalesce(x.entrega_id, ''))) between 6 and 40
  on conflict (entrega_id) do update set
         codigo = excluded.codigo, cidade = excluded.cidade, loja = excluded.loja, loja_id = excluded.loja_id,
         pedido_em = excluded.pedido_em, chamado_em = excluded.chamado_em, aceite_em = excluded.aceite_em,
         chegou_em = excluded.chegou_em, saiu_em = excluded.saiu_em, entregue_em = excluded.entregue_em,
         finalizado_em = excluded.finalizado_em, distancia_m = excluded.distancia_m, entregador_nome = excluded.entregador_nome,
         entregador_id = case when p.decisao is null then excluded.entregador_id else p.entregador_id end,
         entregador_situacao = case when p.decisao is null then excluded.entregador_situacao else p.entregador_situacao end,
         entregador_opcoes = excluded.entregador_opcoes, bairro = coalesce(excluded.bairro, p.bairro), importado_em = now(), importado_por = auth.uid();
  get diagnostics n = row_count;
  return jsonb_build_object('gravados', n);
end $$;

-- fechar o envio monta as rotas antes da limpeza (corpo inteiro; o resto igual à 009z10)
create or replace function public.fechar_importacao_pedidos(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos; apagados integer;
begin
  perform public.exigir_bloq('moderador');
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido.'; end if;
  perform public.classificar_pedidos(p_de, p_ate);
  perform public.montar_rotas(p_de, p_ate);  -- 009z13: os pedidos que saíram juntos, antes da limpeza
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

-- o resumo ganha o bairro (corpo inteiro; o resto igual à 009z11)
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
  -- 009z13: resumo por bairro (dia × cidade × bairro), nos mesmos dias completos
  delete from public.pedidos_resumo_bairro r using _resumo_troca t where r.dia = t.dia and r.cidade = t.cidade;
  insert into public.pedidos_resumo_bairro (dia, cidade, bairro, atraso_min, pedidos, atraso, n_cliente, soma_cliente)
  select (p.chamado_em at time zone 'America/Sao_Paulo')::date, p.cidade, p.bairro, par.analise_atraso_min, count(*),
         count(*) filter (where p.t_total > par.analise_atraso_min),
         count(*) filter (where public.minutos_entre(p.saiu_em, p.entregue_em) >= 0),
         coalesce(sum(public.minutos_entre(p.saiu_em, p.entregue_em)) filter (where public.minutos_entre(p.saiu_em, p.entregue_em) >= 0), 0)
    from public.pedidos_log p
    join _resumo_troca t on t.dia = (p.chamado_em at time zone 'America/Sao_Paulo')::date and t.cidade = p.cidade
   where p.bairro is not null
   group by 1, 2, 3;
end $$;

-- Análises → Pedidos: onde a entrega mais demora, por bairro (o período termina no último dia com dados)
create or replace function public.analise_pedidos_bairros(p_dias integer default 30, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ate date; de date; dias integer := least(greatest(coalesce(p_dias, 3650), 1), 3650); lim integer;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select analise_atraso_min into lim from public.parametros_pedidos where unico;
  select max(dia) into ate from public.pedidos_resumo_bairro where atraso_min = lim and (p_cidade is null or cidade = p_cidade);
  if ate is null then return jsonb_build_object('vazio', true); end if;
  de := ate - dias + 1;
  return (with r as (select * from public.pedidos_resumo_bairro where atraso_min = lim and dia between de and ate and (p_cidade is null or cidade = p_cidade)),
    ant as (select bairro, cidade, sum(pedidos) pedidos, sum(atraso) atraso from public.pedidos_resumo_bairro
             where atraso_min = lim and dia between de - dias and de - 1 and (p_cidade is null or cidade = p_cidade) group by 1, 2),
    b as (select bairro, cidade, sum(pedidos) pedidos, sum(atraso) atraso, sum(n_cliente) n_cliente, sum(soma_cliente) soma_cliente
            from r group by 1, 2 having sum(pedidos) >= 30)
    select jsonb_build_object('de', de, 'ate', ate, 'atraso_min', lim,
      'pedidos', (select coalesce(sum(pedidos), 0) from r), 'atraso', (select coalesce(sum(atraso), 0) from r),
      'bairros', coalesce((select jsonb_agg(jsonb_build_object('bairro', b.bairro, 'cidade', b.cidade, 'pedidos', b.pedidos, 'atraso', b.atraso,
            'media_cliente', round(b.soma_cliente / nullif(b.n_cliente, 0), 1),
            'antes', case when a.pedidos >= 10 then jsonb_build_object('pedidos', a.pedidos, 'atraso', a.atraso) end)
            order by b.atraso::numeric / b.pedidos desc, b.bairro)
          from b left join ant a using (bairro, cidade)), '[]')));
end $$;

-- Parceiros → Sem chamar
create or replace function public.parceiros_sem_chamar(p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return (with d as (select cidade, loja, dia, sum(pedidos) n from public.pedidos_resumo
                      where (p_cidade is null or cidade = p_cidade) and loja <> 'Sem loja' group by 1, 2, 3),
    ref as (select cidade, max(dia) ref, min(dia) inicio from d group by 1),
    l as (select d.cidade, d.loja, r.ref, r.inicio, max(d.dia) ultimo,
                 coalesce(sum(d.n) filter (where d.dia > r.ref - 7), 0) semana,
                 coalesce(sum(d.n) filter (where d.dia between r.ref - 34 and r.ref - 7), 0) quatro
            from d join ref r using (cidade) group by d.cidade, d.loja, r.ref, r.inicio),
    c as (select l.*,
                 -- média por dia nas 4 semanas até o último pedido (só os dias que existem nos dados)
                 (select coalesce(sum(x.n), 0) from d x where x.cidade = l.cidade and x.loja = l.loja and x.dia between l.ultimo - 27 and l.ultimo)::numeric
                   / greatest(1, least(28, l.ultimo - l.inicio + 1)) media_dia,
                 -- média por semana nas 4 semanas antes da última (com pelo menos 14 dias de dados)
                 case when (l.ref - 7) - greatest(l.ref - 34, l.inicio) + 1 >= 14
                      then l.quatro::numeric * 7 / ((l.ref - 7) - greatest(l.ref - 34, l.inicio) + 1) end media_semana,
                 exists (select 1 from public.parceiros p where p.cidade = l.cidade
                          and public.nome_bairro_norm(p.estabelecimento) = public.nome_bairro_norm(l.loja)) parceiro
            from l)
    select jsonb_build_object(
      'cidades', coalesce((select jsonb_agg(jsonb_build_object('cidade', cidade, 'ate', ref) order by cidade) from ref), '[]'),
      'parou', coalesce((select jsonb_agg(jsonb_build_object('loja', loja, 'cidade', cidade, 'ultimo', ultimo, 'dias', ref - ultimo,
                 'media_dia', round(media_dia, 1), 'parceiro', parceiro) order by media_dia desc, loja)
          from c where ref - ultimo >= 3 and media_dia >= 1), '[]'),
      'menos', coalesce((select jsonb_agg(jsonb_build_object('loja', loja, 'cidade', cidade, 'ultimo', ultimo, 'dias', ref - ultimo,
                 'semana', semana, 'media_semana', round(media_semana, 1), 'parceiro', parceiro)
                 order by semana::numeric / media_semana, loja)
          from c where ref - ultimo < 3 and media_semana >= 7 and semana < media_semana / 2), '[]'),
      'sem_pedido', coalesce((select jsonb_agg(jsonb_build_object('estabelecimento', p.estabelecimento, 'cidade', p.cidade,
                 'ativado_em', p.criado_em, 'por', p.criado_por_nome, 'dias', public.hoje_brasilia() - (p.criado_em at time zone 'America/Sao_Paulo')::date)
                 order by p.criado_em)
          from public.parceiros p join ref r on r.cidade = p.cidade
         where not exists (select 1 from d where d.cidade = p.cidade and public.nome_bairro_norm(d.loja) = public.nome_bairro_norm(p.estabelecimento))), '[]')));
end $$;

do $$ begin
  execute 'revoke all on function public.analise_pedidos_bairros(integer, text) from public, anon';
  execute 'grant execute on function public.analise_pedidos_bairros(integer, text) to authenticated';
  execute 'revoke all on function public.parceiros_sem_chamar(text) from public, anon';
  execute 'grant execute on function public.parceiros_sem_chamar(text) to authenticated';
  execute 'revoke all on function public.importar_pedidos(jsonb) from public, anon';
  execute 'grant execute on function public.importar_pedidos(jsonb) to authenticated';
  execute 'revoke all on function public.fechar_importacao_pedidos(timestamp with time zone, timestamp with time zone) from public, anon';
  execute 'grant execute on function public.fechar_importacao_pedidos(timestamp with time zone, timestamp with time zone) to authenticated';
  execute 'revoke all on function public.montar_rotas(timestamp with time zone, timestamp with time zone) from public, anon, authenticated';
  execute 'revoke all on function public.resumir_pedidos(timestamp with time zone, timestamp with time zone) from public, anon, authenticated';
end $$;

-- os pedidos que ainda estão no banco ganham a rota agora (os companheiros sem sinal só existem nos últimos 7 dias)
select public.montar_rotas(min(chamado_em), max(chamado_em)) from public.pedidos_log having count(*) > 0;

notify pgrst, 'reload schema';
