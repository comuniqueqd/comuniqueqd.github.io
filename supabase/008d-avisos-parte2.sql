-- =====================================================================
-- 008d · "Espião ou fofoqueiro? Virou rede social?" · parte 2: fecha a 008
-- Para quem já rodou o 008c-analises.sql. Não apaga nada e pode rodar mais de uma vez.
--
-- 1. Seguir cidade e "de olho nele" (seguir entregador): cada pessoa escolhe o que acompanhar.
-- 2. Preferências: silenciar tipos de aviso (o que é tarefa ou decisão da pessoa não se silencia,
--    e o "de olho nele" também não: foi a pessoa que pediu).
-- 3. Infrações leves agrupadas num aviso só por cidade e dia, que vai atualizando.
-- 4. Aviso de previsão vencida para quem deu a previsão.
-- 5. Resumo do dia no sino ("o que rolou hoje").
-- 6. O suporte também abre a lista "Revisar registros da planilha".
-- =====================================================================

-- ---------------------------------------------------------------------
-- O que cada pessoa acompanha e o que silenciou
-- ---------------------------------------------------------------------
create table if not exists public.seguindo (
  para      uuid not null,
  tipo      text not null check (tipo in ('cidade', 'entregador')),
  alvo      text not null,                -- nome da cidade ou id_app em minúsculas
  criado_em timestamptz not null default now(),
  primary key (para, tipo, alvo)
);
create index if not exists seguindo_alvo on public.seguindo (tipo, alvo);
alter table public.seguindo enable row level security;
drop policy if exists seguindo_leitura on public.seguindo;
create policy seguindo_leitura on public.seguindo for select to authenticated using (para = (select auth.uid()));

create table if not exists public.preferencias_aviso (
  para        uuid primary key,
  silenciados text[] not null default '{}',   -- ativacao | bloqueios | leves | comentarios | cidades
  atualizado_em timestamptz not null default now()
);
alter table public.preferencias_aviso enable row level security;
drop policy if exists preferencias_aviso_leitura on public.preferencias_aviso;
create policy preferencias_aviso_leitura on public.preferencias_aviso for select to authenticated using (para = (select auth.uid()));

-- aviso que vai atualizando (leves do dia por cidade): uma chave e quantos já somou
alter table public.notificacoes add column if not exists chave    text;
alter table public.notificacoes add column if not exists contagem integer;
create index if not exists notificacoes_chave on public.notificacoes (para, chave) where chave is not null;

do $$ begin
  -- o motivo agora também pode ser "seguindo" (cidade que a pessoa segue) e "de_olho" (entregador)
  if exists (select 1 from pg_constraint where conname = 'notificacoes_motivo_check') then
    alter table public.notificacoes drop constraint notificacoes_motivo_check;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Quem recebe cada aviso de Registros (substitui a versão da 008b)
-- Ordem do motivo: de olho nele > responsável da cidade > segue a cidade > moderador.
-- Silenciar vale para tudo, menos o "de olho nele". Leves: um aviso por cidade por dia,
-- que vai somando (o "de olho nele" continua recebendo cada leve, uma por uma).
-- ---------------------------------------------------------------------
drop function if exists public.avisar_registro(text, text, text, text, text, boolean);
create or replace function public.avisar_registro(
  p_categoria text, p_texto text, p_link text, p_cidade text, p_id_app text, p_bq boolean, p_leve boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  resp  text;
  v_id  text := lower(p_id_app);
  cat   text := case when p_leve then 'leves' else p_categoria end;
  hoje  text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  chv   text := 'leves:' || coalesce(p_cidade, '-') || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  r     record;
  n     integer;
begin
  if auth.uid() is null or nullif(btrim(coalesce(p_texto, '')), '') is null then return; end if;
  resp := case when p_cidade is not null then public.responsavel_cidade_email(p_cidade) end;
  for r in
    select x.user_id, x.motivo from (
      select m.user_id,
             case when v_id is not null and exists (select 1 from public.seguindo s where s.para = m.user_id and s.tipo = 'entregador' and s.alvo = v_id) then 'de_olho'
                  when resp is not null and m.email = resp then 'cidade'
                  when p_cidade is not null and exists (select 1 from public.seguindo s where s.para = m.user_id and s.tipo = 'cidade' and s.alvo = p_cidade) then 'seguindo'
                  when m.papel = 'moderador' or m.papel_bloqueios = 'moderador' then 'moderador' end motivo
        from public.membros m
       where m.user_id is not null and m.user_id <> auth.uid()
         and (not p_bq or m.papel_bloqueios is not null)) x
     where x.motivo is not null
       and (x.motivo = 'de_olho' or not exists (select 1 from public.preferencias_aviso p where p.para = x.user_id and cat = any (p.silenciados)))
       -- um aviso por pessoa por ação (a mesma transação pode gerar vários registros)
       and not exists (select 1 from public.notificacoes k where k.para = x.user_id and k.criada_em = now())
  loop
    if p_leve and r.motivo <> 'de_olho' then
      -- leves agrupadas: tira o aviso do dia (se houver) e põe um novo no topo, somando
      select coalesce(max(contagem), 0) into n from public.notificacoes where para = r.user_id and chave = chv;
      delete from public.notificacoes where para = r.user_id and chave = chv;
      insert into public.notificacoes (para, texto, link, categoria, cidade, motivo, chave, contagem)
      values (r.user_id, left(format('%s %s %s hoje. A última: %s', n + 1,
                case when n + 1 = 1 then 'infração leve nova' else 'infrações leves novas' end,
                coalesce('em ' || p_cidade, 'sem cidade'), p_texto), 500),
              '#bloqueios/historico', 'leves', p_cidade, r.motivo, chv, n + 1);
    else
      insert into public.notificacoes (para, texto, link, categoria, cidade, id_app, motivo)
      values (r.user_id, left(p_texto, 500), p_link, cat, p_cidade, v_id, r.motivo);
    end if;
  end loop;
end $$;

-- os três gatilhos de Registros passam a usar a versão nova (o de bloqueios marca as leves)
create or replace function public.aviso_evento_ativacao()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.cadastros; quem text;
begin
  select * into c from public.cadastros where id = new.cadastro_id;
  if c.id is null then return null; end if;
  quem := coalesce(public.nome_de(new.por), 'Alguém');
  perform public.avisar_registro('ativacao',
    format('%s %s: %s%s', quem,
      case new.tipo when 'enviado' then 'enviou um cadastro' when 'aprovado' then 'aprovou o cadastro'
                    when 'reprovado' then 'reprovou o cadastro' when 'encerrado' then 'encerrou o cadastro'
                    when 'desfeito' then 'desfez a decisão do cadastro' when 'editado' then 'editou o cadastro'
                    when 'revisado' then 'conferiu os dados do cadastro' else new.tipo end,
      coalesce(c.nome, c.id_app, 'sem nome') || case when c.nome is not null and c.id_app is not null then ' (' || c.id_app || ')' else '' end,
      ' · ' || c.cidade || case when new.motivo is not null then ' · ' || new.motivo else '' end),
    '#cadastro/' || c.id, c.cidade, c.id_app, false, false);
  return null;
end $$;

create or replace function public.aviso_evento_bloqueio()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.bloqueios; quem text;
begin
  select * into b from public.bloqueios where id = new.bloqueio_id;
  if b.id is null then return null; end if;
  quem := coalesce(new.por_nome, public.nome_de(new.por), 'Alguém');
  perform public.avisar_registro('bloqueios',
    format('%s %s: %s (%s) · %s%s', quem,
      case new.tipo
        when 'registrado' then case when b.leve then 'registrou uma infração leve' else 'registrou um bloqueio' end
        when 'liberado_antes' then case when b.horas is null then 'reverteu o encerramento' else 'liberou antes do prazo' end
        when 'tratativa_concluida' then 'concluiu a tratativa'
        when 'corrigido' then 'corrigiu os dados do bloqueio' when 'revisado' then 'marcou o bloqueio como revisado'
        when 'realocada' then 'realocou a tratativa' else new.tipo end,
      case when b.dados_pendentes then 'sem nome' else b.nome_entregador end, b.id_app, b.infracao,
      case when b.cidade is not null then ' · ' || b.cidade else '' end),
    '#ficha/' || lower(b.id_app), b.cidade, b.id_app, true, b.leve and new.tipo = 'registrado');
  return null;
end $$;

create or replace function public.aviso_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.entregadores;
begin
  select * into e from public.entregadores where id_app = new.id_app;
  perform public.avisar_registro('comentarios',
    format('%s %s %s (%s): %s', coalesce(new.por_nome, 'Alguém'),
      case new.tipo when 'alteracao' then 'alterou a ficha de' else 'comentou sobre' end,
      coalesce(e.nome, 'entregador'), new.id_app,
      case when length(new.texto) > 140 then left(new.texto, 140) || '…' else new.texto end),
    '#ficha/' || new.id_app, e.cidade, new.id_app, true, false);
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Seguir e preferências (cada pessoa só mexe nas suas)
-- ---------------------------------------------------------------------
create or replace function public.minhas_preferencias()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'silenciados', coalesce((select to_jsonb(silenciados) from public.preferencias_aviso where para = auth.uid()), '[]'::jsonb),
    'seguindo', coalesce((select jsonb_agg(jsonb_build_object('tipo', s.tipo, 'alvo', s.alvo,
        'nome', case when s.tipo = 'entregador' then (select e.nome from public.entregadores e where e.id_app = s.alvo) end,
        'desde', s.criado_em) order by s.tipo, s.alvo)
      from public.seguindo s where s.para = auth.uid()), '[]'::jsonb),
    'cidades', coalesce((select jsonb_agg(c.nome order by c.nome) from public.cidades c where c.ativa), '[]'::jsonb));
end $$;

create or replace function public.salvar_preferencias(p_silenciados text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_silenciados, '{}')) x where x is not null), '{}');
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if exists (select 1 from unnest(v) x where x not in ('ativacao', 'bloqueios', 'leves', 'comentarios', 'cidades')) then
    raise exception 'Tipo de aviso desconhecido.';
  end if;
  insert into public.preferencias_aviso (para, silenciados) values (auth.uid(), v)
  on conflict (para) do update set silenciados = excluded.silenciados, atualizado_em = now();
  return public.minhas_preferencias();
end $$;

create or replace function public.seguir(p_tipo text, p_alvo text, p_seguir boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_tipo = 'cidade' then
    v := upper(regexp_replace(btrim(coalesce(p_alvo, '')), '\s+', ' ', 'g'));
    if p_seguir and not exists (select 1 from public.cidades where nome = v and ativa) then raise exception 'Escolha uma cidade da lista.'; end if;
  elsif p_tipo = 'entregador' then
    perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
    v := lower(regexp_replace(coalesce(p_alvo, ''), '[^A-Za-z0-9]', '', 'g'));
    if p_seguir and not exists (select 1 from public.entregadores where id_app = v)
       and not exists (select 1 from public.bloqueios where lower(id_app) = v) then
      raise exception 'Este ID não tem registros no sistema.';
    end if;
  else
    raise exception 'Tipo inválido.';
  end if;
  if p_seguir then
    insert into public.seguindo (para, tipo, alvo) values (auth.uid(), p_tipo, v) on conflict do nothing;
  else
    delete from public.seguindo where para = auth.uid() and tipo = p_tipo and alvo = v;
  end if;
  return public.minhas_preferencias();
end $$;

-- ---------------------------------------------------------------------
-- Previsão vencida: avisa quem deu a previsão (uma vez por previsão)
-- ---------------------------------------------------------------------
alter table public.cadastros  add column if not exists previsao_por uuid;
alter table public.cadastros  add column if not exists previsao_avisada_em timestamptz;
alter table public.tarefas    add column if not exists previsao_por uuid;
alter table public.tarefas    add column if not exists previsao_avisada_em timestamptz;
alter table public.atividades add column if not exists previsao_por uuid;
alter table public.atividades add column if not exists previsao_avisada_em timestamptz;

-- quem mexe na previsão vira o "dono" dela, e o aviso volta a valer para a nova data
create or replace function public.marcar_previsao_por()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.previsao is distinct from old.previsao then
    new.previsao_por := case when new.previsao is null then null else auth.uid() end;
    new.previsao_avisada_em := null;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['cadastros', 'tarefas', 'atividades'] loop
    execute format('drop trigger if exists marcar_previsao_por on public.%I', t);
    execute format('create trigger marcar_previsao_por before update of previsao on public.%I for each row execute function public.marcar_previsao_por()', t);
  end loop;
end $$;
-- previsões que já existiam: o dono é quem tem o nome gravado (se o nome for único na equipe)
update public.cadastros c set previsao_por = m.user_id from public.membros m
 where c.previsao is not null and c.previsao_por is null and m.nome = c.previsao_por_nome and m.user_id is not null
   and (select count(*) from public.membros x where x.nome = c.previsao_por_nome) = 1;
update public.tarefas c set previsao_por = m.user_id from public.membros m
 where c.previsao is not null and c.previsao_por is null and m.nome = c.previsao_por_nome and m.user_id is not null
   and (select count(*) from public.membros x where x.nome = c.previsao_por_nome) = 1;
update public.atividades c set previsao_por = m.user_id from public.membros m
 where c.previsao is not null and c.previsao_por is null and m.nome = c.previsao_por_nome and m.user_id is not null
   and (select count(*) from public.membros x where x.nome = c.previsao_por_nome) = 1;

-- O app chama isto a cada 5 min de uso: só olha as previsões de quem chamou (barato e sem cron).
create or replace function public.verificar_previsoes()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; k integer;
  quando text;
begin
  if public.meu_papel() is null then return 0; end if;
  with x as (
    update public.cadastros c set previsao_avisada_em = now()
     where c.previsao_por = auth.uid() and c.previsao < now() and c.previsao_avisada_em is null
       and c.status in ('aguardando_analise', 'aguardando_contato')
    returning c.id, c.nome, c.id_app, c.previsao)
  insert into public.notificacoes (para, texto, link)
  select auth.uid(), format('Passou a previsão que você deu para o cadastro %s (era %s). Decida ou atualize a previsão.',
           coalesce(x.nome, x.id_app, 'sem nome'), to_char(x.previsao at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
         '#cadastro/' || x.id from x;
  get diagnostics k = row_count; n := n + k;
  with x as (
    update public.tarefas t set previsao_avisada_em = now()
     where t.previsao_por = auth.uid() and t.previsao < now() and t.previsao_avisada_em is null and t.status = 'pendente'
    returning t.id, t.bloqueio_id, t.previsao)
  insert into public.notificacoes (para, texto, link)
  select auth.uid(), format('Passou a previsão que você deu para a tratativa de %s (era %s). Conclua ou atualize a previsão.',
           coalesce(b.nome_entregador, b.id_app), to_char(x.previsao at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
         '#bloqueios/tratativas'
    from x join public.bloqueios b on b.id = x.bloqueio_id;
  get diagnostics k = row_count; n := n + k;
  with x as (
    update public.atividades a set previsao_avisada_em = now()
     where a.previsao_por = auth.uid() and a.previsao < now() and a.previsao_avisada_em is null and a.status = 'aceita'
    returning a.titulo, a.previsao)
  insert into public.notificacoes (para, texto, link)
  select auth.uid(), format('Passou a previsão que você deu para a atividade "%s" (era %s). Conclua ou atualize a previsão.',
           x.titulo, to_char(x.previsao at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
         '#atividades/sugeridas' from x;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Resumo do dia no sino: o que rolou hoje (horário de Brasília), só totais
-- ---------------------------------------------------------------------
create or replace function public.resumo_do_dia()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hoje timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  bq   boolean := public.meu_papel_bloq() is not null;
  eu   uuid := auth.uid();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'cadastros', (select count(*) from public.cadastros where enviado_em >= hoje),
    'aprovados', (select count(*) from public.eventos where tipo = 'aprovado' and em >= hoje),
    'reprovados', (select count(*) from public.eventos where tipo in ('reprovado', 'encerrado') and em >= hoje),
    'bloqueios', case when bq then (select count(*) from public.bloqueios where not leve and not importado and inicio >= hoje) end,
    'leves', case when bq then (select count(*) from public.bloqueios where leve and not importado and inicio >= hoje) end,
    'tratativas', case when bq then (select count(*) from public.tarefas where status = 'concluida' and concluida_em >= hoje) end,
    'saem_hoje', case when bq then (select count(*) from public.bloqueios b where not b.leve and public.situacao_bloqueio(b) = 'bloqueado'
                                       and b.fim < hoje + interval '1 day') end,
    'comentarios', case when bq then (select count(*) from public.comentarios_entregador where tipo = 'comentario' and em >= hoje) end,
    'atividades', (select count(*) from public.atividades where status = 'concluida' and concluida_em >= hoje),
    'voce', (select count(*) from public.bloqueios where registrado_por = eu and inicio >= hoje)
            + (select count(*) from public.cadastros where enviado_por = eu and enviado_em >= hoje)
            + (select count(*) from public.eventos where por = eu and tipo in ('aprovado', 'reprovado', 'encerrado') and em >= hoje)
            + (select count(*) from public.tarefas where concluida_por = eu and concluida_em >= hoje));
end $$;

-- ---------------------------------------------------------------------
-- "Revisar registros da planilha" também para o suporte (o Histórico dele só mostra os próprios)
-- ---------------------------------------------------------------------
create or replace function public.bloqueios_para_revisar()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(public.json_bloqueio(b) order by b.inicio desc)
    from (select * from public.bloqueios where revisar is not null and not dados_pendentes order by inicio desc limit 300) b), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Histórico de bloqueios parecido com o da ativação: totais por situação (para os quadrinhos
-- clicáveis) e "só os que eu registrei". Os totais usam os mesmos filtros, menos a situação.
-- ---------------------------------------------------------------------
drop function if exists public.listar_bloqueios_pagina(integer, integer, text, text, text, smallint, text, text);
create or replace function public.listar_bloqueios_pagina(
  p_pagina integer default 1, p_por integer default 100, p_busca text default null, p_situacao text default null,
  p_cidade text default null, p_infracao smallint default null, p_quem text default null, p_tipo text default null,
  p_meus boolean default false)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  q   text := nullif(btrim(coalesce(p_busca, '')), '');
  por integer := least(greatest(coalesce(p_por, 100), 1), 5000);
  pg  integer := greatest(coalesce(p_pagina, 1), 1);
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return (with f0 as (
      select b.*, public.situacao_bloqueio(b) sit from public.bloqueios b
       where (q is null or concat_ws(' ', b.id_app, b.nome_entregador, b.cidade, b.infracao, b.registrado_por_nome) ilike '%' || q || '%')
         and (p_cidade is null or p_cidade = '' or b.cidade = p_cidade)
         and (p_infracao is null or b.infracao_id = p_infracao)
         and (p_quem is null or p_quem = '' or b.registrado_por_nome = p_quem)
         and (p_tipo is null or p_tipo = '' or (p_tipo = 'leve') = b.leve)
         and (not coalesce(p_meus, false) or b.registrado_por = auth.uid())),
    f as (
      select * from f0
       where (p_situacao is null or p_situacao = ''
              or (p_situacao = 'revisar' and revisar is not null)
              or (p_situacao = 'dados_pendentes' and dados_pendentes)
              or (p_situacao = 'tratativa_pendente' and exists (select 1 from public.tarefas t where t.bloqueio_id = f0.id and t.status = 'pendente'))
              or sit = p_situacao))
    select jsonb_build_object(
      'total', (select count(*) from f),
      'total_geral', (select count(*) from public.bloqueios),
      'pagina', pg, 'por', por,
      'contagens', (select jsonb_build_object(
          'todos', count(*), 'bloqueado', count(*) filter (where sit = 'bloqueado'),
          'liberado', count(*) filter (where sit = 'liberado'), 'liberado_antes', count(*) filter (where sit = 'liberado_antes'),
          'encerramento', count(*) filter (where sit = 'encerramento'), 'leves', count(*) filter (where leve),
          'revisar', count(*) filter (where revisar is not null),
          'tratativa_pendente', count(*) filter (where exists (select 1 from public.tarefas t where t.bloqueio_id = f0.id and t.status = 'pendente')))
        from f0),
      'itens', coalesce((select jsonb_agg(public.json_bloqueio(x) order by x.inicio desc)
                           from (select b.* from public.bloqueios b join (select id, inicio from f order by inicio desc offset (pg - 1) * por limit por) y on y.id = b.id) x), '[]'),
      'quem', coalesce((select jsonb_agg(distinct registrado_por_nome) from public.bloqueios), '[]'),
      'cidades', coalesce((select jsonb_agg(distinct cidade) from public.bloqueios where cidade is not null), '[]')));
end $$;

-- ---------------------------------------------------------------------
-- Permissões e tráfego
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['seguindo', 'preferencias_aviso'] loop
    if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = t and g.tgname = 'marcar_mudanca_ins') then
      execute format('create trigger marcar_mudanca_ins after insert on public.%I referencing new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_upd after update on public.%I referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_del after delete on public.%I referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas()', t);
    end if;
  end loop;
end $$;

revoke all on public.seguindo, public.preferencias_aviso from anon;
grant select on public.seguindo, public.preferencias_aviso to authenticated;
revoke insert, update, delete, truncate on public.seguindo, public.preferencias_aviso from authenticated;

revoke all on function public.avisar_registro(text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.marcar_previsao_por() from public, anon, authenticated;
revoke all on function public.aviso_evento_ativacao() from public, anon, authenticated;
revoke all on function public.aviso_evento_bloqueio() from public, anon, authenticated;
revoke all on function public.aviso_comentario() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.minhas_preferencias()', 'public.salvar_preferencias(text[])', 'public.seguir(text, text, boolean)',
                           'public.verificar_previsoes()', 'public.resumo_do_dia()', 'public.bloqueios_para_revisar()',
                           'public.listar_bloqueios_pagina(integer, integer, text, text, text, smallint, text, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- avisa a API do Supabase que há funções novas
notify pgrst, 'reload schema';
