-- 009z21 "Cálculo em partes" (28/11/2026, defeito real: o Supabase do plano grátis ficou lento e um dia de todas as
-- cidades passava do limite de tempo mesmo tentando de novo). O cálculo de cada dia vira 3 chamadas do site, cada uma
-- com o próprio limite: fechar_importacao_pedidos(de, até, 'sinais') (sinais, rota, pedidos do dia), 'resumo' (os
-- resumos) e 'limpar' (limpeza e o retorno de sempre); sem p_etapa faz tudo, como antes. classificar_pedidos olha o dia
-- vizinho para a rota, mas só grava o período (antes regravava 3 dias a cada chamada). Pode rodar de novo.

drop function if exists public.fechar_importacao_pedidos(timestamptz, timestamptz);

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
     and p.chamado_em between p_de and p_ate   -- 009z21: a rota olha o dia vizinho, mas só o período é gravado
     and (p.rota_n, p.t_chegada, p.t_total, p.t_entrega, p.t_aceitar, p.t_espera, p.t_finalizar, p.sinal_chegada, p.sinal_total,
          p.sinal_finalizacao, p.causa, p.atencao, p.tem_sinal, p.etapa_cancelou)
         is distinct from (x.rota_n, x.t_chegada, x.t_total, x.t_entrega, x.t_aceitar, x.t_espera, x.t_finalizar, x.sc, x.st, x.sf,
          x.causa, x.atencao, x.tem_sinal, x.etapa);
end $$;

create or replace function public.fechar_importacao_pedidos(p_de timestamptz, p_ate timestamptz, p_etapa text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos; apagados integer; velhos integer;
begin
  perform public.exigir_bloq('moderador');
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido.'; end if;
  select * into par from public.parametros_pedidos where unico;
  -- 009z21: o site chama em 3 partes (sinais, resumo, limpar), cada uma dentro do limite de tempo; sem p_etapa, tudo
  if p_etapa is not null and p_etapa not in ('sinais', 'resumo', 'limpar') then raise exception 'Etapa inválida.'; end if;
  if coalesce(p_etapa, 'sinais') = 'sinais' then
  perform public.classificar_pedidos(p_de, p_ate);
  perform public.montar_rotas(p_de, p_ate);
  insert into public.pedidos_dia (dia, cidade, pedidos, cancelados)
  select (chamado_em at time zone 'America/Sao_Paulo')::date, cidade, count(*) filter (where status = 'finalizado'),
         count(*) filter (where status = 'cancelado')
    from public.pedidos_log
   where chamado_em between p_de and p_ate and cidade is not null group by 1, 2
  on conflict (dia, cidade) do update set pedidos = greatest(public.pedidos_dia.pedidos, excluded.pedidos),
         cancelados = greatest(public.pedidos_dia.cancelados, excluded.cancelados);
  if p_etapa = 'sinais' then return jsonb_build_object('etapa', 'sinais'); end if;
  end if;
  if coalesce(p_etapa, 'resumo') = 'resumo' then
  perform public.resumir_pedidos(p_de, p_ate);
  if p_etapa = 'resumo' then return jsonb_build_object('etapa', 'resumo'); end if;
  end if;
  -- só o período calculado agora: o resto do envio ainda não tem os sinais
  delete from public.pedidos_log
   where chamado_em between p_de and p_ate
     and (status = 'cancelado' or (not tem_sinal and decisao is null))
     and coalesce(finalizado_em, entregue_em, chamado_em, importado_em) < now() - par.guardar_dias * interval '1 day';
  get diagnostics apagados = row_count;
  -- pedidos com sinal: só os dos últimos guardar_sinal_dias (já estão nos resumos)
  -- 009z19: só os que chegaram em envios anteriores (os do envio de agora podem ser de dias que ainda vão ser calculados)
  delete from public.pedidos_log where chamado_em < now() - par.guardar_sinal_dias * interval '1 day'
     and importado_em < now() - interval '12 hours';
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

revoke all on function public.classificar_pedidos(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fechar_importacao_pedidos(timestamptz, timestamptz, text) to authenticated;
