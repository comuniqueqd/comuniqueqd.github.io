-- 009y1d "Concluir a atividade da equipe" (20/11/2026, pedido do usuário)
-- As atividades da equipe (automáticas, nascidas ao ativar um parceiro) fecham sozinhas quando a meta é batida.
-- Agora qualquer pessoa da equipe também pode concluí-las antes, por exemplo quando a cidade já não precisa
-- de entregadores. Se a meta ainda não foi batida, o motivo é obrigatório e fica na nota da conclusão.
-- Pode rodar mais de uma vez. Depende da 009y1c.

create or replace function public.concluir_atividade(p_id uuid, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := (select nome from public.membros where email = public.meu_email()); p jsonb;
        v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 600);
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Atividade não encontrada.'; end if;
  if coalesce(a.automatica, false) then
    -- atividade da equipe: qualquer pessoa conclui; antes da meta, com o motivo
    if a.status not in ('aberta', 'aceita') then raise exception 'Esta atividade já foi concluída.'; end if;
    if coalesce(public.progresso_tarefa(a), 0) < coalesce(a.meta, 0) and v_nota is null then
      raise exception 'Conte por que a atividade está sendo concluída antes de bater a meta.';
    end if;
  else
    if a.status <> 'aceita' then raise exception 'Só dá para concluir uma atividade aceita.'; end if;
    if not public.participa(a) and public.meu_papel() <> 'moderador' then
      raise exception 'Só quem está na tarefa (ou um moderador) conclui esta atividade.' using errcode = '42501';
    end if;
  end if;
  update public.atividades set status = 'concluida', concluida_por = auth.uid(), concluida_por_nome = quem, concluida_em = now(),
         pausa_seg = pausa_seg + coalesce(extract(epoch from now() - aguardando_desde)::int, 0), aguardando_desde = null,
         progresso = case when tipo in ('ativar_entregadores', 'ativar_parceiro') then public.progresso_tarefa(a) else progresso end,
         nota = v_nota where id = a.id;
  if a.criada_por is distinct from auth.uid() then
    perform public.notificar(a.criada_por, format('%s concluiu a atividade: %s', quem, a.titulo), '#atividades/sugeridas');
  end if;
  for p in select * from jsonb_array_elements(public.participantes_de(a)) loop
    if (p->>'id')::uuid is distinct from auth.uid() and (p->>'id')::uuid is distinct from a.criada_por then
      perform public.notificar((p->>'id')::uuid, format('%s concluiu a tarefa em que você estava: %s', quem, a.titulo), '#atividades/sugeridas');
    end if;
  end loop;
end $$;

-- o cartão: "Concluir" também nas atividades da equipe (corpo inteiro, igual a supabase/funcoes/json_atividade.sql)
CREATE OR REPLACE FUNCTION public.json_atividade(a atividades)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', a.id, 'titulo', a.titulo, 'descricao', a.descricao,
    'criada_por', a.criada_por, 'criada_por_nome', a.criada_por_nome, 'criada_em', a.criada_em,
    'sugeridas_para', to_jsonb(a.sugeridas_para),
    'sugeridas_nomes', coalesce((select jsonb_agg(m.nome order by m.nome) from public.membros m where m.user_id = any (a.sugeridas_para)), '[]'),
    'para_todos', cardinality(a.sugeridas_para) = 0 or a.criada_em <= now() - interval '10 minutes',
    'para_mim', auth.uid() = any (a.sugeridas_para),
    'opcional', a.opcional, 'opcional_para_mim', a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false),
    'cadastro_id', a.cadastro_id,
    'prazo', a.prazo, 'status', a.status,
    'aceita_por', a.aceita_por, 'aceita_por_nome', a.aceita_por_nome, 'aceita_em', a.aceita_em,
    'concluida_por_nome', a.concluida_por_nome, 'concluida_em', a.concluida_em, 'nota', a.nota,
    'previsao', a.previsao, 'previsao_por_nome', a.previsao_por_nome,
    -- 009d2
    'tipo', coalesce(a.tipo, 'livre'), 'tipo_nome', coalesce(t.nome, 'Outra tarefa'), 'tipo_icone', coalesce(t.icone, '📝'),
    'campos', a.campos, 'cidade', a.cidade, 'modo', a.modo,
    'meta', a.meta, 'progresso', public.progresso_tarefa(a), 'progresso_automatico', a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.modo = 'solicitacao',
    'aguardando_desde', a.aguardando_desde, 'aguardando_motivo', a.aguardando_motivo,
    'checklist', a.checklist,
    'seg_espera', extract(epoch from coalesce(a.aceita_em, now()) - a.criada_em)::int,
    'seg_execucao', public.segundos_execucao(a),
    'atrasada', a.prazo is not null and a.status <> 'concluida' and a.aguardando_desde is null and now() > a.prazo,
    'comentarios', (select count(*) from public.comentarios_tarefa x where x.atividade_id = a.id),
    'agradecimentos', coalesce((select jsonb_agg(g.de_nome order by g.em) from public.agradecimentos g where g.atividade_id = a.id), '[]'),
    'agradeci', exists (select 1 from public.agradecimentos g where g.atividade_id = a.id and g.de = auth.uid()),
    'pode_agradecer', a.status = 'concluida' and a.aceita_por is not null and a.aceita_por <> auth.uid(),
    'pode_mexer', public.pode_mexer_tarefa(a),
    'pode_aceitar', a.status = 'aberta' and public.atividade_aberta_para_mim(a),
    'pode_concluir', (a.status = 'aceita' and (public.participa(a) or public.meu_papel() = 'moderador')) or (coalesce(a.automatica, false) and a.status in ('aberta', 'aceita')),
    'pode_prever', a.status = 'aceita' and (public.participa(a) or public.meu_papel() = 'moderador'),
    'compartilhavel', public.compartilhavel(a)) || jsonb_build_object(
    'participantes', coalesce((select jsonb_agg(p->>'nome') from jsonb_array_elements(public.participantes_de(a)) p), '[]'),
    'sou_participante', coalesce(public.participa(a), false),
    'pode_entrar', a.status = 'aceita' and public.compartilhavel(a) and not coalesce(public.participa(a), false),
    'pode_excluir', a.criada_por = auth.uid() or public.meu_papel() = 'moderador',
    'recorrente', a.recorrente_id is not null,
    'automatica', a.automatica,
    'revisao', (select jsonb_build_object('resultado', v.resultado, 'comentario', v.comentario, 'por_nome', v.por_nome, 'em', v.em)
                  from public.revisoes_qualidade v where v.atividade_id = a.id and (a.aceita_por = auth.uid() or public.sou_moderador())))
  from (select 1) _ left join public.tipos_tarefa t on t.tipo = a.tipo
$function$;

revoke all on function public.json_atividade(public.atividades) from public, anon, authenticated;
revoke all on function public.concluir_atividade(uuid, text) from public, anon;
grant execute on function public.concluir_atividade(uuid, text) to authenticated;

notify pgrst, 'reload schema';
