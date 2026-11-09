-- =====================================================================
-- 009d (parte 3): painel das tarefas, metas pessoais (em teste), placar,
-- tarefas recorrentes e revisão de qualidade por amostragem.
--
-- * painel_tarefas(p_dias): o agora (sem dono, em andamento, aguardando,
--   atrasadas), por tipo e por cidade (no prazo, tempos) e o mapa dia × hora.
--   Moderador vê a equipe e a carga por pessoa; os outros veem os mesmos
--   números da equipe só no agregado e a própria linha ("cada um vê os
--   próprios números como a liderança vê").
-- * metas: só pessoais, cada um cria as suas (tipo de tarefa ou qualquer uma,
--   quantidade por dia ou por semana de terça a segunda). Progresso automático
--   pelas tarefas concluídas por quem pegou. Em teste.
-- * placar_equipe(p_dias): só o administrador final vê (pedido do usuário).
-- * tarefas_recorrentes: modelo (tipo, campos, checklist, para quem) que gera
--   a tarefa sozinho todo dia, toda semana ou todo mês, na hora marcada
--   (horário de Brasília). Sem cron: gerar_recorrentes() roda quando alguém
--   usa o app (o front chama a cada 5 min).
-- * revisões de qualidade: o moderador pede uma amostra de tarefas concluídas
--   (de outras pessoas, sem revisão) e marca "ok" ou "ajustar" com um
--   comentário; quem fez recebe o retorno.
-- Pode rodar mais de uma vez. Rodar depois da 009d2.
-- =====================================================================

create or replace function public.no_prazo(a public.atividades)
returns boolean language sql stable as $$
  select a.status = 'concluida' and (a.prazo is null or a.concluida_em <= a.prazo)
$$;

-- ---------------------------------------------------------------------
-- Painel
-- ---------------------------------------------------------------------
create or replace function public.painel_tarefas(p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ini timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
  mod boolean;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  mod := public.sou_moderador();
  return jsonb_build_object(
    'equipe', mod,
    'agora', (select jsonb_build_object(
        'sem_dono', count(*) filter (where status = 'aberta' and not opcional),
        'em_andamento', count(*) filter (where status = 'aceita' and aguardando_desde is null),
        'aguardando', count(*) filter (where status = 'aceita' and aguardando_desde is not null),
        'atrasadas', count(*) filter (where status <> 'concluida' and aguardando_desde is null and prazo < now() and not opcional))
      from public.atividades),
    'periodo', (select jsonb_build_object(
        'criadas', count(*) filter (where criada_em >= ini and modo = 'solicitacao'),
        'registros', count(*) filter (where criada_em >= ini and modo = 'registro'),
        'concluidas', count(*) filter (where status = 'concluida' and concluida_em >= ini),
        'no_prazo', round(100.0 * count(*) filter (where concluida_em >= ini and public.no_prazo(a) and modo = 'solicitacao')
                    / nullif(count(*) filter (where status = 'concluida' and concluida_em >= ini and modo = 'solicitacao'), 0)),
        'espera_min', round(avg(extract(epoch from aceita_em - criada_em) / 60) filter (where aceita_em >= ini and modo = 'solicitacao')),
        'execucao_min', round(avg(public.segundos_execucao(a) / 60.0) filter (where status = 'concluida' and concluida_em >= ini and modo = 'solicitacao')))
      from public.atividades a),
    'por_tipo', coalesce((select jsonb_agg(x order by x->>'nome') from (
        select jsonb_build_object('tipo', t.tipo, 'nome', t.nome, 'icone', t.icone, 'prazo_horas', t.prazo_horas,
          'abertas', count(a.id) filter (where a.status <> 'concluida'),
          'concluidas', count(a.id) filter (where a.status = 'concluida' and a.concluida_em >= ini),
          'no_prazo', round(100.0 * count(a.id) filter (where a.concluida_em >= ini and public.no_prazo(a) and a.modo = 'solicitacao')
                      / nullif(count(a.id) filter (where a.status = 'concluida' and a.concluida_em >= ini and a.modo = 'solicitacao'), 0)),
          'execucao_min', round(avg(public.segundos_execucao(a) / 60.0) filter (where a.status = 'concluida' and a.concluida_em >= ini and a.modo = 'solicitacao'))) x
          from public.tipos_tarefa t left join public.atividades a on coalesce(a.tipo, 'livre') = t.tipo
         group by t.tipo, t.nome, t.icone, t.prazo_horas
        having count(a.id) filter (where a.status <> 'concluida' or a.concluida_em >= ini) > 0) s), '[]'),
    'por_cidade', coalesce((select jsonb_agg(jsonb_build_object('cidade', cidade, 'abertas', abertas, 'concluidas', concluidas, 'no_prazo', no_prazo) order by concluidas desc, cidade)
      from (select a.cidade, count(*) filter (where a.status <> 'concluida') abertas,
                   count(*) filter (where a.status = 'concluida' and a.concluida_em >= ini) concluidas,
                   round(100.0 * count(*) filter (where a.concluida_em >= ini and public.no_prazo(a) and a.modo = 'solicitacao')
                     / nullif(count(*) filter (where a.status = 'concluida' and a.concluida_em >= ini and a.modo = 'solicitacao'), 0)) no_prazo
              from public.atividades a where a.cidade is not null and (a.status <> 'concluida' or a.concluida_em >= ini)
             group by a.cidade) c), '[]'),
    -- dia da semana (0 = domingo) × hora, pelas tarefas criadas (Brasília)
    'dia_hora', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'hora', h, 'qtd', n))
      from (select extract(dow from criada_em at time zone 'America/Sao_Paulo')::int d, extract(hour from criada_em at time zone 'America/Sao_Paulo')::int h, count(*) n
              from public.atividades where criada_em >= ini group by 1, 2) z), '[]'),
    -- carga por pessoa: moderador vê todos; os outros, só a própria linha
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'nome', m.nome, 'eu', m.user_id = auth.uid(),
        'com_ela', (select count(*) from public.atividades a where a.status = 'aceita' and a.aceita_por = m.user_id),
        'atrasadas', (select count(*) from public.atividades a where a.status = 'aceita' and a.aceita_por = m.user_id and a.aguardando_desde is null and a.prazo < now()),
        'concluidas', (select count(*) from public.atividades a where a.status = 'concluida' and a.aceita_por = m.user_id and a.concluida_em >= ini),
        'registros', (select count(*) from public.atividades a where a.modo = 'registro' and a.criada_por = m.user_id and a.criada_em >= ini),
        'no_prazo', (select round(100.0 * count(*) filter (where public.no_prazo(a)) / nullif(count(*), 0)) from public.atividades a
                      where a.status = 'concluida' and a.aceita_por = m.user_id and a.concluida_em >= ini and a.modo = 'solicitacao'),
        'agradecimentos', (select count(*) from public.agradecimentos g where g.para = m.user_id and g.em >= ini)) order by m.nome)
      from public.membros m where m.user_id is not null and m.papel is not null and (mod or m.user_id = auth.uid())), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Metas pessoais (em teste)
-- ---------------------------------------------------------------------
create table if not exists public.metas (
  id          bigint generated always as identity primary key,
  para        uuid not null,
  tipo        text references public.tipos_tarefa (tipo) on delete cascade,   -- nulo = qualquer tarefa
  quantidade  int not null check (quantidade between 1 and 500),
  periodo     text not null check (periodo in ('dia', 'semana')),
  criada_em   timestamptz not null default now()
);
create index if not exists metas_para on public.metas (para);
alter table public.metas enable row level security;
revoke all on public.metas from anon, authenticated;

create or replace function public.minhas_metas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := public.hoje_brasilia();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'tipo_nome', coalesce(t.nome, 'Qualquer tarefa'), 'icone', coalesce(t.icone, '🎯'),
      'quantidade', x.quantidade, 'periodo', x.periodo,
      'desde', case x.periodo when 'dia' then hoje else public.inicio_semana(hoje) end,
      'feitas', (select count(*) from public.atividades a
                  where a.status = 'concluida' and a.aceita_por = auth.uid() and (x.tipo is null or coalesce(a.tipo, 'livre') = x.tipo)
                    and (a.concluida_em at time zone 'America/Sao_Paulo')::date >= case x.periodo when 'dia' then hoje else public.inicio_semana(hoje) end))
      order by x.id)
    from public.metas x left join public.tipos_tarefa t on t.tipo = x.tipo where x.para = auth.uid()), '[]');
end $$;

create or replace function public.salvar_meta(p_tipo text, p_quantidade int, p_periodo text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_tipo is not null and not exists (select 1 from public.tipos_tarefa where tipo = p_tipo) then raise exception 'Tipo de tarefa desconhecido.'; end if;
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 500 then raise exception 'A meta vai de 1 a 500.'; end if;
  if coalesce(p_periodo, '') not in ('dia', 'semana') then raise exception 'Escolha por dia ou por semana.'; end if;
  if (select count(*) from public.metas where para = auth.uid()) >= 10 then raise exception 'Você já tem 10 metas. Apague uma antes.'; end if;
  insert into public.metas (para, tipo, quantidade, periodo) values (auth.uid(), p_tipo, p_quantidade, p_periodo);
  return public.minhas_metas();
end $$;

create or replace function public.excluir_meta(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  delete from public.metas where id = p_id and para = auth.uid();
  return public.minhas_metas();
end $$;

-- ---------------------------------------------------------------------
-- Placar (só o administrador final)
-- ---------------------------------------------------------------------
create or replace function public.placar_equipe(p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ini timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
begin
  perform public.exigir_papel('moderador');
  if not exists (select 1 from public.membros where user_id = auth.uid() and admin_final) then
    raise exception 'O placar é só do administrador.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(x order by (x->>'pontos')::numeric desc, x->>'nome') from (
    select jsonb_build_object('nome', m.nome,
      'pegou', p.pegou, 'concluidas', p.concluidas, 'registros', p.registros, 'no_prazo', p.no_prazo,
      'pegar_min', p.pegar_min, 'agradecimentos', p.agr, 'ajudas', p.ajudas, 'revisoes_ok', p.rev_ok, 'revisoes_ajustar', p.rev_aj,
      -- pontuação simples, só para ordenar: concluída 3, registro 1, no prazo +1, agradecimento 1, ajuda 2
      'pontos', 3 * p.concluidas + p.registros + p.no_prazo_n + p.agr + 2 * p.ajudas) x
      from public.membros m
      cross join lateral (select
          (select count(*) from public.atividades a where a.aceita_por = m.user_id and a.aceita_em >= ini and a.modo = 'solicitacao') pegou,
          (select count(*) from public.atividades a where a.aceita_por = m.user_id and a.status = 'concluida' and a.concluida_em >= ini and a.modo = 'solicitacao') concluidas,
          (select count(*) from public.atividades a where a.criada_por = m.user_id and a.modo = 'registro' and a.criada_em >= ini) registros,
          (select count(*) from public.atividades a where a.aceita_por = m.user_id and a.concluida_em >= ini and a.modo = 'solicitacao' and public.no_prazo(a)) no_prazo_n,
          (select round(100.0 * count(*) filter (where public.no_prazo(a)) / nullif(count(*), 0)) from public.atividades a
            where a.aceita_por = m.user_id and a.status = 'concluida' and a.concluida_em >= ini and a.modo = 'solicitacao') no_prazo,
          (select round(avg(extract(epoch from a.aceita_em - a.criada_em) / 60)) from public.atividades a
            where a.aceita_por = m.user_id and a.aceita_em >= ini and a.modo = 'solicitacao' and a.criada_por <> m.user_id) pegar_min,
          (select count(*) from public.agradecimentos g where g.para = m.user_id and g.em >= ini) agr,
          (select count(*) from public.avisos_rapidos r where r.tipo = 'ajuda' and r.aceito_por = m.user_id and r.aceito_em >= ini) ajudas,
          (select count(*) from public.revisoes_qualidade v join public.atividades a on a.id = v.atividade_id where a.aceita_por = m.user_id and v.em >= ini and v.resultado = 'ok') rev_ok,
          (select count(*) from public.revisoes_qualidade v join public.atividades a on a.id = v.atividade_id where a.aceita_por = m.user_id and v.em >= ini and v.resultado = 'ajustar') rev_aj) p
     where m.user_id is not null and m.papel is not null) s), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Tarefas recorrentes
-- ---------------------------------------------------------------------
create table if not exists public.tarefas_recorrentes (
  id               bigint generated always as identity primary key,
  tipo             text not null references public.tipos_tarefa (tipo),
  campos           jsonb not null default '{}',
  titulo           text check (length(titulo) <= 150),
  descricao        text check (length(descricao) <= 1500),
  para             uuid[] not null default '{}',
  checklist        text[] not null default '{}',
  frequencia       text not null check (frequencia in ('diaria', 'semanal', 'mensal')),
  dia_semana       int check (dia_semana between 0 and 6),     -- 0 = domingo (semanal)
  dia_mes          int check (dia_mes between 1 and 31),       -- mensal (meses curtos: último dia)
  hora             int not null default 8 check (hora between 0 and 23),
  ativa            boolean not null default true,
  criada_por       uuid not null,
  criada_por_nome  text,
  criada_em        timestamptz not null default now(),
  ultima_em        timestamptz,                                -- o horário da última vez que gerou
  check (frequencia <> 'semanal' or dia_semana is not null),
  check (frequencia <> 'mensal' or dia_mes is not null)
);
alter table public.atividades add column if not exists recorrente_id bigint references public.tarefas_recorrentes (id) on delete set null;
alter table public.tarefas_recorrentes enable row level security;
revoke all on public.tarefas_recorrentes from anon, authenticated;

-- o último horário marcado que já passou (em Brasília)
create or replace function public.ultimo_horario_recorrente(r public.tarefas_recorrentes)
returns timestamptz language plpgsql stable as $$
declare
  hoje date := public.hoje_brasilia();
  d date;
  t timestamptz;
begin
  if r.frequencia = 'diaria' then d := hoje;
  elsif r.frequencia = 'semanal' then d := hoje - ((extract(dow from hoje)::int - r.dia_semana + 7) % 7);
  else d := make_date(extract(year from hoje)::int, extract(month from hoje)::int, 1)
            + (least(r.dia_mes, extract(day from (date_trunc('month', hoje) + interval '1 month - 1 day'))::int) - 1);
  end if;
  t := (d + make_time(r.hora, 0, 0)) at time zone 'America/Sao_Paulo';
  if t > now() then
    if r.frequencia = 'diaria' then d := d - 1;
    elsif r.frequencia = 'semanal' then d := d - 7;
    else
      d := (date_trunc('month', d) - interval '1 month')::date;
      d := d + (least(r.dia_mes, extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int) - 1);
    end if;
    t := (d + make_time(r.hora, 0, 0)) at time zone 'America/Sao_Paulo';
  end if;
  return t;
end $$;

create or replace function public.recorrente_json(r public.tarefas_recorrentes)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(r) - 'criada_por' || jsonb_build_object(
    'tipo_nome', t.nome, 'icone', t.icone, 'titulo_exemplo', public.titulo_tarefa(r.tipo, r.campos, r.titulo),
    'para_nomes', coalesce((select jsonb_agg(m.nome order by m.nome) from public.membros m where m.user_id = any (r.para)), '[]'),
    'meu', r.criada_por = auth.uid(), 'pode_mexer', r.criada_por = auth.uid() or public.meu_papel() = 'moderador')
  from public.tipos_tarefa t where t.tipo = r.tipo
$$;

create or replace function public.salvar_recorrente(p_id bigint, p_tipo text, p_campos jsonb, p_titulo text, p_descricao text, p_para uuid[],
  p_checklist text[], p_frequencia text, p_dia_semana int, p_dia_mes int, p_hora int, p_ativa boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tarefas_recorrentes; c jsonb; v_para uuid[]; lista text[];
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if not exists (select 1 from public.tipos_tarefa where tipo = p_tipo) then raise exception 'Tipo de tarefa desconhecido.'; end if;
  c := public.validar_campos_tarefa(p_tipo, p_campos);
  if coalesce(public.titulo_tarefa(p_tipo, c, p_titulo), '') = '' then raise exception 'Escreva o que precisa ser feito.'; end if;
  if coalesce(p_frequencia, '') not in ('diaria', 'semanal', 'mensal') then raise exception 'Escolha de quanto em quanto tempo.'; end if;
  if p_frequencia = 'semanal' and (p_dia_semana is null or p_dia_semana not between 0 and 6) then raise exception 'Escolha o dia da semana.'; end if;
  if p_frequencia = 'mensal' and (p_dia_mes is null or p_dia_mes not between 1 and 31) then raise exception 'Escolha o dia do mês.'; end if;
  if p_hora is null or p_hora not between 0 and 23 then raise exception 'Escolha a hora.'; end if;
  select coalesce(array_agg(distinct m.user_id), '{}') into v_para from public.membros m where m.user_id = any (coalesce(p_para, '{}'));
  select coalesce(array_agg(left(btrim(x), 200)), '{}') into lista from unnest(coalesce(p_checklist, '{}')) x where btrim(x) <> '';
  if cardinality(lista) > 30 then raise exception 'O checklist vai até 30 itens.'; end if;
  if p_id is null then
    insert into public.tarefas_recorrentes (tipo, campos, titulo, descricao, para, checklist, frequencia, dia_semana, dia_mes, hora, ativa, criada_por, criada_por_nome)
    values (p_tipo, c, nullif(btrim(coalesce(p_titulo, '')), ''), nullif(btrim(coalesce(p_descricao, '')), ''), v_para, lista, p_frequencia,
            case when p_frequencia = 'semanal' then p_dia_semana end, case when p_frequencia = 'mensal' then p_dia_mes end, p_hora,
            coalesce(p_ativa, true), auth.uid(), public.nome_de(auth.uid()))
    returning * into r;
    -- não gera a de agora na hora: começa a contar a partir do próximo horário
    update public.tarefas_recorrentes set ultima_em = public.ultimo_horario_recorrente(r) where id = r.id returning * into r;
  else
    select * into r from public.tarefas_recorrentes where id = p_id for update;
    if r.id is null then raise exception 'Tarefa recorrente não encontrada.'; end if;
    if r.criada_por <> auth.uid() and public.meu_papel() <> 'moderador' then raise exception 'Só quem criou ou um moderador muda.' using errcode = '42501'; end if;
    update public.tarefas_recorrentes set tipo = p_tipo, campos = c, titulo = nullif(btrim(coalesce(p_titulo, '')), ''), descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
           para = v_para, checklist = lista, frequencia = p_frequencia,
           dia_semana = case when p_frequencia = 'semanal' then p_dia_semana end, dia_mes = case when p_frequencia = 'mensal' then p_dia_mes end,
           hora = p_hora, ativa = coalesce(p_ativa, true)
     where id = r.id returning * into r;
    update public.tarefas_recorrentes set ultima_em = greatest(ultima_em, public.ultimo_horario_recorrente(r)) where id = r.id returning * into r;
  end if;
  return public.recorrente_json(r);
end $$;

create or replace function public.excluir_recorrente(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r public.tarefas_recorrentes;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into r from public.tarefas_recorrentes where id = p_id;
  if r.id is null then raise exception 'Tarefa recorrente não encontrada.'; end if;
  if r.criada_por <> auth.uid() and public.meu_papel() <> 'moderador' then raise exception 'Só quem criou ou um moderador apaga.' using errcode = '42501'; end if;
  delete from public.tarefas_recorrentes where id = r.id;
end $$;

create or replace function public.listar_recorrentes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(public.recorrente_json(r) order by r.ativa desc, r.id) from public.tarefas_recorrentes r), '[]');
end $$;

-- gera as que já passaram do horário (uma por modelo, a mais recente)
create or replace function public.gerar_recorrentes()
returns int language plpgsql security definer set search_path = public as $$
declare r public.tarefas_recorrentes; quando timestamptz; tt public.tipos_tarefa; n int := 0; c jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  for r in select * from public.tarefas_recorrentes where ativa for update skip locked loop
    quando := public.ultimo_horario_recorrente(r);
    if r.ultima_em is not null and r.ultima_em >= quando then continue; end if;
    select * into tt from public.tipos_tarefa where tipo = r.tipo;
    c := r.campos;
    insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, tipo, campos, cidade, modo, meta, checklist, recorrente_id)
    values (public.titulo_tarefa(r.tipo, c, r.titulo), r.descricao, r.criada_por, coalesce(r.criada_por_nome, 'Recorrente'), r.para,
            case when tt.prazo_horas is not null then now() + tt.prazo_horas * interval '1 hour' end,
            r.tipo, c, coalesce(c->>'cidade', (select e.cidade from public.entregadores e where e.id_app = c->>'id_app')), 'solicitacao',
            (c->>'quantidade')::int,
            coalesce((select jsonb_agg(jsonb_build_object('texto', x, 'feito', false)) from unnest(r.checklist) x), '[]'), r.id);
    insert into public.notificacoes (para, texto, link)
    select x, format('Tarefa recorrente para você: %s', public.titulo_tarefa(r.tipo, c, r.titulo)), '#atividades/sugeridas' from unnest(r.para) x;
    update public.tarefas_recorrentes set ultima_em = quando where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Revisão de qualidade por amostragem (moderadores)
-- ---------------------------------------------------------------------
create table if not exists public.revisoes_qualidade (
  id           bigint generated always as identity primary key,
  atividade_id uuid not null unique references public.atividades (id) on delete cascade,
  por          uuid not null,
  por_nome     text,
  resultado    text not null check (resultado in ('ok', 'ajustar')),
  comentario   text check (length(comentario) <= 600),
  em           timestamptz not null default now()
);
alter table public.revisoes_qualidade enable row level security;
revoke all on public.revisoes_qualidade from anon, authenticated;

-- amostra: concluídas nos últimos 14 dias, por outra pessoa, ainda sem revisão (sorteadas)
create or replace function public.amostra_revisao(p_qtd int default 5)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if not public.sou_moderador() then raise exception 'A revisão de qualidade é dos moderadores.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(public.json_atividade(a)) from (
    select * from public.atividades x
     where x.status = 'concluida' and x.concluida_em > now() - interval '14 days' and x.aceita_por is distinct from auth.uid()
       and not exists (select 1 from public.revisoes_qualidade v where v.atividade_id = x.id)
     order by random() limit greatest(1, least(coalesce(p_qtd, 5), 20))) a), '[]');
end $$;

create or replace function public.revisar_qualidade(p_id uuid, p_resultado text, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if not public.sou_moderador() then raise exception 'A revisão de qualidade é dos moderadores.' using errcode = '42501'; end if;
  if coalesce(p_resultado, '') not in ('ok', 'ajustar') then raise exception 'Escolha: está ok ou precisa ajustar.'; end if;
  if p_resultado = 'ajustar' and nullif(btrim(coalesce(p_comentario, '')), '') is null then raise exception 'Diga o que precisa ajustar.'; end if;
  select * into a from public.atividades where id = p_id;
  if a.id is null or a.status <> 'concluida' then raise exception 'Só tarefas concluídas são revisadas.'; end if;
  if a.aceita_por = auth.uid() then raise exception 'Você não revisa a sua própria tarefa.'; end if;
  insert into public.revisoes_qualidade (atividade_id, por, por_nome, resultado, comentario)
  values (a.id, auth.uid(), quem, p_resultado, nullif(btrim(coalesce(p_comentario, '')), ''))
  on conflict (atividade_id) do update set por = excluded.por, por_nome = excluded.por_nome, resultado = excluded.resultado,
         comentario = excluded.comentario, em = now();
  if a.aceita_por is not null then
    perform public.notificar(a.aceita_por, case when p_resultado = 'ok'
      then format('✅ %s revisou "%s": tudo certo.', quem, a.titulo)
      else format('✏️ %s revisou "%s" e pediu um ajuste: %s', quem, a.titulo, btrim(p_comentario)) end, '#atividades/sugeridas');
  end if;
end $$;

-- json da tarefa ganha a revisão (quem fez e os moderadores veem)
do $$
declare def text;
begin
  def := pg_get_functiondef('public.json_atividade(public.atividades)'::regprocedure);
  if position('''revisao''' in def) = 0 then
    def := replace(def, '''pode_excluir'', a.criada_por = auth.uid() or public.meu_papel() = ''moderador'')',
      '''pode_excluir'', a.criada_por = auth.uid() or public.meu_papel() = ''moderador'',
    ''recorrente'', a.recorrente_id is not null,
    ''revisao'', (select jsonb_build_object(''resultado'', v.resultado, ''comentario'', v.comentario, ''por_nome'', v.por_nome, ''em'', v.em)
                  from public.revisoes_qualidade v where v.atividade_id = a.id and (a.aceita_por = auth.uid() or public.sou_moderador())))');
    if position('''revisao''' in def) = 0 then raise exception 'Não consegui incluir a revisão no json_atividade.'; end if;
    execute def;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Permissões e tráfego
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['metas', 'tarefas_recorrentes', 'revisoes_qualidade'] loop
    if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = t and g.tgname = 'marcar_mudanca_ins') then
      execute format('create trigger marcar_mudanca_ins after insert on public.%I referencing new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_upd after update on public.%I referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_del after delete on public.%I referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas()', t);
    end if;
  end loop;
end $$;

revoke all on function public.no_prazo(public.atividades) from public, anon, authenticated;
revoke all on function public.ultimo_horario_recorrente(public.tarefas_recorrentes) from public, anon, authenticated;
revoke all on function public.recorrente_json(public.tarefas_recorrentes) from public, anon, authenticated;
revoke all on function public.json_atividade(public.atividades) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.painel_tarefas(int)', 'public.minhas_metas()', 'public.salvar_meta(text, int, text)', 'public.excluir_meta(bigint)',
                           'public.placar_equipe(int)',
                           'public.salvar_recorrente(bigint, text, jsonb, text, text, uuid[], text[], text, int, int, int, boolean)',
                           'public.excluir_recorrente(bigint)', 'public.listar_recorrentes()', 'public.gerar_recorrentes()',
                           'public.amostra_revisao(int)', 'public.revisar_qualidade(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
