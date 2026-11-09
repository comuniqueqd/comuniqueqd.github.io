-- =====================================================================
-- 009f: Parceiros completo e Notícias rápidas.
--
-- Parceiro ativado continua ativo (decisão do usuário: não há desativação).
-- * parceiros_por_cidade(): por cidade, quantos parceiros, quantos entraram nos
--   últimos 30 dias, o último ativado e quem mais ativou.
-- * noticias_rapidas(p_limite): as ativações de parceiros dos últimos 7 dias,
--   para a faixa "Notícias rápidas" da tela inicial (o texto comemorativo é
--   montado no front).
-- * Mensagem "Preencha: o código do pedido" (antes "número do pedido").
-- Pode rodar mais de uma vez. Rodar depois da 009e.
-- =====================================================================

-- versão de rascunho (com desativação) que nunca foi ao ar: some se existir
drop function if exists public.listar_parceiros(text, text, boolean, int, text);
drop function if exists public.desativar_parceiro(bigint, text);
drop function if exists public.reativar_parceiro(bigint);

create or replace function public.parceiros_por_cidade()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('cidade', c.cidade, 'ativos', c.ativos, 'ultimos_30d', c.ultimos_30d,
      'ultimo', (select jsonb_build_object('estabelecimento', p.estabelecimento, 'quando', p.criado_em, 'quem', p.criado_por_nome)
                   from public.parceiros p where p.cidade = c.cidade order by p.criado_em desc limit 1),
      'quem_mais', (select jsonb_build_object('nome', p.criado_por_nome, 'n', count(*)) from public.parceiros p
                     where p.cidade = c.cidade group by p.criado_por_nome order by count(*) desc, p.criado_por_nome limit 1))
      order by c.ativos desc, c.cidade)
    from (select cidade, count(*) ativos, count(*) filter (where criado_em > now() - interval '30 days') ultimos_30d
            from public.parceiros group by cidade) c), '[]');
end $$;

-- notícias rápidas da tela inicial: ativações de parceiros dos últimos 7 dias
create or replace function public.noticias_rapidas(p_limite int default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(x order by x->>'quando' desc) from (
    select jsonb_build_object('tipo', 'parceiro', 'id', p.id, 'estabelecimento', p.estabelecimento, 'cidade', p.cidade,
             'quem', p.criado_por_nome, 'quando', p.criado_em, 'eu', p.criado_por = auth.uid()) x
      from public.parceiros p
     where p.criado_em > now() - interval '7 days'
     order by p.criado_em desc
     limit greatest(1, least(coalesce(p_limite, 6), 20))) s), '[]');
end $$;

-- "número do pedido" vira "código do pedido" na mensagem de campo obrigatório (pedido do usuário)
do $$
declare def text;
begin
  def := pg_get_functiondef('public.validar_campos_tarefa(text, jsonb)'::regprocedure);
  if position('o número do pedido' in def) > 0 then
    execute replace(def, 'o número do pedido', 'o código do pedido');
  end if;
end $$;
revoke all on function public.validar_campos_tarefa(text, jsonb) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.parceiros_por_cidade()', 'public.noticias_rapidas(int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
