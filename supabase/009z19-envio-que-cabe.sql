-- 009z19 "Envio que cabe" (28/11/2026, defeito real: "canceling statement due to statement timeout" no 1º envio da 009z18).
-- Ao fechar o 1º dia de um envio de semanas antigas, a limpeza dos pedidos com sinal mais velhos que guardar_sinal_dias
-- (35) apagava de uma vez todos os pedidos antigos do envio, inclusive os dos dias ainda não calculados: a exclusão
-- enorme passava do limite de tempo do Supabase (e, se coubesse, os dias seguintes perderiam os pedidos antes de virar
-- resumo). Agora ela só apaga o que chegou em envios anteriores (importado há mais de 12 horas). Pode rodar de novo.

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

grant execute on function public.fechar_importacao_pedidos(timestamptz, timestamptz) to authenticated;
