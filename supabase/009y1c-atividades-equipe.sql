-- 009y1c (20/11/2026, pedido do usuário): "Atividades da equipe". As tarefas que o sistema cria sozinho (hoje, a
-- "Aprovar 5 entregadores" ao ativar um parceiro; atividades.automatica) aparecem para todos numa parte própria, sem
-- ninguém precisar aceitar: todo mundo já participa (contam as aprovações de todos, 009x3) e ela fecha sozinha ao bater
-- a meta. Por isso:
-- 1. atividade_aberta_para_mim() = falso para a automática: ninguém "pega" (some o "Eu faço", o "para aceitar" e o
--    "pegar a próxima"; aceitar_atividade recusa).
-- 2. resumo_inicio(): abertas_para_pegar sem as automáticas (corpo inteiro; supabase/funcoes/resumo_inicio.sql junto).
-- 3. sem aviso de "tarefa sem ninguém": a automática nasce com escalada_em (as que já existem também).
-- 4. listar_atividades() mostra a atividade da equipe para todos.
-- Pode rodar de novo.

create or replace function public.atividade_aberta_para_mim(a public.atividades)
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce(a.automatica, false)
     and (a.opcional or cardinality(a.sugeridas_para) = 0 or auth.uid() = any (a.sugeridas_para)
          or a.criada_em <= now() - interval '10 minutes')
$$;

create or replace function public.tarefa_entregadores_do_parceiro(p public.parceiros)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.atividades; tt public.tipos_tarefa; quem text := public.nome_de(auth.uid()); c jsonb; x jsonb;
begin
  select * into a from public.atividades
   where tipo = 'ativar_entregadores' and modo = 'solicitacao' and cidade = p.cidade and status in ('aberta', 'aceita')
   order by criada_em limit 1 for update;
  if a.id is not null then
    c := jsonb_set(a.campos, '{quantidade}', to_jsonb(coalesce(a.meta, 0) + 5));
    update public.atividades set meta = coalesce(meta, 0) + 5, campos = c, titulo = public.titulo_tarefa('ativar_entregadores', c, null),
           descricao = left(concat_ws(E'\n', descricao, format('+5 com o parceiro %s (ativado por %s).', p.estabelecimento, quem)), 1500)
     where id = a.id returning * into a;
    for x in select * from jsonb_array_elements(public.participantes_de(a)) loop
      if (x->>'id')::uuid is distinct from auth.uid() then
        perform public.notificar((x->>'id')::uuid, format('A tarefa subiu para %s entregadores: %s ativou o parceiro %s.', a.meta, quem, p.estabelecimento), '#atividades/sugeridas');
      end if;
    end loop;
    return jsonb_build_object('titulo', a.titulo, 'meta', a.meta, 'nova', false);
  end if;
  select * into tt from public.tipos_tarefa where tipo = 'ativar_entregadores';
  c := jsonb_build_object('cidade', p.cidade, 'quantidade', 5, 'motivo', 'Parceiro novo: ' || p.estabelecimento);
  insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, tipo, campos, cidade, modo, meta, automatica, escalada_em)
  values (public.titulo_tarefa('ativar_entregadores', c, null), format('Criada sozinha ao ativar o parceiro %s.', p.estabelecimento),
          auth.uid(), quem, '{}', case when tt.prazo_horas is not null then now() + tt.prazo_horas * interval '1 hour' end,
          'ativar_entregadores', c, p.cidade, 'solicitacao', 5, true, now())
  returning * into a;
  return jsonb_build_object('titulo', a.titulo, 'meta', a.meta, 'nova', true);
end $$;

-- 4. a lista mostra a atividade da equipe para todos (antes saía junto com o "aberta para mim")
create or replace function public.listar_atividades(p_concluidas integer default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_papel('moderador', 'monitorador', 'suporte');
begin
  return coalesce((select jsonb_agg(public.json_atividade(a) order by a.criada_em desc)
    from (
      select a.* from public.atividades a
       where (a.status = 'aberta' and (a.automatica or p = 'moderador' or a.criada_por = auth.uid() or public.atividade_aberta_para_mim(a)))
          or a.status = 'aceita'
      union all
      (select a.* from public.atividades a
        where a.status = 'concluida' and a.concluida_em > now() - interval '30 days'
          and (p_concluidas is null or p_concluidas > 0)
        order by a.concluida_em desc
        limit p_concluidas)) a), '[]');
end $$;

update public.atividades set escalada_em = now() where id is not null and automatica and escalada_em is null;

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

revoke all on function public.atividade_aberta_para_mim(public.atividades) from public, anon, authenticated;
revoke all on function public.tarefa_entregadores_do_parceiro(public.parceiros) from public, anon, authenticated;
revoke all on function public.listar_atividades(integer) from public, anon;
grant execute on function public.listar_atividades(integer) to authenticated;
revoke all on function public.resumo_inicio() from public, anon;
grant execute on function public.resumo_inicio() to authenticated;

notify pgrst, 'reload schema';
