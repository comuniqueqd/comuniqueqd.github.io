-- =====================================================================
-- Migração 004: atividades sugeridas, tratativas atrasadas, registros gerais, ficha do
-- entregador, tela inicial (seus números e os da equipe) e ajustes
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rodar DEPOIS do 003-entregadores.sql. Não apaga dados e pode rodar mais de uma vez.
--
--   * TRATATIVA ATRASADA: pendente há mais de parametros_bloqueio.tratativa_prazo_horas (32 h)
--     fica vermelha; os moderadores recebem um aviso no sino (uma vez por tarefa, gerado quando
--     alguém abre o app: não há serviço agendado) e podem REALOCAR a tarefa para outra pessoa.
--   * ATIVIDADES SUGERIDAS: qualquer pessoa cria e pode sugerir para pessoas; se ninguém aceitar
--     em 10 minutos, fica aberta para todos. Quem aceitou conclui (ou um moderador); quem criou
--     ou um moderador exclui.
--   * REGISTROS: um feed único das ações dos dois módulos, para todos (cada um vê os módulos a
--     que tem acesso).
--   * FICHA DO ENTREGADOR: a consulta passa a trazer a linha do tempo do ID nos dois módulos.
--   * TELA INICIAL: os números da pessoa e os da equipe.
--   * REVERTER ENCERRAMENTO: liberar um encerramento de parceria vira "encerramento revertido".
--   * Ajustes: lista de cidades da ativação vem da tabela de cidades; regras de leitura (RLS)
--     consultam o papel uma vez por consulta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas e colunas
-- ---------------------------------------------------------------------
alter table public.parametros_bloqueio add column if not exists tratativa_prazo_horas integer not null default 32
  check (tratativa_prazo_horas between 1 and 720);
alter table public.tarefas add column if not exists atraso_avisado_em timestamptz;
alter table public.tarefas add column if not exists realocada_em timestamptz;
alter table public.tarefas add column if not exists realocada_por_nome text;

alter table public.eventos_bloqueio drop constraint if exists eventos_bloqueio_tipo_check;
alter table public.eventos_bloqueio add constraint eventos_bloqueio_tipo_check
  check (tipo in ('registrado', 'liberado_antes', 'tratativa_concluida', 'corrigido', 'revisado', 'realocada'));

create table if not exists public.atividades (
  id                 uuid primary key default gen_random_uuid(),
  titulo             text not null check (length(btrim(titulo)) between 1 and 150),
  descricao          text check (length(descricao) <= 1500),
  criada_por         uuid not null,
  criada_por_nome    text not null,
  criada_em          timestamptz not null default now(),
  sugeridas_para     uuid[] not null default '{}',   -- vazio = para todos desde o início
  prazo              timestamptz,
  status             text not null default 'aberta' check (status in ('aberta', 'aceita', 'concluida')),
  aceita_por         uuid,
  aceita_por_nome    text,
  aceita_em          timestamptz,
  concluida_por_nome text,
  concluida_em       timestamptz,
  nota               text check (length(nota) <= 600)
);
create index if not exists atividades_status on public.atividades (status, criada_em desc);

-- ---------------------------------------------------------------------
-- Situação: liberar um encerramento de parceria = encerramento revertido
-- ---------------------------------------------------------------------
create or replace function public.situacao_bloqueio(b public.bloqueios)
returns text language sql stable as $$
  select case
    when b.liberado_em is not null and b.horas is null then 'revertido'
    when b.liberado_em is not null then 'liberado_antes'
    when b.horas is null then 'encerramento'
    when now() < b.fim then 'bloqueado'
    else 'liberado'
  end
$$;

create or replace function public.liberar_bloqueio(p_bloqueio uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bloqueios; quem text := (select nome from public.membros where email = public.meu_email());
begin
  perform public.exigir_bloq('moderador', 'monitorador');
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo %.', (select case when horas is null then 'para reverter o encerramento' else 'da liberação' end from public.bloqueios where id = p_bloqueio);
  end if;
  select * into b from public.bloqueios where id = p_bloqueio for update;
  if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;
  if public.situacao_bloqueio(b) not in ('bloqueado', 'encerramento') then
    raise exception 'Este bloqueio não está ativo.';
  end if;
  update public.bloqueios set liberado_em = now(), liberado_por = auth.uid(), motivo_liberacao = left(btrim(p_motivo), 300)
   where id = b.id;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
  values (b.id, 'liberado_antes', auth.uid(), quem,
          case when b.horas is null then 'Encerramento revertido: ' else '' end || left(btrim(p_motivo), 300));
  perform public.notificar(b.registrado_por,
    case when b.horas is null
      then format('O encerramento de parceria de %s (%s) foi revertido por %s: %s', b.nome_entregador, b.infracao, quem, btrim(p_motivo))
      else format('%s (%s) foi liberado antes do prazo por %s: %s', b.nome_entregador, b.infracao, quem, btrim(p_motivo)) end,
    '#bloqueios/meus');
end $$;

-- ---------------------------------------------------------------------
-- Tratativas atrasadas
-- ---------------------------------------------------------------------
create or replace function public.prazo_tratativa()
returns interval language sql stable security definer set search_path = public as $$
  select make_interval(hours => coalesce((select tratativa_prazo_horas from public.parametros_bloqueio limit 1), 32))
$$;

create or replace function public.tarefa_atrasada(t public.tarefas)
returns boolean language sql stable security definer set search_path = public as $$
  select t.status = 'pendente' and t.tipo <> 'completar_dados' and t.criada_em < now() - public.prazo_tratativa()
$$;

-- Chamada pelo app a cada carregamento: avisa os moderadores, uma vez por tarefa, das que passaram do prazo.
create or replace function public.verificar_atrasos()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; t record;
begin
  if public.meu_papel() is null then return 0; end if;
  for t in select x.id, b.nome_entregador, b.infracao,
                  coalesce(public.nome_por_email(x.responsavel_email), 'Moderadores') resp,
                  floor(extract(epoch from now() - x.criada_em) / 3600)::integer h
             from public.tarefas x join public.bloqueios b on b.id = x.bloqueio_id
            where public.tarefa_atrasada(x) and x.atraso_avisado_em is null
            for update of x skip locked loop
    update public.tarefas set atraso_avisado_em = now() where id = t.id;
    insert into public.notificacoes (para, texto, link)
    select m.user_id, format('Tratativa atrasada há %s h: %s (%s), com %s. Você pode realocar.', t.h, t.nome_entregador, t.infracao, t.resp),
           '#bloqueios/tratativas'
      from public.membros m where m.papel_bloqueios = 'moderador' and m.user_id is not null;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Moderador passa uma tarefa para outra pessoa (monitorador ou moderador dos bloqueios).
create or replace function public.realocar_tarefa(p_tarefa uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t    public.tarefas;
  b    public.bloqueios;
  m    public.membros;
  quem text := (select nome from public.membros where email = public.meu_email());
begin
  perform public.exigir_bloq('moderador');
  select * into t from public.tarefas where id = p_tarefa for update;
  if t.id is null then raise exception 'Tarefa não encontrada.'; end if;
  if t.status <> 'pendente' then raise exception 'Esta tarefa já foi concluída.'; end if;
  if t.tipo = 'completar_dados' then raise exception 'Esta tarefa já fica com todo o monitoramento.'; end if;
  select * into m from public.membros where email = lower(btrim(coalesce(p_email, '')));
  if m.email is null or m.papel_bloqueios not in ('moderador', 'monitorador') then
    raise exception 'Escolha um monitorador ou moderador dos bloqueios.';
  end if;
  if m.email = t.responsavel_email then raise exception 'A tarefa já está com %.', m.nome; end if;
  update public.tarefas set responsavel_email = m.email, realocada_em = now(), realocada_por_nome = quem where id = t.id;
  select * into b from public.bloqueios where id = t.bloqueio_id;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
  values (b.id, 'realocada', auth.uid(), quem,
          format('de %s para %s', coalesce(public.nome_por_email(t.responsavel_email), 'Moderadores'), m.nome));
  perform public.notificar(m.user_id, format('%s passou para você a tratativa de %s (%s).', quem, b.nome_entregador, b.infracao),
                           '#bloqueios/tratativas');
end $$;

-- Trocar o responsável da cidade leva as tratativas pendentes, menos as realocadas à mão.
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
  update public.tarefas set responsavel_email = public.responsavel_da_cidade(n)
   where cidade = n and status = 'pendente' and realocada_em is null;
end $$;

-- Lista de cidades ativas (sugestões do formulário da ativação).
create or replace function public.listar_cidades()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(nome order by nome) from public.cidades where ativa), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Leitura de bloqueios e tarefas (com atraso e realocação)
-- ---------------------------------------------------------------------
create or replace function public.json_tarefa(t public.tarefas)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'tipo', t.tipo, 'status', t.status,
    'responsavel_email', t.responsavel_email,
    'responsavel_nome', coalesce(public.nome_por_email(t.responsavel_email), 'Moderadores'),
    'criada_em', t.criada_em, 'concluida_em', t.concluida_em, 'nota', t.nota, 'importada', t.importada,
    'concluida_por_nome', case when t.concluida_por is not null then public.nome_de(t.concluida_por) end,
    'atrasada', public.tarefa_atrasada(t), 'prazo_horas', extract(epoch from public.prazo_tratativa()) / 3600,
    'realocada_em', t.realocada_em, 'realocada_por_nome', t.realocada_por_nome)
$$;

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
    'tarefa', (select public.json_tarefa(t) from public.tarefas t where t.bloqueio_id = b.id)) end
$$;

create or replace function public.listar_tarefas(p_status text default 'pendente')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
begin
  return coalesce((
    select jsonb_agg(public.json_tarefa(t) || jsonb_build_object(
      'cidade', t.cidade,
      'minha', p = 'moderador' or t.responsavel_email = public.meu_email() or (t.tipo = 'completar_dados' and p = 'monitorador'),
      'bloqueio', public.json_bloqueio(b)) order by t.criada_em)
    from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
    where (p_status is null or t.status = p_status)
      and case p
            when 'moderador' then true
            when 'monitorador' then t.responsavel_email = public.meu_email() or t.tipo = 'completar_dados'
            else b.registrado_por = auth.uid()
          end), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Atividades sugeridas
-- ---------------------------------------------------------------------
-- quem pode ver e aceitar uma atividade aberta: as pessoas sugeridas e quem criou; depois de
-- 10 minutos sem ninguém aceitar (ou sem sugestão), todo mundo. Moderadores sempre veem.
create or replace function public.atividade_aberta_para_mim(a public.atividades)
returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(a.sugeridas_para) = 0 or auth.uid() = any (a.sugeridas_para)
      or a.criada_em <= now() - interval '10 minutes'
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
    'pode_aceitar', a.status = 'aberta' and public.atividade_aberta_para_mim(a),
    'pode_concluir', a.status = 'aceita' and (a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'),
    'pode_excluir', a.criada_por = auth.uid() or public.meu_papel() = 'moderador')
$$;

create or replace function public.sugerir_atividade(p_titulo text, p_descricao text default null, p_para uuid[] default '{}', p_prazo timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  quem text := (select nome from public.membros where email = public.meu_email());
  para uuid[];
  novo uuid;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'Escreva o que precisa ser feito.'; end if;
  if length(btrim(p_titulo)) > 150 then raise exception 'O título pode ter no máximo 150 caracteres.'; end if;
  if length(coalesce(p_descricao, '')) > 1500 then raise exception 'A descrição pode ter no máximo 1500 caracteres.'; end if;
  if p_prazo is not null and p_prazo < now() then raise exception 'O prazo precisa ser no futuro.'; end if;
  select coalesce(array_agg(distinct m.user_id), '{}') into para
    from public.membros m where m.user_id = any (coalesce(p_para, '{}'));
  if cardinality(para) <> cardinality(array(select distinct x from unnest(coalesce(p_para, '{}')) x)) then
    raise exception 'Alguma pessoa escolhida não faz parte da equipe.';
  end if;
  insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo)
  values (btrim(p_titulo), nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid(), quem, para, p_prazo)
  returning id into novo;
  insert into public.notificacoes (para, texto, link)
  select x, format('%s sugeriu uma atividade para você: %s', quem, btrim(p_titulo)), '#atividades/sugeridas'
    from unnest(para) x where x is distinct from auth.uid();
  return novo;
end $$;

create or replace function public.listar_atividades()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_papel('moderador', 'monitorador', 'suporte');
begin
  return coalesce((select jsonb_agg(public.json_atividade(a) order by a.criada_em desc)
    from public.atividades a
   where (a.status = 'aberta' and (p = 'moderador' or a.criada_por = auth.uid() or public.atividade_aberta_para_mim(a)))
      or a.status = 'aceita'
      or (a.status = 'concluida' and a.concluida_em > now() - interval '30 days')), '[]');
end $$;

create or replace function public.aceitar_atividade(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := (select nome from public.membros where email = public.meu_email());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Atividade não encontrada.'; end if;
  if a.status <> 'aberta' then raise exception 'Esta atividade já foi aceita por %.', a.aceita_por_nome; end if;
  if not public.atividade_aberta_para_mim(a) then
    raise exception 'Esta atividade foi sugerida para outras pessoas. Se ninguém aceitar em 10 minutos, ela abre para todos.' using errcode = '42501';
  end if;
  update public.atividades set status = 'aceita', aceita_por = auth.uid(), aceita_por_nome = quem, aceita_em = now() where id = a.id;
  perform public.notificar(a.criada_por, format('%s aceitou a atividade: %s', quem, a.titulo), '#atividades/sugeridas');
end $$;

create or replace function public.concluir_atividade(p_id uuid, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := (select nome from public.membros where email = public.meu_email());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Atividade não encontrada.'; end if;
  if a.status <> 'aceita' then raise exception 'Só dá para concluir uma atividade aceita.'; end if;
  if a.aceita_por is distinct from auth.uid() and public.meu_papel() <> 'moderador' then
    raise exception 'Só quem aceitou (ou um moderador) conclui esta atividade.' using errcode = '42501';
  end if;
  update public.atividades set status = 'concluida', concluida_por_nome = quem, concluida_em = now(),
         nota = left(nullif(btrim(coalesce(p_nota, '')), ''), 600) where id = a.id;
  perform public.notificar(a.criada_por, format('%s concluiu a atividade: %s', quem, a.titulo), '#atividades/sugeridas');
end $$;

create or replace function public.excluir_atividade(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id;
  if a.id is null then raise exception 'Atividade não encontrada.'; end if;
  if a.criada_por is distinct from auth.uid() and public.meu_papel() <> 'moderador' then
    raise exception 'Só quem criou (ou um moderador) pode excluir esta atividade.' using errcode = '42501';
  end if;
  delete from public.atividades where id = a.id;
end $$;

-- ---------------------------------------------------------------------
-- Registros: feed único das ações (cada pessoa vê os módulos a que tem acesso)
-- ---------------------------------------------------------------------
create or replace function public.listar_registros(
  p_antes timestamptz default null, p_limite integer default 100, p_modulo text default null,
  p_pessoa text default null, p_busca text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  bq  boolean := public.meu_papel_bloq() is not null;
  q   text := nullif(btrim(coalesce(p_busca, '')), '');
  lim integer := least(greatest(coalesce(p_limite, 100), 1), 300);
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.em desc, r.chave desc) from (
    select * from (
      -- ativação
      select 'a' || e.id chave, e.em, 'ativacao' modulo, e.tipo,
             public.nome_de(e.por) por_nome,
             case e.tipo when 'enviado' then 'enviou o cadastro' when 'aprovado' then 'aprovou o cadastro'
                         when 'reprovado' then 'reprovou o cadastro' when 'encerrado' then 'encerrou o cadastro'
                         when 'desfeito' then 'desfez a decisão do cadastro' else e.tipo end acao,
             concat_ws(' · ', case when e.motivo is not null then e.motivo end, e.detalhe) detalhe,
             c.id_app, c.cpf, null::text nome, c.cidade
        from public.eventos e join public.cadastros c on c.id = e.cadastro_id
      union all
      -- bloqueios
      select 'b' || e.id, e.em, 'bloqueios', e.tipo, coalesce(e.por_nome, b.registrado_por_nome),
             case e.tipo
               when 'registrado' then case when b.leve then 'registrou infração leve' when b.importado then 'registrou (planilha)' else 'registrou bloqueio' end
               when 'liberado_antes' then case when b.horas is null then 'reverteu o encerramento' else 'liberou antes do prazo' end
               when 'tratativa_concluida' then 'concluiu a tratativa'
               when 'corrigido' then 'corrigiu os dados' when 'revisado' then 'marcou como revisado'
               when 'realocada' then 'realocou a tratativa' else e.tipo end,
             concat_ws(' · ', b.infracao, e.detalhe),
             b.id_app, null, b.nome_entregador, b.cidade
        from public.eventos_bloqueio e join public.bloqueios b on b.id = e.bloqueio_id
       where bq
      union all
      -- comentários e alterações do cadastro do entregador
      select 'c' || k.id, k.em, 'bloqueios', k.tipo, k.por_nome,
             case k.tipo when 'alteracao' then 'alterou dados do entregador' else 'comentou sobre o entregador' end,
             k.texto, k.id_app, null, (select e.nome from public.entregadores e where e.id_app = k.id_app), null
        from public.comentarios_entregador k
       where bq
    ) x
    where (p_antes is null or x.em < p_antes)
      and (p_modulo is null or x.modulo = p_modulo)
      and (p_pessoa is null or x.por_nome = p_pessoa)
      and (q is null or concat_ws(' ', x.por_nome, x.acao, x.detalhe, x.id_app, x.cpf, x.nome, x.cidade) ilike '%' || q || '%'
                     or x.cpf = nullif(regexp_replace(q, '\D', '', 'g'), ''))
    order by x.em desc, x.chave desc
    limit lim) r), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Ficha do entregador: consulta com linha do tempo dos dois módulos
-- ---------------------------------------------------------------------
create or replace function public.consultar_entregador(p_busca text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q   text := btrim(coalesce(p_busca, ''));
  ids text[];
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if length(q) < 3 then raise exception 'Digite pelo menos 3 letras ou o ID.'; end if;
  select array_agg(x) into ids from (
    select id_app x from public.entregadores where id_app = lower(q) or nome ilike '%' || q || '%'
    union
    select lower(id_app) from public.bloqueios where lower(id_app) = lower(q) or nome_entregador ilike '%' || q || '%'
    union
    select lower(id_app) from public.cadastros where id_app is not null and (lower(id_app) = lower(q) or cpf = nullif(regexp_replace(q, '\D', '', 'g'), ''))
    limit 30) s;
  ids := coalesce(ids, '{}');
  return jsonb_build_object(
    'ids', to_jsonb(ids),
    'entregadores', coalesce((select jsonb_agg(jsonb_build_object(
        'id_app', i, 'nome', e.nome, 'cidade', e.cidade, 'atualizado_em', e.atualizado_em, 'atualizado_por_nome', e.atualizado_por_nome,
        'nomes_usados', (select jsonb_agg(distinct b.nome_entregador) from public.bloqueios b
                          where lower(b.id_app) = i and not b.dados_pendentes),
        'bloqueios', (select count(*) from public.bloqueios b where lower(b.id_app) = i and not b.leve),
        'leves', (select count(*) from public.bloqueios b where lower(b.id_app) = i and b.leve),
        'comentarios', public.comentarios_de(i),
        'linha_do_tempo', coalesce((select jsonb_agg(to_jsonb(l) order by l.em desc) from (
            select e2.em, 'ativacao' modulo, public.nome_de(e2.por) por_nome,
                   case e2.tipo when 'enviado' then 'Cadastro enviado' when 'aprovado' then 'Cadastro aprovado'
                                when 'reprovado' then 'Cadastro reprovado' when 'encerrado' then 'Cadastro encerrado'
                                else 'Decisão desfeita' end texto,
                   concat_ws(' · ', e2.motivo, e2.detalhe) detalhe
              from public.eventos e2 join public.cadastros c on c.id = e2.cadastro_id where lower(c.id_app) = i
            union all
            select ev.em, 'bloqueios', ev.por_nome,
                   case ev.tipo
                     when 'registrado' then case when b.leve then 'Infração leve: ' else 'Bloqueio: ' end || b.infracao
                     when 'liberado_antes' then case when b.horas is null then 'Encerramento revertido' else 'Liberado antes do prazo' end
                     when 'tratativa_concluida' then 'Tratativa realizada'
                     when 'corrigido' then 'Dados do bloqueio corrigidos' when 'revisado' then 'Registro revisado'
                     when 'realocada' then 'Tratativa realocada' else ev.tipo end,
                   ev.detalhe
              from public.eventos_bloqueio ev join public.bloqueios b on b.id = ev.bloqueio_id where lower(b.id_app) = i
            order by 1 desc limit 100) l), '[]')) order by e.nome nulls last, i)
      from unnest(ids) i left join public.entregadores e on e.id_app = i), '[]'),
    'bloqueios', coalesce((select jsonb_agg(public.json_bloqueio(b) order by b.inicio desc) from (
        select * from public.bloqueios b where lower(b.id_app) = any (ids) order by b.inicio desc limit 300) b), '[]'),
    'cadastros', coalesce((select jsonb_agg(jsonb_build_object(
        'id_app', c.id_app, 'cpf', c.cpf, 'cidade', c.cidade, 'status', c.status, 'situacao', public.status_texto(c.status),
        'enviado_em', c.enviado_em, 'enviado_por_nome', public.nome_de(c.enviado_por), 'motivo', c.motivo,
        'decidido_em', c.decidido_em)) from public.cadastros c
         where lower(c.id_app) = any (ids) or c.cpf = nullif(regexp_replace(q, '\D', '', 'g'), '')), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Tela inicial: seus números e os da equipe (+ papéis, para o app perceber mudança de acesso)
-- ---------------------------------------------------------------------
create or replace function public.resumo_inicio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.meu_papel(); pb public.papel := public.meu_papel_bloq(); eu text := public.meu_email();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'papel', p, 'papel_bloqueios', pb,
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
                                 and (pb = 'moderador' or (pb = 'monitorador' and t.responsavel_email = eu))))
      from public.bloqueios b) end,
    'atividades', (select jsonb_build_object(
      'para_aceitar', count(*) filter (where a.status = 'aberta' and public.atividade_aberta_para_mim(a) and a.criada_por is distinct from auth.uid()),
      'minhas_em_andamento', count(*) filter (where a.status = 'aceita' and a.aceita_por = auth.uid()),
      'equipe_abertas', count(*) filter (where a.status in ('aberta', 'aceita')))
      from public.atividades a),
    'notificacoes', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null));
end $$;

-- ---------------------------------------------------------------------
-- RLS: o papel é consultado uma vez por consulta, não por linha
-- ---------------------------------------------------------------------
alter table public.atividades enable row level security;
drop policy if exists atividades_leitura on public.atividades;
create policy atividades_leitura on public.atividades for select to authenticated using ((select public.meu_papel()) is not null);

drop policy if exists membros_leitura on public.membros;
create policy membros_leitura on public.membros for select to authenticated
  using ((select public.meu_papel()) = 'moderador' or email = (select public.meu_email()));
drop policy if exists pedidos_leitura on public.pedidos_acesso;
create policy pedidos_leitura on public.pedidos_acesso for select to authenticated
  using ((select public.meu_papel()) = 'moderador' or email = (select public.meu_email()));
drop policy if exists motivos_leitura on public.motivos;
create policy motivos_leitura on public.motivos for select to authenticated using ((select public.meu_papel()) is not null);
drop policy if exists cadastros_leitura on public.cadastros;
create policy cadastros_leitura on public.cadastros for select to authenticated
  using ((select public.meu_papel()) in ('moderador', 'monitorador') or enviado_por = (select auth.uid()));
drop policy if exists cidades_leitura on public.cidades;
create policy cidades_leitura on public.cidades for select to authenticated using ((select public.meu_papel()) is not null);
drop policy if exists infracoes_leitura on public.infracoes;
create policy infracoes_leitura on public.infracoes for select to authenticated using ((select public.meu_papel_bloq()) is not null);
drop policy if exists notificacoes_leitura on public.notificacoes;
create policy notificacoes_leitura on public.notificacoes for select to authenticated using (para = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
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
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.atividades;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
