-- 009z18 "Monitoramento novo", parte 1 (28/11/2026, pedido do usuário; spec aprovada na conversa):
--   * os pedidos começam do zero (o usuário reenvia tudo, agora com TODAS as cidades e também os CANCELADOS);
--   * pedidos_log.status ('finalizado' | 'cancelado') e etapa_cancelou (até onde o pedido chegou);
--   * resumos novos: cancelados (dia × hora × cidade × loja × bairro × etapa) e por entregador (dia × cidade × entregador),
--     tempo até associar e tempo de entrega no resumo por hora/loja e no resumo por bairro;
--   * a rota e os entregadores com o mesmo nome agora são separados por cidade;
--   * só fica o que a comparação com o mês anterior precisa (pedido do usuário): os pedidos com sinal saem depois de
--     parametros_pedidos.guardar_sinal_dias (35) e os resumos, a previsão do tempo e os planejamentos depois de
--     guardar_resumo_dias (70: o mês atual inteiro contra o mês anterior, 30 dias contra os 30 antes, 8 semanas dos parceiros);
--   * monitor_parceiros(p_cidade): os 4 grupos da aba Parceiros (parou, chamando menos, voltou, chamando mais) com as 8 semanas.
-- Pode rodar de novo (a limpeza só apaga pedidos e resumos; as restrições ficam).

-- ---------- 1. limpeza ----------
delete from public.pedidos_log where true;
delete from public.pedidos_resumo where true;
delete from public.pedidos_resumo_bairro where true;
delete from public.pedidos_dia where true;

-- ---------- 2. colunas e tabelas ----------
alter table public.pedidos_log add column if not exists status text not null default 'finalizado';
alter table public.pedidos_log add column if not exists etapa_cancelou text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_log_status_check') then
    alter table public.pedidos_log add constraint pedidos_log_status_check check (status in ('finalizado', 'cancelado'));
  end if;
end $$;
create index if not exists pedidos_log_entregador_idx on public.pedidos_log (entregador_id, chamado_em);

alter table public.pedidos_dia add column if not exists cancelados integer not null default 0;

alter table public.parametros_pedidos add column if not exists guardar_sinal_dias integer not null default 35;
alter table public.parametros_pedidos add column if not exists guardar_resumo_dias integer not null default 70;
update public.parametros_pedidos set guardar_sinal_dias = 35, guardar_resumo_dias = 70 where unico;

alter table public.pedidos_resumo add column if not exists n_associar integer not null default 0;
alter table public.pedidos_resumo add column if not exists soma_associar numeric not null default 0;
alter table public.pedidos_resumo add column if not exists n_total integer not null default 0;
alter table public.pedidos_resumo add column if not exists soma_total numeric not null default 0;

alter table public.pedidos_resumo_bairro add column if not exists n_associar integer not null default 0;
alter table public.pedidos_resumo_bairro add column if not exists soma_associar numeric not null default 0;
alter table public.pedidos_resumo_bairro add column if not exists n_total integer not null default 0;
alter table public.pedidos_resumo_bairro add column if not exists soma_total numeric not null default 0;
alter table public.pedidos_resumo_bairro add column if not exists lojas jsonb not null default '{}';

-- cancelados: poucos por dia, então uma linha por dia × hora × cidade × loja × bairro × etapa
create table if not exists public.pedidos_resumo_cancel (
  dia date not null,
  hora smallint not null check (hora between 0 and 23),
  cidade text not null,
  loja text not null,
  bairro text not null,
  etapa text not null,
  n integer not null default 0,
  n_associar integer not null default 0,
  soma_associar numeric not null default 0,
  primary key (dia, hora, cidade, loja, bairro, etapa));
alter table public.pedidos_resumo_cancel enable row level security;

-- por entregador: chave = ID (ou "?" + nome quando o ID não foi achado)
create table if not exists public.pedidos_resumo_entregador (
  dia date not null,
  cidade text not null,
  chave text not null,
  entregador_id text,
  nome text,
  pedidos integer not null default 0,
  atraso integer not null default 0,          -- chamado → entregue acima de analise_atraso_min
  at_entregador integer not null default 0,   -- chegada acima do limite OU em tela acima do limite saindo sozinho
  chegada integer not null default 0,
  tela integer not null default 0,
  finalizou integer not null default 0,
  em_rota integer not null default 0,
  n_total integer not null default 0,
  soma_total numeric not null default 0,
  primary key (dia, cidade, chave));
create index if not exists pedidos_resumo_entregador_chave_idx on public.pedidos_resumo_entregador (chave, dia);
alter table public.pedidos_resumo_entregador enable row level security;

-- a limpeza vale também para os resumos novos (rodar de novo começa do zero)
delete from public.pedidos_resumo_cancel where true;
delete from public.pedidos_resumo_entregador where true;

-- ---------- 3. importar com a situação ----------
create or replace function public.importar_pedidos(p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.exigir_bloq('moderador');
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Envie uma lista de pedidos.'; end if;
  if jsonb_array_length(p_itens) > 2000 then raise exception 'Envie no máximo 2.000 pedidos por vez.'; end if;
  insert into public.pedidos_log as p (entrega_id, codigo, cidade, loja, loja_id, pedido_em, chamado_em, aceite_em, chegou_em,
         saiu_em, entregue_em, finalizado_em, distancia_m, entregador_nome, entregador_id, entregador_situacao, entregador_opcoes, importado_por, bairro, status)
  select btrim(x.entrega_id), nullif(btrim(x.codigo), ''), nullif(upper(btrim(x.cidade)), ''), nullif(btrim(x.loja), ''),
         nullif(btrim(x.loja_id), ''), x.pedido_em, x.chamado_em, x.aceite_em, x.chegou_em, x.saiu_em, x.entregue_em, x.finalizado_em,
         case when x.distancia_m between 0 and 500000 then x.distancia_m end, nullif(btrim(x.entregador_nome), ''), nullif(regexp_replace(coalesce(x.entregador_id, ''), '[^A-Za-z0-9]', '', 'g'), ''),
         case when x.entregador_situacao in ('ok', 'conferir', 'escolher', 'sem_id') then x.entregador_situacao else 'sem_id' end,
         coalesce(x.entregador_opcoes, '[]'), auth.uid(), nullif(upper(regexp_replace(btrim(coalesce(x.bairro, '')), '\s+', ' ', 'g')), ''),
         case when x.status = 'cancelado' then 'cancelado' else 'finalizado' end
    from jsonb_to_recordset(p_itens) as x(entrega_id text, codigo text, cidade text, loja text, loja_id text, pedido_em timestamptz,
         chamado_em timestamptz, aceite_em timestamptz, chegou_em timestamptz, saiu_em timestamptz, entregue_em timestamptz,
         finalizado_em timestamptz, distancia_m integer, entregador_nome text, entregador_id text, entregador_situacao text, entregador_opcoes jsonb, bairro text, status text)
   where length(btrim(coalesce(x.entrega_id, ''))) between 6 and 40
  on conflict (entrega_id) do update set
         codigo = excluded.codigo, cidade = excluded.cidade, loja = excluded.loja, loja_id = excluded.loja_id,
         pedido_em = excluded.pedido_em, chamado_em = excluded.chamado_em, aceite_em = excluded.aceite_em,
         chegou_em = excluded.chegou_em, saiu_em = excluded.saiu_em, entregue_em = excluded.entregue_em,
         finalizado_em = excluded.finalizado_em, distancia_m = excluded.distancia_m,
         entregador_nome = coalesce(excluded.entregador_nome, p.entregador_nome),
         entregador_id = case when p.decisao is null and excluded.entregador_nome is not null then excluded.entregador_id else p.entregador_id end,
         entregador_situacao = case when p.decisao is null and excluded.entregador_nome is not null then excluded.entregador_situacao else p.entregador_situacao end,
         entregador_opcoes = case when excluded.entregador_nome is not null then excluded.entregador_opcoes else p.entregador_opcoes end,
         bairro = coalesce(excluded.bairro, p.bairro), status = excluded.status, importado_em = now(), importado_por = auth.uid();
  get diagnostics n = row_count;
  return jsonb_build_object('gravados', n);
end $$;

-- ---------- 4. sinais: só os finalizados; os cancelados ganham a etapa; rota por cidade ----------
create or replace function public.classificar_pedidos(p_de timestamptz, p_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  select * into par from public.parametros_pedidos where unico;
  with base as (
    select p.entrega_id, p.status,
           case when p.status = 'cancelado' or p.saiu_em is null or p.entregador_nome is null then 1
                else count(*) over (partition by p.cidade, lower(p.entregador_nome), (p.status = 'cancelado' or p.saiu_em is null) order by p.saiu_em
                       range between par.rota_janela_min * interval '1 minute' preceding and par.rota_janela_min * interval '1 minute' following) end::smallint rota_n,
           public.minutos_entre(p.aceite_em, p.chegou_em) t_chegada, public.minutos_entre(p.chamado_em, p.entregue_em) t_total,
           public.minutos_entre(p.aceite_em, p.entregue_em) t_entrega, public.minutos_entre(p.chamado_em, p.aceite_em) t_aceitar,
           public.minutos_entre(p.chegou_em, p.saiu_em) t_espera, public.minutos_entre(p.entregue_em, p.finalizado_em) t_finalizar,
           case when p.status <> 'cancelado' then null
                when p.entregue_em is not null or p.finalizado_em is not null then 'depois_de_entregar'
                when p.saiu_em is not null then 'saiu_da_loja'
                when p.chegou_em is not null then 'na_loja'
                when p.aceite_em is not null then 'indo_para_loja'
                else 'sem_entregador' end etapa
      from public.pedidos_log p
     where p.chamado_em between p_de - interval '1 day' and p_ate + interval '1 day'),
  s as (
    select b.*, b.status = 'finalizado' and coalesce(b.t_chegada > par.chegada_min, false) sc,
           b.status = 'finalizado' and coalesce(b.t_total > par.total_min, false) st,
           b.status = 'finalizado' and coalesce(b.t_finalizar > par.finalizar_min, false) sf,
           b.status = 'finalizado' and coalesce(b.t_entrega > par.entrega_min, false) and b.rota_n <= 1 so
      from base b),
  x as (
    select s.*, case when not s.st then null when s.sc or s.so then 'entregador' when s.rota_n > 1 then 'rota'
                     when coalesce(s.t_aceitar > par.aceitar_min, false) then 'aceite'
                     when coalesce(s.t_espera > par.espera_min, false) then 'loja' else 'outras' end causa,
           s.sc or (s.st and s.so) atencao, s.sc or s.st or s.sf tem_sinal
      from s)
  update public.pedidos_log p set rota_n = x.rota_n, t_chegada = x.t_chegada, t_total = x.t_total, t_entrega = x.t_entrega,
         t_aceitar = x.t_aceitar, t_espera = x.t_espera, t_finalizar = x.t_finalizar, sinal_chegada = x.sc, sinal_total = x.st,
         sinal_finalizacao = x.sf, causa = x.causa, atencao = x.atencao, tem_sinal = x.tem_sinal, etapa_cancelou = x.etapa
    from x
   where p.entrega_id = x.entrega_id
     and (p.rota_n, p.t_chegada, p.t_total, p.t_entrega, p.t_aceitar, p.t_espera, p.t_finalizar, p.sinal_chegada, p.sinal_total,
          p.sinal_finalizacao, p.causa, p.atencao, p.tem_sinal, p.etapa_cancelou)
         is distinct from (x.rota_n, x.t_chegada, x.t_total, x.t_entrega, x.t_aceitar, x.t_espera, x.t_finalizar, x.sc, x.st, x.sf,
          x.causa, x.atencao, x.tem_sinal, x.etapa);
end $$;

create or replace function public.montar_rotas(p_de timestamptz, p_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  select * into par from public.parametros_pedidos where unico;
  with r as (
    select p.entrega_id,
           jsonb_agg(jsonb_build_object('entrega_id', q.entrega_id, 'codigo', q.codigo, 'loja', q.loja, 'bairro', q.bairro,
                     'chamado_em', q.chamado_em, 'saiu_em', q.saiu_em, 'entregue_em', q.entregue_em, 't_total', q.t_total,
                     'sinal', coalesce(q.sinal_total, false) or coalesce(q.sinal_chegada, false),
                     'chegada', coalesce(q.sinal_chegada, false), 't_chegada', q.t_chegada)
                     order by q.entregue_em nulls last, q.saiu_em) lista
      from public.pedidos_log p
      join public.pedidos_log q on lower(q.entregador_nome) = lower(p.entregador_nome) and q.cidade is not distinct from p.cidade
                               and q.status = 'finalizado'
                               and q.saiu_em between p.saiu_em - par.rota_janela_min * interval '1 minute'
                                                 and p.saiu_em + par.rota_janela_min * interval '1 minute'
     where p.tem_sinal and p.rota_n > 1 and p.saiu_em is not null and p.entregador_nome is not null
       and p.chamado_em between p_de and p_ate
     group by p.entrega_id)
  update public.pedidos_log p set rota_pedidos = r.lista
    from r where p.entrega_id = r.entrega_id and p.rota_pedidos is distinct from r.lista;
end $$;

-- ---------- 5. resumos ----------
-- Um dia de uma cidade só é trocado quando está completo no banco (tantos pedidos quanto pedidos_dia já contou e pelo
-- menos os que o resumo já tinha) OU quando acabou de chegar um envio do dia inteiro (importados nas últimas 6 horas =
-- pelo menos 90% do maior número já contado). Finalizados e cancelados são conferidos separados: chegam em arquivos
-- diferentes. Um dia incompleto (só os pedidos com sinal que sobraram depois da limpeza) nunca entra.
create or replace function public.resumir_pedidos(p_de timestamptz, p_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  select * into par from public.parametros_pedidos where unico;

  drop table if exists _ped_base;
  create temporary table _ped_base on commit drop as
  select (p.chamado_em at time zone 'America/Sao_Paulo')::date dia,
         extract(hour from p.chamado_em at time zone 'America/Sao_Paulo')::smallint hora,
         p.cidade, coalesce(p.loja, 'Sem loja') loja, p.bairro, p.status, p.etapa_cancelou, p.sinal_total, p.sinal_chegada, p.causa, p.rota_n,
         p.t_entrega, p.t_espera, p.t_aceitar, p.t_total, p.t_chegada, p.t_finalizar, p.entregador_id, p.entregador_nome, p.importado_em,
         public.minutos_entre(p.pedido_em, p.chamado_em) preparo,
         public.minutos_entre(p.saiu_em, p.entregue_em) percurso,
         coalesce(p.t_total > par.analise_atraso_min, false) atrasou
    from public.pedidos_log p
   where p.chamado_em is not null and p.cidade is not null
     and (p.chamado_em at time zone 'America/Sao_Paulo')::date
         between (p_de at time zone 'America/Sao_Paulo')::date and (p_ate at time zone 'America/Sao_Paulo')::date;

  -- quais dias trocar
  drop table if exists _ped_troca;
  create temporary table _ped_troca on commit drop as
  with n as (select dia, cidade, count(*) filter (where status = 'finalizado') fin, count(*) filter (where status = 'cancelado') can,
                    count(*) filter (where status = 'finalizado' and importado_em > now() - interval '6 hours') fin_rec,
                    count(*) filter (where status = 'cancelado' and importado_em > now() - interval '6 hours') can_rec
               from _ped_base group by 1, 2),
       v as (select dia, cidade, sum(pedidos) fin from public.pedidos_resumo r where (r.dia, r.cidade) in (select dia, cidade from n) group by 1, 2),
       vc as (select dia, cidade, sum(r.n) can from public.pedidos_resumo_cancel r where (r.dia, r.cidade) in (select dia, cidade from n) group by 1, 2)
  select n.dia, n.cidade,
         n.fin > 0 and ((n.fin >= coalesce(v.fin, 0) and n.fin >= coalesce(pd.pedidos, 0))
                        or n.fin_rec >= 0.9 * greatest(coalesce(pd.pedidos, 0), coalesce(v.fin, 0), 1)) fin_ok,
         n.can > 0 and ((n.can >= coalesce(vc.can, 0) and n.can >= coalesce(pd.cancelados, 0))
                        or n.can_rec >= 0.9 * greatest(coalesce(pd.cancelados, 0), coalesce(vc.can, 0), 1)) can_ok
    from n left join v using (dia, cidade) left join vc using (dia, cidade)
    left join public.pedidos_dia pd on pd.dia = n.dia and pd.cidade = n.cidade;

  -- finalizados: por hora e loja
  delete from public.pedidos_resumo r using _ped_troca t where t.fin_ok and r.dia = t.dia and r.cidade = t.cidade;
  insert into public.pedidos_resumo (dia, hora, cidade, loja, pedidos, acima45, chegada15, entrega35,
      causa_entregador, causa_rota, causa_aceite, causa_loja, causa_outras, em_rota, em_rota_acima45, sozinho_acima45,
      n_preparo, soma_preparo, preparo30, n_espera, soma_espera, espera10, n_cliente_rota, soma_cliente_rota, n_cliente_so, soma_cliente_so,
      atraso_min, atraso, at_entregador, at_loja, at_aceite, at_rota, at_outras, at_em_rota, at_sozinho, at_espera_loja,
      n_associar, soma_associar, n_total, soma_total)
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
         count(*) filter (where q.atrasou and q.t_espera > par.espera_min),
         count(*) filter (where q.t_aceitar between 0 and 240),
         coalesce(sum(q.t_aceitar) filter (where q.t_aceitar between 0 and 240), 0),
         count(*) filter (where q.t_total between 0 and 600),
         coalesce(sum(q.t_total) filter (where q.t_total between 0 and 600), 0)
    from (select b.*, case when b.atrasou then public.causa_atraso(b.t_chegada, b.t_entrega, b.t_aceitar, b.t_espera, b.percurso, b.rota_n) end causa_at
            from _ped_base b join _ped_troca t on t.fin_ok and t.dia = b.dia and t.cidade = b.cidade
           where b.status = 'finalizado') q
   group by 1, 2, 3, 4;

  -- finalizados: por bairro
  delete from public.pedidos_resumo_bairro r using _ped_troca t where t.fin_ok and r.dia = t.dia and r.cidade = t.cidade;
  insert into public.pedidos_resumo_bairro (dia, cidade, bairro, atraso_min, pedidos, atraso, n_cliente, soma_cliente,
      n_associar, soma_associar, n_total, soma_total, lojas)
  select q.dia, q.cidade, q.bairro, par.analise_atraso_min, count(*),
         count(*) filter (where q.atrasou),
         count(*) filter (where q.percurso >= 0),
         coalesce(sum(q.percurso) filter (where q.percurso >= 0), 0),
         count(*) filter (where q.t_aceitar between 0 and 240),
         coalesce(sum(q.t_aceitar) filter (where q.t_aceitar between 0 and 240), 0),
         count(*) filter (where q.t_total between 0 and 600),
         coalesce(sum(q.t_total) filter (where q.t_total between 0 and 600), 0),
         (select coalesce(jsonb_object_agg(l.loja, l.n), '{}') from
            (select b2.loja, count(*) n from _ped_base b2
              where b2.status = 'finalizado' and b2.dia = q.dia and b2.cidade = q.cidade and b2.bairro = q.bairro
              group by 1 order by 2 desc limit 5) l)
    from _ped_base q join _ped_troca t on t.fin_ok and t.dia = q.dia and t.cidade = q.cidade
   where q.status = 'finalizado' and q.bairro is not null
   group by 1, 2, 3;

  -- finalizados: por entregador
  delete from public.pedidos_resumo_entregador r using _ped_troca t where t.fin_ok and r.dia = t.dia and r.cidade = t.cidade;
  insert into public.pedidos_resumo_entregador (dia, cidade, chave, entregador_id, nome, pedidos, atraso, at_entregador, chegada, tela,
      finalizou, em_rota, n_total, soma_total)
  select q.dia, q.cidade, coalesce(q.entregador_id, '?' || lower(q.entregador_nome)), max(q.entregador_id), max(q.entregador_nome),
         count(*),
         count(*) filter (where q.atrasou),
         count(*) filter (where coalesce(q.t_chegada > par.chegada_min, false)
                             or (coalesce(q.t_entrega > par.entrega_min, false) and q.rota_n <= 1)),
         count(*) filter (where coalesce(q.t_chegada > par.chegada_min, false)),
         count(*) filter (where coalesce(q.t_entrega > par.entrega_min, false) and q.rota_n <= 1),
         count(*) filter (where coalesce(q.t_finalizar > par.finalizar_min, false)),
         count(*) filter (where q.rota_n > 1),
         count(*) filter (where q.t_total between 0 and 600),
         coalesce(sum(q.t_total) filter (where q.t_total between 0 and 600), 0)
    from _ped_base q join _ped_troca t on t.fin_ok and t.dia = q.dia and t.cidade = q.cidade
   where q.status = 'finalizado' and (q.entregador_id is not null or q.entregador_nome is not null)
   group by 1, 2, 3;

  -- cancelados
  delete from public.pedidos_resumo_cancel r using _ped_troca t where t.can_ok and r.dia = t.dia and r.cidade = t.cidade;
  insert into public.pedidos_resumo_cancel (dia, hora, cidade, loja, bairro, etapa, n, n_associar, soma_associar)
  select q.dia, q.hora, q.cidade, q.loja, coalesce(q.bairro, 'SEM BAIRRO'), coalesce(q.etapa_cancelou, 'sem_entregador'), count(*),
         count(*) filter (where q.t_aceitar between 0 and 240),
         coalesce(sum(q.t_aceitar) filter (where q.t_aceitar between 0 and 240), 0)
    from _ped_base q join _ped_troca t on t.can_ok and t.dia = q.dia and t.cidade = q.cidade
   where q.status = 'cancelado'
   group by 1, 2, 3, 4, 5, 6;
end $$;

create or replace function public.fechar_importacao_pedidos(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos; apagados integer; velhos integer;
begin
  perform public.exigir_bloq('moderador');
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido.'; end if;
  perform public.classificar_pedidos(p_de, p_ate);
  perform public.montar_rotas(p_de, p_ate);
  select * into par from public.parametros_pedidos where unico;
  insert into public.pedidos_dia (dia, cidade, pedidos, cancelados)
  select (chamado_em at time zone 'America/Sao_Paulo')::date, cidade, count(*) filter (where status = 'finalizado'),
         count(*) filter (where status = 'cancelado')
    from public.pedidos_log
   where chamado_em between p_de and p_ate and cidade is not null group by 1, 2
  on conflict (dia, cidade) do update set pedidos = greatest(public.pedidos_dia.pedidos, excluded.pedidos),
         cancelados = greatest(public.pedidos_dia.cancelados, excluded.cancelados);
  perform public.resumir_pedidos(p_de, p_ate);
  -- só o período calculado agora: o resto do envio ainda não tem os sinais
  delete from public.pedidos_log
   where chamado_em between p_de and p_ate
     and (status = 'cancelado' or (not tem_sinal and decisao is null))
     and coalesce(finalizado_em, entregue_em, chamado_em, importado_em) < now() - par.guardar_dias * interval '1 day';
  get diagnostics apagados = row_count;
  -- pedidos com sinal: só os dos últimos guardar_sinal_dias (já estão nos resumos)
  delete from public.pedidos_log where chamado_em < now() - par.guardar_sinal_dias * interval '1 day';
  get diagnostics velhos = row_count;
  -- resumos, previsão e planejamentos: só o que a comparação com o mês anterior usa
  delete from public.pedidos_resumo where dia < public.hoje_brasilia() - par.guardar_resumo_dias;
  delete from public.pedidos_resumo_bairro where dia < public.hoje_brasilia() - par.guardar_resumo_dias;
  delete from public.pedidos_resumo_cancel where dia < public.hoje_brasilia() - par.guardar_resumo_dias;
  delete from public.pedidos_resumo_entregador where dia < public.hoje_brasilia() - par.guardar_resumo_dias;
  delete from public.pedidos_dia where dia < public.hoje_brasilia() - par.guardar_resumo_dias;
  delete from public.clima_dia where dia < public.hoje_brasilia() - par.guardar_resumo_dias;
  delete from public.planejamentos_dia where dia < public.hoje_brasilia() - par.guardar_resumo_dias;
  return (select jsonb_build_object(
      'pedidos', count(*) filter (where status = 'finalizado'), 'cancelados', count(*) filter (where status = 'cancelado'),
      'com_sinal', count(*) filter (where tem_sinal), 'atencao', count(*) filter (where atencao),
      'chegada', count(*) filter (where sinal_chegada), 'total', count(*) filter (where sinal_total),
      'finalizacao', count(*) filter (where sinal_finalizacao),
      'sem_id', count(*) filter (where tem_sinal and entregador_situacao in ('escolher', 'sem_id')),
      'apagados', apagados + velhos)
    from public.pedidos_log where chamado_em between p_de and p_ate);
end $$;

-- ---------- 6a. só as cidades da Regras de equipe (pedido do usuário em 28/11) ----------
-- O Tableau traz todas as cidades; os filtros e os números do Monitoramento só usam as cadastradas em cidades.
create or replace function public.cidade_monitorada(p_cidade text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cidades c where c.nome = p_cidade);
$$;
do $$
declare def text;
begin
  def := pg_get_functiondef('public.listar_pedidos(date, date, text, text, text, text, text, integer, integer)'::regprocedure);
  if position('cidade_monitorada' in def) = 0 then
    def := replace(def, 'from public.pedidos_log where tem_sinal and cidade is not null)',
                        'from public.pedidos_log where tem_sinal and cidade is not null and public.cidade_monitorada(cidade))');
    execute def;
  end if;
end $$;

-- ---------- 6. aba Parceiros ----------
-- Os 4 grupos, comparando a última semana (7 dias até o último dia enviado da cidade) com a média semanal das 4 anteriores:
--   parou = 3+ dias sem pedido e média de 1+ por dia nas 4 semanas até o último pedido;
--   menos = pedindo, última semana < metade da média (média >= 7 por semana, 14+ dias de dados);
--   voltou = ficou 7+ dias seguidos sem pedido antes desta semana e voltou a pedir nela;
--   mais = última semana > 1,5 × a média (média >= 7 por semana, 14+ dias de dados).
-- Cada loja traz as 8 semanas (da mais antiga à última). sem_pedido = parceiros ativados que não aparecem nos pedidos.
create or replace function public.monitor_parceiros(p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return (with d as (select cidade, loja, dia, sum(pedidos) n from public.pedidos_resumo
                      where (p_cidade is null or cidade = p_cidade) and loja <> 'Sem loja' and public.cidade_monitorada(cidade) group by 1, 2, 3),
    ref as (select cidade, max(dia) ref, min(dia) inicio from d group by 1),
    l as (select d.cidade, d.loja, r.ref, r.inicio, max(d.dia) ultimo,
                 coalesce(sum(d.n) filter (where d.dia > r.ref - 7), 0) semana,
                 coalesce(sum(d.n) filter (where d.dia between r.ref - 34 and r.ref - 7), 0) quatro,
                 min(d.dia) filter (where d.dia > r.ref - 7) primeiro_semana,
                 max(d.dia) filter (where d.dia <= r.ref - 7) ultimo_antes
            from d join ref r using (cidade) group by d.cidade, d.loja, r.ref, r.inicio),
    -- as 8 semanas: w = 0 é a última
    sw as (select d.cidade, d.loja, (r.ref - d.dia) / 7 w, sum(d.n) n from d join ref r using (cidade)
            where d.dia > r.ref - 56 group by 1, 2, 3),
    sj as (select l.cidade, l.loja, jsonb_agg(coalesce(sw.n, 0) order by g.w desc) semanas
             from l cross join generate_series(0, 7) g(w)
             left join sw on sw.cidade = l.cidade and sw.loja = l.loja and sw.w = g.w
            group by 1, 2),
    md as (select l.cidade, l.loja, sum(d.n) n28 from l join d on d.cidade = l.cidade and d.loja = l.loja
            where d.dia between l.ultimo - 27 and l.ultimo group by 1, 2),
    c as (select l.*, sj.semanas, coalesce(md.n28, 0)::numeric / greatest(1, least(28, l.ultimo - l.inicio + 1)) media_dia,
                 case when (l.ref - 7) - greatest(l.ref - 34, l.inicio) + 1 >= 14
                      then l.quatro::numeric * 7 / ((l.ref - 7) - greatest(l.ref - 34, l.inicio) + 1) end media_semana,
                 coalesce(l.primeiro_semana - l.ultimo_antes - 1 >= 7, false) voltou,
                 exists (select 1 from public.parceiros p where p.cidade = l.cidade
                          and public.nome_bairro_norm(p.estabelecimento) = public.nome_bairro_norm(l.loja)) parceiro
            from l join sj using (cidade, loja) left join md using (cidade, loja)),
    j as (select c.*, jsonb_build_object('loja', loja, 'cidade', cidade, 'ultimo', ultimo, 'dias', ref - ultimo, 'semana', semana,
                 'media_semana', round(media_semana, 1), 'media_dia', round(media_dia, 1), 'parceiro', parceiro, 'semanas', semanas,
                 'parado_dias', case when voltou then primeiro_semana - ultimo_antes - 1 end,
                 'variacao', case when media_semana > 0 then round((semana - media_semana) / media_semana * 100) end) item
            from c)
    select jsonb_build_object(
      'cidades', coalesce((select jsonb_agg(jsonb_build_object('cidade', cidade, 'ate', ref) order by cidade) from ref), '[]'),
      'parou', coalesce((select jsonb_agg(item order by media_dia desc, loja) from j where ref - ultimo >= 3 and media_dia >= 1), '[]'),
      'menos', coalesce((select jsonb_agg(item order by semana::numeric / media_semana, loja)
          from j where ref - ultimo < 3 and not voltou and media_semana >= 7 and semana < media_semana / 2), '[]'),
      'voltou', coalesce((select jsonb_agg(item order by semana desc, loja) from j where voltou and ref - ultimo < 3), '[]'),
      'mais', coalesce((select jsonb_agg(item order by semana::numeric / media_semana desc, loja)
          from j where not voltou and media_semana >= 7 and semana > media_semana * 1.5), '[]'),
      'sem_pedido', coalesce((select jsonb_agg(jsonb_build_object('estabelecimento', p.estabelecimento, 'cidade', p.cidade,
                 'ativado_em', p.criado_em, 'por', p.criado_por_nome, 'dias', public.hoje_brasilia() - (p.criado_em at time zone 'America/Sao_Paulo')::date)
                 order by p.criado_em)
          from public.parceiros p join ref r on r.cidade = p.cidade
         where not exists (select 1 from d where d.cidade = p.cidade and public.nome_bairro_norm(d.loja) = public.nome_bairro_norm(p.estabelecimento))), '[]')));
end $$;

-- ---------- 7. aba Entregadores ----------
-- SLA = entregues em até analise_atraso_min (30) do chamado. O período termina no último dia enviado.
-- "pesa": impacto = quantos pontos o SLA subiria sem os atrasos com causa no entregador (chegada na loja acima do
--   limite ou em tela acima do limite saindo sozinho) = at_entregador / pedidos × 100.
-- "ajuda": impacto = quantos pontos o SLA cairia se as entregas dessa pessoa atrasassem como a média da cidade
--   = (pedidos × taxa da cidade − atrasos dela) / pedidos × 100 (só quem fica abaixo da média).
create or replace function public.monitor_entregadores(p_dias integer default 30, p_cidade text default null, p_busca text default null,
  p_min integer default 30, p_modo text default 'pesa', p_limite integer default 10)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ate date; de date; lim integer;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select max(dia) into ate from public.pedidos_resumo_entregador where (p_cidade is null or cidade = p_cidade) and public.cidade_monitorada(cidade);
  select analise_atraso_min into lim from public.parametros_pedidos where unico;
  if ate is null then
    return jsonb_build_object('vazio', true, 'cidades', coalesce((select jsonb_agg(distinct cidade order by cidade) from public.pedidos_resumo_entregador where public.cidade_monitorada(cidade)), '[]'));
  end if;
  de := ate - greatest(1, least(coalesce(p_dias, 30), 120)) + 1;
  return (with r as (select * from public.pedidos_resumo_entregador where dia between de and ate and (p_cidade is null or cidade = p_cidade)
                        and public.cidade_monitorada(cidade)),
    cid as (select cidade, sum(pedidos) pedidos, sum(atraso) atraso, sum(at_entregador) at_ent,
                   sum(soma_total) / nullif(sum(n_total), 0) tempo
              from r group by 1),
    tot as (select sum(pedidos) pedidos, sum(atraso) atraso, sum(at_ent) at_ent from cid),
    e as (select r.chave, r.cidade, max(r.entregador_id) id, max(r.nome) nome, sum(r.pedidos) pedidos, sum(r.atraso) atraso,
                 sum(r.at_entregador) at_ent, sum(r.soma_total) / nullif(sum(r.n_total), 0) tempo
            from r group by 1, 2),
    x as (select e.*, c.tempo tempo_cidade,
                 case when coalesce(p_modo, 'pesa') = 'ajuda'
                      then (e.pedidos * c.atraso::numeric / nullif(c.pedidos, 0) - e.atraso)
                      else e.at_ent::numeric end ganho,
                 c.pedidos pedidos_cidade
            from e join cid c using (cidade)
           where e.pedidos >= coalesce(p_min, 0)
             and (p_busca is null or e.id ilike '%' || p_busca || '%' or e.nome ilike '%' || p_busca || '%')),
    y as (select x.* from x where x.ganho > 0)
    select jsonb_build_object(
      'de', de, 'ate', ate, 'limite', lim,
      'cidades', (select jsonb_agg(distinct cidade order by cidade) from public.pedidos_resumo_entregador where public.cidade_monitorada(cidade)),
      'pedidos', t.pedidos, 'atraso', t.atraso, 'at_entregador', t.at_ent,
      'sla', round(100 - t.atraso::numeric * 100 / nullif(t.pedidos, 0), 1),
      'n_cidades', (select count(*) from cid),
      'entregadores', (select count(*) from y),
      'lista', coalesce((select jsonb_agg(jsonb_build_object('chave', y.chave, 'id', y.id, 'nome', y.nome, 'cidade', y.cidade,
                 'pedidos', y.pedidos, 'atraso', y.atraso, 'at_entregador', y.at_ent,
                 'pct', round(y.atraso::numeric * 100 / nullif(y.pedidos, 0), 1),
                 'tempo', round(y.tempo, 1), 'dif', round(y.tempo - y.tempo_cidade, 1),
                 'impacto_geral', round(y.ganho * 100 / nullif(t.pedidos, 0), 2),
                 'impacto_cidade', round(y.ganho * 100 / nullif(y.pedidos_cidade, 0), 2)) order by y.ganho desc, y.nome)
          from (select * from y order by ganho desc, nome limit greatest(1, least(coalesce(p_limite, 10), 500))) y), '[]'))
    from tot t);
end $$;

-- o detalhe de um entregador (a linha aberta): de onde vêm os atrasos, quando, onde e o histórico
create or replace function public.monitor_entregador(p_chave text, p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ate date; de date; v_cid text; v_id text;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select max(dia), max(entregador_id) into ate, v_id from public.pedidos_resumo_entregador where chave = p_chave;
  if ate is null then return null; end if;
  select max(dia) into ate from public.pedidos_resumo_entregador;
  de := ate - greatest(1, least(coalesce(p_dias, 30), 120)) + 1;
  select cidade into v_cid from public.pedidos_resumo_entregador where chave = p_chave group by cidade order by sum(pedidos) desc limit 1;
  return (with a as (select * from public.pedidos_log p
                      where p.status = 'finalizado' and (p.entregador_id = v_id or (v_id is null and '?' || lower(p.entregador_nome) = p_chave))
                        and (p.chamado_em at time zone 'America/Sao_Paulo')::date between de and ate
                        and (p.sinal_chegada or (p.sinal_total and p.causa = 'entregador'))),
    q as (select extract(dow from chamado_em at time zone 'America/Sao_Paulo')::int dow,
                 extract(hour from chamado_em at time zone 'America/Sao_Paulo')::int hora, bairro from a)
    select jsonb_build_object('chave', p_chave, 'id', v_id, 'cidade', v_cid, 'de', de, 'ate', ate,
      'chegada', coalesce(sum(r.chegada), 0), 'tela', coalesce(sum(r.tela), 0), 'finalizou', coalesce(sum(r.finalizou), 0),
      'pedidos', coalesce(sum(r.pedidos), 0), 'atraso', coalesce(sum(r.atraso), 0),
      'antes', (select jsonb_build_object('pedidos', sum(b.pedidos), 'atraso', sum(b.atraso))
                  from public.pedidos_resumo_entregador b where b.chave = p_chave and b.dia between de - (ate - de + 1) and de - 1),
      'dias', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select dow, count(*) n from q group by 1 order by 2 desc limit 2) x),
      'horas', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select hora, count(*) n from q group by 1 order by 2 desc limit 3) x),
      'bairros', (select coalesce(jsonb_agg(x.bairro order by x.n desc), '[]') from (select bairro, count(*) n from q where bairro is not null group by 1 order by 2 desc limit 2) x),
      'media_cidade_hora', (select round(sum(pr.soma_total) / nullif(sum(pr.n_total), 0), 1) from public.pedidos_resumo pr
                             where pr.cidade = v_cid and pr.dia between de and ate
                               and pr.hora in (select hora from q group by 1 order by count(*) desc limit 3)),
      'restricoes', case when v_id is null then 0 else (select count(*) from public.bloqueios b
                       where lower(b.id_app) = lower(v_id) and b.inicio > now() - interval '60 days' and not coalesce(b.leve, false)) end)
    from public.pedidos_resumo_entregador r where r.chave = p_chave and r.dia between de and ate);
end $$;

-- ---------- 7c. aba Cidade ----------
-- Uma cidade de cada vez, num período (padrão: os 30 dias até o último dia enviado), comparado com o período anterior
-- do mesmo tamanho ('anterior') ou com o mesmo período do mês passado ('mes').
--   bairros: entregas, atrasadas, impacto no SLA da cidade, tempo até associar e tempo de entrega (com a variação),
--            cancelados sem entregador e as lojas mais pedidas;
--   lojas:   com 30+ pedidos: atrasadas, impacto, espera na loja, causa mais comum e tendência;
--   mapa:    dia da semana × hora: pedidos, atrasos e cancelados.
create or replace function public.monitor_cidade(p_cidade text default null, p_de date default null, p_ate date default null,
  p_comparar text default 'anterior', p_min integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid text; ate date; de date; cde date; cate date; lim integer;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select analise_atraso_min into lim from public.parametros_pedidos where unico;
  cid := (select coalesce(p_cidade, (select cidade from public.pedidos_resumo where public.cidade_monitorada(cidade) group by 1 order by sum(pedidos) desc limit 1))
          where p_cidade is null or public.cidade_monitorada(p_cidade));
  if cid is null then return jsonb_build_object('vazio', true, 'cidades', '[]'::jsonb); end if;
  ate := coalesce(p_ate, (select max(dia) from public.pedidos_resumo where cidade = cid));
  de := coalesce(p_de, ate - 29);
  if ate < de then raise exception 'Período inválido.'; end if;
  if coalesce(p_comparar, 'anterior') = 'mes' then cde := (de - interval '1 month')::date; cate := (ate - interval '1 month')::date;
  else cate := de - 1; cde := de - (ate - de + 1); end if;
  return (with
    b as (select bairro, sum(pedidos) pedidos, sum(atraso) atraso, sum(soma_associar) / nullif(sum(n_associar), 0) assoc,
                 sum(soma_total) / nullif(sum(n_total), 0) total
            from public.pedidos_resumo_bairro where cidade = cid and dia between de and ate group by 1),
    bc as (select bairro, sum(soma_associar) / nullif(sum(n_associar), 0) assoc, sum(soma_total) / nullif(sum(n_total), 0) total
             from public.pedidos_resumo_bairro where cidade = cid and dia between cde and cate group by 1),
    bl as (select bairro, (select jsonb_agg(k order by v desc) from (select k, sum(v::int) v from public.pedidos_resumo_bairro r2,
                 jsonb_each_text(r2.lojas) as e(k, v) where r2.cidade = cid and r2.dia between de and ate and r2.bairro = b.bairro
                 group by 1 order by 2 desc limit 2) z) lojas from b),
    bcan as (select bairro, sum(n) canc, sum(n) filter (where etapa = 'sem_entregador') sem_ent
               from public.pedidos_resumo_cancel where cidade = cid and dia between de and ate group by 1),
    t as (select sum(pedidos) pedidos, sum(atraso) atraso, sum(soma_associar) / nullif(sum(n_associar), 0) assoc
            from public.pedidos_resumo where cidade = cid and dia between de and ate),
    l as (select loja, sum(pedidos) pedidos, sum(atraso) atraso, sum(soma_espera) / nullif(sum(n_espera), 0) espera,
                 sum(at_entregador) e, sum(at_loja) lj, sum(at_aceite) ac, sum(at_rota) ro, sum(at_outras) ou
            from public.pedidos_resumo where cidade = cid and dia between de and ate and loja <> 'Sem loja' group by 1),
    lc as (select loja, sum(pedidos) pedidos, sum(atraso) atraso from public.pedidos_resumo
            where cidade = cid and dia between cde and cate group by 1),
    m as (select extract(dow from dia)::int dow, hora, sum(pedidos) pedidos, sum(atraso) atraso
            from public.pedidos_resumo where cidade = cid and dia between de and ate group by 1, 2),
    mc as (select extract(dow from dia)::int dow, hora, sum(n) canc
             from public.pedidos_resumo_cancel where cidade = cid and dia between de and ate group by 1, 2)
    select jsonb_build_object('cidade', cid, 'de', de, 'ate', ate, 'comp_de', cde, 'comp_ate', cate, 'limite', lim,
      'cidades', (select coalesce(jsonb_agg(c order by c), '[]') from (select distinct cidade c from public.pedidos_resumo where public.cidade_monitorada(cidade)) z),
      'pedidos', t.pedidos, 'atraso', t.atraso, 'sla', round(100 - t.atraso::numeric * 100 / nullif(t.pedidos, 0), 1),
      'assoc', round(t.assoc, 1),
      'cancelados', (select coalesce(sum(n), 0) from public.pedidos_resumo_cancel where cidade = cid and dia between de and ate),
      'bairros', coalesce((select jsonb_agg(jsonb_build_object('bairro', b.bairro, 'pedidos', b.pedidos, 'atraso', b.atraso,
                 'pct', round(b.atraso::numeric * 100 / nullif(b.pedidos, 0), 1),
                 'impacto', round(b.atraso::numeric * 100 / nullif(t.pedidos, 0), 2),
                 'assoc', round(b.assoc, 1), 'assoc_var', round(b.assoc - bc.assoc, 1),
                 'total', round(b.total, 1), 'total_var', round(b.total - bc.total, 1),
                 'cancelados', coalesce(bcan.canc, 0), 'sem_entregador', coalesce(bcan.sem_ent, 0), 'lojas', coalesce(bl.lojas, '[]')))
          from b left join bc using (bairro) left join bl using (bairro) left join bcan using (bairro)
         where b.pedidos >= coalesce(p_min, 0)), '[]'),
      'lojas', coalesce((select jsonb_agg(jsonb_build_object('loja', l.loja, 'pedidos', l.pedidos, 'atraso', l.atraso,
                 'pct', round(l.atraso::numeric * 100 / nullif(l.pedidos, 0), 1),
                 'impacto', round(l.atraso::numeric * 100 / nullif(t.pedidos, 0), 2), 'espera', round(l.espera, 1),
                 'causa', case when l.atraso = 0 then null
                               when l.lj >= greatest(l.e, l.ac, l.ro, l.ou) then 'loja'
                               when l.e >= greatest(l.ac, l.ro, l.ou) then 'entregador'
                               when l.ac >= greatest(l.ro, l.ou) then 'aceite'
                               when l.ro >= l.ou then 'rota' else 'outras' end,
                 'pct_antes', round(lc.atraso::numeric * 100 / nullif(lc.pedidos, 0), 1))
                 order by l.atraso desc, l.loja)
          from l left join lc using (loja) where l.pedidos >= 30 and l.atraso > 0), '[]'),
      'mapa', coalesce((select jsonb_agg(jsonb_build_object('dow', coalesce(m.dow, mc.dow), 'hora', coalesce(m.hora, mc.hora),
                 'pedidos', coalesce(m.pedidos, 0), 'atraso', coalesce(m.atraso, 0), 'cancelados', coalesce(mc.canc, 0)))
          from m full join mc using (dow, hora)), '[]'))
    from t);
end $$;

-- ---------- 7d. aba Calendário ----------
-- Cada dia soma pontos (pedido do usuário em 28/11):
--   clima: chuva prevista ou registrada (1 = chance de 40%+ ou 1 mm+; 2 = chance de 70%+ ou 5 mm+);
--   tempo de entrega: 1 ponto comparando com o mesmo dia da semana passada e 1 com o mesmo dia do mês passado;
--   cancelamentos: o mesmo, 1 + 1.
--   Dia que já aconteceu: o próprio dia contra os dois de referência (pior = tempo 10% acima; cancelados 1 ponto
--   percentual acima). Dia que ainda vai acontecer: os dois de referência contra a média das 4 semanas.
--   Nível: 0–1 tranquilo, 2 atenção, 3 alto, 4 crítico, 5–6 extremo.
-- A previsão do tempo vem do navegador (OpenWeatherMap), uma busca por cidade por dia, guardada em clima_dia.
create table if not exists public.parametros_monitor (
  unico boolean primary key default true check (unico),
  clima_chave text);
insert into public.parametros_monitor (unico) values (true) on conflict do nothing;
alter table public.parametros_monitor enable row level security;

create table if not exists public.clima_dia (
  cidade text not null,
  dia date not null,
  chance integer,            -- maior chance de chuva no dia (%)
  chuva_mm numeric,          -- chuva prevista no dia (mm)
  descricao text,
  das text, ate text,        -- horário com mais chuva prevista (ex.: 18h às 22h)
  buscado_em timestamptz not null default now(),
  primary key (cidade, dia));
alter table public.clima_dia enable row level security;

create table if not exists public.planejamentos_dia (
  cidade text not null,
  dia date not null,
  convocar integer check (convocar between 0 and 500),
  reforco_de text, reforco_ate text,
  acoes text[] not null default '{}',
  observacao text,
  por uuid, por_nome text,
  em timestamptz not null default now(),
  primary key (cidade, dia));
alter table public.planejamentos_dia enable row level security;

create or replace function public.chave_clima()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return (select clima_chave from public.parametros_monitor where unico);
end $$;

create or replace function public.salvar_chave_clima(p_chave text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador');
  if p_chave is not null and btrim(p_chave) !~ '^[A-Za-z0-9]{16,64}$' then raise exception 'A chave tem só letras e números.'; end if;
  update public.parametros_monitor set clima_chave = nullif(btrim(p_chave), '') where unico;
end $$;

-- o navegador manda a previsão dos próximos dias de uma cidade: [{dia, chance, chuva_mm, descricao, das, ate}]
create or replace function public.salvar_clima(p_cidade text, p_itens jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) > 10 then raise exception 'Previsão inválida.'; end if;
  insert into public.clima_dia as c (cidade, dia, chance, chuva_mm, descricao, das, ate)
  select upper(btrim(p_cidade)), x.dia, least(greatest(x.chance, 0), 100), least(greatest(x.chuva_mm, 0), 500), left(x.descricao, 80), left(x.das, 10), left(x.ate, 10)
    from jsonb_to_recordset(p_itens) x(dia date, chance integer, chuva_mm numeric, descricao text, das text, ate text)
   where x.dia between public.hoje_brasilia() - 1 and public.hoje_brasilia() + 7
  on conflict (cidade, dia) do update set chance = excluded.chance, chuva_mm = excluded.chuva_mm, descricao = excluded.descricao,
         das = excluded.das, ate = excluded.ate, buscado_em = now();
end $$;

create or replace function public.salvar_planejamento(p_cidade text, p_dia date, p_convocar integer, p_reforco_de text, p_reforco_ate text,
  p_acoes jsonb, p_observacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador', 'monitorador');
  if p_dia < public.hoje_brasilia() then raise exception 'Só dá para planejar hoje ou um dia que ainda vai acontecer.'; end if;
  if p_reforco_de is not null and p_reforco_de !~ '^\d{2}:\d{2}$' or p_reforco_ate is not null and p_reforco_ate !~ '^\d{2}:\d{2}$' then
    raise exception 'Horário do reforço inválido.'; end if;
  insert into public.planejamentos_dia as pl (cidade, dia, convocar, reforco_de, reforco_ate, acoes, observacao, por, por_nome)
  values (upper(btrim(p_cidade)), p_dia, p_convocar, p_reforco_de, p_reforco_ate,
          coalesce((select array_agg(a) from jsonb_array_elements_text(coalesce(p_acoes, '[]')) a where a in ('mensagem', 'missao', 'aviso_geral', 'avisar_parceiros')), '{}'),
          left(nullif(btrim(p_observacao), ''), 600), auth.uid(), public.nome_de(auth.uid()))
  on conflict (cidade, dia) do update set convocar = excluded.convocar, reforco_de = excluded.reforco_de, reforco_ate = excluded.reforco_ate,
         acoes = excluded.acoes, observacao = excluded.observacao, por = excluded.por, por_nome = excluded.por_nome, em = now();
end $$;

create or replace function public.monitor_calendario(p_cidade text default null, p_mes date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid text; ini date; fim date; hoje date := public.hoje_brasilia(); ult date;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  cid := (select coalesce(p_cidade, (select cidade from public.pedidos_resumo where public.cidade_monitorada(cidade) group by 1 order by sum(pedidos) desc limit 1))
          where p_cidade is null or public.cidade_monitorada(p_cidade));
  if cid is null then return jsonb_build_object('vazio', true); end if;
  ini := date_trunc('month', coalesce(p_mes, hoje))::date;
  fim := (ini + interval '1 month - 1 day')::date;
  select max(dia) into ult from public.pedidos_resumo where cidade = cid;
  return (with
    dias as (select generate_series(ini, fim, '1 day')::date dia),
    v as (select r.dia, sum(r.pedidos) pedidos, sum(r.soma_total) / nullif(sum(r.n_total), 0) tempo,
                 sum(r.soma_associar) / nullif(sum(r.n_associar), 0) assoc, sum(r.atraso) atraso
            from public.pedidos_resumo r where r.cidade = cid and r.dia between ini - 40 and fim group by 1),
    vc as (select dia, sum(n) canc from public.pedidos_resumo_cancel where cidade = cid and dia between ini - 40 and fim group by 1),
    val as (select v.dia, v.pedidos, v.tempo, v.assoc, v.atraso, coalesce(vc.canc, 0) canc,
                   coalesce(vc.canc, 0)::numeric * 100 / nullif(v.pedidos + coalesce(vc.canc, 0), 0) canc_pct
              from v left join vc using (dia)),
    media as (select avg(tempo) tempo, avg(canc_pct) canc_pct from val where dia between ult - 27 and ult),
    x as (select d.dia, d.dia > coalesce(ult, hoje - 1) futuro,
                 a.pedidos, a.tempo, a.assoc, a.canc, a.canc_pct,
                 s.dia s_dia, s.pedidos s_pedidos, s.tempo s_tempo, s.assoc s_assoc, s.canc_pct s_canc,
                 m.dia m_dia, m.tempo m_tempo, m.canc_pct m_canc,
                 c.chance, c.chuva_mm, c.descricao, c.das, c.ate,
                 pl.cidade is not null planejado, pl.convocar, pl.reforco_de, pl.reforco_ate, pl.acoes, pl.observacao, pl.por_nome
            from dias d
            left join val a on a.dia = d.dia
            left join val s on s.dia = d.dia - 7
            left join val m on m.dia = (d.dia - interval '1 month')::date
            left join public.clima_dia c on c.cidade = cid and c.dia = d.dia
            left join public.planejamentos_dia pl on pl.cidade = cid and pl.dia = d.dia),
    pts as (select x.*,
                 case when coalesce(x.chance >= 70, false) or coalesce(x.chuva_mm >= 5, false) then 2
                      when coalesce(x.chance >= 40, false) or coalesce(x.chuva_mm >= 1, false) then 1 else 0 end p_clima,
                 case when not x.futuro then (coalesce(x.tempo > x.s_tempo * 1.1, false))::int + (coalesce(x.tempo > x.m_tempo * 1.1, false))::int
                      else (coalesce(x.s_tempo > (select tempo from media) * 1.1, false))::int + (coalesce(x.m_tempo > (select tempo from media) * 1.1, false))::int end p_tempo,
                 case when not x.futuro then (coalesce(x.canc_pct > x.s_canc + 1, false))::int + (coalesce(x.canc_pct > x.m_canc + 1, false))::int
                      else (coalesce(x.s_canc > (select canc_pct from media) + 1, false))::int + (coalesce(x.m_canc > (select canc_pct from media) + 1, false))::int end p_canc
            from x)
    select jsonb_build_object('cidade', cid, 'mes', ini, 'hoje', hoje, 'ultimo_dado', ult,
      'clima_em', (select max(buscado_em) from public.clima_dia where cidade = cid),
      'tem_chave', (select clima_chave is not null from public.parametros_monitor where unico),
      'cidades', (select coalesce(jsonb_agg(c order by c), '[]') from (select distinct cidade c from public.pedidos_resumo where public.cidade_monitorada(cidade)) z),
      'media', (select jsonb_build_object('tempo', round(tempo, 1), 'canc_pct', round(canc_pct, 1)) from media),
      'dias', jsonb_agg(jsonb_build_object('dia', p.dia, 'futuro', p.futuro, 'pontos', p.p_clima + p.p_tempo + p.p_canc,
          'p_clima', p.p_clima, 'p_tempo', p.p_tempo, 'p_canc', p.p_canc,
          'nivel', case when p.p_clima + p.p_tempo + p.p_canc >= 5 then 4 when p.p_clima + p.p_tempo + p.p_canc = 4 then 3
                        when p.p_clima + p.p_tempo + p.p_canc = 3 then 2 when p.p_clima + p.p_tempo + p.p_canc = 2 then 1 else 0 end,
          'pedidos', p.pedidos, 'tempo', round(p.tempo, 1), 'assoc', round(p.assoc, 1), 'canc_pct', round(p.canc_pct, 1),
          's_dia', p.s_dia, 's_pedidos', p.s_pedidos, 's_tempo', round(p.s_tempo, 1), 's_assoc', round(p.s_assoc, 1), 's_canc', round(p.s_canc, 1),
          'm_dia', p.m_dia, 'm_tempo', round(p.m_tempo, 1), 'm_canc', round(p.m_canc, 1),
          'chance', p.chance, 'chuva_mm', p.chuva_mm, 'descricao', p.descricao, 'das', p.das, 'ate', p.ate,
          'planejado', p.planejado, 'plano', case when p.planejado then jsonb_build_object('convocar', p.convocar, 'reforco_de', p.reforco_de,
             'reforco_ate', p.reforco_ate, 'acoes', p.acoes, 'observacao', p.observacao, 'por', p.por_nome) end,
          'pior_hora', (select r.hora from public.pedidos_resumo r where r.cidade = cid and r.dia = p.dia
                         group by 1 order by sum(r.atraso) desc, 1 limit 1))
        order by p.dia))
    from pts p);
end $$;

-- ---------- 7b. mensagem de agradecimento ao parceiro (aba Parceiros: "Chamando mais" e "Voltou a chamar") ----------
insert into public.modelos_mensagem (chave, grupo, tipo, opcao, titulo, texto, ordem)
values ('parceiro_agradecimento', 'parceiro', 'parceiro_agradecimento', 1, 'Parceiro: agradecimento',
  'Olá! Aqui é {meu_nome}, da equipe de operação. Vimos que {estabelecimento} está chamando bastante com a gente nas últimas semanas. Obrigado pela parceria! Se precisar de qualquer ajuste nas entregas, é só falar por aqui.', 22)
on conflict (chave) do nothing;

-- ---------- 8. acesso ----------
revoke all on function public.classificar_pedidos(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.montar_rotas(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.resumir_pedidos(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.cidade_monitorada(text) from public, anon, authenticated;
grant execute on function public.importar_pedidos(jsonb) to authenticated;
grant execute on function public.fechar_importacao_pedidos(timestamptz, timestamptz) to authenticated;
grant execute on function public.monitor_parceiros(text) to authenticated;
grant execute on function public.monitor_entregadores(integer, text, text, integer, text, integer) to authenticated;
grant execute on function public.monitor_entregador(text, integer) to authenticated;
grant execute on function public.monitor_cidade(text, date, date, text, integer) to authenticated;
grant execute on function public.monitor_calendario(text, date) to authenticated;
grant execute on function public.chave_clima() to authenticated;
grant execute on function public.salvar_chave_clima(text) to authenticated;
grant execute on function public.salvar_clima(text, jsonb) to authenticated;
grant execute on function public.salvar_planejamento(text, date, integer, text, text, jsonb, text) to authenticated;
