-- Conta mensal de custos do Comunique (SÓ LEITURA). Supabase → SQL Editor → cole → Run.
-- Só totais: nenhum dado pessoal. Cole o resultado junto com os números da página Usage.
select 'Banco (pg_database_size), MB' medida, round(pg_database_size(current_database())/1048576.0,1)::text valor
union all select 'Tabelas do app, MB', round(sum(pg_total_relation_size(c.oid))/1048576.0,1)::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'Avisos no banco (linhas)', count(*)::text from public.notificacoes
union all select 'Avisos criados nos últimos 30 dias', count(*)::text from public.notificacoes where criada_em > now()-interval '30 days'
union all select 'Avisos lidos com mais de 120 dias (dá para limpar em Equipe)', count(*)::text from public.notificacoes where lida_em is not null and criada_em < now()-interval '120 days'
union all select 'Anexos, MB (teto 200)', round(coalesce(sum(tamanho),0)/1048576.0,1)::text from public.anexos
union all select 'Pessoas autorizadas', count(*)::text from public.membros
union all select 'Contas de login (auth.users)', count(*)::text from auth.users
union all select 'Maior tabela: '||relname, round(pg_total_relation_size(relid)/1048576.0,2)::text||' MB'
  from (select relid, relname from pg_stat_user_tables where schemaname='public' order by pg_total_relation_size(relid) desc limit 1) t;
