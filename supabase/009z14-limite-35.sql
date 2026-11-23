-- 009z14 "Limite de 35 min no Monitoramento" (23/11/2026, pedido do usuário). Pode rodar de novo.
-- O sinal "pedido acima do limite" do Monitoramento passa de 45 para 35 min (do chamado até a entrega).
-- As Análises continuam com o próprio limite (analise_atraso_min = 30) e a regra do entregador não muda
-- (chegada > 15 min; aceite → entrega > 35 min saindo sozinho).
-- Os pedidos que ainda estão no banco são recalculados agora (as decisões já tomadas continuam). Os pedidos entre 35 e
-- 45 min que já foram apagados por não terem sinal só voltam se os arquivos do Tableau forem reenviados.

update public.parametros_pedidos set total_min = 35 where unico;

select public.classificar_pedidos(min(chamado_em), max(chamado_em)) from public.pedidos_log having count(*) > 0;
select public.montar_rotas(min(chamado_em), max(chamado_em)) from public.pedidos_log having count(*) > 0;

notify pgrst, 'reload schema';
