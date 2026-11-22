-- 009z7 (22/11/2026, pedido do usuário): os pedidos sem nenhum sinal ficam guardados 7 dias (antes 20), para caber
-- mais cidades no plano do Supabase. Os com sinal e os já decididos continuam. O total de pedidos de cada dia já está
-- em pedidos_dia, então os números do topo não mudam. Pode rodar de novo.
update public.parametros_pedidos set guardar_dias = 7 where unico;
alter table public.parametros_pedidos alter column guardar_dias set default 7;

-- apaga agora os que já passaram dos 7 dias (o próximo envio apagaria de qualquer jeito)
delete from public.pedidos_log
 where not tem_sinal and decisao is null
   and coalesce(finalizado_em, entregue_em, chamado_em, importado_em) < now() - interval '7 days';
