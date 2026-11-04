-- =====================================================================
-- Como anda o uso do Comunique (SÓ LEITURA: não altera nada).
-- Supabase → SQL Editor → New query → cole tudo → Run.
-- Devolve só totais (nenhum dado pessoal): pode compartilhar o resultado.
-- Funciona a partir da migração 005.
-- =====================================================================
with
app_bloq as (select * from public.bloqueios where not importado),
acoes as (   -- quem fez alguma coisa e quando (ativação, bloqueios, comentários, atividades)
  select por quem, em from public.eventos
  union all select por, em from public.eventos_bloqueio where por is not null
  union all select por, em from public.comentarios_entregador where por is not null
  union all select criada_por, criada_em from public.atividades
),
aprov as (
  select c.id, c.enviado_em, min(e.em) aprovado_em,
         bool_and(not exists (select 1 from public.eventos r where r.cadastro_id = c.id and r.tipo = 'reprovado')) direto
    from public.cadastros c join public.eventos e on e.cadastro_id = c.id and e.tipo = 'aprovado'
   group by c.id, c.enviado_em
),
trat as (select * from public.tarefas where not importada and tipo <> 'completar_dados')
select ordem, grupo, indicador, valor from (
  select 1 ordem, 'Equipe' grupo, 'Pessoas autorizadas' indicador, count(*)::text valor from public.membros
  union all select 2, 'Equipe', 'Já entraram pelo menos uma vez', count(*)::text from public.membros where user_id is not null
  union all select 3, 'Equipe', 'Fizeram algo nos últimos 7 dias', count(distinct quem)::text from acoes where em > now() - interval '7 days'
  union all select 4, 'Equipe', 'Ações registradas nos últimos 7 dias', count(*)::text from acoes where em > now() - interval '7 days'
  union all select 5, 'Equipe', 'Primeiro registro feito pelo app', coalesce(to_char(min(em) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), '—') from acoes

  union all select 10, 'Ativação', 'Cadastros enviados pelo app', count(*)::text from public.cadastros
  union all select 11, 'Ativação', 'Enviados nos últimos 7 dias', count(*)::text from public.cadastros where enviado_em > now() - interval '7 days'
  union all select 12, 'Ativação', 'Aprovados', count(*)::text from aprov
  union all select 13, 'Ativação', 'Aprovados de primeira (sem reprovação)', coalesce(round(100.0 * count(*) filter (where direto) / nullif(count(*), 0)) || '%', '—') from aprov
  union all select 14, 'Ativação', 'Tempo médio do envio à aprovação', coalesce(round((avg(extract(epoch from aprovado_em - enviado_em)) / 3600)::numeric, 1) || ' h', '—') from aprov
  union all select 15, 'Ativação', 'Aguardando análise agora', count(*)::text from public.cadastros where status = 'aguardando_analise'

  union all select 20, 'Bloqueios', 'Histórico importado da planilha', count(*)::text from public.bloqueios where importado
  union all select 21, 'Bloqueios', 'Bloqueios registrados pelo app', count(*)::text from app_bloq where not leve
  union all select 22, 'Bloqueios', 'Infrações leves registradas pelo app', count(*)::text from app_bloq where leve
  union all select 23, 'Bloqueios', 'Registros pelo app nos últimos 7 dias', count(*)::text from app_bloq where inicio > now() - interval '7 days'
  union all select 24, 'Bloqueios', 'Bloqueios gerados automaticamente por leves', count(*)::text from public.bloqueios l where l.gerou_bloqueio is not null or l.atingiu_limite
  union all select 25, 'Bloqueios', 'Bloqueados agora', count(*)::text from public.bloqueios b where public.situacao_bloqueio(b) = 'bloqueado'
  union all select 26, 'Bloqueios', 'Entregadores com cadastro (ficha)', count(*)::text from public.entregadores

  union all select 30, 'Tratativas', 'Criadas pelo app', count(*)::text from trat
  union all select 31, 'Tratativas', 'Concluídas', count(*)::text from trat where status = 'concluida'
  union all select 32, 'Tratativas', 'Concluídas em até 32 h', coalesce(round(100.0 * count(*) filter (where concluida_em - criada_em <= interval '32 hours') / nullif(count(*), 0)) || '%', '—') from trat where status = 'concluida'
  union all select 33, 'Tratativas', 'Tempo médio até concluir', coalesce(round((avg(extract(epoch from concluida_em - criada_em)) / 3600)::numeric, 1) || ' h', '—') from trat where status = 'concluida'
  union all select 34, 'Tratativas', 'Pendentes agora', count(*)::text from trat where status = 'pendente'
  union all select 35, 'Tratativas', 'Pendentes há mais de 32 h', count(*)::text from trat where status = 'pendente' and criada_em < now() - interval '32 hours'

  union all select 40, 'Qualidade dos dados', 'Alertas "revisar" ainda abertos', count(*)::text from public.bloqueios where revisar is not null
  union all select 41, 'Qualidade dos dados', 'Registros corrigidos ou revisados', count(distinct bloqueio_id)::text from public.eventos_bloqueio where tipo in ('corrigido', 'revisado')
  union all select 42, 'Qualidade dos dados', 'Comentários sobre entregadores', count(*)::text from public.comentarios_entregador where tipo = 'comentario'
  union all select 43, 'Qualidade dos dados', 'Anexos', count(*) || ' (' || pg_size_pretty(coalesce(sum(tamanho), 0)::bigint) || ')' from public.anexos

  union all select 50, 'Colaboração', 'Atividades sugeridas', count(*)::text from public.atividades
  union all select 51, 'Colaboração', 'Atividades concluídas', count(*)::text from public.atividades where status = 'concluida'
  union all select 52, 'Colaboração', 'Avisos enviados no sino', count(*)::text from public.notificacoes
) x
order by ordem;
