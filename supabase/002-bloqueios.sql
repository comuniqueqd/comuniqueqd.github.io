-- =====================================================================
-- Migração 002: módulo de Bloqueios, tarefas, notificações e acesso por módulo
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rodar UMA vez, depois do schema.sql. NÃO apaga dados do módulo de ativação.
--
-- Regras (vindas da planilha "Controle de Bloqueios", aba Config):
--   * cada bloqueio é a N-ésima ocorrência daquela infração para aquele ID, contada PELA DATA;
--   * horas: 1ª = horas_1a, 2ª = horas_2a, 3ª em diante = anterior + 30% (fator), arredondado;
--     horas nulas = ENCERRAMENTO DE PARCERIA (bloqueio definitivo);
--     terceira_encerra = a 3ª ocorrência já encerra a parceria;
--   * janela_dias (só no atraso: 60): se passar esse tempo sem nova ocorrência, a contagem
--     da punição volta para a 1ª — o histórico continua guardado;
--   * bloqueios de 10 h ou mais e encerramentos geram uma TAREFA de tratativa para o
--     responsável da cidade (sem responsável: todos os moderadores). Concluir a tratativa
--     NÃO libera o bloqueio; só avisa quem registrou;
--   * o bloqueio termina sozinho quando o tempo passa; monitorador/moderador podem liberar antes.
-- =====================================================================

drop function if exists public.inserir_bloqueio(text, text, text, smallint, timestamptz, uuid, text, text, boolean, text);
drop function if exists public.importar_bloqueio(text, text, text, text, timestamptz, text, text);

-- ---------------------------------------------------------------------
-- Acesso por módulo: membros.papel = ativação; membros.papel_bloqueios = bloqueios
-- (nulo = sem acesso ao módulo de bloqueios)
-- ---------------------------------------------------------------------
alter table public.membros add column if not exists papel_bloqueios public.papel;
update public.membros set papel_bloqueios = papel where papel_bloqueios is null;
alter table public.membros drop constraint if exists membros_check;
alter table public.membros drop constraint if exists membros_admin_final_moderador;
alter table public.membros add constraint membros_admin_final_moderador
  check (not admin_final or (papel = 'moderador' and papel_bloqueios = 'moderador'));

create or replace function public.meu_papel_bloq()
returns public.papel language sql stable security definer set search_path = public as $$
  select papel_bloqueios from public.membros where email = public.meu_email()
$$;

create or replace function public.exigir_bloq(variadic aceitos public.papel[])
returns public.papel language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.meu_papel_bloq();
begin
  if public.meu_papel() is null then
    raise exception 'Você não tem acesso a este sistema.' using errcode = '42501';
  end if;
  if p is null then
    raise exception 'Você não tem acesso ao módulo de bloqueios.' using errcode = '42501';
  end if;
  if not p = any (aceitos) then
    raise exception 'Seu acesso nos bloqueios (%) não permite esta ação.', p using errcode = '42501';
  end if;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- Cidades (comum aos módulos) e infrações (regras de punição)
-- ---------------------------------------------------------------------
create table if not exists public.cidades (
  nome              text primary key check (nome ~ '^\S.* - [A-Z]{2}$' and length(nome) <= 80),
  responsavel_email text references public.membros (email) on update cascade on delete set null,
  ativa             boolean not null default true
);

insert into public.cidades (nome) values
  ('ITABAIANA - SE'), ('LAGARTO - SE'), ('SERRINHA - BA'), ('PAULO AFONSO - BA'), ('TOBIAS BARRETO - SE'),
  ('SALGADO - SE'), ('SIMÃO DIAS - SE'), ('CÍCERO DANTAS - BA'), ('ITABERABA - BA'), ('ALAGOINHAS - BA'),
  ('ARCOVERDE - PE'), ('CARPINA - PE'), ('SANTA CRUZ DO CAPIBARIBE - PE'), ('POJUCA - BA'), ('CANDEIAS - BA'),
  ('ESCADA - PE'), ('BELO JARDIM - PE'), ('VITÓRIA DE SANTO ANTÃO - PE'), ('GRAVATÁ - PE'), ('RECIFE - PE'),
  ('RIACHÃO DO DANTAS - SE'), ('SÃO LOURENÇO DA MATA - PE'), ('PAULISTA - PE'), ('RIBEIRA DO POMBAL - BA'),
  ('POÇO VERDE - SE'), ('PALMEIRA DOS ÍNDIOS - AL'), ('ESTÂNCIA - SE'), ('CABO DE SANTO AGOSTINHO - PE'),
  ('BUÍQUE - PE'), ('CAPELA - SE')
on conflict (nome) do nothing;

create table if not exists public.infracoes (
  id               smallint generated always as identity primary key,
  nome             text not null unique check (length(btrim(nome)) between 3 and 150),
  horas_1a         integer check (horas_1a > 0),   -- nulo = encerramento de parceria já na 1ª
  horas_2a         integer check (horas_2a > 0),   -- nulo = encerramento na 2ª
  terceira_encerra boolean not null default false, -- a 3ª ocorrência encerra a parceria
  fator            numeric(4, 2) not null default 1.30 check (fator between 1 and 5),
  janela_dias      integer check (janela_dias > 0), -- nulo = reincidência conta para sempre
  ativa            boolean not null default true,
  ordem            smallint not null default 0,
  atualizada_em    timestamptz not null default now(),
  atualizada_por   text
);

insert into public.infracoes (nome, horas_1a, horas_2a, terceira_encerra, janela_dias, ordem) values
  ('Reabrir Pedido Após Aceite Sem Justificativa Plausível', 1, 24, false, null, 1),
  ('Mal Uso Proposital do Aplicativo', 48, 72, false, null, 2),
  ('Atraso na Coleta ou na Entrega Sem Justificativa', 24, 48, false, 60, 3),
  ('Avaria de Produto', 36, 72, true, null, 4),
  ('Retenção de Valores ou Equipamentos de Pagamento', 72, null, true, null, 5),
  ('Finalização Falsa de Entrega', 48, 72, true, null, 6),
  ('Mau Comportamento com Clientes Finais ou Parceiros: Desrespeito ou Atitude Inapropriada', 168, null, true, null, 7),
  ('Uso da Conta por Terceiros Não Autorizados', 72, null, true, null, 8),
  ('Furto ou Extravio: Desvio de Produtos ou Valores', null, null, true, null, 9),
  ('Agressão Física ou Assédio (Moral ou Sexual)', null, null, true, null, 10),
  ('Fraude Documental', null, null, true, null, 11)
on conflict (nome) do nothing;

-- Horas da N-ésima ocorrência (nulo = encerramento de parceria).
-- A partir da 3ª: anterior + 30% (fator), arredondando a cada passo.
create or replace function public.horas_previstas(i public.infracoes, n integer)
returns integer language plpgsql immutable as $$
declare h numeric; k integer;
begin
  if i.horas_1a is null then return null; end if;
  if n <= 1 then return i.horas_1a; end if;
  if i.horas_2a is null then return null; end if;
  if n = 2 then return i.horas_2a; end if;
  if i.terceira_encerra then return null; end if;
  h := i.horas_2a;
  for k in 3..n loop h := round(h * i.fator); end loop;
  return h::integer;
end $$;

-- ---------------------------------------------------------------------
-- Bloqueios, histórico de ações, tarefas e notificações
-- ---------------------------------------------------------------------
create table if not exists public.bloqueios (
  id                  uuid primary key default gen_random_uuid(),
  id_app              text not null check (id_app ~ '^[A-Za-z0-9]{4,40}$'),
  nome_entregador     text not null check (length(btrim(nome_entregador)) between 1 and 120),
  cidade              text references public.cidades (nome) on update cascade,
  infracao_id         smallint not null references public.infracoes (id),
  infracao            text not null,             -- nome no momento do registro
  ocorrencia          integer not null check (ocorrencia >= 1),  -- usada na punição
  ocorrencia_total    integer not null,          -- todas as vezes desta infração (histórico)
  horas               integer check (horas > 0), -- nulo = encerramento de parceria
  inicio              timestamptz not null default now(),
  fim                 timestamptz,               -- inicio + horas (nulo no encerramento)
  liberado_em         timestamptz,               -- liberação antes do tempo
  liberado_por        uuid,
  motivo_liberacao    text,
  registrado_por      uuid,                      -- nulo nos importados da planilha
  registrado_por_nome text not null,
  observacao          text check (length(observacao) <= 600),
  importado           boolean not null default false,
  revisar             text,                      -- alerta de revisão (ex.: dados conflitantes)
  check (ocorrencia_total >= ocorrencia),
  check ((horas is null) = (fim is null))
);
create index if not exists bloqueios_id_app on public.bloqueios (lower(id_app), infracao_id, inicio);
create index if not exists bloqueios_registrado_por on public.bloqueios (registrado_por, inicio);
create index if not exists bloqueios_fim on public.bloqueios (fim);

create table if not exists public.eventos_bloqueio (
  id          bigint generated always as identity primary key,
  bloqueio_id uuid not null references public.bloqueios (id) on delete cascade,
  tipo        text not null check (tipo in ('registrado', 'liberado_antes', 'tratativa_concluida')),
  por         uuid,
  por_nome    text,
  em          timestamptz not null default now(),
  detalhe     text
);
create index if not exists eventos_bloqueio_bloqueio on public.eventos_bloqueio (bloqueio_id, id);

-- Tarefas: base comum da aba Atividades. Por enquanto só tratativas de bloqueio.
create table if not exists public.tarefas (
  id                uuid primary key default gen_random_uuid(),
  modulo            text not null default 'bloqueios',
  tipo              text not null check (tipo in ('tratativa', 'encerramento_parceria')),
  bloqueio_id       uuid unique references public.bloqueios (id) on delete cascade,
  cidade            text,
  responsavel_email text references public.membros (email) on update cascade on delete set null, -- nulo = moderadores
  status            text not null default 'pendente' check (status in ('pendente', 'concluida')),
  criada_em         timestamptz not null default now(),
  concluida_em      timestamptz,
  concluida_por     uuid,
  nota              text check (length(nota) <= 600),
  importada         boolean not null default false
);
create index if not exists tarefas_status on public.tarefas (status, responsavel_email);

create table if not exists public.notificacoes (
  id        bigint generated always as identity primary key,
  para      uuid not null,
  texto     text not null,
  link      text,
  criada_em timestamptz not null default now(),
  lida_em   timestamptz
);
create index if not exists notificacoes_para on public.notificacoes (para, id desc);

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create or replace function public.situacao_bloqueio(b public.bloqueios)
returns text language sql stable as $$
  select case
    when b.liberado_em is not null then 'liberado_antes'
    when b.horas is null then 'encerramento'
    when now() < b.fim then 'bloqueado'
    else 'liberado'
  end
$$;

-- N-ésima ocorrência (para a punição) e total histórico, contando pela data.
-- Com janela (atraso): a sequência só continua se cada ocorrência anterior estiver a no
-- máximo janela_dias da seguinte; um intervalo maior zera a contagem da punição.
create or replace function public.calcular_ocorrencia(p_id_app text, p_infracao smallint, p_momento timestamptz)
returns table (ocorrencia integer, total integer)
language plpgsql stable security definer set search_path = public as $$
declare
  janela  integer;
  n       integer := 1;
  tot     integer := 1;
  ultimo  timestamptz := p_momento;
  r       record;
begin
  select janela_dias into janela from public.infracoes where id = p_infracao;
  for r in select b.inicio from public.bloqueios b
            where lower(b.id_app) = lower(p_id_app) and b.infracao_id = p_infracao and b.inicio < p_momento
            order by b.inicio desc loop
    tot := tot + 1;
    if n = tot - 1 and (janela is null or ultimo - r.inicio <= make_interval(days => janela)) then
      n := n + 1;
      ultimo := r.inicio;
    end if;
  end loop;
  return query select n, tot;
end $$;

-- Quem cuida da tratativa de uma cidade: o responsável, se tiver acesso de monitorador ou
-- moderador nos bloqueios; senão nulo (= todos os moderadores).
create or replace function public.responsavel_da_cidade(p_cidade text)
returns text language sql stable security definer set search_path = public as $$
  select m.email from public.cidades c join public.membros m on m.email = c.responsavel_email
   where c.nome = p_cidade and m.papel_bloqueios in ('moderador', 'monitorador')
$$;

create or replace function public.nome_por_email(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select nome from public.membros where email = p_email
$$;

create or replace function public.notificar(p_para uuid, p_texto text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notificacoes (para, texto, link)
  select p_para, p_texto, p_link where p_para is not null and p_para is distinct from auth.uid()
$$;

create or replace function public.texto_punicao(p_horas integer)
returns text language sql immutable as $$
  select case when p_horas is null then 'encerramento de parceria'
              when p_horas % 24 = 0 and p_horas >= 48 then (p_horas / 24) || ' dias'
              else p_horas || ' h' end
$$;

-- Insere um bloqueio já calculado e cria a tarefa de tratativa quando couber.
-- p_fixar_horas: usa p_horas (nulo = encerramento) em vez da regra — só na importação,
-- para guardar o que foi de fato aplicado na planilha.
create or replace function public.inserir_bloqueio(
  p_id_app text, p_nome text, p_cidade text, p_infracao smallint, p_inicio timestamptz,
  p_registrado_por uuid, p_registrado_por_nome text, p_observacao text,
  p_importado boolean default false, p_revisar text default null,
  p_fixar_horas boolean default false, p_horas integer default null)
returns public.bloqueios language plpgsql security definer set search_path = public as $$
declare
  i   public.infracoes;
  oc  record;
  h   integer;
  b   public.bloqueios;
begin
  select * into i from public.infracoes where id = p_infracao;
  select * into oc from public.calcular_ocorrencia(p_id_app, p_infracao, p_inicio);
  h := case when p_fixar_horas then p_horas else public.horas_previstas(i, oc.ocorrencia) end;
  insert into public.bloqueios (id_app, nome_entregador, cidade, infracao_id, infracao, ocorrencia, ocorrencia_total,
                                horas, inicio, fim, registrado_por, registrado_por_nome, observacao, importado, revisar)
  values (p_id_app, btrim(p_nome), p_cidade, i.id, i.nome, oc.ocorrencia, oc.total,
          h, p_inicio, case when h is null then null else p_inicio + make_interval(hours => h) end,
          p_registrado_por, p_registrado_por_nome, p_observacao, p_importado, p_revisar)
  returning * into b;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, em, detalhe)
  values (b.id, 'registrado', p_registrado_por, p_registrado_por_nome, p_inicio,
          oc.ocorrencia || 'ª ocorrência · ' || public.texto_punicao(h));
  if h is null or h >= 10 then
    insert into public.tarefas (tipo, bloqueio_id, cidade, responsavel_email, criada_em, status, concluida_em, importada)
    values (case when h is null then 'encerramento_parceria' else 'tratativa' end, b.id, p_cidade,
            public.responsavel_da_cidade(p_cidade), p_inicio,
            -- importados: só fica pendente a tratativa de quem ainda está bloqueado por tempo
            case when p_importado and (h is null or b.fim <= now()) then 'concluida' else 'pendente' end,
            case when p_importado and (h is null or b.fim <= now()) then now() end,
            p_importado);
  end if;
  return b;
end $$;

-- ---------------------------------------------------------------------
-- Acesso: login e equipe passam a conhecer o papel nos bloqueios
-- ---------------------------------------------------------------------
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
  return jsonb_build_object('membro', true, 'id', auth.uid(), 'email', m.email, 'nome', m.nome,
    'papel', m.papel, 'papel_bloqueios', m.papel_bloqueios, 'admin_final', m.admin_final);
end $$;

create or replace function public.listar_equipe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador');
  return jsonb_build_object(
    'membros', coalesce((select jsonb_agg(jsonb_build_object(
        'email', email, 'nome', nome, 'papel', papel, 'papel_bloqueios', papel_bloqueios,
        'admin_final', admin_final, 'ja_entrou', user_id is not null,
        'liberado_por', liberado_por, 'liberado_em', liberado_em)
        order by admin_final desc, papel, nome) from public.membros), '[]'),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
        'email', email, 'nome', nome, 'pedido_em', pedido_em) order by pedido_em)
        from public.pedidos_acesso), '[]'));
end $$;

drop function if exists public.salvar_membro(text, text, public.papel);
create or replace function public.salvar_membro(
  p_email text, p_nome text, p_papel public.papel, p_papel_bloqueios public.papel)
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
  insert into public.membros (email, nome, papel, papel_bloqueios, liberado_por, user_id)
  values (e, btrim(p_nome), p_papel, p_papel_bloqueios, public.meu_email(),
          (select user_id from public.pedidos_acesso where email = e))
  on conflict (email) do update
    set nome = excluded.nome, papel = excluded.papel, papel_bloqueios = excluded.papel_bloqueios;
  delete from public.pedidos_acesso where email = e;
end $$;

-- ---------------------------------------------------------------------
-- Regras (infrações e cidades): leitura para quem usa o módulo, edição para moderadores
-- ---------------------------------------------------------------------
create or replace function public.regras_bloqueio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'infracoes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'nome', i.nome, 'horas_1a', i.horas_1a, 'horas_2a', i.horas_2a,
        'terceira_encerra', i.terceira_encerra, 'fator', i.fator, 'janela_dias', i.janela_dias,
        'ativa', i.ativa, 'ordem', i.ordem, 'atualizada_em', i.atualizada_em, 'atualizada_por', i.atualizada_por,
        'previstas', (select jsonb_agg(public.horas_previstas(i, n) order by n) from generate_series(1, 5) n))
        order by i.ordem, i.nome) from public.infracoes i), '[]'),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', c.nome, 'ativa', c.ativa, 'responsavel_email', c.responsavel_email,
        'responsavel_nome', public.nome_por_email(c.responsavel_email),
        'responsavel_valido', public.responsavel_da_cidade(c.nome) is not null)
        order by c.nome) from public.cidades c), '[]'),
    'responsaveis', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'nome', nome, 'papel', papel_bloqueios) order by nome)
        from public.membros where papel_bloqueios in ('moderador', 'monitorador')), '[]'));
end $$;

create or replace function public.salvar_infracao(
  p_id smallint, p_nome text, p_horas_1a integer, p_horas_2a integer, p_terceira_encerra boolean,
  p_fator numeric, p_janela_dias integer, p_ativa boolean)
returns smallint language plpgsql security definer set search_path = public as $$
declare novo smallint;
begin
  perform public.exigir_bloq('moderador');
  if coalesce(btrim(p_nome), '') = '' then raise exception 'Informe o nome da infração.'; end if;
  if p_horas_1a is not null and p_horas_1a <= 0 or p_horas_2a is not null and p_horas_2a <= 0 then
    raise exception 'As horas precisam ser maiores que zero (deixe vazio para encerramento de parceria).';
  end if;
  if p_horas_1a is null and p_horas_2a is not null then
    raise exception 'Se a 1ª ocorrência já encerra a parceria, a 2ª também encerra.';
  end if;
  if p_id is null then
    insert into public.infracoes (nome, horas_1a, horas_2a, terceira_encerra, fator, janela_dias, ativa, ordem, atualizada_por)
    values (btrim(p_nome), p_horas_1a, p_horas_2a, coalesce(p_terceira_encerra, false), coalesce(p_fator, 1.30),
            p_janela_dias, coalesce(p_ativa, true), (select coalesce(max(ordem), 0) + 1 from public.infracoes), public.meu_email())
    returning id into novo;
    return novo;
  end if;
  update public.infracoes
     set nome = btrim(p_nome), horas_1a = p_horas_1a, horas_2a = p_horas_2a,
         terceira_encerra = coalesce(p_terceira_encerra, false), fator = coalesce(p_fator, 1.30),
         janela_dias = p_janela_dias, ativa = coalesce(p_ativa, true),
         atualizada_em = now(), atualizada_por = public.meu_email()
   where id = p_id;
  if not found then raise exception 'Infração não encontrada.'; end if;
  return p_id;
exception when unique_violation then
  raise exception 'Já existe uma infração com esse nome.';
end $$;

create or replace function public.salvar_cidade(p_nome text, p_responsavel_email text, p_ativa boolean)
returns void language plpgsql security definer set search_path = public as $$
declare n text := upper(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
        r text := nullif(lower(btrim(coalesce(p_responsavel_email, ''))), '');
begin
  perform public.exigir_bloq('moderador');
  if n !~ '^\S.* - [A-Z]{2}$' then raise exception 'Use o formato CIDADE - UF, ex.: LAGARTO - SE.'; end if;
  if r is not null and not exists (select 1 from public.membros where email = r and papel_bloqueios in ('moderador', 'monitorador')) then
    raise exception 'O responsável precisa ser monitorador ou moderador nos bloqueios.';
  end if;
  insert into public.cidades (nome, responsavel_email, ativa) values (n, r, coalesce(p_ativa, true))
  on conflict (nome) do update set responsavel_email = excluded.responsavel_email, ativa = excluded.ativa;
  -- tratativas pendentes da cidade passam para o novo responsável
  update public.tarefas set responsavel_email = public.responsavel_da_cidade(n)
   where cidade = n and status = 'pendente';
end $$;

-- ---------------------------------------------------------------------
-- Registro de bloqueios
-- ---------------------------------------------------------------------
-- O que vai acontecer se registrar agora (mostrado antes de confirmar) + histórico do entregador.
create or replace function public.previa_bloqueio(p_id_app text, p_infracao smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_id  text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  i     public.infracoes;
  n     integer;
  tot   integer;
  h     integer;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into i from public.infracoes where id = p_infracao;
  if i.id is not null and length(v_id) >= 4 then
    select c.ocorrencia, c.total into n, tot from public.calcular_ocorrencia(v_id, i.id, now()) c;
    h := public.horas_previstas(i, n);
  end if;
  return jsonb_build_object(
    'ocorrencia', n, 'total', tot,
    'reiniciada', coalesce(n < tot, false),
    'janela_dias', i.janela_dias,
    'horas', h, 'encerramento', i.id is not null and n is not null and h is null,
    'fim', case when h is not null then now() + make_interval(hours => h) end,
    'gera_tratativa', n is not null and (h is null or h >= 10),
    'historico', coalesce((select jsonb_agg(jsonb_build_object(
        'infracao', b.infracao, 'inicio', b.inicio, 'horas', b.horas, 'ocorrencia', b.ocorrencia,
        'situacao', public.situacao_bloqueio(b), 'fim', b.fim, 'nome', b.nome_entregador,
        'registrado_por_nome', b.registrado_por_nome) order by b.inicio desc)
        from public.bloqueios b where lower(b.id_app) = lower(v_id) and length(v_id) >= 4), '[]'),
    'cadastro', (select jsonb_build_object('status', c.status, 'situacao', public.status_texto(c.status), 'enviado_em', c.enviado_em, 'cidade', c.cidade)
                   from public.cadastros c where lower(c.id_app) = lower(v_id) limit 1));
end $$;

create or replace function public.registrar_bloqueio(
  p_id_app text, p_nome text, p_cidade text, p_infracao smallint, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id     text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  i        public.infracoes;
  b        public.bloqueios;
  ja       public.bloqueios;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if length(v_id) < 4 then raise exception 'Preencha o ID do entregador.'; end if;
  if coalesce(btrim(p_nome), '') = '' then raise exception 'Preencha o nome do entregador.'; end if;
  if not exists (select 1 from public.cidades where nome = v_cidade and ativa) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  select * into i from public.infracoes where id = p_infracao and ativa;
  if i.id is null then raise exception 'Escolha a infração.'; end if;
  -- evita registro em dobro (dois cliques, duas pessoas ao mesmo tempo)
  perform pg_advisory_xact_lock(hashtext(lower(v_id)));
  select * into ja from public.bloqueios
   where lower(id_app) = lower(v_id) and infracao_id = i.id and inicio > now() - interval '10 minutes' limit 1;
  if ja.id is not null then
    raise exception 'Este entregador já recebeu um bloqueio por esta infração há poucos minutos (registrado por %).', ja.registrado_por_nome;
  end if;
  b := public.inserir_bloqueio(v_id, p_nome, v_cidade, i.id, now(), auth.uid(),
                               (select nome from public.membros where email = public.meu_email()), v_obs);
  return jsonb_build_object('id', b.id, 'ocorrencia', b.ocorrencia, 'horas', b.horas, 'fim', b.fim,
    'tarefa', exists (select 1 from public.tarefas where bloqueio_id = b.id));
end $$;

create or replace function public.liberar_bloqueio(p_bloqueio uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bloqueios; quem text := (select nome from public.membros where email = public.meu_email());
begin
  perform public.exigir_bloq('moderador', 'monitorador');
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da liberação.'; end if;
  select * into b from public.bloqueios where id = p_bloqueio for update;
  if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;
  if public.situacao_bloqueio(b) not in ('bloqueado', 'encerramento') then
    raise exception 'Este bloqueio não está ativo.';
  end if;
  update public.bloqueios set liberado_em = now(), liberado_por = auth.uid(), motivo_liberacao = left(btrim(p_motivo), 300)
   where id = b.id;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
  values (b.id, 'liberado_antes', auth.uid(), quem, left(btrim(p_motivo), 300));
  perform public.notificar(b.registrado_por,
    format('%s (%s) foi liberado antes do prazo por %s: %s', b.nome_entregador, b.infracao, quem, btrim(p_motivo)),
    '#bloqueios/meus');
end $$;

create or replace function public.concluir_tratativa(p_tarefa uuid, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t    public.tarefas;
  b    public.bloqueios;
  p    public.papel := public.exigir_bloq('moderador', 'monitorador');
  quem text := (select nome from public.membros where email = public.meu_email());
begin
  select * into t from public.tarefas where id = p_tarefa for update;
  if t.id is null then raise exception 'Tarefa não encontrada.'; end if;
  if t.status <> 'pendente' then raise exception 'Esta tratativa já foi concluída.'; end if;
  if p = 'monitorador' and t.responsavel_email is distinct from public.meu_email() then
    raise exception 'Esta tratativa é de outro responsável.' using errcode = '42501';
  end if;
  update public.tarefas set status = 'concluida', concluida_em = now(), concluida_por = auth.uid(),
         nota = left(nullif(btrim(coalesce(p_nota, '')), ''), 600)
   where id = t.id;
  select * into b from public.bloqueios where id = t.bloqueio_id;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
  values (b.id, 'tratativa_concluida', auth.uid(), quem, nullif(btrim(coalesce(p_nota, '')), ''));
  perform public.notificar(b.registrado_por,
    format('Tratativa realizada por %s: %s (%s). %s', quem, b.nome_entregador, b.infracao,
           case when b.horas is null then 'Parceria encerrada.'
                when public.situacao_bloqueio(b) = 'bloqueado' then 'O bloqueio continua até ' || to_char(b.fim at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.'
                else 'O bloqueio já terminou.' end),
    '#bloqueios/meus');
end $$;

create or replace function public.excluir_bloqueio(p_bloqueio uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador');
  delete from public.bloqueios where id = p_bloqueio;
  if not found then raise exception 'Bloqueio não encontrado.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------
create or replace function public.json_bloqueio(b public.bloqueios)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'id_app', b.id_app, 'nome', b.nome_entregador, 'cidade', b.cidade,
    'infracao_id', b.infracao_id, 'infracao', b.infracao, 'ocorrencia', b.ocorrencia, 'ocorrencia_total', b.ocorrencia_total,
    'horas', b.horas, 'inicio', b.inicio, 'fim', b.fim, 'situacao', public.situacao_bloqueio(b),
    'liberado_em', b.liberado_em, 'liberado_por_nome', case when b.liberado_por is not null then public.nome_de(b.liberado_por) end,
    'motivo_liberacao', b.motivo_liberacao,
    'registrado_por', b.registrado_por, 'registrado_por_nome', b.registrado_por_nome,
    'observacao', b.observacao, 'importado', b.importado, 'revisar', b.revisar,
    'tarefa', (select jsonb_build_object('id', t.id, 'tipo', t.tipo, 'status', t.status,
                 'responsavel_email', t.responsavel_email,
                 'responsavel_nome', coalesce(public.nome_por_email(t.responsavel_email), 'Moderadores'),
                 'criada_em', t.criada_em, 'concluida_em', t.concluida_em, 'nota', t.nota, 'importada', t.importada,
                 'concluida_por_nome', case when t.concluida_por is not null then public.nome_de(t.concluida_por) end)
               from public.tarefas t where t.bloqueio_id = b.id))
$$;

-- p_escopo: 'ativos' (bloqueados agora ou com tratativa pendente) | 'meus' | 'todos'.
-- Roda com as permissões de quem chama: o suporte só recebe o que registrou.
create or replace function public.listar_bloqueios(p_escopo text)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return coalesce((
    select jsonb_agg(public.json_bloqueio(b) order by b.inicio desc)
      from public.bloqueios b
     where case p_escopo
             when 'ativos' then public.situacao_bloqueio(b) = 'bloqueado'
                             or exists (select 1 from public.tarefas t where t.bloqueio_id = b.id and t.status = 'pendente')
             when 'meus' then b.registrado_por = auth.uid()
             when 'todos' then true
             else false
           end), '[]');
end $$;

-- Tratativas: monitorador vê as suas; moderador vê todas; suporte vê as dos bloqueios que registrou.
create or replace function public.listar_tarefas(p_status text default 'pendente')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'tipo', t.tipo, 'status', t.status, 'criada_em', t.criada_em, 'concluida_em', t.concluida_em,
      'nota', t.nota, 'importada', t.importada, 'cidade', t.cidade,
      'responsavel_email', t.responsavel_email,
      'responsavel_nome', coalesce(public.nome_por_email(t.responsavel_email), 'Moderadores'),
      'minha', (t.responsavel_email = public.meu_email()) or (t.responsavel_email is null and p = 'moderador') or p = 'moderador',
      'concluida_por_nome', case when t.concluida_por is not null then public.nome_de(t.concluida_por) end,
      'bloqueio', public.json_bloqueio(b)) order by t.criada_em)
    from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
    where (p_status is null or t.status = p_status)
      and case p
            when 'moderador' then true
            when 'monitorador' then t.responsavel_email = public.meu_email()
            else b.registrado_por = auth.uid()
          end), '[]');
end $$;

-- Busca de um entregador nos dois módulos (por ID exato ou parte do nome).
create or replace function public.consultar_entregador(p_busca text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := btrim(coalesce(p_busca, ''));
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if length(q) < 3 then raise exception 'Digite pelo menos 3 letras ou o ID.'; end if;
  return jsonb_build_object(
    'bloqueios', coalesce((select jsonb_agg(public.json_bloqueio(b) order by b.inicio desc) from (
        select * from public.bloqueios b
         where lower(b.id_app) = lower(q) or b.nome_entregador ilike '%' || q || '%'
         order by b.inicio desc limit 200) b), '[]'),
    'cadastros', coalesce((select jsonb_agg(jsonb_build_object(
        'id_app', c.id_app, 'cidade', c.cidade, 'status', c.status, 'situacao', public.status_texto(c.status),
        'enviado_em', c.enviado_em, 'motivo', c.motivo)) from public.cadastros c
         where lower(c.id_app) = lower(q) or c.cpf = regexp_replace(q, '\D', '', 'g')), '[]'));
end $$;

-- Painel. p_pessoas: cadastros registrados OU tratados por essas pessoas. p_dias: período (nulo = tudo).
create or replace function public.metricas_bloqueios(
  p_pessoas uuid[] default null, p_dias integer default 30, p_cidade text default null, p_infracao smallint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz   constant text := 'America/Sao_Paulo';
  hoje date := (now() at time zone tz)::date;
  ini  date := case when p_dias is null then null else hoje - (p_dias - 1) end;
  res  jsonb;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  with b as (
    select b.*, public.situacao_bloqueio(b) as sit, (b.inicio at time zone tz)::date as dia,
           t.status as t_status, t.tipo as t_tipo, t.concluida_por, t.concluida_em, t.criada_em as t_criada
      from public.bloqueios b left join public.tarefas t on t.bloqueio_id = b.id
     where (ini is null or (b.inicio at time zone tz)::date >= ini)
       and (p_cidade is null or b.cidade = p_cidade)
       and (p_infracao is null or b.infracao_id = p_infracao)
       and (p_pessoas is null or b.registrado_por = any (p_pessoas) or t.concluida_por = any (p_pessoas))
  )
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'total', (select count(*) from b),
      'bloqueados_agora', (select count(*) from b where sit = 'bloqueado'),
      'encerramentos', (select count(*) from b where horas is null),
      'reincidentes', (select count(*) from b where ocorrencia >= 2),
      'tratativas_pendentes', (select count(*) from b where t_status = 'pendente'),
      'tratativas_feitas', (select count(*) from b where t_status = 'concluida' and not importado),
      'horas_ate_tratativa', (select round(avg(extract(epoch from concluida_em - t_criada) / 3600)::numeric, 1)
                                from b where t_status = 'concluida' and not importado),
      'liberados_antes', (select count(*) from b where sit = 'liberado_antes'),
      'entregadores', (select count(distinct lower(id_app)) from b)),
    'por_dia', (select jsonb_agg(jsonb_build_object('dia', d,
        'total', (select count(*) from b where b.dia = d),
        'encerramentos', (select count(*) from b where b.dia = d and horas is null),
        'reincidencias', (select count(*) from b where b.dia = d and ocorrencia >= 2 and horas is not null)) order by d)
      from generate_series(0, least(coalesce(p_dias, 30), 90) - 1) g(i), lateral (select hoje - g.i as d) x),
    'por_infracao', coalesce((select jsonb_agg(l order by (l ->> 'total')::int desc) from (
        select jsonb_build_object('infracao', infracao, 'total', count(*),
          'reincidencias', count(*) filter (where ocorrencia >= 2),
          'encerramentos', count(*) filter (where horas is null)) l from b group by infracao) t), '[]'),
    'por_cidade', coalesce((select jsonb_agg(l order by (l ->> 'total')::int desc) from (
        select jsonb_build_object('cidade', coalesce(cidade, '(sem cidade)'), 'total', count(*),
          'bloqueados_agora', count(*) filter (where sit = 'bloqueado'),
          'encerramentos', count(*) filter (where horas is null),
          'tratativas_pendentes', count(*) filter (where t_status = 'pendente')) l from b group by cidade) t), '[]'),
    'por_pessoa', coalesce((select jsonb_agg(l order by (l ->> 'registrou')::int + (l ->> 'tratou')::int desc) from (
        select jsonb_build_object('nome', nome, 'registrou', registrou, 'tratou', tratou) l from (
          select coalesce(m.nome, x.nome) nome, sum(x.registrou)::int registrou, sum(x.tratou)::int tratou from (
            select registrado_por uid, registrado_por_nome nome, 1 registrou, 0 tratou from b
            union all
            select concluida_por, null, 0, 1 from b where t_status = 'concluida' and concluida_por is not null
          ) x left join public.membros m on m.user_id = x.uid
          where p_pessoas is null or x.uid = any (p_pessoas)
          group by coalesce(m.nome, x.nome)) y) t), '[]'),
    'reincidentes', coalesce((select jsonb_agg(l order by (l ->> 'bloqueios')::int desc, l ->> 'nome') from (
        select jsonb_build_object('id_app', min(id_app), 'nome', (array_agg(nome_entregador order by inicio desc))[1],
          'cidade', (array_agg(cidade order by inicio desc))[1], 'bloqueios', count(*),
          'ultimo', max(inicio), 'bloqueado_agora', bool_or(sit in ('bloqueado', 'encerramento'))) l
        from b group by lower(id_app) having count(*) >= 2 order by count(*) desc limit 15) t), '[]')
  ) into res;
  return res;
end $$;

create or replace function public.minhas_notificacoes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'nao_lidas', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'link', link,
        'criada_em', criada_em, 'lida', lida_em is not null) order by id desc)
      from (select * from public.notificacoes where para = auth.uid() order by id desc limit 50) n), '[]'));
end $$;

create or replace function public.marcar_notificacoes_lidas()
returns void language sql security definer set search_path = public as $$
  update public.notificacoes set lida_em = now() where para = auth.uid() and lida_em is null
$$;

-- Números da tela inicial.
create or replace function public.resumo_inicio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.meu_papel(); pb public.papel := public.meu_papel_bloq();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'ativacao', jsonb_build_object(
      'aguardando_analise', (select count(*) from public.cadastros where status = 'aguardando_analise'
                               and (p in ('moderador', 'monitorador') or enviado_por = auth.uid())),
      'aguardando_contato', (select count(*) from public.cadastros where status = 'aguardando_contato'
                               and (p in ('moderador', 'monitorador') or enviado_por = auth.uid()))),
    'bloqueios', case when pb is null then null else jsonb_build_object(
      'bloqueados_agora', (select count(*) from public.bloqueios b where public.situacao_bloqueio(b) = 'bloqueado'
                             and (pb in ('moderador', 'monitorador') or b.registrado_por = auth.uid())),
      'tratativas_pendentes', (select count(*) from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
                                where t.status = 'pendente' and case pb
                                  when 'moderador' then true
                                  when 'monitorador' then t.responsavel_email = public.meu_email()
                                  else b.registrado_por = auth.uid() end)) end,
    'notificacoes', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null));
end $$;

-- ---------------------------------------------------------------------
-- Importação do histórico (só pelo SQL Editor; o app não pode chamar)
-- p_horas_planilha: horas de fato aplicadas na planilha ('0' ou 'Definitivo' = encerramento).
-- Nulo = calcula pela regra atual. A ocorrência é sempre recalculada pela data.
-- ---------------------------------------------------------------------
create or replace function public.importar_bloqueio(
  p_id_app text, p_nome text, p_cidade text, p_infracao text, p_inicio timestamptz,
  p_registrado_por_nome text, p_revisar text default null, p_horas_planilha text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  i smallint;
  h text := nullif(lower(btrim(coalesce(p_horas_planilha, ''))), '');
begin
  select id into i from public.infracoes where nome = p_infracao;
  if i is null then raise exception 'Infração desconhecida: %', p_infracao; end if;
  perform public.inserir_bloqueio(p_id_app, coalesce(nullif(btrim(p_nome), ''), '(sem nome)'),
    case when exists (select 1 from public.cidades where nome = p_cidade) then p_cidade end,
    i, p_inicio, null, coalesce(nullif(btrim(p_registrado_por_nome), ''), '(não informado)'), null, true, p_revisar,
    h is not null,
    case when h is null or h in ('0', 'definitivo') then null else round(h::numeric)::integer end);
end $$;

-- ---------------------------------------------------------------------
-- RLS (leitura direta) e permissões
-- ---------------------------------------------------------------------
alter table public.cidades enable row level security;
alter table public.infracoes enable row level security;
alter table public.bloqueios enable row level security;
alter table public.eventos_bloqueio enable row level security;
alter table public.tarefas enable row level security;
alter table public.notificacoes enable row level security;

drop policy if exists cidades_leitura on public.cidades;
create policy cidades_leitura on public.cidades for select to authenticated using (public.meu_papel() is not null);
drop policy if exists infracoes_leitura on public.infracoes;
create policy infracoes_leitura on public.infracoes for select to authenticated using (public.meu_papel_bloq() is not null);
drop policy if exists bloqueios_leitura on public.bloqueios;
create policy bloqueios_leitura on public.bloqueios for select to authenticated
  using (public.meu_papel_bloq() in ('moderador', 'monitorador') or registrado_por = auth.uid());
drop policy if exists eventos_bloqueio_leitura on public.eventos_bloqueio;
create policy eventos_bloqueio_leitura on public.eventos_bloqueio for select to authenticated
  using (exists (select 1 from public.bloqueios b where b.id = bloqueio_id));
drop policy if exists tarefas_leitura on public.tarefas;
create policy tarefas_leitura on public.tarefas for select to authenticated
  using (exists (select 1 from public.bloqueios b where b.id = bloqueio_id));
drop policy if exists notificacoes_leitura on public.notificacoes;
create policy notificacoes_leitura on public.notificacoes for select to authenticated using (para = auth.uid());

-- View para análises no SQL Editor
create or replace view public.vw_bloqueios with (security_invoker = true) as
select b.id, b.id_app, b.nome_entregador, b.cidade, b.infracao, b.ocorrencia, b.ocorrencia_total,
       coalesce(b.horas::text, 'encerramento') as punicao, b.horas, b.inicio, b.fim,
       public.situacao_bloqueio(b) as situacao, b.registrado_por_nome,
       t.tipo as tratativa_tipo, t.status as tratativa_status,
       coalesce(public.nome_por_email(t.responsavel_email), case when t.id is not null then 'Moderadores' end) as tratativa_responsavel,
       t.concluida_em as tratativa_concluida_em,
       round(extract(epoch from t.concluida_em - t.criada_em) / 3600.0, 1) as horas_ate_tratativa,
       b.importado, b.revisar
  from public.bloqueios b left join public.tarefas t on t.bloqueio_id = b.id;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.importar_bloqueio(text, text, text, text, timestamptz, text, text, text) from authenticated;
revoke execute on function public.inserir_bloqueio(text, text, text, smallint, timestamptz, uuid, text, text, boolean, text, boolean, integer) from authenticated;
revoke execute on function public.notificar(uuid, text, text) from authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.bloqueios, public.tarefas, public.notificacoes;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
