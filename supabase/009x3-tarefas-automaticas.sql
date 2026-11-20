-- 009x3 (20/11/2026, pedido do usuário): tarefas automáticas contam as aprovações de toda a equipe.
-- A tarefa "Aprovar N entregadores · CIDADE" que nasce sozinha ao ativar um parceiro (tarefa_entregadores_do_parceiro,
-- 009g) passa a contar TODOS os cadastros aprovados naquela cidade desde que a tarefa foi criada, não importa quem
-- aprovou nem se alguém já pegou a tarefa. As tarefas criadas por uma pessoa continuam contando só as aprovações de
-- quem pegou (e de quem entrou junto).
-- Marca nova: atividades.automatica (as que já existem são reconhecidas pela descrição "Criada sozinha ao ativar o
-- parceiro"). aprovacoes_de() com p_quem nulo = qualquer pessoa. json_atividade ganha 'automatica' (corpo inteiro,
-- regra da 009x: supabase/funcoes/json_atividade.sql atualizado junto).
-- Pode rodar de novo.

alter table public.atividades add column if not exists automatica boolean not null default false;
update public.atividades set automatica = true
 where id is not null and not automatica and tipo = 'ativar_entregadores' and modo = 'solicitacao'
   and descricao like 'Criada sozinha ao ativar o parceiro%';

-- p_quem nulo = aprovações de qualquer pessoa
create or replace function public.aprovacoes_de(p_tipo text, p_quem uuid, p_cidade text, p_de timestamptz, p_ate timestamptz default null)
returns int language sql stable security definer set search_path = public as $$
  select case p_tipo
    when 'ativar_entregadores' then (select count(distinct c.id)::int from public.cadastros c
        where c.status = 'aprovado' and (p_cidade is null or c.cidade = p_cidade)
          and exists (select 1 from public.eventos e where e.cadastro_id = c.id and e.tipo = 'aprovado' and (p_quem is null or e.por = p_quem)
                        and e.em >= p_de and (p_ate is null or e.em <= p_ate)))
    when 'ativar_parceiro' then (select count(*)::int from public.parceiros p
        where (p_quem is null or p.criado_por = p_quem) and (p_cidade is null or p.cidade = p_cidade) and p.criado_em >= p_de and (p_ate is null or p.criado_em <= p_ate))
    else 0 end
$$;

create or replace function public.progresso_tarefa(a public.atividades)
returns int language sql stable security definer set search_path = public as $$
  select case
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.modo = 'registro' then coalesce(a.meta, a.progresso)
    -- automática: toda a equipe, desde que a tarefa nasceu (mesmo sem ninguém ter pegado)
    when a.automatica and a.tipo in ('ativar_entregadores', 'ativar_parceiro') then
      public.aprovacoes_de(a.tipo, null, a.cidade, a.criada_em, a.concluida_em)
    when a.tipo in ('ativar_entregadores', 'ativar_parceiro') and a.aceita_por is not null then
      (select coalesce(sum(public.aprovacoes_de(a.tipo, (p->>'id')::uuid, a.cidade, (p->>'desde')::timestamptz, a.concluida_em)), 0)::int
         from jsonb_array_elements(public.participantes_de(a)) p)
    else a.progresso end
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
  insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, tipo, campos, cidade, modo, meta, automatica)
  values (public.titulo_tarefa('ativar_entregadores', c, null), format('Criada sozinha ao ativar o parceiro %s.', p.estabelecimento),
          auth.uid(), quem, '{}', case when tt.prazo_horas is not null then now() + tt.prazo_horas * interval '1 hour' end,
          'ativar_entregadores', c, p.cidade, 'solicitacao', 5, true)
  returning * into a;
  return jsonb_build_object('titulo', a.titulo, 'meta', a.meta, 'nova', true);
end $$;

-- "Contou para": as automáticas da cidade contam para qualquer pessoa
create or replace function public.tarefas_que_contam(p_tipo text, p_cidade text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'titulo', a.titulo, 'meta', a.meta, 'progresso', public.progresso_tarefa(a)) order by a.automatica, a.aceita_em)
    from public.atividades a
   where a.tipo = p_tipo and a.modo = 'solicitacao' and a.cidade = upper(btrim(p_cidade))
     and ((a.status = 'aceita' and public.participa(a)) or (a.automatica and a.status in ('aberta', 'aceita')))), '[]');
end $$;

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

revoke all on function public.aprovacoes_de(text, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.progresso_tarefa(public.atividades) from public, anon, authenticated;
revoke all on function public.tarefa_entregadores_do_parceiro(public.parceiros) from public, anon, authenticated;
revoke all on function public.json_atividade(public.atividades) from public, anon, authenticated;
revoke all on function public.tarefas_que_contam(text, text) from public, anon;
grant execute on function public.tarefas_que_contam(text, text) to authenticated;

notify pgrst, 'reload schema';
