-- =====================================================================
-- Comunique · números de uso (varredura a10, 21/11/2026, versão 009z4) — SÓ LEITURA.
-- Supabase → SQL Editor → New query → cole TUDO → Run.
-- É UMA consulta só (um "select"): não grava nada (nenhum insert/update/delete).
-- Devolve só números agregados: nenhum nome, ID de entregador, telefone, e-mail ou texto
-- escrito pela equipe. Pode copiar o resultado ("Copy" / "Export CSV") e colar na conversa.
-- Colunas: grupo · medida · valor · detalhe · s0 (semana atual, terça a segunda,
-- horário de Brasília) · s1 (semana passada) … s7 (sete semanas atrás).
-- Precisa das migrações até a 009z4 (uso_dia, lembretes, renovações da ajuda).
-- =====================================================================
with
par as (
  select (date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date - 1)::date + 1) sa,  -- terça desta semana
         coalesce((select tratativa_prazo_horas from public.parametros_bloqueio limit 1), 32) prazo_h
),
-- ---------- 1. fluxos semanais: lista fixa (aparecem mesmo com zero) ----------
cat as (select * from (values
    (100, 'Ativação', 'Cadastros enviados'),
    (101, 'Ativação', 'Aprovações (eventos)'),
    (102, 'Ativação', 'Reprovações (eventos)'),
    (103, 'Ativação', 'Encerramentos (eventos)'),
    (104, 'Ativação', 'Decisões desfeitas'),
    (105, 'Ativação', 'Cadastros editados depois de enviados'),
    (106, 'Ativação', 'Cadastros marcados como revisados'),
    (110, 'Restrições', 'Restrições registradas pelo app'),
    (111, 'Restrições', 'Infrações leves registradas'),
    (112, 'Restrições', 'Restrições geradas por leves acumuladas'),
    (113, 'Restrições', 'Restrições com agravante'),
    (114, 'Restrições', 'Liberadas antes do prazo'),
    (115, 'Restrições', 'Registros corrigidos ou revisados'),
    (116, 'Restrições', 'Pendências de retenção resolvidas'),
    (117, 'Restrições', 'Anexos enviados'),
    (120, 'Tratativas', 'Tratativas criadas'),
    (121, 'Tratativas', 'Concluídas no prazo'),
    (122, 'Tratativas', 'Concluídas fora do prazo'),
    (123, 'Tratativas', 'Realocadas'),
    (130, 'Tarefas', 'Tarefas pedidas (solicitação, à mão)'),
    (131, 'Tarefas', 'Tarefas registradas como já feitas'),
    (132, 'Tarefas', 'Tarefas geradas por recorrência'),
    (133, 'Tarefas', 'Atividades da equipe (automáticas) criadas'),
    (134, 'Tarefas', 'Tarefas concluídas (todas)'),
    (135, 'Tarefas', 'Automáticas fechadas pela meta da equipe'),
    (136, 'Tarefas', 'Automáticas concluídas à mão (com motivo)'),
    (137, 'Tarefas', 'Comentários em tarefas'),
    (138, 'Tarefas', 'Agradecimentos'),
    (139, 'Tarefas', 'Revisões de qualidade'),
    (140, 'Financeiro', 'Adicionais registrados'),
    (141, 'Financeiro', 'Adicionais: valor total (R$)'),
    (142, 'Financeiro', 'Adicionais marcados como mercado'),
    (143, 'Financeiro', 'Adicionais de pedido de fora (origem outros)'),
    (144, 'Financeiro', 'Ajustes de bairro registrados'),
    (145, 'Financeiro', 'Ajustes de bairro: valor total (R$)'),
    (146, 'Financeiro', 'Lançamentos marcados como lançados'),
    (147, 'Financeiro', 'Acordos com parceiros registrados'),
    (148, 'Financeiro', 'Acordos ajustados'),
    (150, 'Parceiros', 'Parceiros ativados'),
    (160, 'Agora', 'Pedidos de ajuda'),
    (161, 'Agora', 'Pedidos de ajuda aceitos'),
    (162, 'Agora', 'Pedidos de ajuda renovados (vezes)'),
    (163, 'Agora', 'Avisos gerais'),
    (164, 'Agora', 'Pendências rápidas (retenção) abertas'),
    (165, 'Agora', 'Passagens de turno'),
    (166, 'Agora', 'Passagens de turno lidas'),
    (180, 'Entregadores', 'Fichas criadas'),
    (181, 'Entregadores', 'Fichas criadas pela janela Cadastrar entregador'),
    (182, 'Entregadores', 'Comentários sobre entregadores'),
    (183, 'Entregadores', 'Alterações de dados da ficha'),
    (184, 'Entregadores', 'Lembretes de retorno criados (009z4)'),
    (185, 'Entregadores', 'Lembretes marcados como feitos'),
    (186, 'Entregadores', 'Lembretes que chegaram na hora (aviso)')
  ) v(o, g, m)),
ev as (
  select 100 o, enviado_em em, 1::numeric p from public.cadastros
  union all select 101, em, 1 from public.eventos where tipo = 'aprovado'
  union all select 102, em, 1 from public.eventos where tipo = 'reprovado'
  union all select 103, em, 1 from public.eventos where tipo = 'encerrado'
  union all select 104, em, 1 from public.eventos where tipo = 'desfeito'
  union all select 105, em, 1 from public.eventos where tipo = 'editado'
  union all select 106, em, 1 from public.eventos where tipo = 'revisado'
  union all select 110, inicio, 1 from public.bloqueios where not importado and not leve
  union all select 111, inicio, 1 from public.bloqueios where not importado and leve
  union all select 112, criada_em, 1 from public.tarefas where tipo = 'leves_acumuladas'
  union all select 113, inicio, 1 from public.bloqueios where not importado and agravante is not null
  union all select 114, em, 1 from public.eventos_bloqueio where tipo = 'liberado_antes'
  union all select 115, em, 1 from public.eventos_bloqueio where tipo in ('corrigido', 'revisado')
  union all select 116, em, 1 from public.eventos_bloqueio where tipo = 'pendencia_resolvida'
  union all select 117, em, 1 from public.anexos
  union all select 120, criada_em, 1 from public.tarefas where not importada and tipo <> 'completar_dados'
  union all select 121, t.concluida_em, 1 from public.tarefas t, par
     where not importada and tipo <> 'completar_dados' and status = 'concluida' and t.concluida_em - t.criada_em <= make_interval(hours => par.prazo_h)
  union all select 122, t.concluida_em, 1 from public.tarefas t, par
     where not importada and tipo <> 'completar_dados' and status = 'concluida' and t.concluida_em - t.criada_em > make_interval(hours => par.prazo_h)
  union all select 123, realocada_em, 1 from public.tarefas where realocada_em is not null
  union all select 130, criada_em, 1 from public.atividades where modo = 'solicitacao' and recorrente_id is null and not automatica
  union all select 131, criada_em, 1 from public.atividades where modo = 'registro'
  union all select 132, criada_em, 1 from public.atividades where recorrente_id is not null
  union all select 133, criada_em, 1 from public.atividades where automatica
  union all select 134, concluida_em, 1 from public.atividades where status = 'concluida'
  union all select 135, concluida_em, 1 from public.atividades where automatica and status = 'concluida' and concluida_por is null
  union all select 136, concluida_em, 1 from public.atividades where automatica and status = 'concluida' and concluida_por is not null
  union all select 137, em, 1 from public.comentarios_tarefa
  union all select 138, em, 1 from public.agradecimentos
  union all select 139, em, 1 from public.revisoes_qualidade
  union all select 140, criado_em, 1 from public.lancamentos_financeiros where tipo = 'adicional'
  union all select 141, criado_em, valor from public.lancamentos_financeiros where tipo = 'adicional'
  union all select 142, criado_em, 1 from public.lancamentos_financeiros where tipo = 'adicional' and mercado
  union all select 143, criado_em, 1 from public.lancamentos_financeiros where tipo = 'adicional' and origem = 'outros'
  union all select 144, criado_em, 1 from public.lancamentos_financeiros where tipo = 'ajuste_bairro'
  union all select 145, criado_em, valor from public.lancamentos_financeiros where tipo = 'ajuste_bairro'
  union all select 146, lancado_em, 1 from public.lancamentos_financeiros where lancado
  union all select 147, criado_em, 1 from public.acordos
  union all select 148, ajustado_em, 1 from public.acordos where ajustado_em is not null
  union all select 150, criado_em, 1 from public.parceiros
  union all select 160, criado_em, 1 from public.avisos_rapidos where tipo = 'ajuda'
  union all select 161, aceito_em, 1 from public.avisos_rapidos where tipo = 'ajuda' and aceito_em is not null
  union all select 162, criado_em, renovacoes from public.avisos_rapidos where tipo = 'ajuda' and renovacoes > 0
  union all select 163, criado_em, 1 from public.avisos_rapidos where tipo = 'aviso'
  union all select 164, criado_em, 1 from public.avisos_rapidos where tipo = 'pendencia'
  union all select 165, criada_em, 1 from public.passagens_turno
  union all select 166, lida_em, 1 from public.passagens_lidas
  union all select 180, criado_em, 1 from public.entregadores
  union all select 181, criado_em, 1 from public.entregadores where criado_por is not null
  union all select 182, em, 1 from public.comentarios_entregador where tipo = 'comentario'
  union all select 183, em, 1 from public.comentarios_entregador where tipo = 'alteracao'
  union all select 184, em, 1 from public.comentarios_entregador where lembrar_em is not null
  union all select 185, lembrete_feito_em, 1 from public.comentarios_entregador where lembrete_feito_em is not null
  union all select 186, lembrete_avisado_em, 1 from public.comentarios_entregador where lembrete_avisado_em is not null
),
evs as (
  select ev.o, ev.p, ev.em,
         ((select sa from par) - (date_trunc('week', (ev.em at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 w
    from ev where ev.em is not null
),
semanal as (
  select cat.o, cat.g, cat.m, coalesce(sum(p) filter (where w between 0 and 7), 0) valor, 'total nas 8 semanas' d,
         coalesce(sum(p) filter (where w = 0), 0) s0, coalesce(sum(p) filter (where w = 1), 0) s1,
         coalesce(sum(p) filter (where w = 2), 0) s2, coalesce(sum(p) filter (where w = 3), 0) s3,
         coalesce(sum(p) filter (where w = 4), 0) s4, coalesce(sum(p) filter (where w = 5), 0) s5,
         coalesce(sum(p) filter (where w = 6), 0) s6, coalesce(sum(p) filter (where w = 7), 0) s7
    from cat left join evs using (o) group by cat.o, cat.g, cat.m
),
-- desde sempre e há quantos dias foi a última vez (acha o que nunca é usado: A16-10)
sempre as (
  select cat.o + 8000 o, 'Uso desde sempre' g, cat.m, count(evs.o)::numeric valor,
         coalesce('última vez há ' || ((now() at time zone 'America/Sao_Paulo')::date - (max(evs.em) at time zone 'America/Sao_Paulo')::date) || ' dias', 'nunca') d
    from cat left join evs using (o) where cat.m not like '%(R$)%' group by cat.o, cat.m
),
-- ---------- 2. tarefas por tipo e modo, semana a semana ----------
tipos as (
  select coalesce(tt.ordem, 99) ord, tt.tipo, tt.nome from public.tipos_tarefa tt
  union all select 98, null, 'Sem tipo (antigas)'
),
tar as (
  select a.tipo, 'criadas: pedido' k, 1 kk, a.criada_em em from public.atividades a where a.modo = 'solicitacao' and not a.automatica
  union all select a.tipo, 'criadas: registro (já feito)', 2, a.criada_em from public.atividades a where a.modo = 'registro'
  union all select a.tipo, 'criadas: automáticas', 3, a.criada_em from public.atividades a where a.automatica
  union all select a.tipo, 'concluídas', 4, a.concluida_em from public.atividades a where a.status = 'concluida'
),
tar_k as (select * from (values ('criadas: pedido', 1), ('criadas: registro (já feito)', 2), ('criadas: automáticas', 3), ('concluídas', 4)) v(k, kk)),
tar_w as (
  select tar.tipo, tar.k, ((select sa from par) - (date_trunc('week', (tar.em at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 w
    from tar where tar.em is not null
),
por_tipo as (
  select 2000 + tipos.ord * 10 + tar_k.kk o, 'Tarefas por tipo' g, tipos.nome || ' · ' || tar_k.k m,
         count(tar_w.w) filter (where tar_w.w between 0 and 7)::numeric valor, 'total nas 8 semanas' d,
         count(*) filter (where tar_w.w = 0) s0, count(*) filter (where tar_w.w = 1) s1,
         count(*) filter (where tar_w.w = 2) s2, count(*) filter (where tar_w.w = 3) s3,
         count(*) filter (where tar_w.w = 4) s4, count(*) filter (where tar_w.w = 5) s5,
         count(*) filter (where tar_w.w = 6) s6, count(*) filter (where tar_w.w = 7) s7
    from tipos cross join tar_k
    left join tar_w on tar_w.tipo is not distinct from tipos.tipo and tar_w.k = tar_k.k
   group by tipos.ord, tipos.tipo, tipos.nome, tar_k.kk, tar_k.k
  having tipos.tipo is not null or count(tar_w.w) > 0   -- "sem tipo" só aparece se existir
),
-- ---------- 3. avisos do sino: gerados × lidos por categoria e por motivo ----------
-- "lido pela pessoa" = lido em menos de 7 dias (desde a 009x5 o banco marca sozinho como lido o que passa de 7 dias)
av as (
  select coalesce(n.categoria, 'pessoal') cat, coalesce(n.motivo, case when n.categoria is null then 'pessoal' else 'sem motivo' end) mot,
         n.criada_em, n.lida_em,
         (n.lida_em is not null and n.lida_em - n.criada_em < interval '7 days') lido,
         (n.lida_em is not null and n.lida_em - n.criada_em <= interval '1 hour') lido_1h,
         ((select sa from par) - (date_trunc('week', (n.criada_em at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 w
    from public.notificacoes n
),
av_cat as (
  select 4000 + dense_rank() over (order by cat) * 3 o, 'Avisos por categoria' g, cat || ' · gerados' m,
         count(*) filter (where w between 0 and 7)::numeric valor,
         round(100.0 * count(*) filter (where w between 0 and 7 and lido) / nullif(count(*) filter (where w between 0 and 7), 0), 1) || '% lidos pela pessoa; '
           || coalesce(round(100.0 * count(*) filter (where w between 0 and 7 and lido_1h) / nullif(count(*) filter (where w between 0 and 7), 0), 1), 0) || '% em até 1 h (8 semanas)' d,
         count(*) filter (where w = 0) s0, count(*) filter (where w = 1) s1, count(*) filter (where w = 2) s2, count(*) filter (where w = 3) s3,
         count(*) filter (where w = 4) s4, count(*) filter (where w = 5) s5, count(*) filter (where w = 6) s6, count(*) filter (where w = 7) s7
    from av group by cat
  union all
  select 4001 + dense_rank() over (order by cat) * 3, 'Avisos por categoria', cat || ' · lidos pela pessoa (pela semana em que nasceram)',
         count(*) filter (where w between 0 and 7 and lido), null,
         count(*) filter (where w = 0 and lido), count(*) filter (where w = 1 and lido), count(*) filter (where w = 2 and lido), count(*) filter (where w = 3 and lido),
         count(*) filter (where w = 4 and lido), count(*) filter (where w = 5 and lido), count(*) filter (where w = 6 and lido), count(*) filter (where w = 7 and lido)
    from av group by cat
),
av_mot as (
  select 4500 + dense_rank() over (order by mot) o, 'Avisos por motivo (por que a pessoa recebeu)' g, mot m,
         count(*) filter (where w between 0 and 7)::numeric valor,
         coalesce(round(100.0 * count(*) filter (where w between 0 and 7 and lido) / nullif(count(*) filter (where w between 0 and 7), 0), 1), 0) || '% lidos pela pessoa (8 semanas)' d,
         count(*) filter (where w = 0) s0, count(*) filter (where w = 1) s1, count(*) filter (where w = 2) s2, count(*) filter (where w = 3) s3,
         count(*) filter (where w = 4) s4, count(*) filter (where w = 5) s5, count(*) filter (where w = 6) s6, count(*) filter (where w = 7) s7
    from av group by mot
),
-- ---------- 4. quem fez alguma coisa: (módulo, pessoa, quando) ----------
acoes as (
  select 'Ativação' mod, enviado_por quem, enviado_em em from public.cadastros
  union all select 'Ativação', por, em from public.eventos
  union all select 'Restrições', registrado_por, inicio from public.bloqueios where not importado
  union all select 'Restrições', por, em from public.eventos_bloqueio
  union all select 'Restrições', concluida_por, concluida_em from public.tarefas
  union all select 'Entregadores', por, em from public.comentarios_entregador
  union all select 'Entregadores', criado_por, criado_em from public.entregadores
  union all select 'Tarefas', criada_por, criada_em from public.atividades where not automatica
  union all select 'Tarefas', aceita_por, aceita_em from public.atividades
  union all select 'Tarefas', concluida_por, concluida_em from public.atividades
  union all select 'Tarefas', por, em from public.comentarios_tarefa
  union all select 'Financeiro', registrado_por, criado_em from public.lancamentos_financeiros
  union all select 'Financeiro', lancado_por, lancado_em from public.lancamentos_financeiros
  union all select 'Financeiro', criado_por, criado_em from public.acordos
  union all select 'Financeiro', ajustado_por, ajustado_em from public.acordos
  union all select 'Parceiros', criado_por, criado_em from public.parceiros
  union all select 'Agora (ajuda, aviso, turno)', criado_por, criado_em from public.avisos_rapidos where tipo in ('ajuda', 'aviso')
  union all select 'Agora (ajuda, aviso, turno)', aceito_por, aceito_em from public.avisos_rapidos
  union all select 'Agora (ajuda, aviso, turno)', de, criada_em from public.passagens_turno
  union all select 'Avisos (leu algum)', para, lida_em from public.notificacoes where lida_em - criada_em < interval '7 days'
),
acoes_ok as (
  select a.mod, a.quem, a.em,
         ((select sa from par) - (date_trunc('week', (a.em at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 w
    from acoes a where a.quem is not null and a.em is not null
),
pessoas as (
  select 3000 + row_number() over (order by mod) o, 'Pessoas que usaram (por módulo)' g, mod m,
         count(distinct quem) filter (where em > now() - interval '30 days')::numeric valor, 'nos últimos 30 dias; semanas ao lado' d,
         count(distinct quem) filter (where w = 0) s0, count(distinct quem) filter (where w = 1) s1,
         count(distinct quem) filter (where w = 2) s2, count(distinct quem) filter (where w = 3) s3,
         count(distinct quem) filter (where w = 4) s4, count(distinct quem) filter (where w = 5) s5,
         count(distinct quem) filter (where w = 6) s6, count(distinct quem) filter (where w = 7) s7
    from (values ('Ativação'), ('Restrições'), ('Entregadores'), ('Tarefas'), ('Financeiro'), ('Parceiros'), ('Agora (ajuda, aviso, turno)'), ('Avisos (leu algum)')) mods(mod)
    left join acoes_ok using (mod) group by mod
  union all
  select 3000, 'Pessoas que usaram (por módulo)', 'Qualquer módulo', count(distinct quem) filter (where em > now() - interval '30 days'), 'nos últimos 30 dias; semanas ao lado',
         count(distinct quem) filter (where w = 0), count(distinct quem) filter (where w = 1),
         count(distinct quem) filter (where w = 2), count(distinct quem) filter (where w = 3),
         count(distinct quem) filter (where w = 4), count(distinct quem) filter (where w = 5),
         count(distinct quem) filter (where w = 6), count(distinct quem) filter (where w = 7)
    from acoes_ok
),
-- ativos por papel (o papel de HOJE de cada pessoa; quem saiu da equipe entra como "fora da equipe")
papeis as (
  select 'Ativação · ' || coalesce(m.papel::text, 'fora da equipe') pp, a.quem, a.em, a.w
    from acoes_ok a left join public.membros m on m.user_id = a.quem
  union all
  select 'Restrições · ' || coalesce(m.papel_bloqueios::text, case when m.user_id is null then 'fora da equipe' else 'sem acesso' end), a.quem, a.em, a.w
    from acoes_ok a left join public.membros m on m.user_id = a.quem
),
pessoas_papel as (
  select 3300 + dense_rank() over (order by pp) o, 'Pessoas ativas por papel' g, pp m,
         count(distinct quem) filter (where em > now() - interval '30 days')::numeric valor, 'nos últimos 30 dias; semanas ao lado' d,
         count(distinct quem) filter (where w = 0) s0, count(distinct quem) filter (where w = 1) s1,
         count(distinct quem) filter (where w = 2) s2, count(distinct quem) filter (where w = 3) s3,
         count(distinct quem) filter (where w = 4) s4, count(distinct quem) filter (where w = 5) s5,
         count(distinct quem) filter (where w = 6) s6, count(distinct quem) filter (where w = 7) s7
    from papeis group by pp
),
-- ---------- 5. uso de telas e botões sem saber quem (uso_dia, 009z4, A16-07) ----------
uso_w as (
  select u.recurso, u.qtd, u.dia,
         ((select sa from par) - (date_trunc('week', u.dia - 1)::date + 1)) / 7 w
    from public.uso_dia u
),
uso as (
  select 6000 + row_number() over (order by split_part(recurso, ':', 1), sum(qtd) desc, recurso) o,
         'Uso de telas e botões (uso_dia)' g, recurso m,
         sum(qtd) filter (where w between 0 and 7)::numeric valor, count(distinct dia) || ' dias com uso; desde ' || to_char(min(dia), 'DD/MM') d,
         coalesce(sum(qtd) filter (where w = 0), 0) s0, coalesce(sum(qtd) filter (where w = 1), 0) s1,
         coalesce(sum(qtd) filter (where w = 2), 0) s2, coalesce(sum(qtd) filter (where w = 3), 0) s3,
         coalesce(sum(qtd) filter (where w = 4), 0) s4, coalesce(sum(qtd) filter (where w = 5), 0) s5,
         coalesce(sum(qtd) filter (where w = 6), 0) s6, coalesce(sum(qtd) filter (where w = 7), 0) s7
    from uso_w group by recurso
  union all
  select 5999, 'Uso de telas e botões (uso_dia)', 'Total (todas as chaves)', coalesce(sum(qtd), 0),
         count(distinct recurso) || ' chaves diferentes; ' || count(distinct dia) || ' dias com dados',
         coalesce(sum(qtd) filter (where w = 0), 0), coalesce(sum(qtd) filter (where w = 1), 0),
         coalesce(sum(qtd) filter (where w = 2), 0), coalesce(sum(qtd) filter (where w = 3), 0),
         coalesce(sum(qtd) filter (where w = 4), 0), coalesce(sum(qtd) filter (where w = 5), 0),
         coalesce(sum(qtd) filter (where w = 6), 0), coalesce(sum(qtd) filter (where w = 7), 0)
    from uso_w
),
naolidos as (select para, count(*) n from public.notificacoes where lida_em is null group by para),
-- ---------- 6. fotografia de agora: (ordem, grupo, medida, valor, detalhe) ----------
agora as (
  select 1 o, 'Banco' g, 'Tamanho do banco (MB)' m, round(pg_database_size(current_database()) / 1048576.0, 1) valor, 'plano grátis: 500 MB' d
  union all select 2, 'Banco', 'Tabelas do app (public): tamanho somado (MB)', round(sum(pg_total_relation_size(relid)) / 1048576.0, 1), null from pg_stat_user_tables where schemaname = 'public'
  union all select 3, 'Banco', 'Avisos (notificacoes): parte do banco (%)',
     round(100.0 * pg_total_relation_size('public.notificacoes') / nullif(pg_database_size(current_database()), 0), 1), null
  union all select 10, 'Equipe', 'Pessoas autorizadas', count(*), null from public.membros
  union all select 11, 'Equipe', 'Já entraram ao menos uma vez', count(*), null from public.membros where user_id is not null
  union all select 12, 'Equipe', 'Ativação: moderadores', count(*), null from public.membros where papel = 'moderador'
  union all select 13, 'Equipe', 'Ativação: monitoradores', count(*), null from public.membros where papel = 'monitorador'
  union all select 14, 'Equipe', 'Ativação: suporte', count(*), null from public.membros where papel = 'suporte'
  union all select 15, 'Equipe', 'Restrições: moderadores', count(*), null from public.membros where papel_bloqueios = 'moderador'
  union all select 16, 'Equipe', 'Restrições: monitoradores', count(*), null from public.membros where papel_bloqueios = 'monitorador'
  union all select 17, 'Equipe', 'Restrições: suporte', count(*), null from public.membros where papel_bloqueios = 'suporte'
  union all select 18, 'Equipe', 'Sem acesso às restrições', count(*), null from public.membros where papel_bloqueios is null
  union all select 19, 'Equipe', 'Moderadores com "receber tudo" ligado', count(*), null from public.preferencias_aviso p
     where p.receber_tudo and exists (select 1 from public.membros m where m.user_id = p.para and (m.papel = 'moderador' or m.papel_bloqueios = 'moderador'))
  union all select 20, 'Para revisar', 'Restrições com "revisar" em aberto', count(*), null from public.bloqueios where revisar is not null
  union all select 21, 'Para revisar', 'Restrições com "revisar" vindas da planilha', count(*), null from public.bloqueios where revisar is not null and importado
  union all select 22, 'Para revisar', 'Restrições com dados pendentes (sem nome)', count(*), null from public.bloqueios where dados_pendentes
  union all select 23, 'Para revisar', 'Cadastros com "revisar" (não encerrados)', count(*), null from public.cadastros c where c.status <> 'encerrado' and public.motivo_revisar_cadastro(c) is not null
  union all select 24, 'Para revisar', 'Cadastros sem ID (antigos, só tinham CPF)', count(*), null from public.cadastros where id_app is null
  union all select 25, 'Para revisar', 'Tarefas "completar dados" pendentes', count(*), null from public.tarefas where tipo = 'completar_dados' and status = 'pendente'
  union all select 30, 'Fichas', 'Fichas de entregador', count(*), null from public.entregadores
  union all select 31, 'Fichas', 'Fichas sem cidade', count(*), null from public.entregadores where cidade is null or btrim(cidade) = ''
  union all select 32, 'Fichas', 'Fichas com cidade fora da lista de cidades', count(*), null from public.entregadores e where nullif(btrim(e.cidade), '') is not null and not exists (select 1 from public.cidades c where c.nome = e.cidade)
  union all select 33, 'Fichas', 'Cidades ativas', count(*), null from public.cidades where ativa
  union all select 34, 'Fichas', 'Cidades ativas sem responsável', count(*), null from public.cidades where ativa and responsavel_email is null
  union all select 40, 'Fila agora', 'Cadastros aguardando análise', count(*), null from public.cadastros where status = 'aguardando_analise'
  union all select 41, 'Fila agora', 'Cadastros aguardando contato', count(*), null from public.cadastros where status = 'aguardando_contato'
  union all select 42, 'Fila agora', 'Cadastros aguardando contato há mais de 7 dias', count(*), null from public.cadastros c
     where c.status = 'aguardando_contato' and coalesce((select max(e.em) from public.eventos e where e.cadastro_id = c.id), c.enviado_em) < now() - interval '7 days'
  union all select 43, 'Fila agora', 'Tratativas pendentes', count(*), null from public.tarefas where status = 'pendente' and tipo <> 'completar_dados'
  union all select 44, 'Fila agora', 'Tratativas pendentes além do prazo', count(*), null from public.tarefas t, par where t.status = 'pendente' and t.tipo <> 'completar_dados' and t.criada_em < now() - make_interval(hours => par.prazo_h)
  union all select 45, 'Fila agora', 'Com restrição agora', count(*), null from public.bloqueios b where public.situacao_bloqueio(b) = 'bloqueado'
  union all select 46, 'Fila agora', 'Tarefas abertas sem dono (sem as da equipe)', count(*), null from public.atividades where status = 'aberta' and not automatica
  union all select 47, 'Fila agora', 'Atividades da equipe (automáticas) abertas', count(*), null from public.atividades where status <> 'concluida' and automatica
  union all select 48, 'Fila agora', 'Tarefas em andamento', count(*), null from public.atividades where status = 'aceita'
  union all select 49, 'Fila agora', 'Tarefas aguardando terceiro', count(*), null from public.atividades where status = 'aceita' and aguardando_desde is not null
  union all select 50, 'Fila agora', 'Adicionais/ajustes ainda não lançados', count(*), 'R$ ' || coalesce(sum(valor), 0)::text from public.lancamentos_financeiros where not lancado
  union all select 51, 'Fila agora', 'Não lançados há mais de 48 h', count(*), 'R$ ' || coalesce(sum(valor), 0)::text from public.lancamentos_financeiros where not lancado and criado_em < now() - interval '48 hours'
  union all select 52, 'Fila agora', 'Acordos vencidos sem ajuste', count(*), null from public.acordos where ajustado_em is null and vence_em <= (now() at time zone 'America/Sao_Paulo')::date
  union all select 53, 'Fila agora', 'Pedidos de cidade esperando', count(*), null from public.pedidos_cidade where status = 'pendente'
  union all select 54, 'Fila agora', 'Lembretes de retorno abertos', count(*), count(*) filter (where lembrar_em <= now()) || ' já passaram da hora' from public.comentarios_entregador where lembrar_em is not null and lembrete_feito_em is null
  union all select 60, 'Avisos não lidos', 'Avisos não lidos (total)', coalesce(sum(n), 0), null from naolidos
  union all select 61, 'Avisos não lidos', 'Pessoas com aviso não lido', count(*), null from naolidos
  union all select 62, 'Avisos não lidos', 'Maior pilha de não lidos de uma pessoa', coalesce(max(n), 0), null from naolidos
  union all select 63, 'Avisos não lidos', 'Pessoas com mais de 50 não lidos', count(*) filter (where n > 50), null from naolidos
  union all select 64, 'Avisos não lidos', 'Avisos marcados como lidos pelo banco (passaram de 7 dias)', count(*), 'desde a 009x5' from public.notificacoes where lida_em - criada_em >= interval '7 days'
  union all select 65, 'Avisos não lidos', 'Avisos lidos em até 1 hora (% dos lidos pela pessoa, 30 dias)',
     round(100.0 * count(*) filter (where lida_em - criada_em <= interval '1 hour') / nullif(count(*), 0), 1), null
     from public.notificacoes where lida_em - criada_em < interval '7 days' and criada_em > now() - interval '30 days'
  union all select 66, 'Avisos não lidos', 'Avisos por pessoa por dia útil (média, últimos 7 dias)',
     round(count(*) / nullif((select count(*) from public.membros where user_id is not null), 0) / 5.0, 1), null
     from public.notificacoes where criada_em > now() - interval '7 days'
  -- recursos que talvez ninguém use (desde sempre): A16-10
  union all select 900, 'Recursos (desde sempre)', 'Metas pessoais criadas', count(*), null from public.metas
  union all select 901, 'Recursos (desde sempre)', 'Tarefas recorrentes (ativas)', count(*) filter (where ativa), 'de ' || count(*) || ' criadas' from public.tarefas_recorrentes
  union all select 902, 'Recursos (desde sempre)', 'Seguindo cidade', count(*), null from public.seguindo where tipo = 'cidade'
  union all select 903, 'Recursos (desde sempre)', 'De olho em entregador', count(*), null from public.seguindo where tipo = 'entregador'
  union all select 904, 'Recursos (desde sempre)', 'Pessoas com algum aviso silenciado', count(*), null from public.preferencias_aviso where cardinality(silenciados) > 0
  union all select 905, 'Recursos (desde sempre)', 'Tarefas com checklist', count(*), null from public.atividades where jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) > 0
  union all select 906, 'Recursos (desde sempre)', 'Tarefas que já ficaram aguardando terceiro', count(*), null from public.atividades where coalesce(pausa_seg, 0) > 0 or aguardando_desde is not null
  union all select 907, 'Recursos (desde sempre)', 'Tarefas com mais de um participante', count(*), null from public.atividades where jsonb_typeof(participantes) = 'array' and jsonb_array_length(participantes) > 1
  union all select 908, 'Recursos (desde sempre)', 'Comentários com @menção', count(*), null from public.comentarios_tarefa where cardinality(mencoes) > 0
  union all select 909, 'Recursos (desde sempre)', 'Previsões definidas (cadastros+tratativas+tarefas)',
     (select count(*) from public.cadastros where previsao is not null) + (select count(*) from public.tarefas where previsao is not null) + (select count(*) from public.atividades where previsao is not null), null
  union all select 910, 'Recursos (desde sempre)', 'Modelos de mensagem editados pela equipe', count(*), 'de ' || (select count(*) from public.modelos_mensagem) || ' modelos' from public.modelos_mensagem where atualizado_por is not null
  union all select 911, 'Recursos (desde sempre)', 'Bairros cadastrados (ativos)', count(*) filter (where ativo), (select count(distinct cidade) from public.bairros where ativo) || ' cidades' from public.bairros
  union all select 912, 'Recursos (desde sempre)', 'Bairros com apelido (juntados)', count(*), null from public.bairros where ativo and cardinality(apelidos) > 0
  union all select 913, 'Recursos (desde sempre)', 'Pares de bairros marcados como diferentes', count(*), null from public.bairros_diferentes
  union all select 914, 'Recursos (desde sempre)', 'Pedidos de cidade (todos)', count(*), count(*) filter (where status = 'aprovado') || ' aprovados' from public.pedidos_cidade
  union all select 915, 'Recursos (desde sempre)', 'Casos suspeitos no banco (guardados)', count(*), null from public.casos
  union all select 916, 'Recursos (desde sempre)', 'Anexos: espaço usado (MB)', round(coalesce(sum(tamanho), 0) / 1048576.0, 2), count(*) || ' anexos' from public.anexos
  union all select 917, 'Recursos (desde sempre)', 'Pedidos de ajuda que venceram sem ninguém', count(*), null from public.avisos_rapidos where tipo = 'ajuda' and aceito_por is null and expira_em <= now()
  union all select 918, 'Recursos (desde sempre)', 'Adicionais: % marcados como mercado', round(100.0 * count(*) filter (where mercado) / nullif(count(*), 0), 1), count(*) || ' adicionais' from public.lancamentos_financeiros where tipo = 'adicional'
),
-- ---------- 7. tamanho de cada tabela (só nomes de tabela e números) ----------
tabelas as (
  select 9000 + row_number() over (order by pg_total_relation_size(relid) desc) o, 'Tabelas' g, relname::text m,
         round(pg_total_relation_size(relid) / 1048576.0, 2) valor, n_live_tup || ' linhas (aprox.)' d
    from pg_stat_user_tables where schemaname = 'public'
)
select g grupo, m medida, valor, d detalhe, s0, s1, s2, s3, s4, s5, s6, s7 from (
  select o, g, m, valor, d, null::numeric s0, null::numeric s1, null::numeric s2, null::numeric s3, null::numeric s4, null::numeric s5, null::numeric s6, null::numeric s7 from agora
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from semanal
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from por_tipo
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from pessoas
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from pessoas_papel
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from av_cat
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from av_mot
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from uso
  union all select o, g, m, valor, d, null, null, null, null, null, null, null, null from sempre
  union all select o, g, m, valor, d, null, null, null, null, null, null, null, null from tabelas
) x
order by o, m;
