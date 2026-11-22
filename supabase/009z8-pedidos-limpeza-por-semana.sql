-- 009z8 (22/11/2026, correção da 009z6): o site fecha o envio uma semana por vez (fechar_importacao_pedidos), e a
-- limpeza dos pedidos sem sinal rodava na tabela inteira. As semanas seguintes do mesmo envio ainda não tinham sido
-- calculadas (tem_sinal = falso por padrão) e eram apagadas antes da vez delas: só a 1ª semana de cada envio ficava.
-- Agora a limpeza mexe só no período que acabou de ser calculado. Pode rodar de novo.
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

revoke all on function public.fechar_importacao_pedidos(timestamp with time zone, timestamp with time zone) from public, anon;
grant execute on function public.fechar_importacao_pedidos(timestamp with time zone, timestamp with time zone) to authenticated;

notify pgrst, 'reload schema';
