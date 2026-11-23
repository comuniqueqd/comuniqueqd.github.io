-- 009z15 "Limite de 30 min e chegada na rota" (23/11/2026, pedidos do usuário). Pode rodar de novo.
-- 1. Atraso a partir de 30 min: o sinal "pedido acima do limite" do Monitoramento passa de 35 para 30 min (chamado →
--    entrega, total_min). Para o entregador, atraso continua sendo só: mais de 15 min do aceite até chegar na loja
--    (chegada_min) ou mais de 30 min com o pedido em tela, do aceite até a entrega, saindo sozinho (entrega_min, antes 35).
--    Os pedidos que estão no banco são recalculados agora (as decisões continuam). As Análises já contavam atraso a
--    partir de 30 min; os dias já resumidos só ganham a regra nova do entregador quando os arquivos forem reenviados.
-- 2. Em "Ver a rota", cada pedido guarda também se o entregador demorou para chegar na loja e quanto: o cartão mostra
--    "chegou tarde na loja" no lugar da antiga etiqueta "passou do limite", que juntava esse sinal com o total.

update public.parametros_pedidos set total_min = 30, entrega_min = 30 where unico;

-- montar_rotas (corpo inteiro; o resto igual à 009z13)
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
      join public.pedidos_log q on lower(q.entregador_nome) = lower(p.entregador_nome)
                               and q.saiu_em between p.saiu_em - par.rota_janela_min * interval '1 minute'
                                                 and p.saiu_em + par.rota_janela_min * interval '1 minute'
     where p.tem_sinal and p.rota_n > 1 and p.saiu_em is not null and p.entregador_nome is not null
       and p.chamado_em between p_de and p_ate
     group by p.entrega_id)
  update public.pedidos_log p set rota_pedidos = r.lista
    from r where p.entrega_id = r.entrega_id and p.rota_pedidos is distinct from r.lista;
end $$;

select public.classificar_pedidos(min(chamado_em), max(chamado_em)) from public.pedidos_log having count(*) > 0;
select public.montar_rotas(min(chamado_em), max(chamado_em)) from public.pedidos_log having count(*) > 0;

do $$ begin
  execute 'revoke all on function public.montar_rotas(timestamp with time zone, timestamp with time zone) from public, anon, authenticated';
end $$;

notify pgrst, 'reload schema';
