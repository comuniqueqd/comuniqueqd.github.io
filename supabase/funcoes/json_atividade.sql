-- json_atividade(atividades): versão atual (todas as migrações até a 009x3 rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
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
    'pode_concluir', a.status = 'aceita' and (public.participa(a) or public.meu_papel() = 'moderador'),
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
