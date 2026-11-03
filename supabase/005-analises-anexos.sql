-- =====================================================================
-- Migração 005: Análises, Resumo semanal, Da ativação ao bloqueio e anexos
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rodar DEPOIS do 004-atividades-registros.sql. Não apaga dados e pode rodar mais de uma vez.
--
--   * ANÁLISES (para todos os papéis, só números agregados): eficácia da punição, tempo até
--     reincidir, dia × hora do registro, bloqueados agora por cidade (vindos da ativação ou só
--     dos bloqueios), conversão das leves, tempo de tratativa por responsável e
--     "da ativação ao bloqueio" (aprovados por mês bloqueados em 30/60/90 dias).
--   * RESUMO SEMANAL: semana de TERÇA a SEGUNDA (reunião na terça), qualquer semana.
--   * APROVADOS E BLOQUEIOS: para o Histórico da ativação (monitorador e moderador).
--   * ANEXOS só nos bloqueios: até 3 por bloqueio, até 300 KB cada (imagens são comprimidas no
--     navegador), guardados no banco com as mesmas regras de acesso; teto total de 200 MB.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Semana de terça a segunda (horário de Brasília)
-- ---------------------------------------------------------------------
create or replace function public.inicio_semana(p_data date)
returns date language sql immutable as $$
  -- isodow: segunda = 1 ... domingo = 7; terça → 0 dias para trás, segunda → 6
  select p_data - ((extract(isodow from p_data)::integer + 5) % 7)
$$;

create or replace function public.resumo_semanal(p_data date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ini date := public.inicio_semana(coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date));
  t0  timestamptz := ini::timestamp at time zone 'America/Sao_Paulo';
  t1  timestamptz := (ini + 7)::timestamp at time zone 'America/Sao_Paulo';
  prazo interval := public.prazo_tratativa();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'inicio', ini, 'fim', ini + 6, 'em_andamento', now() < t1, 'futura', now() < t0,
    'ativacao', (select jsonb_build_object(
        'enviados', count(*) filter (where e.tipo = 'enviado'),
        'aprovados', count(*) filter (where e.tipo = 'aprovado'),
        'reprovados', count(*) filter (where e.tipo = 'reprovado'),
        'encerrados', count(*) filter (where e.tipo = 'encerrado'),
        'horas_ate_aprovacao', round((avg(extract(epoch from e.em - c.enviado_em) / 3600) filter (where e.tipo = 'aprovado'))::numeric, 1))
      from public.eventos e join public.cadastros c on c.id = e.cadastro_id where e.em >= t0 and e.em < t1),
    'bloqueios', (select jsonb_build_object(
        'registrados', count(*) filter (where not b.leve and b.inicio >= t0 and b.inicio < t1),
        'leves', count(*) filter (where b.leve and b.inicio >= t0 and b.inicio < t1),
        'encerramentos', count(*) filter (where not b.leve and b.horas is null and b.inicio >= t0 and b.inicio < t1),
        'reincidencias', count(*) filter (where not b.leve and b.ocorrencia >= 2 and b.inicio >= t0 and b.inicio < t1),
        'entregadores', count(distinct lower(b.id_app)) filter (where b.inicio >= t0 and b.inicio < t1),
        'gerados_por_leves', count(*) filter (where not b.leve and b.inicio >= t0 and b.inicio < t1
                                 and exists (select 1 from public.bloqueios l where l.gerou_bloqueio = b.id)),
        'liberados_antes', count(*) filter (where b.horas is not null and b.liberado_em >= t0 and b.liberado_em < t1),
        'revertidos', count(*) filter (where b.horas is null and b.liberado_em >= t0 and b.liberado_em < t1))
      from public.bloqueios b),
    'tratativas', (select jsonb_build_object(
        'criadas', count(*) filter (where t.criada_em >= t0 and t.criada_em < t1 and not t.importada),
        'concluidas', count(*) filter (where t.concluida_em >= t0 and t.concluida_em < t1 and not t.importada),
        'fora_do_prazo', count(*) filter (where t.concluida_em >= t0 and t.concluida_em < t1 and not t.importada and t.concluida_em - t.criada_em > prazo),
        'horas_media', round((avg(extract(epoch from t.concluida_em - t.criada_em) / 3600)
                         filter (where t.concluida_em >= t0 and t.concluida_em < t1 and not t.importada))::numeric, 1),
        'pendentes_no_fim', count(*) filter (where not t.importada and t.criada_em < least(t1, now())
                                 and (t.status = 'pendente' or t.concluida_em >= least(t1, now())))
        ) from public.tarefas t where t.tipo <> 'completar_dados'),
    'atividades', (select jsonb_build_object(
        'criadas', count(*) filter (where a.criada_em >= t0 and a.criada_em < t1),
        'concluidas', count(*) filter (where a.concluida_em >= t0 and a.concluida_em < t1))
      from public.atividades a),
    'por_infracao', coalesce((select jsonb_agg(x order by x.total desc, x.infracao) from (
        select b.infracao, b.leve, count(*) total from public.bloqueios b
         where b.inicio >= t0 and b.inicio < t1 group by 1, 2 order by 3 desc limit 10) x), '[]'),
    'por_cidade', coalesce((select jsonb_agg(x order by x.total desc, x.cidade) from (
        select coalesce(b.cidade, '(sem cidade)') cidade, count(*) total from public.bloqueios b
         where b.inicio >= t0 and b.inicio < t1 group by 1 order by 2 desc limit 10) x), '[]'),
    'por_pessoa', coalesce((select jsonb_agg(x order by x.total desc, x.nome) from (
        select nome, sum(bloqueios)::int bloqueios, sum(leves)::int leves, sum(cadastros)::int cadastros, sum(decisoes)::int decisoes,
               sum(tratativas)::int tratativas, sum(bloqueios + leves + cadastros + decisoes + tratativas)::int total from (
          select b.registrado_por_nome nome, count(*) filter (where not b.leve) bloqueios, count(*) filter (where b.leve) leves,
                 0 cadastros, 0 decisoes, 0 tratativas
            from public.bloqueios b where b.inicio >= t0 and b.inicio < t1 and not b.importado group by 1
          union all
          select public.nome_de(e.por), 0, 0, count(*) filter (where e.tipo = 'enviado'), count(*) filter (where e.tipo <> 'enviado'), 0
            from public.eventos e where e.em >= t0 and e.em < t1 group by 1
          union all
          select public.nome_de(t.concluida_por), 0, 0, 0, 0, count(*)
            from public.tarefas t where t.concluida_em >= t0 and t.concluida_em < t1 and not t.importada and t.concluida_por is not null group by 1
        ) u group by nome) x), '[]'),
    'semanas', (select jsonb_agg(public.inicio_semana((now() at time zone 'America/Sao_Paulo')::date) - 7 * g order by g)
                  from generate_series(0, 25) g));
end $$;

-- ---------------------------------------------------------------------
-- Análises (agregados; para todos)
-- p_dias: período (nulo = tudo); p_cidade: uma cidade (nulo = todas)
-- ---------------------------------------------------------------------
create or replace function public.analises(p_dias integer default 90, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  desde timestamptz := case when p_dias is null then '-infinity'::timestamptz else now() - make_interval(days => p_dias) end;
  prazo interval := public.prazo_tratativa();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'periodo_dias', p_dias, 'cidade', p_cidade,
    -- depois de cada punição, quantos voltaram a ser bloqueados em até 30 dias
    -- (só bloqueios com pelo menos 30 dias, para dar tempo de ver a reincidência)
    'eficacia', coalesce((select jsonb_agg(x order by x.ordem) from (
        select case when horas is null then 'Encerramento' else public.texto_punicao(horas) end punicao,
               coalesce(horas, 99999) ordem, count(*) bloqueios,
               count(*) filter (where proximo <= inicio + interval '30 days') reincidiram_30d,
               round(100.0 * count(*) filter (where proximo <= inicio + interval '30 days') / count(*), 1) pct
          from (select b.*, lead(b.inicio) over (partition by lower(b.id_app) order by b.inicio) proximo
                  from public.bloqueios b where not b.leve) s
         where inicio >= desde and inicio <= now() - interval '30 days' and (p_cidade is null or cidade = p_cidade)
         group by horas) x), '[]'),
    -- intervalo entre um bloqueio e o seguinte do mesmo entregador
    'reincidencia', (select jsonb_build_object(
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
             where anterior is not null and inicio >= desde and (p_cidade is null or cidade = p_cidade)) d),
    -- quando a equipe registra (dia da semana × hora), sem os importados da planilha
    'dia_hora', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'hora', hora, 'qtd', qtd)) from (
        select extract(dow from b.inicio at time zone 'America/Sao_Paulo')::integer dia,
               extract(hour from b.inicio at time zone 'America/Sao_Paulo')::integer hora, count(*) qtd
          from public.bloqueios b
         where not b.importado and b.inicio >= desde and (p_cidade is null or b.cidade = p_cidade)
         group by 1, 2) x), '[]'),
    -- bloqueados agora por cidade, separando quem veio da ativação de quem só existe pelos bloqueios
    'bloqueados_por_cidade', coalesce((select jsonb_agg(x order by x.agora desc, x.cidade) from (
        select coalesce(b.cidade, '(sem cidade)') cidade, count(*) agora,
               count(*) filter (where exists (select 1 from public.cadastros c where lower(c.id_app) = lower(b.id_app))) da_ativacao,
               count(*) filter (where not exists (select 1 from public.cadastros c where lower(c.id_app) = lower(b.id_app))) so_bloqueios
          from public.bloqueios b
         where not b.leve and public.situacao_bloqueio(b) = 'bloqueado' and (p_cidade is null or b.cidade = p_cidade)
         group by 1) x), '[]'),
    'leves', (select jsonb_build_object(
        'total', count(*), 'entregadores', count(distinct lower(id_app)),
        'atingiram_limite', count(distinct lower(id_app)) filter (where atingiu_limite),
        'por_motivo', coalesce((select jsonb_agg(m order by m.qtd desc) from (
            select infracao, count(*) qtd, count(*) filter (where atingiu_limite) geraram from public.bloqueios
             where leve and inicio >= desde and (p_cidade is null or cidade = p_cidade) group by 1) m), '[]'))
      from public.bloqueios where leve and inicio >= desde and (p_cidade is null or cidade = p_cidade)),
    'tratativas_por_responsavel', coalesce((select jsonb_agg(x order by x.total desc, x.responsavel) from (
        select coalesce(public.nome_por_email(t.responsavel_email), 'Moderadores') responsavel, count(*) total,
               count(*) filter (where t.status = 'concluida') concluidas,
               round((avg(extract(epoch from t.concluida_em - t.criada_em) / 3600) filter (where t.status = 'concluida'))::numeric, 1) horas_media,
               count(*) filter (where t.status = 'concluida' and t.concluida_em - t.criada_em > prazo) fora_do_prazo,
               count(*) filter (where t.status = 'pendente') pendentes,
               count(*) filter (where public.tarefa_atrasada(t)) atrasadas_agora
          from public.tarefas t
         where not t.importada and t.tipo <> 'completar_dados' and t.criada_em >= desde and (p_cidade is null or t.cidade = p_cidade)
         group by 1) x), '[]'),
    'ativacao_bloqueio', public.ativacao_ao_bloqueio(p_cidade));
end $$;

-- Dos aprovados em cada mês, quantos foram bloqueados (bloqueio normal) em até 30/60/90 dias.
-- "maduro_30" etc. = quantos aprovados daquele mês já têm 30 (60, 90) dias, para a conta ser justa.
create or replace function public.ativacao_ao_bloqueio(p_cidade text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with aprov as (
    select lower(c.id_app) id, c.cidade,
           (select min(e.em) from public.eventos e where e.cadastro_id = c.id and e.tipo = 'aprovado') aprovado_em
      from public.cadastros c
     where c.status = 'aprovado' and c.id_app is not null and (p_cidade is null or c.cidade = p_cidade)
  ), prim as (
    select a.*, (select min(b.inicio) from public.bloqueios b
                  where lower(b.id_app) = a.id and not b.leve and b.inicio >= a.aprovado_em) primeiro
      from aprov a where a.aprovado_em is not null
  )
  select jsonb_build_object(
    'aprovados', count(*), 'bloqueados', count(primeiro),
    'dias_medios', round((avg(extract(epoch from primeiro - aprovado_em) / 86400))::numeric, 1),
    'meses', coalesce((select jsonb_agg(m order by m.mes desc) from (
        select to_char(date_trunc('month', aprovado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM') mes, count(*) aprovados,
               count(*) filter (where aprovado_em <= now() - interval '30 days') maduro_30,
               count(*) filter (where aprovado_em <= now() - interval '60 days') maduro_60,
               count(*) filter (where aprovado_em <= now() - interval '90 days') maduro_90,
               count(*) filter (where primeiro <= aprovado_em + interval '30 days') bloq_30,
               count(*) filter (where primeiro <= aprovado_em + interval '60 days') bloq_60,
               count(*) filter (where primeiro <= aprovado_em + interval '90 days') bloq_90,
               count(primeiro) bloq_total
          from prim group by 1) m), '[]'))
    from prim
$$;

-- Histórico da ativação: cada aprovado e se/quando foi bloqueado depois (monitorador e moderador)
create or replace function public.aprovados_e_bloqueios()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador');
  return coalesce((select jsonb_agg(x order by x.aprovado_em desc) from (
    select c.id_app, c.cidade, c.cpf, public.nome_de(c.enviado_por) enviado_por_nome, a.aprovado_em,
           (select e.nome from public.entregadores e where e.id_app = lower(c.id_app)) nome,
           count(b.id) bloqueios, min(b.inicio) primeiro_bloqueio,
           round((extract(epoch from min(b.inicio) - a.aprovado_em) / 86400)::numeric, 1) dias_ate_bloqueio,
           bool_or(public.situacao_bloqueio(b) = 'bloqueado') bloqueado_agora,
           bool_or(public.situacao_bloqueio(b) = 'encerramento') encerrado
      from public.cadastros c
      cross join lateral (select min(e.em) aprovado_em from public.eventos e where e.cadastro_id = c.id and e.tipo = 'aprovado') a
      left join public.bloqueios b on lower(b.id_app) = lower(c.id_app) and not b.leve and b.inicio >= a.aprovado_em
     where c.status = 'aprovado' and c.id_app is not null and a.aprovado_em is not null
     group by c.id, c.id_app, c.cidade, c.cpf, c.enviado_por, a.aprovado_em) x), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Anexos (só nos bloqueios)
-- ---------------------------------------------------------------------
create table if not exists public.anexos (
  id          uuid primary key default gen_random_uuid(),
  bloqueio_id uuid not null references public.bloqueios (id) on delete cascade,
  nome        text not null check (length(btrim(nome)) between 1 and 120),
  tipo        text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  tamanho     integer not null check (tamanho between 1 and 307200),   -- até 300 KB
  conteudo    bytea not null,
  por         uuid,
  por_nome    text,
  em          timestamptz not null default now()
);
create index if not exists anexos_bloqueio on public.anexos (bloqueio_id, em);

-- suporte: só nos bloqueios que registrou; monitorador e moderador: em qualquer um
create or replace function public.pode_ver_bloqueio(p_bloqueio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.meu_papel_bloq() in ('moderador', 'monitorador')
      or exists (select 1 from public.bloqueios where id = p_bloqueio and registrado_por = auth.uid())
$$;

create or replace function public.anexar(p_bloqueio uuid, p_nome text, p_tipo text, p_base64 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  dados bytea;
  novo  uuid;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if not exists (select 1 from public.bloqueios where id = p_bloqueio) then raise exception 'Bloqueio não encontrado.'; end if;
  if not public.pode_ver_bloqueio(p_bloqueio) then raise exception 'Você só pode anexar nos bloqueios que registrou.' using errcode = '42501'; end if;
  if p_tipo not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'Anexe uma imagem (JPG, PNG) ou um PDF.';
  end if;
  begin dados := decode(coalesce(p_base64, ''), 'base64');
  exception when others then raise exception 'Arquivo inválido.'; end;
  if length(dados) = 0 then raise exception 'Arquivo vazio.'; end if;
  if length(dados) > 307200 then raise exception 'O arquivo passou de 300 KB. Use uma imagem menor ou um PDF mais leve.'; end if;
  perform pg_advisory_xact_lock(hashtext('anexos:' || p_bloqueio::text));
  if (select count(*) from public.anexos where bloqueio_id = p_bloqueio) >= 3 then
    raise exception 'Cada bloqueio pode ter no máximo 3 anexos.';
  end if;
  if (select coalesce(sum(tamanho), 0) from public.anexos) + length(dados) > 200 * 1024 * 1024 then
    raise exception 'O espaço para anexos do sistema está cheio (200 MB). Fale com um moderador.';
  end if;
  insert into public.anexos (bloqueio_id, nome, tipo, tamanho, conteudo, por, por_nome)
  values (p_bloqueio, left(btrim(coalesce(nullif(btrim(p_nome), ''), 'anexo')), 120), p_tipo, length(dados), dados, auth.uid(),
          (select nome from public.membros where email = public.meu_email()))
  returning id into novo;
  return novo;
end $$;

create or replace function public.listar_anexos(p_bloqueio uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
begin
  if not public.pode_ver_bloqueio(p_bloqueio) then return '[]'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'tamanho', tamanho,
           'por_nome', por_nome, 'em', em, 'pode_excluir', p = 'moderador' or por = auth.uid()) order by em)
    from public.anexos where bloqueio_id = p_bloqueio), '[]');
end $$;

create or replace function public.baixar_anexo(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.anexos;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into a from public.anexos where id = p_id;
  if a.id is null or not public.pode_ver_bloqueio(a.bloqueio_id) then raise exception 'Anexo não encontrado.'; end if;
  return jsonb_build_object('nome', a.nome, 'tipo', a.tipo, 'base64', translate(encode(a.conteudo, 'base64'), E'\n', ''));
end $$;

create or replace function public.excluir_anexo(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte'); a public.anexos;
begin
  select * into a from public.anexos where id = p_id;
  if a.id is null then raise exception 'Anexo não encontrado.'; end if;
  if p <> 'moderador' and a.por is distinct from auth.uid() then
    raise exception 'Só quem anexou (ou um moderador) pode excluir.' using errcode = '42501';
  end if;
  delete from public.anexos where id = a.id;
end $$;

-- json do bloqueio passa a dizer quantos anexos tem
create or replace function public.json_bloqueio(b public.bloqueios)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and public.meu_papel_bloq() is null then null else jsonb_build_object(
    'id', b.id, 'id_app', b.id_app, 'nome', b.nome_entregador, 'cidade', b.cidade,
    'infracao_id', b.infracao_id, 'infracao', b.infracao, 'ocorrencia', b.ocorrencia, 'ocorrencia_total', b.ocorrencia_total,
    'horas', b.horas, 'inicio', b.inicio, 'fim', b.fim, 'situacao', public.situacao_bloqueio(b),
    'liberado_em', b.liberado_em, 'liberado_por_nome', case when b.liberado_por is not null then public.nome_de(b.liberado_por) end,
    'motivo_liberacao', b.motivo_liberacao,
    'registrado_por', b.registrado_por, 'registrado_por_nome', b.registrado_por_nome,
    'observacao', b.observacao, 'importado', b.importado, 'revisar', b.revisar,
    'leve', b.leve, 'dados_pendentes', b.dados_pendentes, 'gerou_bloqueio', b.gerou_bloqueio,
    'corrigido', exists (select 1 from public.eventos_bloqueio e where e.bloqueio_id = b.id and e.tipo = 'corrigido'),
    'anexos', (select count(*) from public.anexos a where a.bloqueio_id = b.id),
    'tarefa', (select public.json_tarefa(t) from public.tarefas t where t.bloqueio_id = b.id)) end
$$;

-- ---------------------------------------------------------------------
-- RLS e permissões (o conteúdo dos anexos só sai por baixar_anexo)
-- ---------------------------------------------------------------------
alter table public.anexos enable row level security;
drop policy if exists anexos_leitura on public.anexos;   -- sem política: ninguém lê a tabela direto

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- internas: só rodam dentro de outras funções (ou no SQL Editor)
revoke execute on function public.importar_bloqueio(text, text, text, text, timestamptz, text, text, text) from authenticated;
revoke execute on function public.inserir_bloqueio(text, text, text, smallint, timestamptz, uuid, text, text, boolean, text, boolean, numeric, boolean, text) from authenticated;
revoke execute on function public.notificar(uuid, text, text) from authenticated;
revoke execute on function public.dados_conhecidos(text) from authenticated;
revoke execute on function public.leves_acumuladas(text, timestamptz) from authenticated;
revoke execute on function public.calcular_ocorrencia(text, smallint, timestamptz) from authenticated;
revoke execute on function public.responsavel_da_cidade(text) from authenticated;
revoke execute on function public.nome_por_email(text) from authenticated;
revoke execute on function public.comentarios_de(text, integer) from authenticated;
revoke execute on function public.anotar_entregador(text, text, text, uuid) from authenticated;
revoke execute on function public.bloqueio_cria_entregador() from authenticated;
revoke execute on function public.json_tarefa(public.tarefas) from authenticated;
revoke execute on function public.json_atividade(public.atividades) from authenticated;
revoke execute on function public.atividade_aberta_para_mim(public.atividades) from authenticated;
revoke execute on function public.ativacao_ao_bloqueio(text) from authenticated;
revoke execute on function public.pode_ver_bloqueio(uuid) from authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke select on public.anexos from authenticated;
