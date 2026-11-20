-- resumo_inicio(): versão atual (todas as migrações até a 009y1c rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.resumo_inicio()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.papel := public.meu_papel(); pb public.papel := public.meu_papel_bloq(); eu text := public.meu_email();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'papel', p, 'papel_bloqueios', pb,
    'prazo_tratativa_horas', (select tratativa_prazo_horas from public.parametros_bloqueio),
    'ativacao', (select jsonb_build_object(
      'aguardando_analise', count(*) filter (where status = 'aguardando_analise' and (p in ('moderador', 'monitorador') or enviado_por = auth.uid())),
      'aguardando_contato', count(*) filter (where status = 'aguardando_contato' and (p in ('moderador', 'monitorador') or enviado_por = auth.uid())),
      'meus_aguardando_analise', count(*) filter (where status = 'aguardando_analise' and enviado_por = auth.uid()),
      'meus_aguardando_contato', count(*) filter (where status = 'aguardando_contato' and enviado_por = auth.uid()),
      'equipe_aguardando_analise', count(*) filter (where status = 'aguardando_analise'),
      'equipe_aguardando_contato', count(*) filter (where status = 'aguardando_contato'))
      from public.cadastros),
    'bloqueios', case when pb is null then null else (select jsonb_build_object(
      'bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado' and (pb in ('moderador', 'monitorador') or b.registrado_por = auth.uid())),
      'meus_bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado' and b.registrado_por = auth.uid()),
      'equipe_bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado'),
      'tratativas_pendentes', (select count(*) from public.tarefas t join public.bloqueios x on x.id = t.bloqueio_id
                                where t.status = 'pendente' and case pb
                                  when 'moderador' then true
                                  when 'monitorador' then t.responsavel_email = eu or t.tipo = 'completar_dados'
                                  else x.registrado_por = auth.uid() end),
      'equipe_tratativas_pendentes', (select count(*) from public.tarefas t where t.status = 'pendente'),
      'tratativas_atrasadas', (select count(*) from public.tarefas t where public.tarefa_atrasada(t)
                                 and (pb = 'moderador' or (pb = 'monitorador' and t.responsavel_email = eu))),
      'atencao', jsonb_array_length(public.entregadores_atencao()))
      from public.bloqueios b) end,
    'atividades', (select jsonb_build_object(
      'para_aceitar', count(*) filter (where a.status = 'aberta' and public.atividade_aberta_para_mim(a) and a.criada_por is distinct from auth.uid()
                                         and not (a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false))),
      'opcionais', count(*) filter (where a.status = 'aberta' and a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false)),
      'minhas_em_andamento', count(*) filter (where a.status = 'aceita' and public.participa(a)),
      'equipe_abertas', count(*) filter (where a.status in ('aberta', 'aceita')),
      'abertas_para_pegar', count(*) filter (where a.status = 'aberta' and not a.automatica and a.criada_por is distinct from auth.uid() and (p = 'moderador' or public.atividade_aberta_para_mim(a))))
      from public.atividades a),
    'notificacoes', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null));
end $function$;
