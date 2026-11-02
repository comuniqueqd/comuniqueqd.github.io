-- =====================================================================
-- Cadastro de Entregadores: esquema do banco (Supabase / PostgreSQL)
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo
-- inteiro → Run.
--
-- ATENÇÃO: este arquivo recria as tabelas do zero e APAGA os dados
-- existentes. Use só na instalação. Mudanças futuras vão em arquivos
-- separados (migrações).
--
-- Visão geral
--   membros         quem pode usar o app e com qual papel
--   pedidos_acesso  quem tentou entrar sem permissão
--   motivos         listas de motivos de reprovação e de encerramento
--   cadastros       um registro por entregador (situação atual)
--   eventos         histórico de tudo o que aconteceu com cada cadastro
--
-- Segurança
--   O app nunca grava direto nas tabelas: toda gravação passa por uma
--   função (enviar_cadastro, decidir, ...) que confere o papel de quem
--   chamou. A leitura direta das tabelas (para análises) é limitada por
--   Row Level Security: o suporte só enxerga os próprios cadastros.
-- =====================================================================

drop table if exists public.eventos, public.cadastros, public.pedidos_acesso,
  public.membros, public.motivos cascade;
drop type if exists public.papel, public.status_cadastro cascade;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.papel as enum ('moderador', 'monitorador', 'suporte');

create type public.status_cadastro as enum (
  'aguardando_analise',   -- enviado, esperando moderador/monitorador
  'aguardando_contato',   -- reprovado: aguardando novo contato e documentação
  'aprovado',
  'encerrado'             -- definitivo (raro)
);

-- ---------------------------------------------------------------------
-- Validação de CPF (dígitos verificadores)
-- ---------------------------------------------------------------------
create or replace function public.cpf_valido(c text)
returns boolean language plpgsql immutable as $$
declare
  s int; t int; i int;
begin
  if c is null or c !~ '^[0-9]{11}$' or c ~ '^(.)\1{10}$' then
    return false;
  end if;
  for t in 9..10 loop
    s := 0;
    for i in 1..t loop
      s := s + substr(c, i, 1)::int * (t + 2 - i);
    end loop;
    if ((s * 10) % 11) % 10 <> substr(c, t + 1, 1)::int then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.membros (
  email        text primary key
               check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nome         text not null check (length(btrim(nome)) between 1 and 80),
  papel        public.papel not null,
  admin_final  boolean not null default false,   -- não pode ser removido nem rebaixado
  user_id      uuid unique,                      -- preenchido no primeiro login
  liberado_por text,
  liberado_em  timestamptz not null default now(),
  check (not admin_final or papel = 'moderador')
);
-- no máximo um administrador final
create unique index membros_um_admin_final on public.membros ((true)) where admin_final;

create table public.pedidos_acesso (
  email     text primary key,
  nome      text,
  user_id   uuid,
  pedido_em timestamptz not null default now()
);

create table public.motivos (
  id     smallint generated always as identity primary key,
  tipo   text not null check (tipo in ('reprovacao', 'encerramento')),
  texto  text not null,
  ordem  smallint not null default 0,
  ativo  boolean not null default true,
  unique (tipo, texto)
);

create table public.cadastros (
  id           uuid primary key default gen_random_uuid(),
  id_app       text check (id_app ~ '^[A-Za-z0-9]{4,40}$'),
  cpf          text unique check (cpf is null or public.cpf_valido(cpf)),  -- só dígitos
  cidade       text not null check (cidade ~ '^\S.* - [A-Z]{2}$' and length(cidade) <= 80),
  observacao   text check (length(observacao) <= 600),
  status       public.status_cadastro not null default 'aguardando_analise',
  enviado_por  uuid not null,
  enviado_em   timestamptz not null default now(),
  status_desde timestamptz not null default now(),  -- desde quando está no status atual
  motivo       text,          -- motivo da última reprovação/encerramento em vigor
  detalhe      text,
  decidido_por uuid,
  decidido_em  timestamptz,
  check (id_app is not null or cpf is not null)
);
create unique index cadastros_id_app_unico on public.cadastros (lower(id_app));
create index cadastros_status on public.cadastros (status, status_desde);
create index cadastros_enviado_por on public.cadastros (enviado_por);

create table public.eventos (
  id              bigint generated always as identity primary key,
  cadastro_id     uuid not null references public.cadastros (id) on delete cascade,
  tipo            text not null check (tipo in ('enviado', 'aprovado', 'reprovado', 'encerrado', 'desfeito')),
  status_anterior public.status_cadastro,
  status_novo     public.status_cadastro not null,
  por             uuid not null,
  em              timestamptz not null default now(),
  motivo          text,
  detalhe         text
);
create index eventos_cadastro on public.eventos (cadastro_id, id);
create index eventos_por on public.eventos (por, em);

-- ---------------------------------------------------------------------
-- Dados iniciais
-- ---------------------------------------------------------------------
insert into public.motivos (tipo, texto, ordem) values
  ('reprovacao', 'Documento ilegível', 1),
  ('reprovacao', 'Documento pendente', 2),
  ('reprovacao', 'Dados divergentes', 3),
  ('reprovacao', 'Fotos sem camisa', 4),
  ('reprovacao', 'Documentação bancária com dados insuficientes', 5),
  ('reprovacao', 'Fora da área de atuação', 6),
  ('reprovacao', 'Outro', 99),
  ('encerramento', 'CPF com restrição', 1),
  ('encerramento', 'Suspeita de fraude', 2),
  ('encerramento', 'Entregador desistiu', 3),
  ('encerramento', 'Sem retorno do entregador', 4),
  ('encerramento', 'Fora da área de atuação', 5),
  ('encerramento', 'Outro', 99);

-- Administrador final (moderador que ninguém pode remover).
insert into public.membros (email, nome, papel, admin_final, liberado_por)
values ('mateuslopesmb@gmail.com', 'Mateus Lopes', 'moderador', true, 'instalação');

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------
create or replace function public.meu_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.meu_papel()
returns public.papel language sql stable security definer set search_path = public as $$
  select papel from public.membros where email = public.meu_email()
$$;

create or replace function public.nome_de(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nome from public.membros where user_id = uid), '(fora da equipe)')
$$;

create or replace function public.exigir_papel(variadic aceitos public.papel[])
returns public.papel language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.meu_papel();
begin
  if p is null then
    raise exception 'Você não tem acesso a este sistema.' using errcode = '42501';
  end if;
  if not p = any (aceitos) then
    raise exception 'Seu acesso (%) não permite esta ação.', p using errcode = '42501';
  end if;
  return p;
end $$;

create or replace function public.status_texto(s public.status_cadastro)
returns text language sql immutable as $$
  select case s
    when 'aguardando_analise' then 'Aguardando análise'
    when 'aguardando_contato' then 'Aguardando novo contato e documentação'
    when 'aprovado' then 'Aprovado'
    when 'encerrado' then 'Encerrado'
  end
$$;

-- ---------------------------------------------------------------------
-- Row Level Security (leitura direta das tabelas)
-- Nenhuma política de escrita: gravações só pelas funções abaixo.
-- ---------------------------------------------------------------------
alter table public.membros enable row level security;
alter table public.pedidos_acesso enable row level security;
alter table public.motivos enable row level security;
alter table public.cadastros enable row level security;
alter table public.eventos enable row level security;

create policy membros_leitura on public.membros for select to authenticated
  using (public.meu_papel() = 'moderador' or email = public.meu_email());
create policy pedidos_leitura on public.pedidos_acesso for select to authenticated
  using (public.meu_papel() = 'moderador' or email = public.meu_email());
create policy motivos_leitura on public.motivos for select to authenticated
  using (public.meu_papel() is not null);
create policy cadastros_leitura on public.cadastros for select to authenticated
  using (public.meu_papel() in ('moderador', 'monitorador') or enviado_por = auth.uid());
create policy eventos_leitura on public.eventos for select to authenticated
  using (exists (select 1 from public.cadastros c where c.id = cadastro_id));

-- ---------------------------------------------------------------------
-- Acesso: login, pedidos, equipe
-- ---------------------------------------------------------------------

-- Chamada logo após o login. Liga o usuário ao seu e-mail na equipe.
create or replace function public.entrar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.membros;
begin
  if auth.uid() is null then
    raise exception 'Faça login.' using errcode = '42501';
  end if;
  update public.membros set user_id = auth.uid()
   where email = public.meu_email() and user_id is distinct from auth.uid()
  returning * into m;
  if m.email is null then
    select * into m from public.membros where email = public.meu_email();
  end if;
  if m.email is null then
    return jsonb_build_object(
      'membro', false,
      'email', public.meu_email(),
      'pedido', exists (select 1 from public.pedidos_acesso where email = public.meu_email()));
  end if;
  return jsonb_build_object('membro', true, 'id', auth.uid(), 'email', m.email,
    'nome', m.nome, 'papel', m.papel, 'admin_final', m.admin_final);
end $$;

create or replace function public.pedir_acesso()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.meu_email() = '' then
    raise exception 'Faça login.' using errcode = '42501';
  end if;
  if public.meu_papel() is not null then
    raise exception 'Você já tem acesso.';
  end if;
  insert into public.pedidos_acesso (email, nome, user_id)
  values (public.meu_email(),
          left(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                        auth.jwt() -> 'user_metadata' ->> 'name', ''), 80),
          auth.uid())
  on conflict (email) do update set pedido_em = now();
end $$;

create or replace function public.listar_equipe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador');
  return jsonb_build_object(
    'membros', coalesce((select jsonb_agg(jsonb_build_object(
        'email', email, 'nome', nome, 'papel', papel, 'admin_final', admin_final,
        'ja_entrou', user_id is not null, 'liberado_por', liberado_por, 'liberado_em', liberado_em)
        order by admin_final desc, papel, nome) from public.membros), '[]'),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
        'email', email, 'nome', nome, 'pedido_em', pedido_em) order by pedido_em)
        from public.pedidos_acesso), '[]'));
end $$;

-- Autoriza um e-mail novo ou muda nome/papel de quem já está na equipe.
create or replace function public.salvar_membro(p_email text, p_nome text, p_papel public.papel)
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(btrim(p_email));
begin
  perform public.exigir_papel('moderador');
  if exists (select 1 from public.membros where email = e and admin_final) then
    raise exception 'O administrador final não pode ser alterado.' using errcode = '42501';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.';
  end if;
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome.';
  end if;
  insert into public.membros (email, nome, papel, liberado_por, user_id)
  values (e, btrim(p_nome), p_papel, public.meu_email(),
          (select user_id from public.pedidos_acesso where email = e))
  on conflict (email) do update set nome = excluded.nome, papel = excluded.papel;
  delete from public.pedidos_acesso where email = e;
end $$;

create or replace function public.remover_membro(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(btrim(p_email));
begin
  perform public.exigir_papel('moderador');
  if exists (select 1 from public.membros where email = e and admin_final) then
    raise exception 'O administrador final não pode ser removido.' using errcode = '42501';
  end if;
  if e = public.meu_email() then
    raise exception 'Você não pode remover o seu próprio acesso.';
  end if;
  delete from public.membros where email = e;
end $$;

create or replace function public.recusar_pedido(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador');
  delete from public.pedidos_acesso where email = lower(btrim(p_email));
end $$;

-- Nomes da equipe (para "enviado por" e filtros do painel). Todos os membros podem ver.
create or replace function public.pessoas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'nome', nome) order by nome)
                     from public.membros where user_id is not null), '[]');
end $$;

create or replace function public.listar_motivos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'reprovacao', coalesce((select jsonb_agg(texto order by ordem, texto) from public.motivos
                             where tipo = 'reprovacao' and ativo), '[]'),
    'encerramento', coalesce((select jsonb_agg(texto order by ordem, texto) from public.motivos
                               where tipo = 'encerramento' and ativo), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create or replace function public.enviar_cadastro(
  p_id_app text, p_cpf text, p_cidade text, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id_app text := nullif(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'), '');
  v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  ja       public.cadastros;
  novo     uuid;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if v_id_app is null and v_cpf is null then
    raise exception 'Preencha o ID do entregador ou o CPF.';
  end if;
  if v_id_app is not null and length(v_id_app) < 4 then
    raise exception 'ID muito curto. Confira.';
  end if;
  if v_cpf is not null and not public.cpf_valido(v_cpf) then
    raise exception 'CPF inválido. Confira os 11 números.';
  end if;
  if v_cidade !~ '^\S.* - [A-Z]{2}$' then
    raise exception 'Use o formato CIDADE - UF, ex.: LAGARTO - SE.';
  end if;

  select * into ja from public.cadastros
   where (v_cpf is not null and cpf = v_cpf)
      or (v_id_app is not null and lower(id_app) = lower(v_id_app))
   limit 1;
  if ja.id is not null then
    raise exception 'Este % já está cadastrado (situação: %, enviado em %).',
      case when v_cpf is not null and ja.cpf = v_cpf then 'CPF' else 'ID' end,
      public.status_texto(ja.status),
      to_char(ja.enviado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;

  insert into public.cadastros (id_app, cpf, cidade, observacao, enviado_por)
  values (v_id_app, v_cpf, v_cidade, v_obs, auth.uid())
  returning id into novo;
  insert into public.eventos (cadastro_id, tipo, status_novo, por)
  values (novo, 'enviado', 'aguardando_analise', auth.uid());
  return novo;
exception when unique_violation then
  raise exception 'Este CPF ou ID já está cadastrado.' using errcode = '23505';
end $$;

-- p_acao: 'aprovar' | 'reprovar' | 'encerrar'
create or replace function public.decidir(
  p_cadastro uuid, p_acao text, p_motivo text default null, p_detalhe text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c       public.cadastros;
  novo    public.status_cadastro;
  tipo_ev text;
  tipo_mo text;
  v_mot   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_det   text := left(nullif(btrim(coalesce(p_detalhe, '')), ''), 300);
begin
  perform public.exigir_papel('moderador', 'monitorador');
  select * into c from public.cadastros where id = p_cadastro for update;
  if c.id is null then
    raise exception 'Cadastro não encontrado.';
  end if;

  case p_acao
    when 'aprovar'  then novo := 'aprovado';           tipo_ev := 'aprovado';
    when 'reprovar' then novo := 'aguardando_contato'; tipo_ev := 'reprovado'; tipo_mo := 'reprovacao';
    when 'encerrar' then novo := 'encerrado';          tipo_ev := 'encerrado'; tipo_mo := 'encerramento';
    else raise exception 'Ação inválida: %', p_acao;
  end case;

  if not (c.status = 'aguardando_analise'
          or (c.status = 'aguardando_contato' and p_acao in ('aprovar', 'encerrar'))) then
    raise exception 'Não é possível % um cadastro com situação "%".',
      p_acao, public.status_texto(c.status);
  end if;

  if tipo_mo is not null then
    if v_mot is null or not exists (select 1 from public.motivos
                                     where tipo = tipo_mo and texto = v_mot and ativo) then
      raise exception 'Escolha o motivo.';
    end if;
    if v_mot = 'Outro' and v_det is null then
      raise exception 'Descreva o motivo no detalhe.';
    end if;
  else
    v_mot := null; v_det := null;
  end if;

  update public.cadastros
     set status = novo, status_desde = now(), motivo = v_mot, detalhe = v_det,
         decidido_por = auth.uid(), decidido_em = now()
   where id = c.id;
  insert into public.eventos (cadastro_id, tipo, status_anterior, status_novo, por, motivo, detalhe)
  values (c.id, tipo_ev, c.status, novo, auth.uid(), v_mot, v_det);
end $$;

-- Desfaz a última decisão (só moderador). Uma decisão por vez.
create or replace function public.desfazer(p_cadastro uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c   public.cadastros;
  ult public.eventos;
  ant public.eventos;
begin
  perform public.exigir_papel('moderador');
  select * into c from public.cadastros where id = p_cadastro for update;
  if c.id is null then
    raise exception 'Cadastro não encontrado.';
  end if;
  select * into ult from public.eventos where cadastro_id = c.id order by id desc limit 1;
  if ult.tipo not in ('aprovado', 'reprovado', 'encerrado') then
    raise exception 'Não há decisão para desfazer.';
  end if;
  -- decisão anterior que volta a valer (ex.: a reprovação antes da aprovação desfeita)
  select * into ant from public.eventos
   where cadastro_id = c.id and id < ult.id and status_novo = ult.status_anterior
     and tipo in ('aprovado', 'reprovado', 'encerrado')
   order by id desc limit 1;

  update public.cadastros
     set status = ult.status_anterior,
         status_desde = coalesce(ant.em, c.enviado_em),
         motivo = ant.motivo, detalhe = ant.detalhe,
         decidido_por = ant.por, decidido_em = ant.em
   where id = c.id;
  insert into public.eventos (cadastro_id, tipo, status_anterior, status_novo, por, motivo)
  values (c.id, 'desfeito', c.status, ult.status_anterior, auth.uid(), 'Desfeito: ' || ult.tipo);
end $$;

create or replace function public.excluir_cadastro(p_cadastro uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador');
  delete from public.cadastros where id = p_cadastro;
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
end $$;

-- p_escopo: 'pendentes' | 'meus' | 'todos'. Roda com as permissões de quem chama
-- (security invoker), então o suporte só recebe os próprios cadastros.
create or replace function public.listar_cadastros(p_escopo text)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'id_app', c.id_app, 'cpf', c.cpf, 'cidade', c.cidade, 'observacao', c.observacao,
      'status', c.status, 'enviado_por', c.enviado_por, 'enviado_por_nome', public.nome_de(c.enviado_por),
      'enviado_em', c.enviado_em, 'status_desde', c.status_desde,
      'motivo', c.motivo, 'detalhe', c.detalhe,
      'decidido_por_nome', case when c.decidido_por is not null then public.nome_de(c.decidido_por) end,
      'decidido_em', c.decidido_em,
      'reprovacoes', (select count(*) from public.eventos e where e.cadastro_id = c.id and e.tipo = 'reprovado'),
      'pode_desfazer', (select e.tipo in ('aprovado', 'reprovado', 'encerrado') from public.eventos e
                         where e.cadastro_id = c.id order by e.id desc limit 1))
      order by c.status_desde)
    from public.cadastros c
    where case p_escopo
            when 'pendentes' then c.status in ('aguardando_analise', 'aguardando_contato')
            when 'meus' then c.enviado_por = auth.uid()
            when 'todos' then true
            else false
          end), '[]');
end $$;

create or replace function public.eventos_do_cadastro(p_cadastro uuid)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tipo', e.tipo, 'status_anterior', e.status_anterior, 'status_novo', e.status_novo,
      'por_nome', public.nome_de(e.por), 'em', e.em, 'motivo', e.motivo, 'detalhe', e.detalhe)
      order by e.id)
    from public.eventos e where e.cadastro_id = p_cadastro), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Métricas do painel
-- Todos os papéis veem os números da operação inteira (só agregados, sem CPF).
-- p_pessoas: null = todos; senão, só cadastros enviados OU decididos por essas pessoas.
-- ---------------------------------------------------------------------
create or replace function public.metricas(p_pessoas uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz    constant text := 'America/Sao_Paulo';
  hoje  date := (now() at time zone tz)::date;
  res   jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');

  with c as (
    select * from public.cadastros c
     where p_pessoas is null
        or c.enviado_por = any (p_pessoas)
        or exists (select 1 from public.eventos e where e.cadastro_id = c.id and e.por = any (p_pessoas))
  ),
  -- decisões em vigor (as desfeitas não contam)
  ev as (
    select e.*, (e.em at time zone tz)::date as dia
      from public.eventos e join c on c.id = e.cadastro_id
     where e.tipo in ('aprovado', 'reprovado', 'encerrado')
       -- uma decisão foi desfeita quando o evento seguinte do cadastro é um 'desfeito'
       and coalesce((select d.tipo from public.eventos d
                      where d.cadastro_id = e.cadastro_id and d.id > e.id
                      order by d.id limit 1), '') <> 'desfeito'
  ),
  primeira as (   -- primeira decisão de cada cadastro
    select distinct on (cadastro_id) cadastro_id, tipo from ev order by cadastro_id, id
  ),
  aprov as (      -- tempo do envio até a aprovação
    select c.cidade, extract(epoch from (ev.em - c.enviado_em)) / 3600.0 as horas
      from ev join c on c.id = ev.cadastro_id where ev.tipo = 'aprovado'
  )
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'aguardando_analise', (select count(*) from c where status = 'aguardando_analise'),
      'aguardando_contato', (select count(*) from c where status = 'aguardando_contato'),
      'aprovados_hoje', (select count(*) from ev where tipo = 'aprovado' and dia = hoje),
      'aprovados_7d', (select count(*) from ev where tipo = 'aprovado' and dia > hoje - 7),
      'aprovados_mes', (select count(*) from ev where tipo = 'aprovado' and date_trunc('month', dia) = date_trunc('month', hoje)),
      'encerrados_mes', (select count(*) from ev where tipo = 'encerrado' and date_trunc('month', dia) = date_trunc('month', hoje)),
      'aprovacao_1a_analise', (select round(100.0 * count(*) filter (where tipo = 'aprovado') / nullif(count(*), 0)) from primeira),
      'horas_ate_aprovacao', (select round(avg(horas)::numeric, 1) from aprov),
      'total', (select count(*) from c)),
    'por_dia', (select jsonb_agg(jsonb_build_object(
        'dia', d,
        'enviados', (select count(*) from c where (c.enviado_em at time zone tz)::date = d),
        'aprovados', (select count(*) from ev where dia = d and tipo = 'aprovado'),
        'reprovados', (select count(*) from ev where dia = d and tipo = 'reprovado'),
        'encerrados', (select count(*) from ev where dia = d and tipo = 'encerrado')) order by d)
      from generate_series(0, 13) as g(i), lateral (select hoje - 13 + g.i as d) x),
    'por_cidade', coalesce((select jsonb_agg(l order by (l ->> 'recebidos')::int desc, l ->> 'cidade') from (
        select jsonb_build_object(
          'cidade', c.cidade,
          'recebidos', count(*),
          'em_andamento', count(*) filter (where c.status in ('aguardando_analise', 'aguardando_contato')),
          'aprovados', count(*) filter (where c.status = 'aprovado'),
          'encerrados', count(*) filter (where c.status = 'encerrado'),
          'reprovacoes', (select count(*) from ev join c c2 on c2.id = ev.cadastro_id
                           where ev.tipo = 'reprovado' and c2.cidade = c.cidade),
          'horas_ate_aprovacao', (select round(avg(horas)::numeric, 1) from aprov where aprov.cidade = c.cidade)) as l
        from c group by c.cidade) t), '[]'),
    'motivos_reprovacao', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'qtd', n, 'pct', pct) order by n desc)
        from (select motivo, count(*) n, round(100.0 * count(*) / sum(count(*)) over ()) pct
                from ev where tipo = 'reprovado' group by motivo) t), '[]'),
    'motivos_encerramento', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'qtd', n) order by n desc)
        from (select motivo, count(*) n from ev where tipo = 'encerrado' group by motivo) t), '[]'),
    'por_pessoa', coalesce((select jsonb_agg(p order by (p ->> 'enviados')::int + (p ->> 'decisoes')::int desc) from (
        select jsonb_build_object(
          'id', m.user_id, 'nome', m.nome, 'papel', m.papel,
          'enviados', (select count(*) from c where enviado_por = m.user_id),
          'enviados_14d', (select count(*) from c where enviado_por = m.user_id
                            and (enviado_em at time zone tz)::date > hoje - 14),
          'aprovou', (select count(*) from ev where por = m.user_id and tipo = 'aprovado'),
          'reprovou', (select count(*) from ev where por = m.user_id and tipo = 'reprovado'),
          'encerrou', (select count(*) from ev where por = m.user_id and tipo = 'encerrado'),
          'decisoes', (select count(*) from ev where por = m.user_id)) as p
        from public.membros m
        where m.user_id is not null and (p_pessoas is null or m.user_id = any (p_pessoas))) t
        where (p ->> 'enviados')::int + (p ->> 'decisoes')::int > 0), '[]')
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------------
-- View para análises no SQL Editor (respeita as permissões de quem consulta)
-- ---------------------------------------------------------------------
create or replace view public.vw_cadastros with (security_invoker = true) as
select c.id, c.id_app, c.cpf, c.cidade, c.status, public.status_texto(c.status) as situacao,
       public.nome_de(c.enviado_por) as enviado_por, c.enviado_em,
       c.status_desde, c.motivo, c.detalhe,
       public.nome_de(c.decidido_por) as decidido_por, c.decidido_em,
       round(extract(epoch from (coalesce(c.decidido_em, now()) - c.enviado_em)) / 3600.0, 1) as horas_desde_envio,
       (select count(*) from public.eventos e where e.cadastro_id = c.id and e.tipo = 'reprovado') as reprovacoes
  from public.cadastros c;

-- ---------------------------------------------------------------------
-- Permissões: só usuários logados chamam as funções
-- ---------------------------------------------------------------------
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

-- Atualização em tempo real (o app recarrega quando algo muda)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cadastros, public.eventos, public.membros, public.pedidos_acesso;
  end if;
end $$;
