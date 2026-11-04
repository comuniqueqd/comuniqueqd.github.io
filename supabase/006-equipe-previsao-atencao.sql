-- =====================================================================
-- Migração 006: Regras de equipe, previsão de término, entregadores de atenção e
-- prazo da tratativa editável
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rodar DEPOIS do 005-analises-anexos.sql. Não apaga dados e pode rodar mais de uma vez.
--
--   * REGRAS DE EQUIPE (aba da Equipe; todos veem, só moderadores editam): cada cidade tem a
--     gestão (Quero Delivery ou Operador Logístico), o operador logístico (parceiro de fora,
--     cadastrado uma vez e usado em várias cidades), as tarifas e o responsável.
--     Cidades de operador logístico usam o "responsável pelos operadores" (um só para todas);
--     cidades da Quero Delivery têm o seu responsável. O responsável recebe as tratativas, um
--     aviso a cada cadastro novo da cidade e o aviso de tratativa atrasada.
--   * PREVISÃO DE TÉRMINO nos cadastros da ativação, nas tratativas e nas atividades:
--     quem está com a tarefa informa até quando termina (só informativo).
--   * ENTREGADORES DE ATENÇÃO: a uma leve do limite, reincidentes, mais de um tipo de
--     infração em 50 dias, ou aprovados há pouco que já levaram bloqueio.
--   * PRAZO DA TRATATIVA (32 h) editável pelo moderador na aba Regras dos bloqueios.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Regras de equipe: operadores, gestão das cidades, tarifas, telefones
-- ---------------------------------------------------------------------
create table if not exists public.operadores_logisticos (
  id      smallint generated always as identity primary key,
  nome    text not null unique check (length(btrim(nome)) between 1 and 80),
  contato text check (length(contato) <= 40),
  ativo   boolean not null default true
);

alter table public.cidades add column if not exists gestao text not null default 'quero';
alter table public.cidades drop constraint if exists cidades_gestao_check;
alter table public.cidades add constraint cidades_gestao_check check (gestao in ('quero', 'operador'));
alter table public.cidades add column if not exists operador_id smallint references public.operadores_logisticos (id) on delete set null;
alter table public.cidades add column if not exists tarifa_inicial numeric(8, 2) check (tarifa_inicial >= 0);
alter table public.cidades add column if not exists tarifa_tipo text check (tarifa_tipo in ('km', 'bairro'));
alter table public.cidades add column if not exists adicional_km numeric(8, 2) check (adicional_km >= 0);

alter table public.membros add column if not exists telefone text check (length(telefone) <= 40);

create table if not exists public.parametros_equipe (
  unico                          boolean primary key default true check (unico),
  responsavel_operadores_email   text references public.membros (email) on update cascade on delete set null,
  atualizado_em                  timestamptz,
  atualizado_por                 text
);
insert into public.parametros_equipe (unico) values (true) on conflict do nothing;

alter table public.parametros_bloqueio add column if not exists atencao_janela_dias integer not null default 50
  check (atencao_janela_dias between 1 and 365);

-- Responsável "bruto" da cidade (qualquer membro): o dos operadores, se a cidade é de operador
-- logístico; senão, o da própria cidade.
create or replace function public.responsavel_cidade_email(p_cidade text)
returns text language sql stable security definer set search_path = public as $$
  select case when c.gestao = 'operador' then (select responsavel_operadores_email from public.parametros_equipe)
              else c.responsavel_email end
    from public.cidades c where c.nome = p_cidade
$$;

-- Quem cuida da tratativa: o responsável, se ele for monitorador ou moderador nos bloqueios;
-- senão nulo (= todos os moderadores).
create or replace function public.responsavel_da_cidade(p_cidade text)
returns text language sql stable security definer set search_path = public as $$
  select m.email from public.membros m
   where m.email = public.responsavel_cidade_email(p_cidade) and m.papel_bloqueios in ('moderador', 'monitorador')
$$;

-- Passa as tratativas pendentes das cidades para o responsável atual (menos as realocadas à mão).
create or replace function public.reatribuir_tarefas(p_cidades text[])
returns void language sql security definer set search_path = public as $$
  update public.tarefas set responsavel_email = public.responsavel_da_cidade(cidade)
   where cidade = any (p_cidades) and status = 'pendente' and realocada_em is null
     and tipo <> 'completar_dados'
     and responsavel_email is distinct from public.responsavel_da_cidade(cidade)
$$;

create or replace function public.regras_equipe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare mod boolean := public.meu_papel() = 'moderador';
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'pode_editar', mod,
    'responsavel_operadores', (select jsonb_build_object('email', m.email, 'nome', m.nome, 'telefone', m.telefone,
                                   'recebe_tratativas', m.papel_bloqueios in ('moderador', 'monitorador'))
                                 from public.parametros_equipe p join public.membros m on m.email = p.responsavel_operadores_email),
    'operadores', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'contato', o.contato, 'ativo', o.ativo,
                       'cidades', (select count(*) from public.cidades c where c.operador_id = o.id and c.ativa)) order by o.nome)
                     from public.operadores_logisticos o), '[]'),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', c.nome, 'ativa', c.ativa, 'gestao', c.gestao,
        'operador_id', c.operador_id, 'operador_nome', o.nome, 'operador_contato', o.contato,
        'tarifa_inicial', c.tarifa_inicial, 'tarifa_tipo', c.tarifa_tipo, 'adicional_km', c.adicional_km,
        'responsavel_email', c.responsavel_email,
        'responsavel_efetivo_email', r.email, 'responsavel_nome', r.nome, 'responsavel_telefone', r.telefone,
        'recebe_tratativas', public.responsavel_da_cidade(c.nome) is not null)
        order by c.ativa desc, c.nome)
      from public.cidades c
      left join public.operadores_logisticos o on o.id = c.operador_id
      left join public.membros r on r.email = public.responsavel_cidade_email(c.nome)), '[]'),
    -- lista de pessoas só para quem edita
    'membros', case when mod then coalesce((select jsonb_agg(jsonb_build_object('email', email, 'nome', nome, 'telefone', telefone,
                   'papel_bloqueios', papel_bloqueios) order by nome) from public.membros), '[]') end);
end $$;

create or replace function public.salvar_cidade_equipe(
  p_nome text, p_gestao text, p_responsavel_email text, p_operador_id smallint,
  p_tarifa_inicial numeric, p_tarifa_tipo text, p_adicional_km numeric, p_ativa boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  n text := upper(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  r text := nullif(lower(btrim(coalesce(p_responsavel_email, ''))), '');
begin
  perform public.exigir_papel('moderador');
  if n !~ '^\S.* - [A-Z]{2}$' then raise exception 'Use o formato CIDADE - UF, ex.: LAGARTO - SE.'; end if;
  if coalesce(p_gestao, '') not in ('quero', 'operador') then raise exception 'Escolha a gestão da cidade.'; end if;
  if r is not null and not exists (select 1 from public.membros where email = r) then raise exception 'Escolha um membro da equipe.'; end if;
  if p_operador_id is not null and not exists (select 1 from public.operadores_logisticos where id = p_operador_id) then
    raise exception 'Operador logístico não encontrado.';
  end if;
  if p_tarifa_tipo is not null and p_tarifa_tipo not in ('km', 'bairro') then raise exception 'Tipo de tarifa inválido.'; end if;
  if coalesce(p_tarifa_inicial, 0) < 0 or coalesce(p_adicional_km, 0) < 0 then raise exception 'As tarifas não podem ser negativas.'; end if;
  insert into public.cidades (nome, gestao, responsavel_email, operador_id, tarifa_inicial, tarifa_tipo, adicional_km, ativa)
  values (n, p_gestao, r, case when p_gestao = 'operador' then p_operador_id end, p_tarifa_inicial, p_tarifa_tipo,
          case when p_tarifa_tipo = 'km' then p_adicional_km end, coalesce(p_ativa, true))
  on conflict (nome) do update set gestao = excluded.gestao, responsavel_email = excluded.responsavel_email,
    operador_id = excluded.operador_id, tarifa_inicial = excluded.tarifa_inicial, tarifa_tipo = excluded.tarifa_tipo,
    adicional_km = excluded.adicional_km, ativa = excluded.ativa;
  perform public.reatribuir_tarefas(array[n]);
end $$;

-- a aba Regras dos bloqueios continua podendo criar/ativar cidades (o responsável vem da Regras de equipe)
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
  on conflict (nome) do update set responsavel_email = coalesce(excluded.responsavel_email, public.cidades.responsavel_email),
    ativa = excluded.ativa;
  perform public.reatribuir_tarefas(array[n]);
end $$;

create or replace function public.salvar_operador(p_id smallint, p_nome text, p_contato text, p_ativo boolean default true)
returns smallint language plpgsql security definer set search_path = public as $$
declare novo smallint;
begin
  perform public.exigir_papel('moderador');
  if coalesce(btrim(p_nome), '') = '' then raise exception 'Informe o nome do operador.'; end if;
  if p_id is null then
    insert into public.operadores_logisticos (nome, contato, ativo)
    values (btrim(p_nome), nullif(btrim(coalesce(p_contato, '')), ''), coalesce(p_ativo, true)) returning id into novo;
    return novo;
  end if;
  update public.operadores_logisticos set nome = btrim(p_nome), contato = nullif(btrim(coalesce(p_contato, '')), ''), ativo = coalesce(p_ativo, true)
   where id = p_id;
  if not found then raise exception 'Operador não encontrado.'; end if;
  return p_id;
exception when unique_violation then raise exception 'Já existe um operador com esse nome.';
end $$;

create or replace function public.salvar_responsavel_operadores(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare r text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  perform public.exigir_papel('moderador');
  if r is not null and not exists (select 1 from public.membros where email = r) then raise exception 'Escolha um membro da equipe.'; end if;
  update public.parametros_equipe set responsavel_operadores_email = r, atualizado_em = now(), atualizado_por = public.meu_email();
  perform public.reatribuir_tarefas(array(select nome from public.cidades where gestao = 'operador'));
end $$;

create or replace function public.salvar_telefone(p_email text, p_telefone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador');
  update public.membros set telefone = nullif(btrim(coalesce(p_telefone, '')), '') where email = lower(btrim(coalesce(p_email, '')));
  if not found then raise exception 'Membro não encontrado.'; end if;
end $$;

-- Aviso ao responsável da cidade a cada cadastro novo na ativação
create or replace function public.avisar_cadastro_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select m.user_id into u from public.membros m where m.email = public.responsavel_cidade_email(new.cidade);
  perform public.notificar(u, format('Cadastro novo em %s: %s, enviado por %s.', new.cidade,
            coalesce('ID ' || new.id_app, 'CPF ' || new.cpf), coalesce(public.nome_de(new.enviado_por), '—')),
          '#ativacao/pendentes');
  return new;
end $$;
drop trigger if exists avisar_cadastro_novo on public.cadastros;
create trigger avisar_cadastro_novo after insert on public.cadastros for each row execute function public.avisar_cadastro_novo();

-- Tratativa atrasada: avisa os moderadores e também o responsável da cidade (uma vez por tarefa)
create or replace function public.verificar_atrasos()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; t record;
begin
  if public.meu_papel() is null then return 0; end if;
  for t in select x.id, x.cidade, x.responsavel_email, b.nome_entregador, b.infracao,
                  coalesce(public.nome_por_email(x.responsavel_email), 'Moderadores') resp,
                  floor(extract(epoch from now() - x.criada_em) / 3600)::integer h
             from public.tarefas x join public.bloqueios b on b.id = x.bloqueio_id
            where public.tarefa_atrasada(x) and x.atraso_avisado_em is null
            for update of x skip locked loop
    update public.tarefas set atraso_avisado_em = now() where id = t.id;
    insert into public.notificacoes (para, texto, link)
    select distinct m.user_id, format('Tratativa atrasada há %s h: %s (%s), com %s.', t.h, t.nome_entregador, t.infracao, t.resp)
             || case when m.papel_bloqueios = 'moderador' then ' Você pode realocar.' else '' end,
           '#bloqueios/tratativas'
      from public.membros m
     where m.user_id is not null
       and (m.papel_bloqueios = 'moderador' or m.email = t.responsavel_email or m.email = public.responsavel_cidade_email(t.cidade));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Prazo da tratativa editável
-- ---------------------------------------------------------------------
create or replace function public.salvar_prazo_tratativa(p_horas integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador');
  if p_horas is null or p_horas not between 1 and 720 then raise exception 'O prazo deve ser de 1 a 720 horas.'; end if;
  update public.parametros_bloqueio set tratativa_prazo_horas = p_horas, atualizado_em = now(), atualizado_por = public.meu_email();
end $$;

create or replace function public.regras_bloqueio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'infracoes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'nome', i.nome, 'horas_1a', i.horas_1a, 'horas_2a', i.horas_2a,
        'terceira_encerra', i.terceira_encerra, 'fator', i.fator, 'janela_dias', i.janela_dias,
        'ativa', i.ativa, 'ordem', i.ordem, 'atualizada_em', i.atualizada_em, 'atualizada_por', i.atualizada_por,
        'leve', i.leve, 'escala_para', i.escala_para,
        'previstas', (select jsonb_agg(public.horas_previstas(i, n) order by n) from generate_series(1, 5) n))
        order by i.leve, i.ordem, i.nome) from public.infracoes i), '[]'),
    'leves', (select jsonb_build_object('limite', leves_limite, 'janela_dias', leves_janela_dias,
                'atualizado_em', atualizado_em, 'atualizado_por', atualizado_por) from public.parametros_bloqueio),
    'prazo_tratativa_horas', (select tratativa_prazo_horas from public.parametros_bloqueio),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', c.nome, 'ativa', c.ativa, 'gestao', c.gestao, 'responsavel_email', public.responsavel_cidade_email(c.nome),
        'responsavel_nome', public.nome_por_email(public.responsavel_cidade_email(c.nome)),
        'responsavel_valido', public.responsavel_da_cidade(c.nome) is not null)
        order by c.nome) from public.cidades c), '[]'),
    'responsaveis', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'nome', nome, 'papel', papel_bloqueios) order by nome)
        from public.membros where papel_bloqueios in ('moderador', 'monitorador')), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Previsão de término (cadastro, tratativa, atividade)
-- ---------------------------------------------------------------------
alter table public.cadastros add column if not exists previsao timestamptz;
alter table public.cadastros add column if not exists previsao_por_nome text;
alter table public.tarefas add column if not exists previsao timestamptz;
alter table public.tarefas add column if not exists previsao_por_nome text;
alter table public.atividades add column if not exists previsao timestamptz;
alter table public.atividades add column if not exists previsao_por_nome text;

-- p_tipo: 'cadastro' | 'tarefa' | 'atividade'; p_previsao nulo = tirar a previsão
create or replace function public.definir_previsao(p_tipo text, p_id uuid, p_previsao timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  quem text := (select nome from public.membros where email = public.meu_email());
  c public.cadastros; t public.tarefas; a public.atividades;
  pb public.papel := public.meu_papel_bloq();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_previsao is not null and p_previsao < now() - interval '5 minutes' then raise exception 'A previsão precisa ser no futuro.'; end if;
  if p_previsao is not null and p_previsao > now() + interval '60 days' then raise exception 'A previsão pode ser de no máximo 60 dias.'; end if;
  if p_tipo = 'cadastro' then
    perform public.exigir_papel('moderador', 'monitorador');
    select * into c from public.cadastros where id = p_id for update;
    if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
    if c.status not in ('aguardando_analise', 'aguardando_contato') then raise exception 'Este cadastro já foi decidido.'; end if;
    update public.cadastros set previsao = p_previsao, previsao_por_nome = case when p_previsao is null then null else quem end where id = p_id;
  elsif p_tipo = 'tarefa' then
    select * into t from public.tarefas where id = p_id for update;
    if t.id is null then raise exception 'Tarefa não encontrada.'; end if;
    if t.status <> 'pendente' then raise exception 'Esta tarefa já foi concluída.'; end if;
    if not (pb = 'moderador' or (pb = 'monitorador' and (t.responsavel_email = public.meu_email() or t.tipo = 'completar_dados'))) then
      raise exception 'Só quem está com a tarefa (ou um moderador) informa a previsão.' using errcode = '42501';
    end if;
    update public.tarefas set previsao = p_previsao, previsao_por_nome = case when p_previsao is null then null else quem end where id = p_id;
  elsif p_tipo = 'atividade' then
    select * into a from public.atividades where id = p_id for update;
    if a.id is null then raise exception 'Atividade não encontrada.'; end if;
    if a.status <> 'aceita' then raise exception 'A previsão é de quem aceitou a atividade.'; end if;
    if a.aceita_por is distinct from auth.uid() and public.meu_papel() <> 'moderador' then
      raise exception 'Só quem aceitou (ou um moderador) informa a previsão.' using errcode = '42501';
    end if;
    update public.atividades set previsao = p_previsao, previsao_por_nome = case when p_previsao is null then null else quem end where id = p_id;
  else
    raise exception 'Tipo inválido.';
  end if;
end $$;

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
      'previsao', c.previsao, 'previsao_por_nome', c.previsao_por_nome,
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

-- a previsão sai quando o cadastro é decidido (a decisão encerra a tarefa)
create or replace function public.limpar_previsao_cadastro()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status not in ('aguardando_analise', 'aguardando_contato') then
    new.previsao := null; new.previsao_por_nome := null;
  end if;
  return new;
end $$;
drop trigger if exists limpar_previsao_cadastro on public.cadastros;
create trigger limpar_previsao_cadastro before update of status on public.cadastros for each row execute function public.limpar_previsao_cadastro();

create or replace function public.json_tarefa(t public.tarefas)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'tipo', t.tipo, 'status', t.status,
    'responsavel_email', t.responsavel_email,
    'responsavel_nome', coalesce(public.nome_por_email(t.responsavel_email), 'Moderadores'),
    'criada_em', t.criada_em, 'concluida_em', t.concluida_em, 'nota', t.nota, 'importada', t.importada,
    'concluida_por_nome', case when t.concluida_por is not null then public.nome_de(t.concluida_por) end,
    'atrasada', public.tarefa_atrasada(t), 'prazo_horas', extract(epoch from public.prazo_tratativa()) / 3600,
    'realocada_em', t.realocada_em, 'realocada_por_nome', t.realocada_por_nome,
    'previsao', t.previsao, 'previsao_por_nome', t.previsao_por_nome)
$$;

create or replace function public.json_atividade(a public.atividades)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'titulo', a.titulo, 'descricao', a.descricao,
    'criada_por', a.criada_por, 'criada_por_nome', a.criada_por_nome, 'criada_em', a.criada_em,
    'sugeridas_para', to_jsonb(a.sugeridas_para),
    'sugeridas_nomes', coalesce((select jsonb_agg(m.nome order by m.nome) from public.membros m where m.user_id = any (a.sugeridas_para)), '[]'),
    'para_todos', cardinality(a.sugeridas_para) = 0 or a.criada_em <= now() - interval '10 minutes',
    'para_mim', auth.uid() = any (a.sugeridas_para),
    'prazo', a.prazo, 'status', a.status,
    'aceita_por', a.aceita_por, 'aceita_por_nome', a.aceita_por_nome, 'aceita_em', a.aceita_em,
    'concluida_por_nome', a.concluida_por_nome, 'concluida_em', a.concluida_em, 'nota', a.nota,
    'previsao', a.previsao, 'previsao_por_nome', a.previsao_por_nome,
    'pode_aceitar', a.status = 'aberta' and public.atividade_aberta_para_mim(a),
    'pode_concluir', a.status = 'aceita' and (a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'),
    'pode_prever', a.status = 'aceita' and (a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'),
    'pode_excluir', a.criada_por = auth.uid() or public.meu_papel() = 'moderador')
$$;

-- ---------------------------------------------------------------------
-- Entregadores de atenção
-- ---------------------------------------------------------------------
create or replace function public.entregadores_atencao()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  jan  integer := (select atencao_janela_dias from public.parametros_bloqueio);
  lim  integer := (select leves_limite from public.parametros_bloqueio);
  desde timestamptz := now() - make_interval(days => jan);
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return coalesce((
    with jb as (select * from public.bloqueios where inicio >= desde),
    ag as (
      select lower(b.id_app) id,
             (array_agg(b.nome_entregador order by b.inicio desc) filter (where not b.dados_pendentes))[1] nome_bloqueio,
             (array_agg(b.cidade order by b.inicio desc) filter (where b.cidade is not null))[1] cidade_bloqueio,
             max(b.inicio) ultimo,
             count(*) filter (where not b.leve) normais,
             count(distinct b.infracao_id) filter (where not b.leve) tipos,
             bool_or(not b.leve and public.situacao_bloqueio(b) = 'bloqueado') bloqueado_agora,
             bool_or(not b.leve and public.situacao_bloqueio(b) = 'encerramento') encerrado
        from jb b group by 1),
    aprov as (
      select lower(c.id_app) id, min(ev.em) aprovado_em
        from public.cadastros c join public.eventos ev on ev.cadastro_id = c.id and ev.tipo = 'aprovado'
       where c.status = 'aprovado' and c.id_app is not null group by 1),
    x as (
      select ag.*, coalesce(e.nome, ag.nome_bloqueio) nome, coalesce(e.cidade, ag.cidade_bloqueio) cidade,
             public.leves_acumuladas(ag.id, now()) leves, ap.aprovado_em,
             (select count(*) from jb where lower(jb.id_app) = ag.id and not jb.leve and jb.inicio >= ap.aprovado_em) bloq_apos
        from ag left join aprov ap on ap.id = ag.id left join public.entregadores e on e.id_app = ag.id
       where not ag.encerrado),
    m as (
      select x.*, array_remove(array[
               case when lim > 1 and x.leves = lim - 1 then format('a uma infração leve do limite (%s de %s)', x.leves, lim) end,
               case when x.normais >= 2 then format('reincidente: %s bloqueios em %s dias', x.normais, jan) end,
               case when x.tipos >= 2 then format('%s tipos de infração em %s dias', x.tipos, jan) end,
               case when x.aprovado_em > now() - interval '30 days' and x.bloq_apos > 0 then 'aprovado há pouco e já bloqueado' end], null) motivos
        from x)
    select jsonb_agg(jsonb_build_object('id_app', m.id, 'nome', m.nome, 'cidade', m.cidade, 'ultimo', m.ultimo,
             'bloqueios', m.normais, 'tipos', m.tipos, 'leves', m.leves, 'bloqueado_agora', m.bloqueado_agora,
             'aprovado_em', m.aprovado_em, 'motivos', to_jsonb(m.motivos))
             order by cardinality(m.motivos) desc, m.ultimo desc)
      from m where cardinality(m.motivos) > 0), '[]');
end $$;
drop function if exists public.listar_atencao();

-- Tela inicial: + entregadores de atenção e o prazo da tratativa
create or replace function public.resumo_inicio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.meu_papel(); pb public.papel := public.meu_papel_bloq(); eu text := public.meu_email();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'papel', p, 'papel_bloqueios', pb,
    'prazo_tratativa_horas', (select tratativa_prazo_horas from public.parametros_bloqueio),
    'ativacao', (select jsonb_build_object(
      'aguardando_analise', count(*) filter (where status = 'aguardando_analise' and (p in ('moderador', 'monitorador') or enviado_por = auth.uid())),
      'aguardando_contato', count(*) filter (where status = 'aguardando_contato' and (p in ('moderador', 'monitorador') or enviado_por = auth.uid())),
      'meus_aguardando_analise', count(*) filter (where status = 'aguardando_analise' and enviado_por = auth.uid()),
      'meus_aguardando_contato', count(*) filter (where status = 'aguardando_contato' and enviado_por = auth.uid()),
      'equipe_aguardando_analise', count(*) filter (where status = 'aguardando_analise'),
      'equipe_aguardando_contato', count(*) filter (where status = 'aguardando_contato'))
      from public.cadastros),
    'bloqueios', case when pb is null then null else (select jsonb_build_object(
      'bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado' and (pb in ('moderador', 'monitorador') or b.registrado_por = auth.uid())),
      'meus_bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado' and b.registrado_por = auth.uid()),
      'equipe_bloqueados_agora', count(*) filter (where public.situacao_bloqueio(b) = 'bloqueado'),
      'tratativas_pendentes', (select count(*) from public.tarefas t join public.bloqueios x on x.id = t.bloqueio_id
                                where t.status = 'pendente' and case pb
                                  when 'moderador' then true
                                  when 'monitorador' then t.responsavel_email = eu or t.tipo = 'completar_dados'
                                  else x.registrado_por = auth.uid() end),
      'equipe_tratativas_pendentes', (select count(*) from public.tarefas t where t.status = 'pendente'),
      'tratativas_atrasadas', (select count(*) from public.tarefas t where public.tarefa_atrasada(t)
                                 and (pb = 'moderador' or (pb = 'monitorador' and t.responsavel_email = eu))),
      'atencao', jsonb_array_length(public.entregadores_atencao()))
      from public.bloqueios b) end,
    'atividades', (select jsonb_build_object(
      'para_aceitar', count(*) filter (where a.status = 'aberta' and public.atividade_aberta_para_mim(a) and a.criada_por is distinct from auth.uid()),
      'minhas_em_andamento', count(*) filter (where a.status = 'aceita' and a.aceita_por = auth.uid()),
      'equipe_abertas', count(*) filter (where a.status in ('aberta', 'aceita')))
      from public.atividades a),
    'notificacoes', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null));
end $$;

-- ---------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------
alter table public.operadores_logisticos enable row level security;
alter table public.parametros_equipe enable row level security;
drop policy if exists operadores_leitura on public.operadores_logisticos;
create policy operadores_leitura on public.operadores_logisticos for select to authenticated using ((select public.meu_papel()) is not null);
drop policy if exists parametros_equipe_leitura on public.parametros_equipe;
create policy parametros_equipe_leitura on public.parametros_equipe for select to authenticated using ((select public.meu_papel()) is not null);

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
revoke execute on function public.responsavel_cidade_email(text) from authenticated;
revoke execute on function public.reatribuir_tarefas(text[]) from authenticated;
revoke execute on function public.nome_por_email(text) from authenticated;
revoke execute on function public.comentarios_de(text, integer) from authenticated;
revoke execute on function public.anotar_entregador(text, text, text, uuid) from authenticated;
revoke execute on function public.bloqueio_cria_entregador() from authenticated;
revoke execute on function public.avisar_cadastro_novo() from authenticated;
revoke execute on function public.limpar_previsao_cadastro() from authenticated;
revoke execute on function public.json_tarefa(public.tarefas) from authenticated;
revoke execute on function public.json_atividade(public.atividades) from authenticated;
revoke execute on function public.atividade_aberta_para_mim(public.atividades) from authenticated;
revoke execute on function public.ativacao_ao_bloqueio(text) from authenticated;
revoke execute on function public.pode_ver_bloqueio(uuid) from authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke select on public.anexos from authenticated;
