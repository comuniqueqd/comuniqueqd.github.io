-- =====================================================================
-- 008c · Análises simples e complexas + revisão
-- Para quem já rodou o 008b-notificacoes.sql. Não apaga nada e pode rodar
-- mais de uma vez.
--
-- analises_simples(): os números do dia a dia (ativação, motivos das não
--   aprovações, bloqueados agora e quem sai hoje, reincidência, quando a
--   equipe e você registram, leves, infrações, tratativas no prazo,
--   atividades e o que você fez no período).
-- analises_complexas(): as de sempre (eficácia da punição, tratativas por
--   responsável, da ativação ao bloqueio) + reincidência por infração,
--   escada de reincidência, cidades, tempo de resposta da ativação e
--   liberações antes do prazo.
-- Só totais para todos os papéis (nenhum nome de entregador), menos o
-- bloco "voce", que é da própria pessoa.
-- =====================================================================

create or replace function public.analises_simples(p_dias integer default 30, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  desde  timestamptz := case when p_dias is null then '-infinity'::timestamptz else now() - make_interval(days => p_dias) end;
  hoje   timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  amanha timestamptz := hoje + interval '1 day';
  prazo  interval := public.prazo_tratativa();
  eu     uuid := auth.uid();
  bq     boolean := public.meu_papel_bloq() is not null;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'periodo_dias', p_dias, 'cidade', p_cidade, 'tem_bloqueios', bq,
    -- ativação: agora e no período
    'ativacao', (select jsonb_build_object(
        'aguardando_analise', (select count(*) from public.cadastros c where c.status = 'aguardando_analise' and (p_cidade is null or c.cidade = p_cidade)),
        'aguardando_contato', (select count(*) from public.cadastros c where c.status = 'aguardando_contato' and (p_cidade is null or c.cidade = p_cidade)),
        'enviados', count(*),
        'aprovados', count(*) filter (where c.status = 'aprovado'),
        'em_aberto', count(*) filter (where c.status in ('aguardando_analise', 'aguardando_contato')),
        'encerrados', count(*) filter (where c.status = 'encerrado'),
        'reprovados_alguma_vez', count(*) filter (where exists (select 1 from public.eventos e where e.cadastro_id = c.id and e.tipo = 'reprovado')),
        'horas_ate_aprovar', (select round((percentile_cont(0.5) within group (order by extract(epoch from e.em - c2.enviado_em) / 3600))::numeric, 1)
            from public.cadastros c2 join lateral (select min(em) em from public.eventos e where e.cadastro_id = c2.id and e.tipo = 'aprovado') e on e.em is not null
           where c2.enviado_em >= desde and (p_cidade is null or c2.cidade = p_cidade)))
      from public.cadastros c where c.enviado_em >= desde and (p_cidade is null or c.cidade = p_cidade)),
    -- por que não aprovou: reprovações e encerramentos do período (sem os desfeitos depois)
    'motivos_nao_aprovacao', coalesce((select jsonb_agg(x order by x.qtd desc, x.motivo) from (
        select e.tipo, coalesce(nullif(btrim(e.motivo), ''), '(sem motivo)') motivo, count(*) qtd
          from public.eventos e join public.cadastros c on c.id = e.cadastro_id
         where e.tipo in ('reprovado', 'encerrado') and e.em >= desde and (p_cidade is null or c.cidade = p_cidade)
           and not exists (select 1 from public.eventos d where d.cadastro_id = e.cadastro_id and d.tipo = 'desfeito' and d.em > e.em
                             and d.status_anterior = e.status_novo
                             and not exists (select 1 from public.eventos m where m.cadastro_id = e.cadastro_id and m.em > e.em and m.em < d.em
                                               and m.tipo not in ('editado', 'revisado')))
         group by 1, 2) x), '[]'),
    -- bloqueios agora e quem sai hoje (o fim do prazo libera sozinho)
    'agora', case when bq then (select jsonb_build_object(
        'bloqueados', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado'),
        'saem_hoje', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado' and b.fim < amanha),
        'sairam_hoje', count(*) filter (where b.liberado_em is null and b.horas is not null and b.fim >= hoje and b.fim <= now()),
        'liberados_antes_hoje', count(*) filter (where b.liberado_em >= hoje),
        'proximo_fim', min(b.fim) filter (where public.situacao_bloqueio(b) = 'bloqueado'),
        'encerramentos_pendentes', (select count(*) from public.tarefas t where t.tipo = 'encerramento_parceria' and t.status = 'pendente' and (p_cidade is null or t.cidade = p_cidade)),
        'tratativas_pendentes', (select count(*) from public.tarefas t where t.status = 'pendente' and t.tipo <> 'completar_dados' and (p_cidade is null or t.cidade = p_cidade)),
        'tratativas_atrasadas', (select count(*) from public.tarefas t where t.status = 'pendente' and public.tarefa_atrasada(t) and (p_cidade is null or t.cidade = p_cidade)),
        'saem_hoje_por_hora', coalesce((select jsonb_agg(h order by h.hora) from (
            select extract(hour from x.fim at time zone 'America/Sao_Paulo')::integer hora, count(*) qtd
              from public.bloqueios x
             where not x.leve and public.situacao_bloqueio(x) = 'bloqueado' and x.fim < amanha and (p_cidade is null or x.cidade = p_cidade)
             group by 1) h), '[]'))
      from public.bloqueios b where not b.leve and (p_cidade is null or b.cidade = p_cidade)) end,
    'bloqueados_por_cidade', case when bq then coalesce((select jsonb_agg(x order by x.agora desc, x.cidade) from (
        select coalesce(b.cidade, '(sem cidade)') cidade, count(*) agora, count(*) filter (where b.fim < amanha) saem_hoje
          from public.bloqueios b
         where not b.leve and public.situacao_bloqueio(b) = 'bloqueado' and (p_cidade is null or b.cidade = p_cidade)
         group by 1) x), '[]') end,
    -- intervalo entre um bloqueio e o seguinte do mesmo entregador
    'reincidencia', case when bq then (select jsonb_build_object(
        'total', count(*),
        'mediana_dias', round((percentile_cont(0.5) within group (order by dias))::numeric, 1),
        'faixas', jsonb_build_array(
          jsonb_build_object('faixa', 'até 7 dias', 'qtd', count(*) filter (where dias <= 7)),
          jsonb_build_object('faixa', '8 a 30 dias', 'qtd', count(*) filter (where dias > 7 and dias <= 30)),
          jsonb_build_object('faixa', '31 a 60 dias', 'qtd', count(*) filter (where dias > 30 and dias <= 60)),
          jsonb_build_object('faixa', '61 a 90 dias', 'qtd', count(*) filter (where dias > 60 and dias <= 90)),
          jsonb_build_object('faixa', 'mais de 90 dias', 'qtd', count(*) filter (where dias > 90))))
      from (select extract(epoch from inicio - anterior) / 86400 dias from (
              select b.inicio, b.cidade, lag(b.inicio) over (partition by lower(b.id_app) order by b.inicio) anterior
                from public.bloqueios b where not b.leve) s
             where anterior is not null and inicio >= desde and (p_cidade is null or cidade = p_cidade)) d) end,
    -- quando a equipe registra e quando você registra: bloqueios, leves e cadastros enviados
    -- (dia da semana × hora, horário de Brasília; sem os importados da planilha)
    'dia_hora', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'hora', hora, 'qtd', qtd)) from (
        select extract(dow from em at time zone 'America/Sao_Paulo')::integer dia,
               extract(hour from em at time zone 'America/Sao_Paulo')::integer hora, count(*) qtd
          from (select b.inicio em, b.registrado_por por from public.bloqueios b
                 where bq and not b.importado and b.inicio >= desde and (p_cidade is null or b.cidade = p_cidade)
                union all
                select c.enviado_em, c.enviado_por from public.cadastros c
                 where c.enviado_em >= desde and (p_cidade is null or c.cidade = p_cidade)) r
         group by 1, 2) x), '[]'),
    'dia_hora_meu', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'hora', hora, 'qtd', qtd)) from (
        select extract(dow from em at time zone 'America/Sao_Paulo')::integer dia,
               extract(hour from em at time zone 'America/Sao_Paulo')::integer hora, count(*) qtd
          from (select b.inicio em from public.bloqueios b
                 where b.registrado_por = eu and not b.importado and b.inicio >= desde and (p_cidade is null or b.cidade = p_cidade)
                union all
                select c.enviado_em from public.cadastros c
                 where c.enviado_por = eu and c.enviado_em >= desde and (p_cidade is null or c.cidade = p_cidade)) r
         group by 1, 2) x), '[]'),
    'leves', case when bq then (select jsonb_build_object(
        'total', count(*), 'entregadores', count(distinct lower(id_app)),
        'atingiram_limite', count(distinct lower(id_app)) filter (where atingiu_limite))
      from public.bloqueios where leve and inicio >= desde and (p_cidade is null or cidade = p_cidade)) end,
    'por_infracao', case when bq then coalesce((select jsonb_agg(x order by x.qtd desc, x.infracao) from (
        select infracao, count(*) qtd, count(*) filter (where horas is null) encerramentos
          from public.bloqueios where not leve and inicio >= desde and (p_cidade is null or cidade = p_cidade)
         group by 1 order by 2 desc limit 8) x), '[]') end,
    'tratativas', case when bq then (select jsonb_build_object(
        'criadas', count(*), 'concluidas', count(*) filter (where t.status = 'concluida'),
        'no_prazo', count(*) filter (where t.status = 'concluida' and t.concluida_em - t.criada_em <= prazo),
        'prazo_horas', extract(epoch from prazo) / 3600)
      from public.tarefas t
     where not t.importada and t.tipo <> 'completar_dados' and t.criada_em >= desde and (p_cidade is null or t.cidade = p_cidade)) end,
    'atividades', (select jsonb_build_object(
        'sugeridas', count(*) filter (where a.criada_em >= desde),
        'concluidas', count(*) filter (where a.status = 'concluida' and a.concluida_em >= desde),
        'abertas_agora', count(*) filter (where a.status = 'aberta'),
        'em_andamento', count(*) filter (where a.status = 'aceita'))
      from public.atividades a),
    -- o que você fez no período (só a própria pessoa)
    'voce', jsonb_build_object(
        'cadastros', (select count(*) from public.cadastros c where c.enviado_por = eu and c.enviado_em >= desde),
        'decisoes', (select count(*) from public.eventos e where e.por = eu and e.tipo in ('aprovado', 'reprovado', 'encerrado') and e.em >= desde),
        'bloqueios', (select count(*) from public.bloqueios b where b.registrado_por = eu and not b.leve and b.inicio >= desde),
        'leves', (select count(*) from public.bloqueios b where b.registrado_por = eu and b.leve and b.inicio >= desde),
        'tratativas', (select count(*) from public.tarefas t where t.concluida_por = eu and t.concluida_em >= desde),
        'atividades', (select count(*) from public.atividades a where a.aceita_por = eu and a.status = 'concluida' and a.concluida_em >= desde),
        'comentarios', (select count(*) from public.comentarios_entregador k where k.por = eu and k.tipo = 'comentario' and k.em >= desde)));
end $$;

create or replace function public.analises_complexas(p_dias integer default 90, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  desde timestamptz := case when p_dias is null then '-infinity'::timestamptz else now() - make_interval(days => p_dias) end;
  base  jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  base := public.analises(p_dias, p_cidade);
  return jsonb_build_object(
    'periodo_dias', p_dias, 'cidade', p_cidade,
    'eficacia', base -> 'eficacia',
    'tratativas_por_responsavel', base -> 'tratativas_por_responsavel',
    'ativacao_bloqueio', base -> 'ativacao_bloqueio',
    -- qual infração mais se repete: entregadores com 2 ou mais da mesma infração (todo o histórico)
    'reincidencia_por_infracao', coalesce((select jsonb_agg(x order by x.pct desc nulls last, x.entregadores desc) from (
        select b.infracao, count(*) bloqueios, count(distinct lower(b.id_app)) entregadores,
               count(distinct lower(b.id_app)) filter (where (select count(*) from public.bloqueios y
                  where lower(y.id_app) = lower(b.id_app) and y.infracao = b.infracao and not y.leve) >= 2) repetiram,
               round(100.0 * count(distinct lower(b.id_app)) filter (where (select count(*) from public.bloqueios y
                  where lower(y.id_app) = lower(b.id_app) and y.infracao = b.infracao and not y.leve) >= 2)
                 / nullif(count(distinct lower(b.id_app)), 0), 1) pct
          from public.bloqueios b
         where not b.leve and b.inicio >= desde and (p_cidade is null or b.cidade = p_cidade)
         group by 1 having count(*) >= 2) x), '[]'),
    -- escada: dos entregadores bloqueados no período, quantos bloqueios cada um já teve (todo o histórico)
    'escada', (select jsonb_build_object(
        'entregadores', count(*),
        'faixas', jsonb_build_array(
          jsonb_build_object('faixa', '1 bloqueio', 'qtd', count(*) filter (where n = 1)),
          jsonb_build_object('faixa', '2 bloqueios', 'qtd', count(*) filter (where n = 2)),
          jsonb_build_object('faixa', '3 bloqueios', 'qtd', count(*) filter (where n = 3)),
          jsonb_build_object('faixa', '4 ou mais', 'qtd', count(*) filter (where n >= 4))))
      from (select d.id, (select count(*) from public.bloqueios y where lower(y.id_app) = d.id and not y.leve) n
              from (select distinct lower(b.id_app) id from public.bloqueios b
                     where not b.leve and b.inicio >= desde and (p_cidade is null or b.cidade = p_cidade)) d) e),
    -- cidades: volume, bloqueios por entregador, reincidentes e encerramentos
    'cidades', coalesce((select jsonb_agg(x order by x.bloqueios desc, x.cidade) from (
        select coalesce(b.cidade, '(sem cidade)') cidade, count(*) bloqueios, count(distinct lower(b.id_app)) entregadores,
               round(count(*)::numeric / nullif(count(distinct lower(b.id_app)), 0), 2) por_entregador,
               count(distinct lower(b.id_app)) filter (where b.ocorrencia_total >= 2) reincidentes,
               count(*) filter (where b.horas is null) encerramentos,
               (select count(*) from public.bloqueios l where l.leve and l.inicio >= desde and l.cidade is not distinct from b.cidade) leves
          from public.bloqueios b
         where not b.leve and b.inicio >= desde and (p_cidade is null or b.cidade = p_cidade)
         group by b.cidade) x), '[]'),
    -- ativação: do envio à primeira decisão, por quem decidiu e pelo dia do envio
    'resposta_ativacao', (select jsonb_build_object(
        'por_pessoa', coalesce((select jsonb_agg(x order by x.decisoes desc) from (
            select coalesce(public.nome_de(d.por), '—') pessoa, count(*) decisoes,
                   count(*) filter (where d.tipo = 'aprovado') aprovou,
                   round((percentile_cont(0.5) within group (order by extract(epoch from d.em - c.enviado_em) / 3600))::numeric, 1) horas_mediana
              from public.cadastros c
              join lateral (select e.* from public.eventos e where e.cadastro_id = c.id and e.tipo in ('aprovado', 'reprovado', 'encerrado')
                             order by e.em limit 1) d on true
             where c.enviado_em >= desde and (p_cidade is null or c.cidade = p_cidade)
             group by d.por) x), '[]'),
        'por_dia', coalesce((select jsonb_agg(x order by x.dia) from (
            select extract(dow from c.enviado_em at time zone 'America/Sao_Paulo')::integer dia, count(*) enviados,
                   round((percentile_cont(0.5) within group (order by extract(epoch from d.em - c.enviado_em) / 3600))::numeric, 1) horas_mediana
              from public.cadastros c
              join lateral (select e.em from public.eventos e where e.cadastro_id = c.id and e.tipo in ('aprovado', 'reprovado', 'encerrado')
                             order by e.em limit 1) d on true
             where c.enviado_em >= desde and (p_cidade is null or c.cidade = p_cidade)
             group by 1) x), '[]'))),
    -- punições desfeitas: liberados antes do prazo e encerramentos revertidos, por infração
    'liberacoes', coalesce((select jsonb_agg(x order by x.pct desc nulls last, x.bloqueios desc) from (
        select b.infracao, count(*) bloqueios, count(*) filter (where b.liberado_em is not null) liberados,
               round(100.0 * count(*) filter (where b.liberado_em is not null) / count(*), 1) pct,
               round((avg(extract(epoch from b.liberado_em - b.inicio) / 3600) filter (where b.liberado_em is not null))::numeric, 1) horas_media
          from public.bloqueios b
         where not b.leve and not b.importado and b.inicio >= desde and (p_cidade is null or b.cidade = p_cidade)
         group by 1) x where x.liberados > 0), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Revisão: o número de "algo mudou" (versao_dados) só sobe quando alguma
-- linha mudou de verdade. Antes subia a cada comando, mesmo sem mudar nada
-- (entrar() a cada abertura do app, marcar avisos como lidos, verificar
-- atrasos a cada 5 min), e todo mundo recarregava as listas à toa.
-- Um gatilho por evento, com as linhas do comando (tabelas de transição).
-- ---------------------------------------------------------------------
create or replace function public.marcar_mudanca_linhas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    -- update que não mudou nenhum valor (ou não pegou nenhuma linha) não conta
    if not exists (select 1 from (select * from novas except all select * from antigas) x) then return null; end if;
  elsif TG_OP = 'INSERT' then
    if not exists (select 1 from novas) then return null; end if;
  else
    if not exists (select 1 from antigas) then return null; end if;
  end if;
  update public.versao_dados set n = n + 1, em = now() where unico;  -- o Supabase recusa update sem where
  return null;
end $$;

do $$
declare t text;
begin
  for t in select distinct c.relname from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and g.tgname in ('marcar_mudanca', 'marcar_mudanca_ins') and not g.tgisinternal loop
    execute format('drop trigger if exists marcar_mudanca on public.%I', t);
    execute format('drop trigger if exists marcar_mudanca_ins on public.%I', t);
    execute format('drop trigger if exists marcar_mudanca_upd on public.%I', t);
    execute format('drop trigger if exists marcar_mudanca_del on public.%I', t);
    execute format('create trigger marcar_mudanca_ins after insert on public.%I referencing new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
    execute format('create trigger marcar_mudanca_upd after update on public.%I referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
    execute format('create trigger marcar_mudanca_del after delete on public.%I referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas()', t);
  end loop;
end $$;
revoke execute on function public.marcar_mudanca_linhas() from public, anon, authenticated;

-- Revisão (segurança): motivo_revisar_cadastro() pode ser chamada direto pela API por qualquer conta
-- logada (o listar_cadastros, que é invoker, precisa dela) e devolvia o nome da ficha de qualquer ID.
-- Agora quem não é da equipe recebe nulo (no SQL Editor, sem usuário, continua funcionando).
create or replace function public.motivo_revisar_cadastro(c public.cadastros)
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and public.meu_papel() is null then null else nullif(concat_ws(' · ',
    case when c.nome is null then 'falta o nome do entregador' end,
    case when c.id_app is null then 'falta o ID do entregador' end,
    case when not c.revisado and c.id_app is not null and c.nome is not null
              and exists (select 1 from public.entregadores e where e.id_app = lower(c.id_app)
                           and lower(btrim(e.nome)) <> lower(btrim(c.nome)))
         then 'o ID já tem ficha com outro nome: ' || (select e.nome from public.entregadores e where e.id_app = lower(c.id_app)) end), '') end
$$;

-- Revisão: o app passa a ouvir em tempo real só os avisos da própria pessoa (o resto chega
-- pelo número de versão a cada 30 s). As outras tabelas saem da publicação do Realtime.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cadastros', 'eventos', 'membros', 'pedidos_acesso', 'bloqueios', 'tarefas', 'atividades'] loop
      if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime drop table public.%I', t);
      end if;
    end loop;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes') then
      alter publication supabase_realtime add table public.notificacoes;
    end if;
  end if;
exception when others then
  -- sem permissão na publicação (ou outro problema nela): não impede o resto da migração
  raise notice 'Realtime não ajustado: %', sqlerrm;
end $$;

-- as duas são para todos os papéis (só totais, como a analises() de sempre)
revoke all on function public.analises_simples(integer, text) from public, anon;
grant execute on function public.analises_simples(integer, text) to authenticated;
revoke all on function public.analises_complexas(integer, text) from public, anon;
grant execute on function public.analises_complexas(integer, text) to authenticated;

-- avisa a API do Supabase que há funções novas (sem isso ela pode demorar a enxergá-las)
notify pgrst, 'reload schema';

