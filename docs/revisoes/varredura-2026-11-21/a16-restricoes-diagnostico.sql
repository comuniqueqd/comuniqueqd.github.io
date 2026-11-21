-- =====================================================================
-- Comunique · por que as restrições caíram (A10-20) — a16, 21/11/2026 — SÓ LEITURA.
-- Supabase → SQL Editor → cole tudo → Run. Um "select" só; não grava nada.
-- Só números da equipe: nenhum nome, ID, e-mail ou texto; nada por pessoa
-- (a linha "Pessoas que registraram" é só uma contagem, nunca quem).
-- s0 = semana atual (terça a segunda, Brasília), s1 = anterior ... s5.
-- =====================================================================
with par as (
  select (date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date - 1)::date + 1) sa
),
b as (  -- restrições e leves registradas pelo app (sem as importadas da planilha)
  select bl.*, ((select sa from par) - (date_trunc('week', (bl.inicio at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 sem
  from public.bloqueios bl where not bl.importado
),
c as (
  select ((select sa from par) - (date_trunc('week', (enviado_em at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 sem
  from public.cadastros
),
f as (  -- fichas criadas à mão (janela Cadastrar entregador)
  select ((select sa from par) - (date_trunc('week', (criado_em at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 sem
  from public.entregadores where criado_por is not null
),
u as (  -- visitas às telas, sem quem (009z4; começa em 21/11)
  select recurso, qtd, ((select sa from par) - (date_trunc('week', dia - 1)::date + 1)) / 7 sem from public.uso_dia
),
linhas as (
  select 1 o, 'Restrições (normais) registradas' medida, sem from b where not leve
  union all select 2, 'Infrações leves registradas', sem from b where leve
  union all select 3, 'Encerramentos de parceria', sem from b where not leve and horas is null
  union all select 4, 'Restrições com dados pendentes (sem nome/cidade)', sem from b where dados_pendentes
  union all select 10 + infracao_id, 'Por infração: ' || left(infracao, 40), sem from b
  union all select 40, 'Cadastros enviados (comparação)', sem from c
  union all select 41, 'Fichas criadas por alguém da equipe (comparação)', sem from f
  union all select 50, 'Visitas à tela Nova restrição (uso_dia)', sem from u, generate_series(1, least(u.qtd, 1000)) where recurso = 'aba:bloqueios/novo'
  union all select 51, 'Visitas a Com restrição agora / Tratativas (uso_dia)', sem from u, generate_series(1, least(u.qtd, 1000)) where recurso in ('aba:bloqueios/ativos', 'aba:bloqueios/tratativas')
),
pessoas as (
  select 60 o, 'Pessoas que registraram restrição (só a contagem)' medida, sem, count(distinct registrado_por) n
  from b group by sem
)
select o, medida,
  count(*) filter (where sem = 0) s0, count(*) filter (where sem = 1) s1, count(*) filter (where sem = 2) s2,
  count(*) filter (where sem = 3) s3, count(*) filter (where sem = 4) s4, count(*) filter (where sem = 5) s5
from linhas group by o, medida
union all
select o, medida, sum(n) filter (where sem = 0), sum(n) filter (where sem = 1), sum(n) filter (where sem = 2),
  sum(n) filter (where sem = 3), sum(n) filter (where sem = 4), sum(n) filter (where sem = 5)
from pessoas group by o, medida
order by 1;
