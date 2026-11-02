-- =====================================================================
-- Consultas de análise. Cole no Supabase → SQL Editor e rode uma por vez.
-- No SQL Editor você roda como dono do banco, então vê todos os dados.
-- Datas no fuso de São Paulo.
-- =====================================================================

-- 1. Tempo médio do envio até a aprovação, por cidade (em horas)
select c.cidade,
       count(*)                                                        as aprovados,
       round(avg(extract(epoch from e.em - c.enviado_em) / 3600)::numeric, 1) as horas_media,
       round((percentile_cont(0.5) within group (order by extract(epoch from e.em - c.enviado_em) / 3600))::numeric, 1) as horas_mediana
  from cadastros c
  join eventos e on e.cadastro_id = c.id and e.tipo = 'aprovado'
 group by c.cidade
 order by horas_media desc;

-- 2. Taxa de reprovação por motivo (cada reprovação conta, mesmo que o cadastro seja aprovado depois)
select motivo,
       count(*)                                            as reprovacoes,
       round(100.0 * count(*) / sum(count(*)) over (), 1)  as pct
  from eventos
 where tipo = 'reprovado'
 group by motivo
 order by reprovacoes desc;

-- 3. Cadastros enviados por pessoa por dia (últimos 30 dias)
select (c.enviado_em at time zone 'America/Sao_Paulo')::date as dia,
       m.nome,
       count(*) as enviados
  from cadastros c
  left join membros m on m.user_id = c.enviado_por
 where c.enviado_em > now() - interval '30 days'
 group by 1, 2
 order by 1 desc, 3 desc;

-- 4. Situação atual da operação
select situacao, count(*) from vw_cadastros group by situacao order by 2 desc;

-- 5. Quantas idas e vindas: cadastros por número de reprovações antes da decisão final
select reprovacoes, status, count(*)
  from vw_cadastros
 group by 1, 2
 order by 1, 2;

-- 6. Produtividade de quem analisa (decisões por pessoa por semana)
select date_trunc('week', e.em at time zone 'America/Sao_Paulo')::date as semana,
       m.nome,
       count(*) filter (where e.tipo = 'aprovado')  as aprovou,
       count(*) filter (where e.tipo = 'reprovado') as reprovou,
       count(*) filter (where e.tipo = 'encerrado') as encerrou
  from eventos e
  join membros m on m.user_id = e.por
 where e.tipo in ('aprovado', 'reprovado', 'encerrado')
 group by 1, 2
 order by 1 desc, 2;

-- 7. Cadastros esperando há mais de 24 h
select id_app, cpf, cidade, situacao, enviado_por, round(extract(epoch from now() - status_desde) / 3600) as horas_esperando
  from vw_cadastros
 where status in ('aguardando_analise', 'aguardando_contato')
   and status_desde < now() - interval '24 hours'
 order by status_desde;

-- ---------------------------------------------------------------------
-- Manutenção das listas de motivos (sem mexer no código do app)
-- ---------------------------------------------------------------------
-- Adicionar um motivo:
--   insert into motivos (tipo, texto, ordem) values ('reprovacao', 'Selfie sem documento', 7);
-- Esconder um motivo (continua nos dados antigos):
--   update motivos set ativo = false where tipo = 'reprovacao' and texto = 'Documento pendente';
