-- =====================================================================
-- Verificação dos dados (SÓ LEITURA: não altera nada).
-- Supabase → SQL Editor → New query → cole tudo → Run.
-- O resultado é uma tabela: cada linha é um tipo de problema, com a quantidade
-- e alguns exemplos. Quantidade 0 = tudo certo naquele ponto.
-- =====================================================================
with
ids_varios_nomes as (       -- mesmo ID de entregador registrado com nomes diferentes
  select lower(id_app) id, count(distinct lower(btrim(nome_entregador))) nomes
    from bloqueios where not dados_pendentes group by 1 having count(distinct lower(btrim(nome_entregador))) > 1),
nomes_varios_ids as (       -- mesmo nome com IDs diferentes (pode ser homônimo ou ID digitado errado)
  select lower(btrim(nome_entregador)) nome, count(distinct lower(id_app)) ids
    from bloqueios where not dados_pendentes group by 1 having count(distinct lower(id_app)) > 1),
cad_cidade_fora as (        -- cadastros da ativação com cidade que não existe na lista de cidades
  select distinct cidade from cadastros c where not exists (select 1 from cidades x where x.nome = c.cidade)),
cad_e_bloq_cidade as (      -- entregador com cidade diferente na ativação e no último bloqueio
  select c.id_app, c.cidade cad, (select b.cidade from bloqueios b where lower(b.id_app) = lower(c.id_app) and b.cidade is not null order by b.inicio desc limit 1) bloq
    from cadastros c where c.id_app is not null),
tarefas_sem_dono as (       -- tarefas pendentes com responsável que não é mais monitorador/moderador nos bloqueios
  select t.id from tarefas t left join membros m on m.email = t.responsavel_email
   where t.status = 'pendente' and t.responsavel_email is not null
     and coalesce(m.papel_bloqueios::text, '') not in ('moderador', 'monitorador')),
cidades_sem_resp as (       -- cidades ativas sem responsável válido (tratativas vão para os moderadores)
  select nome from cidades c where ativa and responsavel_da_cidade(nome) is null),
bloq_duplicados as (        -- mesmo ID + mesma infração no mesmo minuto (provável registro em dobro, ex.: planilha)
  select lower(id_app) id, infracao_id, date_trunc('minute', inicio) m, count(*) n
    from bloqueios group by 1, 2, 3 having count(*) > 1),
membros_nunca_entraram as (
  select email from membros where user_id is null),
pedidos_antigos as (
  select email from pedidos_acesso where pedido_em < now() - interval '7 days'),
tarefas_antigas as (        -- tratativas pendentes há mais de 32 h
  select id from tarefas where status = 'pendente' and criada_em < now() - interval '32 hours'),
leves_sem_dados as (
  select distinct lower(id_app) id from bloqueios where dados_pendentes)
select 'IDs com mais de um nome nos bloqueios' as verificacao, (select count(*) from ids_varios_nomes) as qtd,
       (select string_agg(id, ', ') from (select id from ids_varios_nomes order by nomes desc limit 5) x) as exemplos
union all select 'Nomes com mais de um ID', (select count(*) from nomes_varios_ids),
       (select string_agg(nome, ', ') from (select nome from nomes_varios_ids order by ids desc limit 5) x)
union all select 'Marcados para revisão (importação)', (select count(*) from bloqueios where revisar is not null), null
union all select 'Cidades da ativação fora da lista de cidades', (select count(*) from cad_cidade_fora),
       (select string_agg(cidade, ', ') from (select cidade from cad_cidade_fora limit 5) x)
union all select 'Entregadores com cidade diferente na ativação e nos bloqueios', (select count(*) from cad_e_bloq_cidade where bloq is not null and bloq <> cad),
       (select string_agg(id_app || ': ' || cad || ' x ' || bloq, ', ') from (select * from cad_e_bloq_cidade where bloq is not null and bloq <> cad limit 3) x)
union all select 'Bloqueios repetidos no mesmo minuto (mesmo ID e infração)', (select count(*) from bloq_duplicados),
       (select string_agg(id, ', ') from (select id from bloq_duplicados limit 5) x)
union all select 'IDs registrados só com o ID (dados a completar)', (select count(*) from leves_sem_dados), null
union all select 'Cidades ativas sem responsável pela tratativa', (select count(*) from cidades_sem_resp),
       (select string_agg(nome, ', ') from (select nome from cidades_sem_resp limit 8) x)
union all select 'Tarefas pendentes com responsável que perdeu o acesso', (select count(*) from tarefas_sem_dono), null
union all select 'Tratativas pendentes há mais de 32 h', (select count(*) from tarefas_antigas), null
union all select 'Pessoas autorizadas que nunca entraram', (select count(*) from membros_nunca_entraram),
       (select string_agg(email, ', ') from (select email from membros_nunca_entraram limit 5) x)
union all select 'Pedidos de acesso parados há mais de 7 dias', (select count(*) from pedidos_antigos), null;
