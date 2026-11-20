-- =====================================================================
-- Comunique · números de uso (varredura a10, nov/2026) — SÓ LEITURA.
-- Supabase → SQL Editor → New query → cole TUDO → Run.
-- Devolve só números agregados (nenhum nome, ID, telefone, e-mail ou texto):
-- pode copiar o resultado (botão "Copy" / "Export CSV") e colar na conversa.
-- Colunas: grupo · medida · valor · detalhe · s0 (semana atual, terça a segunda,
-- horário de Brasília) · s1 (semana passada) … s7 (sete semanas atrás).
-- Precisa das migrações até a 009x. Não grava nada (nenhum insert/update/delete).
-- =====================================================================
with
par as (
  select (date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date - 1)::date + 1) sa,  -- terça desta semana
         coalesce((select tratativa_prazo_horas from public.parametros_bloqueio limit 1), 32) prazo_h
),
-- ---------- fluxos semanais: (ordem, grupo, medida, quando, peso) ----------
-- lista de medidas semanais (aparecem mesmo com zero)
cat as (select * from (values
    (100, 'Ativação', 'Cadastros enviados'),
    (101, 'Ativação', 'Cadastros aprovados (eventos)'),
    (102, 'Ativação', 'Cadastros reprovados (eventos)'),
    (103, 'Ativação', 'Cadastros encerrados (eventos)'),
    (104, 'Ativação', 'Decisões desfeitas'),
    (105, 'Ativação', 'Cadastros editados depois de enviados'),
    (110, 'Bloqueios', 'Bloqueios registrados pelo app'),
    (111, 'Bloqueios', 'Infrações leves registradas'),
    (112, 'Bloqueios', 'Bloqueios com agravante'),
    (113, 'Bloqueios', 'Liberados antes do prazo'),
    (114, 'Bloqueios', 'Registros corrigidos ou revisados'),
    (115, 'Bloqueios', 'Anexos enviados'),
    (120, 'Tratativas', 'Tratativas criadas'),
    (121, 'Tratativas', 'Concluídas no prazo'),
    (122, 'Tratativas', 'Concluídas fora do prazo'),
    (123, 'Tratativas', 'Realocadas'),
    (130, 'Tarefas', 'Tarefas pedidas (solicitação)'),
    (131, 'Tarefas', 'Tarefas registradas como já feitas'),
    (132, 'Tarefas', 'Tarefas geradas por recorrência'),
    (133, 'Tarefas', 'Tarefas concluídas'),
    (134, 'Tarefas', 'Comentários em tarefas'),
    (135, 'Tarefas', 'Agradecimentos'),
    (136, 'Tarefas', 'Revisões de qualidade'),
    (140, 'Financeiro', 'Adicionais registrados'),
    (141, 'Financeiro', 'Adicionais: valor total (R$)'),
    (142, 'Financeiro', 'Adicionais de mercado'),
    (143, 'Financeiro', 'Adicionais de pedido de fora (origem outros)'),
    (144, 'Financeiro', 'Ajustes de bairro registrados'),
    (145, 'Financeiro', 'Ajustes de bairro: valor total (R$)'),
    (146, 'Financeiro', 'Lançamentos marcados como lançados'),
    (147, 'Financeiro', 'Acordos com parceiros registrados'),
    (148, 'Financeiro', 'Acordos ajustados'),
    (150, 'Parceiros', 'Parceiros ativados'),
    (160, 'Agora', 'Pedidos de ajuda'),
    (161, 'Agora', 'Pedidos de ajuda aceitos'),
    (162, 'Agora', 'Avisos gerais'),
    (163, 'Agora', 'Pendências rápidas (retenção) abertas'),
    (164, 'Agora', 'Passagens de turno'),
    (165, 'Agora', 'Passagens de turno lidas'),
    (170, 'Avisos', 'Avisos criados (sino)'),
    (171, 'Avisos', 'Avisos lidos'),
    (180, 'Entregadores', 'Fichas criadas'),
    (181, 'Entregadores', 'Fichas criadas pela tela Cadastrar entregador'),
    (182, 'Entregadores', 'Comentários sobre entregadores'),
    (183, 'Entregadores', 'Alterações de dados da ficha')
  ) v(o, g, m)),
ev as (
  select 100 o, enviado_em em, 1::numeric p from public.cadastros
  union all select 101, em, 1 from public.eventos where tipo = 'aprovado'
  union all select 102, em, 1 from public.eventos where tipo = 'reprovado'
  union all select 103, em, 1 from public.eventos where tipo = 'encerrado'
  union all select 104, em, 1 from public.eventos where tipo = 'desfeito'
  union all select 105, em, 1 from public.eventos where tipo = 'editado'
  union all select 110, inicio, 1 from public.bloqueios where not importado and not leve
  union all select 111, inicio, 1 from public.bloqueios where not importado and leve
  union all select 112, inicio, 1 from public.bloqueios where not importado and agravante is not null
  union all select 113, em, 1 from public.eventos_bloqueio where tipo = 'liberado_antes'
  union all select 114, em, 1 from public.eventos_bloqueio where tipo in ('corrigido', 'revisado')
  union all select 115, em, 1 from public.anexos
  union all select 120, criada_em, 1 from public.tarefas where not importada and tipo <> 'completar_dados'
  union all select 121, t.concluida_em, 1 from public.tarefas t, par
     where not importada and tipo <> 'completar_dados' and status = 'concluida' and t.concluida_em - t.criada_em <= make_interval(hours => par.prazo_h)
  union all select 122, t.concluida_em, 1 from public.tarefas t, par
     where not importada and tipo <> 'completar_dados' and status = 'concluida' and t.concluida_em - t.criada_em > make_interval(hours => par.prazo_h)
  union all select 123, realocada_em, 1 from public.tarefas where realocada_em is not null
  union all select 130, criada_em, 1 from public.atividades where coalesce(modo, 'solicitacao') = 'solicitacao' and recorrente_id is null
  union all select 131, criada_em, 1 from public.atividades where modo = 'registro'
  union all select 132, criada_em, 1 from public.atividades where recorrente_id is not null
  union all select 133, concluida_em, 1 from public.atividades where status = 'concluida'
  union all select 134, em, 1 from public.comentarios_tarefa
  union all select 135, em, 1 from public.agradecimentos
  union all select 136, em, 1 from public.revisoes_qualidade
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
  union all select 162, criado_em, 1 from public.avisos_rapidos where tipo = 'aviso'
  union all select 163, criado_em, 1 from public.avisos_rapidos where tipo = 'pendencia'
  union all select 164, criada_em, 1 from public.passagens_turno
  union all select 165, lida_em, 1 from public.passagens_lidas
  union all select 170, criada_em, 1 from public.notificacoes
  union all select 171, lida_em, 1 from public.notificacoes where lida_em is not null
  union all select 180, criado_em, 1 from public.entregadores
  union all select 181, criado_em, 1 from public.entregadores where criado_por is not null
  union all select 182, em, 1 from public.comentarios_entregador where tipo = 'comentario'
  union all select 183, em, 1 from public.comentarios_entregador where tipo = 'alteracao'
),
-- ---------- quem fez alguma coisa: (módulo, pessoa, quando) ----------
acoes as (
  select 'Ativação' mod, enviado_por quem, enviado_em em from public.cadastros
  union all select 'Ativação', por, em from public.eventos
  union all select 'Bloqueios', registrado_por, inicio from public.bloqueios where not importado
  union all select 'Bloqueios', por, em from public.eventos_bloqueio
  union all select 'Bloqueios', concluida_por, concluida_em from public.tarefas
  union all select 'Entregadores', por, em from public.comentarios_entregador
  union all select 'Entregadores', criado_por, criado_em from public.entregadores
  union all select 'Tarefas', criada_por, criada_em from public.atividades
  union all select 'Tarefas', aceita_por, aceita_em from public.atividades
  union all select 'Tarefas', concluida_por, concluida_em from public.atividades
  union all select 'Tarefas', por, em from public.comentarios_tarefa
  union all select 'Financeiro', registrado_por, criado_em from public.lancamentos_financeiros
  union all select 'Financeiro', lancado_por, lancado_em from public.lancamentos_financeiros
  union all select 'Financeiro', criado_por, criado_em from public.acordos
  union all select 'Financeiro', ajustado_por, ajustado_em from public.acordos
  union all select 'Parceiros', criado_por, criado_em from public.parceiros
  union all select 'Agora (ajuda, aviso, turno)', criado_por, criado_em from public.avisos_rapidos
  union all select 'Agora (ajuda, aviso, turno)', aceito_por, aceito_em from public.avisos_rapidos
  union all select 'Agora (ajuda, aviso, turno)', de, criada_em from public.passagens_turno
  union all select 'Avisos (leu algum)', para, lida_em from public.notificacoes
),
acoes_ok as (select * from acoes where quem is not null and em is not null),
-- ---------- semana de cada coisa (0 = atual … 7) ----------
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
-- desde sempre e há quantos dias foi a última vez (para achar o que nunca é usado)
sempre as (
  select cat.o + 1000 o, 'Uso desde sempre' g, cat.m, count(evs.o)::numeric valor,
         coalesce('última vez há ' || ((now() at time zone 'America/Sao_Paulo')::date - (max(evs.em) at time zone 'America/Sao_Paulo')::date) || ' dias', 'nunca') d
    from cat left join evs using (o) where cat.m not like '%(R$)%' group by cat.o, cat.m
),
pessoas_sem as (
  select a.mod, a.quem, ((select sa from par) - (date_trunc('week', (a.em at time zone 'America/Sao_Paulo')::date - 1)::date + 1)) / 7 w,
         a.em from acoes_ok a
),
pessoas as (
  select 300 + row_number() over (order by mod) o, 'Pessoas que usaram' g, mod m,
         count(distinct quem) filter (where em > now() - interval '30 days')::numeric valor, 'nos últimos 30 dias; semanas ao lado' d,
         count(distinct quem) filter (where w = 0) s0, count(distinct quem) filter (where w = 1) s1,
         count(distinct quem) filter (where w = 2) s2, count(distinct quem) filter (where w = 3) s3,
         count(distinct quem) filter (where w = 4) s4, count(distinct quem) filter (where w = 5) s5,
         count(distinct quem) filter (where w = 6) s6, count(distinct quem) filter (where w = 7) s7
    from (values ('Ativação'), ('Bloqueios'), ('Entregadores'), ('Tarefas'), ('Financeiro'), ('Parceiros'), ('Agora (ajuda, aviso, turno)'), ('Avisos (leu algum)')) mods(mod) left join pessoas_sem using (mod) group by mod
  union all
  select 300, 'Pessoas que usaram', 'Qualquer módulo', count(distinct quem) filter (where em > now() - interval '30 days'), 'nos últimos 30 dias; semanas ao lado',
         count(distinct quem) filter (where w = 0), count(distinct quem) filter (where w = 1),
         count(distinct quem) filter (where w = 2), count(distinct quem) filter (where w = 3),
         count(distinct quem) filter (where w = 4), count(distinct quem) filter (where w = 5),
         count(distinct quem) filter (where w = 6), count(distinct quem) filter (where w = 7)
    from pessoas_sem
),
naolidos as (select para, count(*) n, min(criada_em) mais_antigo from public.notificacoes where lida_em is null group by para),
-- ---------- fotografia de agora: (ordem, grupo, medida, valor, detalhe) ----------
agora as (
  select 1 o, 'Banco' g, 'Tamanho do banco (MB)' m, round(pg_database_size(current_database()) / 1048576.0, 1) valor, 'plano grátis: 500 MB' d
  union all select 2, 'Banco', 'Tabelas do app (public): tamanho somado (MB)', round(sum(pg_total_relation_size(relid)) / 1048576.0, 1), null from pg_stat_user_tables where schemaname = 'public'
  union all select 3, 'Banco', 'Avisos (notificacoes): parte do banco (%)',
     round(100.0 * pg_total_relation_size('public.notificacoes') / nullif(pg_database_size(current_database()), 0), 1), null
  union all select 10, 'Equipe', 'Pessoas autorizadas', count(*), null from public.membros
  union all select 11, 'Equipe', 'Já entraram ao menos uma vez', count(*), null from public.membros where user_id is not null
  union all select 12, 'Equipe', 'Com acesso aos bloqueios', count(*), null from public.membros where papel_bloqueios is not null
  union all select 13, 'Equipe', 'Moderadores (ativação)', count(*), null from public.membros where papel = 'moderador'
  union all select 14, 'Equipe', 'Pedidos de acesso esperando', count(*), null from public.pedidos_acesso
  union all select 20, 'Para revisar', 'Bloqueios com "revisar" em aberto', count(*), null from public.bloqueios where revisar is not null
  union all select 21, 'Para revisar', 'Bloqueios com dados pendentes (sem nome)', count(*), null from public.bloqueios where dados_pendentes
  union all select 22, 'Para revisar', 'Cadastros com "revisar" (não encerrados)', count(*), null from public.cadastros c where c.status <> 'encerrado' and public.motivo_revisar_cadastro(c) is not null
  union all select 23, 'Para revisar', 'Cadastros sem ID (antigos, só tinham CPF)', count(*), null from public.cadastros where id_app is null
  union all select 24, 'Para revisar', 'Tarefas "completar dados" pendentes', count(*), null from public.tarefas where tipo = 'completar_dados' and status = 'pendente'
  union all select 30, 'Fichas', 'Fichas de entregador', count(*), null from public.entregadores
  union all select 31, 'Fichas', 'Fichas sem cidade', count(*), null from public.entregadores where cidade is null or btrim(cidade) = ''
  union all select 32, 'Fichas', 'Fichas com cidade que não está na lista de cidades', count(*), null from public.entregadores e where e.cidade is not null and not exists (select 1 from public.cidades c where c.nome = e.cidade)
  union all select 33, 'Fichas', 'Cidades ativas', count(*), null from public.cidades where ativa
  union all select 34, 'Fichas', 'Cidades ativas sem responsável', count(*), null from public.cidades where ativa and responsavel_email is null
  union all select 40, 'Fila agora', 'Cadastros aguardando análise', count(*), null from public.cadastros where status = 'aguardando_analise'
  union all select 41, 'Fila agora', 'Cadastros aguardando contato', count(*), null from public.cadastros where status = 'aguardando_contato'
  union all select 42, 'Fila agora', 'Tratativas pendentes', count(*), null from public.tarefas where status = 'pendente' and tipo <> 'completar_dados'
  union all select 43, 'Fila agora', 'Tratativas pendentes além do prazo', count(*), null from public.tarefas t, par where t.status = 'pendente' and t.tipo <> 'completar_dados' and t.criada_em < now() - make_interval(hours => par.prazo_h)
  union all select 44, 'Fila agora', 'Bloqueados agora', count(*), null from public.bloqueios b where public.situacao_bloqueio(b) = 'bloqueado'
  union all select 45, 'Fila agora', 'Tarefas abertas sem dono', count(*), null from public.atividades where status = 'aberta'
  union all select 46, 'Fila agora', 'Tarefas em andamento', count(*), null from public.atividades where status = 'aceita'
  union all select 47, 'Fila agora', 'Tarefas aguardando terceiro', count(*), null from public.atividades where status = 'aceita' and aguardando_desde is not null
  union all select 48, 'Fila agora', 'Adicionais/ajustes ainda não lançados', count(*), 'R$ ' || coalesce(sum(valor), 0)::text from public.lancamentos_financeiros where not lancado
  union all select 49, 'Fila agora', 'Acordos vencidos sem ajuste', count(*), null from public.acordos where ajustado_em is null and vence_em <= (now() at time zone 'America/Sao_Paulo')::date
  union all select 50, 'Fila agora', 'Pedidos de cidade esperando', count(*), null from public.pedidos_cidade where status = 'pendente'
  union all select 60, 'Avisos não lidos', 'Avisos não lidos (total)', coalesce(sum(n), 0), null from naolidos
  union all select 61, 'Avisos não lidos', 'Pessoas com aviso não lido', count(*), null from naolidos
  union all select 62, 'Avisos não lidos', 'Maior pilha de não lidos de uma pessoa', coalesce(max(n), 0), null from naolidos
  union all select 63, 'Avisos não lidos', 'Pessoas com mais de 100 não lidos', count(*) filter (where n > 100), null from naolidos
  union all select 64, 'Avisos não lidos', 'Não lidos com mais de 30 dias', count(*), null from public.notificacoes where lida_em is null and criada_em < now() - interval '30 days'
  union all select 65, 'Avisos não lidos', 'Avisos lidos em até 1 hora (% dos lidos, 30 dias)',
     round(100.0 * count(*) filter (where lida_em - criada_em <= interval '1 hour') / nullif(count(*), 0), 1), null
     from public.notificacoes where lida_em is not null and criada_em > now() - interval '30 days'
  -- recursos que talvez ninguém use (desde sempre)
  union all select 900, 'Recursos (desde sempre)', 'Metas pessoais criadas', count(*), null from public.metas
  union all select 901, 'Recursos (desde sempre)', 'Tarefas recorrentes (ativas)', count(*) filter (where ativa), 'de ' || count(*) || ' criadas' from public.tarefas_recorrentes
  union all select 902, 'Recursos (desde sempre)', 'Seguindo cidade', count(*), null from public.seguindo where tipo = 'cidade'
  union all select 903, 'Recursos (desde sempre)', 'De olho em entregador', count(*), null from public.seguindo where tipo = 'entregador'
  union all select 904, 'Recursos (desde sempre)', 'Pessoas com algum aviso silenciado', count(*), null from public.preferencias_aviso where cardinality(silenciados) > 0
  union all select 905, 'Recursos (desde sempre)', 'Tarefas com checklist', count(*), null from public.atividades where jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) > 0
  union all select 906, 'Recursos (desde sempre)', 'Tarefas que já ficaram aguardando terceiro', count(*), null from public.atividades where coalesce(pausa_seg, 0) > 0 or aguardando_desde is not null
  union all select 907, 'Recursos (desde sempre)', 'Tarefas com mais de um participante (Entrar junto)', count(*), null from public.atividades where jsonb_typeof(participantes) = 'array' and jsonb_array_length(participantes) > 1
  union all select 908, 'Recursos (desde sempre)', 'Comentários com @menção', count(*), null from public.comentarios_tarefa where cardinality(mencoes) > 0
  union all select 909, 'Recursos (desde sempre)', 'Previsões definidas (cadastros+tratativas+tarefas)',
     (select count(*) from public.cadastros where previsao is not null) + (select count(*) from public.tarefas where previsao is not null) + (select count(*) from public.atividades where previsao is not null), null
  union all select 910, 'Recursos (desde sempre)', 'Modelos de mensagem editados pela equipe', count(*), 'de ' || (select count(*) from public.modelos_mensagem) || ' modelos' from public.modelos_mensagem where atualizado_por is not null
  union all select 911, 'Recursos (desde sempre)', 'Bairros cadastrados (ativos)', count(*) filter (where ativo), (select count(distinct cidade) from public.bairros where ativo) || ' cidades' from public.bairros
  union all select 912, 'Recursos (desde sempre)', 'Bairros com apelido (juntados)', count(*), null from public.bairros where ativo and cardinality(apelidos) > 0
  union all select 913, 'Recursos (desde sempre)', 'Pares de bairros marcados como diferentes', count(*), null from public.bairros_diferentes
  union all select 914, 'Recursos (desde sempre)', 'Pedidos de cidade (todos)', count(*), null from public.pedidos_cidade
  union all select 915, 'Recursos (desde sempre)', 'Casos suspeitos no banco (guardados)', count(*), null from public.casos
  union all select 916, 'Recursos (desde sempre)', 'Anexos: espaço usado (MB)', round(coalesce(sum(tamanho), 0) / 1048576.0, 2), count(*) || ' anexos' from public.anexos
  union all select 917, 'Recursos (desde sempre)', 'Fichas ligadas a alguém em "de olho"', count(distinct alvo), null from public.seguindo where tipo = 'entregador'
),
-- tarefas por tipo (tipos do sistema, não texto livre)
por_tipo as (
  select 200 + coalesce(tt.ordem, 99) o, 'Tarefas por tipo (8 semanas)' g, coalesce(tt.nome, 'Livre / sem tipo') m,
         count(*)::numeric valor, count(*) filter (where a.status = 'concluida') || ' concluídas' d
    from public.atividades a left join public.tipos_tarefa tt on tt.tipo = a.tipo, par
   where a.criada_em >= (par.sa - 49)::timestamp at time zone 'America/Sao_Paulo'
   group by tt.ordem, tt.nome
),
-- tamanho de cada tabela (só nomes de tabela e números)
tabelas as (
  select 500 + row_number() over (order by pg_total_relation_size(relid) desc) o, 'Tabelas' g, relname::text m,
         round(pg_total_relation_size(relid) / 1048576.0, 2) valor, n_live_tup || ' linhas (aprox.)' d
    from pg_stat_user_tables where schemaname = 'public'
)
select g grupo, m medida, valor, d detalhe, s0, s1, s2, s3, s4, s5, s6, s7 from (
  select o, g, m, valor, d, null::numeric s0, null::numeric s1, null::numeric s2, null::numeric s3, null::numeric s4, null::numeric s5, null::numeric s6, null::numeric s7 from agora
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from semanal
  union all select o, g, m, valor, d, s0, s1, s2, s3, s4, s5, s6, s7 from pessoas
  union all select o, g, m, valor, d, null, null, null, null, null, null, null, null from por_tipo
  union all select o, g, m, valor, d, null, null, null, null, null, null, null, null from sempre
  union all select o, g, m, valor, d, null, null, null, null, null, null, null, null from tabelas
) x
order by o, m;
