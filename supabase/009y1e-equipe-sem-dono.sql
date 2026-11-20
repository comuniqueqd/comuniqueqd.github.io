-- 009y1e "Atividade da equipe sem dono" (20/11/2026, pedido do usuário)
-- Antes da 009y1c dava para "pegar" a tarefa automática. As que ficaram como "em andamento" com alguém
-- apareciam duas vezes na Minha fila (em Atividades da equipe e em Tarefas com você) e contavam como
-- "tarefa com você em andamento" na tela inicial. Elas voltam a ser da equipe: abertas, sem dono.
-- Quem estava nelas continua guardado em participantes (é avisado quando a meta é batida).
-- Pode rodar mais de uma vez. Depende da 009y1c.

update public.atividades
   set status = 'aberta', aceita_por = null, aceita_por_nome = null, aceita_em = null,
       pausa_seg = pausa_seg + coalesce(extract(epoch from now() - aguardando_desde)::int, 0),
       aguardando_desde = null, aguardando_motivo = null
 where automatica and status = 'aceita';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Notícias rápidas também com os acordos novos com parceiros (pedido do usuário, 20/11/2026)
-- ---------------------------------------------------------------------
create or replace function public.noticias_rapidas(p_limite int default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limite, 6), 20));
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(x order by x->>'quando' desc) from (
    select x from (
      select jsonb_build_object('tipo', 'tarefa', 'id', a.id::text, 'titulo', a.titulo, 'cidade', a.cidade,
               'quem', coalesce(a.concluida_por_nome, a.aceita_por_nome, a.criada_por_nome), 'quando', a.concluida_em,
               'equipe', a.automatica, 'eu', coalesce(a.concluida_por, a.aceita_por) = auth.uid()) x
        from public.atividades a
       where a.status = 'concluida' and a.concluida_em > now() - interval '7 days'
      union all
      select jsonb_build_object('tipo', 'acordo', 'id', c.id::text, 'titulo', c.estabelecimento, 'cidade', c.cidade,
               'quem', c.criado_por_nome, 'quando', c.criado_em, 'equipe', false, 'eu', c.criado_por = auth.uid())
        from public.acordos c
       where c.criado_em > now() - interval '7 days') t
     order by x->>'quando' desc
     limit lim) s), '[]');
end $$;

revoke all on function public.noticias_rapidas(int) from public, anon;
grant execute on function public.noticias_rapidas(int) to authenticated;

notify pgrst, 'reload schema';
