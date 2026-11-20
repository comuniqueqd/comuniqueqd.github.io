-- 009y1b (parte 2 da 009y1, 20/11/2026, A15-03): entrar() devolve também liberado_em (quando a pessoa entrou na
-- equipe), para a tela inicial mostrar os "primeiros passos" só a quem chegou há menos de 14 dias. Corpo inteiro da
-- versão da 002 + o campo novo. Pode rodar de novo.

create or replace function public.entrar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.membros;
begin
  if auth.uid() is null then
    raise exception 'Faça login.' using errcode = '42501';
  end if;
  update public.membros set user_id = auth.uid()
   where email = public.meu_email() and user_id is distinct from auth.uid()
  returning * into m;
  if m.email is null then
    select * into m from public.membros where email = public.meu_email();
  end if;
  if m.email is null then
    return jsonb_build_object(
      'membro', false,
      'email', public.meu_email(),
      'pedido', exists (select 1 from public.pedidos_acesso where email = public.meu_email()));
  end if;
  return jsonb_build_object('membro', true, 'id', auth.uid(), 'email', m.email, 'nome', m.nome,
    'papel', m.papel, 'papel_bloqueios', m.papel_bloqueios, 'admin_final', m.admin_final, 'liberado_em', m.liberado_em);
end $$;

revoke all on function public.entrar() from public, anon;
grant execute on function public.entrar() to authenticated;

notify pgrst, 'reload schema';
