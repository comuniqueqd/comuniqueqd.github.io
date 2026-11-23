-- 009z16 "Reenvio que vale" (23/11/2026, correção da 009z10/009z13). Pode rodar de novo.
-- O resumo das Análises (pedidos_resumo e pedidos_resumo_bairro) só era refeito quando o envio trazia pelo menos tantos
-- pedidos quanto o maior número já contado para o dia. No reenvio de 23/11 o Tableau exportou uns poucos pedidos a menos
-- em vários dias e esses dias foram pulados sem aviso (ficaram sem o bairro nas Análises). Agora um envio do dia inteiro
-- (pedidos importados nas últimas 6 horas = 90% ou mais do que já foi contado) também refaz o dia. Para valer nos dias
-- antigos, é preciso reenviar os arquivos de etapas.

-- resumir_pedidos (corpo inteiro; o resto igual à 009z13)
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
  -- troca o dia da cidade quando o dia está completo no banco (tantos pedidos quanto pedidos_dia contou e pelo menos os
  -- que o resumo já contava) OU quando acabou de chegar um envio do dia inteiro (009z16: pedidos do dia importados nas
  -- últimas 6 horas = pelo menos 90% do maior número já contado; o Tableau pode exportar uns poucos pedidos a menos num
  -- reenvio, e antes o dia era pulado sem aviso). Um dia incompleto (só os pedidos com sinal que sobraram) nunca entra.
  drop table if exists _resumo_troca;
  create temporary table _resumo_troca on commit drop as
  with novo as (select dia, cidade, sum(pedidos) n from _resumo_novo group by 1, 2),
       velho as (select dia, cidade, sum(pedidos) n from public.pedidos_resumo r
                  where (r.dia, r.cidade) in (select dia, cidade from novo) group by 1, 2),
       recente as (select (p.chamado_em at time zone 'America/Sao_Paulo')::date dia, p.cidade, count(*) n
                     from public.pedidos_log p
                    where p.importado_em > now() - interval '6 hours' and p.cidade is not null
                      and p.chamado_em between p_de - interval '1 day' and p_ate + interval '1 day'
                    group by 1, 2)
  select n.dia, n.cidade from novo n left join velho v using (dia, cidade)
    left join public.pedidos_dia pd on pd.dia = n.dia and pd.cidade = n.cidade
    left join recente rc on rc.dia = n.dia and rc.cidade = n.cidade
   where (n.n >= coalesce(v.n, 0) and n.n >= coalesce(pd.pedidos, 0))
      or coalesce(rc.n, 0) >= 0.9 * greatest(coalesce(pd.pedidos, 0), coalesce(v.n, 0), 1);
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

do $$ begin
  execute 'revoke all on function public.resumir_pedidos(timestamp with time zone, timestamp with time zone) from public, anon, authenticated';
end $$;

notify pgrst, 'reload schema';
