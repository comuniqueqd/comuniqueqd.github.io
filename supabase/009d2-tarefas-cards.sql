-- =====================================================================
-- 009d (parte 2): tarefas em cards.
--
-- * atividades ganha tipo + campos (cada tipo tem os seus campos, validados aqui),
--   cidade, modo (solicitacao = pedir a alguém/à equipe; registro = o que já fiz,
--   entra direto como concluída), meta/progresso, pausa ("aguardando terceiro"
--   pausa o relógio), checklist e quem concluiu.
-- * tipos_tarefa: nome e prazo padrão (SLA, em horas) de cada tipo; o moderador
--   ajusta. Sem prazo informado, a tarefa recebe o prazo padrão do tipo.
-- * Progresso: "Ativar entregadores" conta sozinho os cadastros aprovados da cidade
--   enviados por quem pegou, depois que pegou; os outros com meta avançam no botão.
-- * Comentários com @menções (quem é mencionado recebe aviso) e agradecimentos.
-- * pegar_proxima(): a próxima tarefa justa para mim (as sugeridas para mim
--   primeiro, depois a de prazo mais perto, depois a mais antiga).
-- * verificar_tarefas() (o front chama a cada 5 min): tarefa sem dono depois da
--   metade do prazo avisa os moderadores (uma vez); tarefa com dono que passou do
--   prazo avisa quem está com ela (uma vez).
-- Pode rodar mais de uma vez. Rodar depois da 009d (ajuda, aviso, turno).
-- =====================================================================

create table if not exists public.tipos_tarefa (
  tipo        text primary key,
  nome        text not null,
  icone       text,
  prazo_horas numeric check (prazo_horas is null or prazo_horas between 0.25 and 720),
  ordem       int not null default 0
);
alter table public.tipos_tarefa enable row level security;
revoke all on public.tipos_tarefa from anon, authenticated;
insert into public.tipos_tarefa (tipo, nome, icone, prazo_horas, ordem) values
  ('procurar_entregador', 'Procurar entregador', '🔎', 1, 1),
  ('contato_entregador', 'Contato com entregador', '📞', 8, 2),
  ('pedido_problema', 'Pedido com problema', '📦', 4, 3),
  ('pagamento_entregador', 'Pagamento ao entregador', '💸', 24, 4),
  ('fazer_contato', 'Fazer contato', '☎️', 24, 5),
  ('criar_comunicado', 'Criar comunicado para entregadores', '📣', 24, 6),
  ('revisar_registro', 'Revisar registro', '🔍', 48, 7),
  ('ativar_entregadores', 'Ativar entregadores', '🛵', 72, 8),
  ('ativar_parceiro', 'Ativar parceiro', '🏪', 120, 9),
  ('livre', 'Outra tarefa (texto livre)', '📝', null, 10)
on conflict (tipo) do nothing;

alter table public.atividades add column if not exists tipo text references public.tipos_tarefa (tipo);
alter table public.atividades add column if not exists campos jsonb not null default '{}';
alter table public.atividades add column if not exists cidade text;
alter table public.atividades add column if not exists modo text not null default 'solicitacao';
alter table public.atividades drop constraint if exists atividades_modo_check;
alter table public.atividades add constraint atividades_modo_check check (modo in ('solicitacao', 'registro'));
alter table public.atividades add column if not exists meta int check (meta is null or meta between 1 and 1000);
alter table public.atividades add column if not exists progresso int not null default 0;
alter table public.atividades add column if not exists aguardando_desde timestamptz;
alter table public.atividades add column if not exists aguardando_motivo text check (length(aguardando_motivo) <= 300);
alter table public.atividades add column if not exists pausa_seg int not null default 0;
alter table public.atividades add column if not exists checklist jsonb not null default '[]';
alter table public.atividades add column if not exists concluida_por uuid;
alter table public.atividades add column if not exists escalada_em timestamptz;
alter table public.atividades add column if not exists prazo_avisado_em timestamptz;
create index if not exists atividades_tipo on public.atividades (tipo, criada_em desc);

create table if not exists public.comentarios_tarefa (
  id           bigint generated always as identity primary key,
  atividade_id uuid not null references public.atividades (id) on delete cascade,
  por          uuid not null,
  por_nome     text,
  texto        text not null check (length(btrim(texto)) between 1 and 1000),
  mencoes      uuid[] not null default '{}',
  em           timestamptz not null default now()
);
create index if not exists comentarios_tarefa_ativ on public.comentarios_tarefa (atividade_id, em);
create table if not exists public.agradecimentos (
  atividade_id uuid not null references public.atividades (id) on delete cascade,
  de           uuid not null,
  de_nome      text,
  para         uuid not null,
  em           timestamptz not null default now(),
  primary key (atividade_id, de)
);
alter table public.comentarios_tarefa enable row level security;
alter table public.agradecimentos enable row level security;
revoke all on public.comentarios_tarefa, public.agradecimentos from anon, authenticated;

-- ---------------------------------------------------------------------
-- Campos de cada tipo
-- ---------------------------------------------------------------------
create or replace function public.motivos_contato_entregador()
returns text[] language sql immutable as $$
  select array['Prestação de contas', 'Retorno de itens', 'Confirmação de entrega', 'Solicitação de troca', 'Ajuda por conta de veículo']
$$;

-- devolve os campos limpos (texto aparado, números como número) ou dá erro com o que falta
create or replace function public.validar_campos_tarefa(p_tipo text, p_campos jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  c jsonb := coalesce(p_campos, '{}');
  saida jsonb := '{}';
  k text;
  v text;
  n numeric;
  obrig text[];
  opc text[];
begin
  if jsonb_typeof(c) <> 'object' then raise exception 'Campos inválidos.'; end if;
  case p_tipo
    when 'ativar_entregadores', 'ativar_parceiro' then obrig := array['cidade', 'quantidade']; opc := array['motivo'];
    when 'fazer_contato' then obrig := array['contato', 'cidade', 'motivo']; opc := array['telefone'];
    when 'contato_entregador' then obrig := array['id_app', 'tratativa']; opc := array['motivo', 'detalhe'];
    when 'pedido_problema' then obrig := array['pedido', 'cidade', 'problema']; opc := array[]::text[];
    when 'pagamento_entregador' then obrig := array['id_app', 'valor', 'motivo']; opc := array[]::text[];
    when 'revisar_registro' then obrig := array['referencia', 'motivo']; opc := array[]::text[];
    when 'criar_comunicado' then obrig := array['cidade', 'motivo']; opc := array[]::text[];
    when 'procurar_entregador' then obrig := array['cidade']; opc := array['detalhe'];
    when 'livre' then obrig := array[]::text[]; opc := array[]::text[];
    else raise exception 'Tipo de tarefa desconhecido.';
  end case;
  foreach k in array obrig || opc loop
    v := nullif(btrim(coalesce(c->>k, '')), '');
    if v is null then
      if k = any (obrig) then
        raise exception 'Preencha: %.', case k when 'cidade' then 'a cidade' when 'quantidade' then 'a quantidade' when 'contato' then 'o nome da pessoa ou do estabelecimento'
          when 'motivo' then 'o motivo' when 'id_app' then 'o ID do entregador' when 'tratativa' then 'se é tratativa' when 'pedido' then 'o número do pedido'
          when 'problema' then 'o problema' when 'valor' then 'o valor' when 'referencia' then 'o registro a revisar' else k end;
      end if;
      continue;
    end if;
    if length(v) > 600 then raise exception 'Um dos campos passou de 600 caracteres.'; end if;
    if k = 'quantidade' then
      begin n := v::numeric; exception when others then raise exception 'A quantidade precisa ser um número.'; end;
      if n < 1 or n > 1000 or n <> trunc(n) then raise exception 'A quantidade vai de 1 a 1000.'; end if;
      saida := saida || jsonb_build_object(k, n::int);
    elsif k = 'valor' then
      begin n := replace(v, ',', '.')::numeric; exception when others then raise exception 'O valor precisa ser um número.'; end;
      if n <= 0 or n > 100000 then raise exception 'O valor precisa ser maior que zero.'; end if;
      saida := saida || jsonb_build_object(k, round(n, 2));
    elsif k = 'tratativa' then
      if v not in ('true', 'false', 'sim', 'nao', 'não') then raise exception 'Diga se é tratativa.'; end if;
      saida := saida || jsonb_build_object(k, v in ('true', 'sim'));
    elsif k = 'id_app' then
      if v !~ '^[A-Za-z0-9]{4,40}$' then raise exception 'O ID do entregador tem só letras e números (4 a 40).'; end if;
      saida := saida || jsonb_build_object(k, lower(v));
    elsif k = 'cidade' then
      saida := saida || jsonb_build_object(k, upper(v));
    else
      saida := saida || jsonb_build_object(k, v);
    end if;
  end loop;
  if p_tipo = 'contato_entregador' and not (saida->>'tratativa')::boolean
     and not coalesce(saida->>'motivo' = any (public.motivos_contato_entregador()), false) then
    raise exception 'Escolha o motivo do contato.';
  end if;
  return saida;
end $$;

-- título montado a partir dos campos (o card mostra o resto)
create or replace function public.titulo_tarefa(p_tipo text, c jsonb, p_titulo text default null)
returns text language sql stable set search_path = public as $$
  select left(case p_tipo
    when 'ativar_entregadores' then format('Ativar %s entregador(es) · %s', c->>'quantidade', c->>'cidade')
    when 'ativar_parceiro' then format('Ativar %s parceiro(s) · %s', c->>'quantidade', c->>'cidade')
    when 'fazer_contato' then format('Fazer contato: %s · %s', c->>'contato', c->>'cidade')
    when 'contato_entregador' then format('Contato com entregador %s%s', coalesce((select e.nome from public.entregadores e where e.id_app = c->>'id_app'), c->>'id_app'),
                                          case when (c->>'tratativa')::boolean then ' · tratativa' else ' · ' || (c->>'motivo') end)
    when 'pedido_problema' then format('Pedido com problema: %s · %s', c->>'pedido', c->>'cidade')
    when 'pagamento_entregador' then format('Pagamento ao entregador %s · R$ %s', coalesce((select e.nome from public.entregadores e where e.id_app = c->>'id_app'), c->>'id_app'),
                                            replace(to_char((c->>'valor')::numeric, 'FM999990.00'), '.', ','))
    when 'revisar_registro' then format('Revisar registro: %s', c->>'referencia')
    when 'criar_comunicado' then format('Criar comunicado para entregadores · %s', c->>'cidade')
    when 'procurar_entregador' then format('Procurar entregador · %s', c->>'cidade')
    else btrim(coalesce(p_titulo, '')) end, 150)
$$;

-- progresso: "Ativar entregadores" conta sozinho; o resto vem da coluna
create or replace function public.progresso_tarefa(a public.atividades)
returns int language sql stable security definer set search_path = public as $$
  select case when a.tipo = 'ativar_entregadores' and coalesce(a.aceita_por, case when a.modo = 'registro' then a.criada_por end) is not null then
    (select count(*)::int from public.cadastros c
      where c.status = 'aprovado' and c.cidade = a.cidade
        and c.enviado_por = coalesce(a.aceita_por, a.criada_por)
        and c.enviado_em >= coalesce(a.aceita_em, a.criada_em) - case when a.modo = 'registro' then interval '30 days' else interval '0' end
        and (a.concluida_em is null or c.enviado_em <= a.concluida_em))
  else a.progresso end
$$;

-- segundos trabalhando (sem a espera de terceiros)
create or replace function public.segundos_execucao(a public.atividades)
returns int language sql stable as $$
  select case when a.aceita_em is null then null else greatest(0,
    extract(epoch from coalesce(a.concluida_em, now()) - a.aceita_em)::int - a.pausa_seg
    - coalesce(extract(epoch from now() - a.aguardando_desde)::int, 0)) end
$$;

create or replace function public.pode_mexer_tarefa(a public.atividades)
returns boolean language sql stable security definer set search_path = public as $$
  select a.criada_por = auth.uid() or a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'
$$;

create or replace function public.json_atividade(a public.atividades)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'titulo', a.titulo, 'descricao', a.descricao,
    'criada_por', a.criada_por, 'criada_por_nome', a.criada_por_nome, 'criada_em', a.criada_em,
    'sugeridas_para', to_jsonb(a.sugeridas_para),
    'sugeridas_nomes', coalesce((select jsonb_agg(m.nome order by m.nome) from public.membros m where m.user_id = any (a.sugeridas_para)), '[]'),
    'para_todos', cardinality(a.sugeridas_para) = 0 or a.criada_em <= now() - interval '10 minutes',
    'para_mim', auth.uid() = any (a.sugeridas_para),
    'opcional', a.opcional, 'opcional_para_mim', a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false),
    'cadastro_id', a.cadastro_id,
    'prazo', a.prazo, 'status', a.status,
    'aceita_por', a.aceita_por, 'aceita_por_nome', a.aceita_por_nome, 'aceita_em', a.aceita_em,
    'concluida_por_nome', a.concluida_por_nome, 'concluida_em', a.concluida_em, 'nota', a.nota,
    'previsao', a.previsao, 'previsao_por_nome', a.previsao_por_nome,
    -- 009d2
    'tipo', coalesce(a.tipo, 'livre'), 'tipo_nome', coalesce(t.nome, 'Outra tarefa'), 'tipo_icone', coalesce(t.icone, '📝'),
    'campos', a.campos, 'cidade', a.cidade, 'modo', a.modo,
    'meta', a.meta, 'progresso', public.progresso_tarefa(a), 'progresso_automatico', a.tipo = 'ativar_entregadores',
    'aguardando_desde', a.aguardando_desde, 'aguardando_motivo', a.aguardando_motivo,
    'checklist', a.checklist,
    'seg_espera', extract(epoch from coalesce(a.aceita_em, now()) - a.criada_em)::int,
    'seg_execucao', public.segundos_execucao(a),
    'atrasada', a.prazo is not null and a.status <> 'concluida' and a.aguardando_desde is null and now() > a.prazo,
    'comentarios', (select count(*) from public.comentarios_tarefa x where x.atividade_id = a.id),
    'agradecimentos', coalesce((select jsonb_agg(g.de_nome order by g.em) from public.agradecimentos g where g.atividade_id = a.id), '[]'),
    'agradeci', exists (select 1 from public.agradecimentos g where g.atividade_id = a.id and g.de = auth.uid()),
    'pode_agradecer', a.status = 'concluida' and a.aceita_por is not null and a.aceita_por <> auth.uid(),
    'pode_mexer', public.pode_mexer_tarefa(a),
    'pode_aceitar', a.status = 'aberta' and public.atividade_aberta_para_mim(a),
    'pode_concluir', a.status = 'aceita' and (a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'),
    'pode_prever', a.status = 'aceita' and (a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'),
    'pode_excluir', a.criada_por = auth.uid() or public.meu_papel() = 'moderador')
  from (select 1) _ left join public.tipos_tarefa t on t.tipo = a.tipo
$$;

-- ---------------------------------------------------------------------
-- Criar tarefa (solicitação para alguém/para a equipe, ou registro do que já fiz)
-- ---------------------------------------------------------------------
create or replace function public.criar_tarefa(p_tipo text, p_campos jsonb default '{}', p_titulo text default null,
  p_descricao text default null, p_para uuid[] default '{}', p_prazo timestamptz default null, p_modo text default 'solicitacao')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  quem text := public.nome_de(auth.uid());
  c jsonb;
  tt public.tipos_tarefa;
  titulo text;
  para uuid[];
  cid text;
  a public.atividades;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into tt from public.tipos_tarefa where tipo = coalesce(p_tipo, 'livre');
  if tt.tipo is null then raise exception 'Tipo de tarefa desconhecido.'; end if;
  if coalesce(p_modo, '') not in ('solicitacao', 'registro') then raise exception 'Escolha se é um pedido ou um registro do que você já fez.'; end if;
  c := public.validar_campos_tarefa(tt.tipo, p_campos);
  titulo := public.titulo_tarefa(tt.tipo, c, p_titulo);
  if coalesce(titulo, '') = '' then raise exception 'Escreva o que precisa ser feito.'; end if;
  if length(coalesce(p_descricao, '')) > 1500 then raise exception 'A descrição pode ter no máximo 1500 caracteres.'; end if;
  if p_modo = 'solicitacao' and p_prazo is not null and p_prazo < now() then raise exception 'O prazo precisa ser no futuro.'; end if;
  select coalesce(array_agg(distinct m.user_id), '{}') into para from public.membros m where m.user_id = any (coalesce(p_para, '{}'));
  if cardinality(para) <> cardinality(array(select distinct x from unnest(coalesce(p_para, '{}')) x)) then
    raise exception 'Alguma pessoa escolhida não faz parte da equipe.';
  end if;
  cid := coalesce(c->>'cidade', (select e.cidade from public.entregadores e where e.id_app = c->>'id_app'));
  if p_modo = 'registro' then
    insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, status, aceita_por, aceita_por_nome, aceita_em,
                                   concluida_por, concluida_por_nome, concluida_em, tipo, campos, cidade, modo, meta)
    values (titulo, nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid(), quem, '{}', null, 'concluida', auth.uid(), quem, now(),
            auth.uid(), quem, now(), tt.tipo, c, cid, 'registro', (c->>'quantidade')::int)
    returning * into a;
  else
    insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, tipo, campos, cidade, modo, meta)
    values (titulo, nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid(), quem, para,
            coalesce(p_prazo, now() + tt.prazo_horas * interval '1 hour'), tt.tipo, c, cid, 'solicitacao', (c->>'quantidade')::int)
    returning * into a;
    insert into public.notificacoes (para, texto, link)
    select x, format('%s pediu para você: %s', quem, titulo), '#atividades/sugeridas' from unnest(para) x where x is distinct from auth.uid();
  end if;
  return public.json_atividade(a);
end $$;

-- aceitar/concluir ganham "quem concluiu" (id) e saem do "aguardando"
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
  update public.atividades set status = 'concluida', concluida_por = auth.uid(), concluida_por_nome = quem, concluida_em = now(),
         pausa_seg = pausa_seg + coalesce(extract(epoch from now() - aguardando_desde)::int, 0), aguardando_desde = null,
         progresso = case when tipo = 'ativar_entregadores' then public.progresso_tarefa(a) else progresso end,
         nota = left(nullif(btrim(coalesce(p_nota, '')), ''), 600) where id = a.id;
  perform public.notificar(a.criada_por, format('%s concluiu a atividade: %s', quem, a.titulo), '#atividades/sugeridas');
end $$;

-- "aguardando terceiro": pausa o relógio (p_motivo nulo = retomar)
create or replace function public.aguardar_terceiro(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null or a.status <> 'aceita' then raise exception 'Só uma tarefa em andamento pode esperar alguém.'; end if;
  if a.aceita_por is distinct from auth.uid() and public.meu_papel() <> 'moderador' then
    raise exception 'Só quem está com a tarefa muda isso.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is not null then
    if a.aguardando_desde is not null then raise exception 'A tarefa já está aguardando.'; end if;
    update public.atividades set aguardando_desde = now(), aguardando_motivo = left(btrim(p_motivo), 300) where id = a.id;
  else
    if a.aguardando_desde is null then raise exception 'A tarefa não está aguardando.'; end if;
    -- o prazo anda junto com a pausa
    update public.atividades set pausa_seg = pausa_seg + extract(epoch from now() - aguardando_desde)::int,
           prazo = case when prazo is null then null else prazo + (now() - aguardando_desde) end,
           aguardando_desde = null, aguardando_motivo = null
     where id = a.id;
  end if;
end $$;

-- progresso manual (tipos com meta, menos "Ativar entregadores", que conta sozinho)
create or replace function public.avancar_tarefa(p_id uuid, p_delta int default 1)
returns int language plpgsql security definer set search_path = public as $$
declare a public.atividades; novo int;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Tarefa não encontrada.'; end if;
  if a.meta is null then raise exception 'Esta tarefa não tem meta.'; end if;
  if a.tipo = 'ativar_entregadores' then raise exception 'O progresso desta tarefa conta sozinho (cadastros aprovados).'; end if;
  if a.status = 'aberta' then raise exception 'Pegue a tarefa antes de marcar o progresso.'; end if;
  if not public.pode_mexer_tarefa(a) then raise exception 'Só quem está com a tarefa marca o progresso.' using errcode = '42501'; end if;
  novo := greatest(0, least(a.meta * 10, a.progresso + coalesce(p_delta, 1)));
  update public.atividades set progresso = novo where id = a.id;
  return novo;
end $$;

-- checklist: p_acao 'incluir' (p_texto), 'marcar' (p_indice, alterna), 'remover' (p_indice)
create or replace function public.checklist_tarefa(p_id uuid, p_acao text, p_indice int default null, p_texto text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.atividades; l jsonb; item jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null then raise exception 'Tarefa não encontrada.'; end if;
  if not public.pode_mexer_tarefa(a) then raise exception 'Só quem criou, quem está com a tarefa ou um moderador mexe no checklist.' using errcode = '42501'; end if;
  l := a.checklist;
  if p_acao = 'incluir' then
    if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'Escreva o item.'; end if;
    if jsonb_array_length(l) >= 30 then raise exception 'O checklist vai até 30 itens.'; end if;
    l := l || jsonb_build_array(jsonb_build_object('texto', left(btrim(p_texto), 200), 'feito', false));
  elsif p_acao in ('marcar', 'remover') then
    if p_indice is null or p_indice < 0 or p_indice >= jsonb_array_length(l) then raise exception 'Item não encontrado.'; end if;
    if p_acao = 'remover' then l := l - p_indice;
    else
      item := l->p_indice;
      item := case when (item->>'feito')::boolean then jsonb_build_object('texto', item->>'texto', 'feito', false)
                   else jsonb_build_object('texto', item->>'texto', 'feito', true, 'por_nome', public.nome_de(auth.uid()), 'em', now()) end;
      l := jsonb_set(l, array[p_indice::text], item);
    end if;
  else raise exception 'Ação desconhecida.';
  end if;
  update public.atividades set checklist = l where id = a.id;
  return l;
end $$;

-- comentários com @menções: avisa quem foi mencionado, quem criou e quem está com a tarefa (menos quem escreveu)
create or replace function public.comentar_tarefa(p_id uuid, p_texto text, p_mencoes uuid[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := public.nome_de(auth.uid()); men uuid[];
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id;
  if a.id is null then raise exception 'Tarefa não encontrada.'; end if;
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'Escreva o comentário.'; end if;
  if length(p_texto) > 1000 then raise exception 'O comentário vai até 1000 caracteres.'; end if;
  select coalesce(array_agg(distinct m.user_id), '{}') into men from public.membros m where m.user_id = any (coalesce(p_mencoes, '{}')) and m.user_id <> auth.uid();
  insert into public.comentarios_tarefa (atividade_id, por, por_nome, texto, mencoes) values (a.id, auth.uid(), quem, btrim(p_texto), men);
  insert into public.notificacoes (para, texto, link)
  select x, case when x = any (men) then format('%s mencionou você em "%s": %s', quem, a.titulo, left(btrim(p_texto), 200))
                 else format('%s comentou em "%s": %s', quem, a.titulo, left(btrim(p_texto), 200)) end, '#atividades/sugeridas'
    from (select distinct x from unnest(men || array[a.criada_por, a.aceita_por]) x where x is not null and x <> auth.uid()) d;
end $$;

create or replace function public.comentarios_da_tarefa(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'por_nome', c.por_nome, 'texto', c.texto, 'em', c.em, 'meu', c.por = auth.uid(),
      'mencoes', coalesce((select jsonb_agg(m.nome) from public.membros m where m.user_id = any (c.mencoes)), '[]')) order by c.em)
    from public.comentarios_tarefa c where c.atividade_id = p_id), '[]');
end $$;

-- agradecer quem fez (liga/desliga)
create or replace function public.agradecer_tarefa(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.atividades; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id;
  if a.id is null or a.status <> 'concluida' or a.aceita_por is null then raise exception 'Só dá para agradecer uma tarefa concluída.'; end if;
  if a.aceita_por = auth.uid() then raise exception 'Você não pode agradecer a si mesmo.'; end if;
  if exists (select 1 from public.agradecimentos where atividade_id = a.id and de = auth.uid()) then
    delete from public.agradecimentos where atividade_id = a.id and de = auth.uid();
    return false;
  end if;
  insert into public.agradecimentos (atividade_id, de, de_nome, para) values (a.id, auth.uid(), quem, a.aceita_por);
  perform public.notificar(a.aceita_por, format('👏 %s agradeceu por: %s', quem, a.titulo), '#atividades/sugeridas');
  return true;
end $$;

-- "Pedir para alguém": uma tarefa aberta passa a ser sugerida para uma pessoa (que recebe aviso)
create or replace function public.pedir_tarefa_para(p_id uuid, p_para uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; m public.membros; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null or a.status <> 'aberta' then raise exception 'Esta tarefa não está mais aberta.'; end if;
  select * into m from public.membros where user_id = p_para;
  if m.user_id is null or m.papel is null then raise exception 'Escolha alguém da equipe.'; end if;
  update public.atividades set sugeridas_para = array[m.user_id] where id = a.id;
  if m.user_id <> auth.uid() then
    perform public.notificar(m.user_id, format('%s pediu para você: %s', quem, a.titulo), '#atividades/sugeridas');
  end if;
end $$;

-- a próxima tarefa justa para mim: sugerida para mim > prazo mais perto > mais antiga
create or replace function public.pegar_proxima()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.atividades;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades x
   where x.status = 'aberta' and not x.opcional and x.criada_por is distinct from auth.uid() and public.atividade_aberta_para_mim(x)
   order by (auth.uid() = any (x.sugeridas_para)) desc, x.prazo nulls last, x.criada_em
   limit 1 for update skip locked;
  if a.id is null then return null; end if;
  perform public.aceitar_atividade(a.id);
  select * into a from public.atividades where id = a.id;
  return public.json_atividade(a);
end $$;

-- sem dono depois da metade do prazo → moderadores; passou do prazo com dono → quem está com ela
create or replace function public.verificar_tarefas()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; a public.atividades;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  for a in select * from public.atividades x
            where x.status = 'aberta' and x.escalada_em is null and x.prazo is not null and not x.opcional
              and now() >= x.criada_em + (x.prazo - x.criada_em) / 2
            for update skip locked loop
    update public.atividades set escalada_em = now() where id = a.id;
    insert into public.notificacoes (para, texto, link)
    select m.user_id, format('Tarefa sem ninguém, já na metade do prazo: %s (de %s)', a.titulo, a.criada_por_nome), '#atividades/sugeridas'
      from public.membros m where m.user_id is not null and (m.papel = 'moderador' or m.papel_bloqueios = 'moderador');
    n := n + 1;
  end loop;
  for a in select * from public.atividades x
            where x.status = 'aceita' and x.prazo_avisado_em is null and x.prazo is not null and x.aguardando_desde is null and now() > x.prazo
            for update skip locked loop
    update public.atividades set prazo_avisado_em = now() where id = a.id;
    perform public.notificar(a.aceita_por, format('Tarefa atrasada (o prazo era %s): %s',
      to_char(a.prazo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), a.titulo), '#atividades/sugeridas');
    n := n + 1;
  end loop;
  return n;
end $$;

-- tipos e prazos padrão (todos leem; moderador muda o prazo)
create or replace function public.tipos_tarefa()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object('tipos', coalesce((select jsonb_agg(to_jsonb(t) order by t.ordem) from public.tipos_tarefa t), '[]'),
                            'motivos_contato', to_jsonb(public.motivos_contato_entregador()));
end $$;
create or replace function public.salvar_prazo_tipo_tarefa(p_tipo text, p_prazo_horas numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador');
  if p_prazo_horas is not null and (p_prazo_horas < 0.25 or p_prazo_horas > 720) then raise exception 'O prazo vai de 15 minutos a 30 dias.'; end if;
  update public.tipos_tarefa set prazo_horas = p_prazo_horas where tipo = p_tipo;
  if not found then raise exception 'Tipo de tarefa desconhecido.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Permissões e tráfego
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['comentarios_tarefa', 'agradecimentos', 'tipos_tarefa'] loop
    if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = t and g.tgname = 'marcar_mudanca_ins') then
      execute format('create trigger marcar_mudanca_ins after insert on public.%I referencing new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_upd after update on public.%I referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_del after delete on public.%I referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas()', t);
    end if;
  end loop;
end $$;

revoke all on function public.motivos_contato_entregador() from public, anon, authenticated;
revoke all on function public.validar_campos_tarefa(text, jsonb) from public, anon, authenticated;
revoke all on function public.titulo_tarefa(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.progresso_tarefa(public.atividades) from public, anon, authenticated;
revoke all on function public.segundos_execucao(public.atividades) from public, anon, authenticated;
revoke all on function public.pode_mexer_tarefa(public.atividades) from public, anon, authenticated;
revoke all on function public.json_atividade(public.atividades) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.criar_tarefa(text, jsonb, text, text, uuid[], timestamptz, text)', 'public.concluir_atividade(uuid, text)',
                           'public.aguardar_terceiro(uuid, text)', 'public.avancar_tarefa(uuid, int)', 'public.checklist_tarefa(uuid, text, int, text)',
                           'public.comentar_tarefa(uuid, text, uuid[])', 'public.comentarios_da_tarefa(uuid)', 'public.agradecer_tarefa(uuid)',
                           'public.pedir_tarefa_para(uuid, uuid)', 'public.pegar_proxima()', 'public.verificar_tarefas()',
                           'public.tipos_tarefa()', 'public.salvar_prazo_tipo_tarefa(text, numeric)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
