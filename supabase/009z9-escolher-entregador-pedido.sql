-- 009z9 (22/11/2026, pedido do usuário): no cartão do pedido, "Nome igual ao de outro entregador: confira o ID" abre
-- os entregadores com o mesmo nome (o que o Comunique sabe de cada ID) e a pessoa escolhe o certo, neste pedido ou em
-- todos os pedidos ainda não decididos com o mesmo nome. Pode rodar de novo.

-- os IDs possíveis para o nome do pedido: os do Tableau (entregador_opcoes) e o que está no pedido, com a ficha,
-- as restrições e os cadastros de cada um
create or replace function public.opcoes_entregador_pedido(p_entrega_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.pedidos_log;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into p from public.pedidos_log where entrega_id = p_entrega_id;
  if p.entrega_id is null then raise exception 'Pedido não encontrado.'; end if;
  return jsonb_build_object(
    'nome', p.entregador_nome, 'atual', p.entregador_id, 'situacao', p.entregador_situacao,
    'pedidos_mesmo_nome', (select count(*) from public.pedidos_log q
       where lower(q.entregador_nome) = lower(p.entregador_nome) and q.decisao is null and q.tem_sinal),
    'opcoes', coalesce((
      with ids as (
        select o ->> 'id' as id, o ->> 'cidade' as cidade_tableau from jsonb_array_elements(p.entregador_opcoes) o
        union select p.entregador_id, null where p.entregador_id is not null)
      select jsonb_agg(jsonb_build_object(
          'id', x.id, 'cidade_tableau', x.cidade_tableau,
          'ficha_nome', e.nome, 'ficha_cidade', e.cidade,
          'restricoes', (select count(*) from public.bloqueios b where lower(b.id_app) = lower(x.id)),
          'ultima_restricao', (select max(b.inicio) from public.bloqueios b where lower(b.id_app) = lower(x.id)),
          'cadastros', (select count(*) from public.cadastros c where lower(c.id_app) = lower(x.id)),
          'pedidos', (select count(*) from public.pedidos_log q where lower(q.entregador_id) = lower(x.id)),
          'atual', lower(x.id) = lower(coalesce(p.entregador_id, '')))
        order by lower(x.id) = lower(coalesce(p.entregador_id, '')) desc, x.id)
      from (select distinct on (lower(id)) id, cidade_tableau from ids where id is not null order by lower(id), cidade_tableau nulls last) x
      left join public.entregadores e on e.id_app = lower(x.id)), '[]'));
end $$;

-- grava o ID escolhido neste pedido ou em todos os pedidos ainda não decididos com o mesmo nome
create or replace function public.escolher_entregador_pedido(p_entrega_id text, p_id_app text, p_todos boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.pedidos_log; v_id text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'); n integer;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if length(v_id) < 4 then raise exception 'Escolha o ID do entregador.'; end if;
  select * into p from public.pedidos_log where entrega_id = p_entrega_id;
  if p.entrega_id is null then raise exception 'Pedido não encontrado.'; end if;
  if p.decisao is not null then raise exception 'Este pedido já foi decidido; o ID não muda mais por aqui.'; end if;
  update public.pedidos_log set entregador_id = v_id, entregador_situacao = 'ok'
   where decisao is null
     and (entrega_id = p.entrega_id
          or (coalesce(p_todos, false) and p.entregador_nome is not null and lower(entregador_nome) = lower(p.entregador_nome)));
  get diagnostics n = row_count;
  return jsonb_build_object('pedidos', n);
end $$;

do $$ declare f text; begin
  foreach f in array array['opcoes_entregador_pedido(text)', 'escolher_entregador_pedido(text, text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
