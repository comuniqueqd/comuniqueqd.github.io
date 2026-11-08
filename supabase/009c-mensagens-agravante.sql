-- =====================================================================
-- 009c: mensagens prontas e agravante no bloqueio.
--
-- * infracoes.explicacao: a regra em linguagem simples (tirada da Política de
--   Boas Práticas e Conduta), usada nas mensagens ao entregador. Só é
--   preenchida aqui se estiver vazia; depois edita-se no app.
-- * infracoes.agravante / agravante_efeito: a situação que agrava a infração
--   (aparece como caixinha no Novo bloqueio) e o que ela faz:
--     mais_uma = conta como a próxima ocorrência (ex.: 1ª vira a punição da 2ª);
--     encerra  = encerramento de parceria já nesta ocorrência.
--   Retenção de valores: "não respondeu ao suporte em até 8 horas" (mais_uma).
--   Uso da conta por terceiros: "o terceiro é menor de 18 anos" (encerra).
-- * bloqueios.agravante: o texto do agravante aplicado (nulo = sem agravante).
-- * modelos_mensagem: textos das mensagens com marcadores {nome}, {infracao}…;
--   moderador (de qualquer módulo) edita em Ferramentas → Mensagens prontas.
--   Regra permanente: bloqueio temporário se chama "restrição temporária".
-- * registrar_bloqueio_agravante(): igual ao registrar_bloqueio, com p_agravante.
--   (nome novo de propósito: não cria uma segunda versão de registrar_bloqueio)
-- * previa_bloqueio(): ganha o bloco "agravante" (texto e punição com ele) e a "pendencia".
-- * Pendência e avisos rápidos (pedido do usuário): infracoes.pendencia (ex.: retenção de
--   valores → "Aguardando prestação de contas"). No Novo bloqueio pergunta-se "já foi
--   solucionado?"; se não, nasce um aviso rápido (avisos_rapidos) que fica na tela inicial
--   de todos até alguém marcar como resolvido (resolver_aviso_rapido). Resolver grava o
--   evento "pendencia_resolvida" no histórico do bloqueio. A tabela é genérica: na 009d
--   recebe também o aviso geral e o pedido de ajuda.
--
-- Pode rodar mais de uma vez. Rodar depois da 009b.
-- =====================================================================

alter table public.infracoes add column if not exists explicacao text check (length(explicacao) <= 600);
alter table public.infracoes add column if not exists agravante text check (length(agravante) <= 160);
alter table public.infracoes add column if not exists agravante_efeito text check (agravante_efeito in ('mais_uma', 'encerra'));
alter table public.bloqueios add column if not exists agravante text;
alter table public.infracoes add column if not exists pendencia text check (length(pendencia) <= 80);
update public.infracoes set pendencia = 'Aguardando prestação de contas'
 where nome = 'Retenção de Valores ou Equipamentos de Pagamento' and pendencia is null;

-- avisos rápidos da tela inicial (genérico: hoje a pendência do bloqueio; na 009d, aviso geral e ajuda)
create table if not exists public.avisos_rapidos (
  id                 bigint generated always as identity primary key,
  tipo               text not null check (tipo in ('pendencia')),
  titulo             text not null,
  bloqueio_id        uuid references public.bloqueios (id) on delete cascade,
  id_app             text,
  nome               text,
  cidade             text,
  criado_por         uuid,
  criado_por_nome    text,
  criado_em          timestamptz not null default now(),
  resolvido_em       timestamptz,
  resolvido_por      uuid,
  resolvido_por_nome text,
  nota               text check (length(nota) <= 500)
);
create index if not exists avisos_rapidos_abertos on public.avisos_rapidos (criado_em) where resolvido_em is null;
alter table public.avisos_rapidos enable row level security;
revoke all on public.avisos_rapidos from anon, authenticated;

-- histórico do bloqueio ganha "pendência resolvida"
alter table public.eventos_bloqueio drop constraint if exists eventos_bloqueio_tipo_check;
alter table public.eventos_bloqueio add constraint eventos_bloqueio_tipo_check
  check (tipo in ('registrado', 'liberado_antes', 'tratativa_concluida', 'corrigido', 'revisado', 'realocada', 'pendencia_resolvida'));

-- explicações da política (só onde ainda não há)
update public.infracoes i set explicacao = p.txt, atualizada_em = now(), atualizada_por = 'política de conduta (009c)'
  from (values
    ('Reabrir Pedido Após Aceite Sem Justificativa Plausível', 'Depois de aceitar um pedido, pedir para tirá-lo da sua tela sem um motivo comprovado. Só valem imprevistos fora do seu controle, como acidente, pane no veículo ou emergência pessoal, sempre com comprovação. Forma de pagamento e local de entrega não são motivo, porque já aparecem antes do aceite.'),
    ('Mal Uso Proposital do Aplicativo', 'Deixar de marcar no aplicativo as etapas da entrega: chegada na loja, saída, chegada ao cliente, entrega e, no pagamento na entrega, o retorno à loja. Sem essas marcações, a loja e o cliente não conseguem acompanhar o pedido.'),
    ('Atraso na Coleta ou na Entrega Sem Justificativa', 'Levar mais de 20 minutos para coletar o pedido depois de aceitar, ou mais de 30 minutos para entregar depois de coletar, sem um imprevisto comprovado.'),
    ('Avaria de Produto', 'Entregar o pedido danificado: derramado, com a embalagem aberta ou violada, consumido em parte ou com itens faltando por manuseio inadequado.'),
    ('Retenção de Valores ou Equipamentos de Pagamento', 'Depois de um pedido com pagamento na entrega, o entregador tem até 1 hora para prestar contas do valor recebido e devolver a máquina de cartão ao estabelecimento.'),
    ('Finalização Falsa de Entrega', 'Marcar no aplicativo uma entrega que não foi feita. Se o pedido já tiver saído por outro meio, o certo é cancelar a corrida, e a taxa de cancelamento vai para o seu saldo.'),
    ('Mau Comportamento com Clientes Finais ou Parceiros: Desrespeito ou Atitude Inapropriada', 'Tratar clientes, estabelecimentos ou a equipe com desrespeito: linguagem ofensiva, ameaças, gritos, intimidação, dano ao patrimônio ou qualquer forma de discriminação.'),
    ('Uso da Conta por Terceiros Não Autorizados', 'Deixar outra pessoa fazer entregas com a sua conta sem autorização da nossa equipe.'),
    ('Furto ou Extravio: Desvio de Produtos ou Valores', 'Desaparecer com o pedido ou com o valor do pedido.'),
    ('Agressão Física ou Assédio (Moral ou Sexual)', 'Agredir fisicamente ou assediar (moral ou sexualmente) clientes, estabelecimentos ou a equipe.'),
    ('Fraude Documental', 'Falsificar ou adulterar documentos pessoais ou do veículo (RG, CNH, licenciamento, IPVA).')
  ) p(nome, txt)
 where i.nome = p.nome and i.explicacao is null;

update public.infracoes set agravante = 'Não respondeu ao contato do suporte em até 8 horas', agravante_efeito = 'mais_uma'
 where nome = 'Retenção de Valores ou Equipamentos de Pagamento' and agravante is null;
update public.infracoes set agravante = 'O terceiro que usava a conta é menor de 18 anos', agravante_efeito = 'encerra'
 where nome = 'Uso da Conta por Terceiros Não Autorizados' and agravante is null;

-- ---------------------------------------------------------------------
-- Modelos de mensagem
-- ---------------------------------------------------------------------
create table if not exists public.modelos_mensagem (
  chave          text primary key,
  grupo          text not null check (grupo in ('bloqueio', 'entregador', 'parceiro')),
  titulo         text not null,
  texto          text not null check (length(texto) <= 2000),
  ordem          smallint not null default 0,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);
alter table public.modelos_mensagem enable row level security;
revoke all on public.modelos_mensagem from anon, authenticated;

insert into public.modelos_mensagem (chave, grupo, titulo, texto, ordem) values
  ('restricao', 'bloqueio', 'Restrição temporária', $t$Olá, {nome}! Tudo bem?

Identificamos uma ocorrência na sua conta e, por isso, ela está com uma restrição temporária na plataforma Quero Log.

Motivo: {infracao}
O que diz a regra: {regra}
{agravante}
Esta é a sua {ocorrencia} ocorrência desse tipo. Por isso a restrição é de {punicao}, com término previsto para {termino}. Depois desse prazo o acesso volta automaticamente.

Se acredita que houve algum engano, responda esta mensagem que nossa equipe analisa.

Contamos com você!$t$, 1),
  ('encerramento', 'bloqueio', 'Encerramento de parceria', $t$Olá, {nome}.

Informamos que a sua parceria com a plataforma Quero Log foi encerrada.

Motivo: {infracao}
O que diz a regra: {regra}
{agravante}{reincidencia}
Se acredita que houve algum engano, responda esta mensagem que nossa equipe analisa.

Agradecemos pelas entregas realizadas até aqui.$t$, 2),
  ('liberacao', 'bloqueio', 'Liberação antes do prazo', $t$Olá, {nome}! A restrição temporária da sua conta foi encerrada antes do prazo, e você já pode voltar a fazer entregas.

Contamos com você para manter as boas práticas. Bom trabalho!$t$, 3),
  ('leve', 'bloqueio', 'Infração leve (aviso)', $t$Olá, {nome}! Este é um aviso: identificamos {infracao} na sua conta.

Por enquanto não há restrição. Mas, ao acumular {leves_limite} avisos em {leves_janela} dias, a conta recebe uma restrição temporária, conforme a nossa política.{leves_situacao}

Qualquer dúvida, é só chamar a gente.$t$, 4),
  ('engajamento_movimento', 'entregador', 'Engajamento: movimento alto', $t$Fala, {nome}! Hoje o movimento em {cidade} está forte e tem pedido esperando entregador. Bora ficar online? 🛵$t$, 10),
  ('engajamento_reconhecimento', 'entregador', 'Engajamento: reconhecimento', $t${nome}, passando para agradecer pelas entregas desta semana! Seu trabalho faz a diferença para os clientes e as lojas de {cidade}. Seguimos juntos! 💪$t$, 11),
  ('engajamento_voltar', 'entregador', 'Engajamento: voltar a rodar', $t$Oi, {nome}! Sentimos sua falta nas entregas em {cidade}. A demanda está boa por aqui. Se quiser voltar, é só ficar online. Qualquer dúvida, conta com a gente!$t$, 12),
  ('parceiro_ativacao', 'parceiro', 'Parceiro: entrega pelo Quero Log ativa', $t$Olá, {estabelecimento}! Tudo bem?

Aqui é {meu_nome}, da equipe Quero Log. Passando para avisar que a entrega pelo Quero Log está ativa para vocês em {cidade}. Seus pedidos já podem ser entregues pelos nossos entregadores parceiros.

Qualquer dúvida sobre o funcionamento, prazos ou valores, é só falar comigo por aqui. Boas vendas! 🚀$t$, 20)
on conflict (chave) do nothing;

create or replace function public.mensagens()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'pode_editar', public.sou_moderador(),
    'modelos', coalesce((select jsonb_agg(jsonb_build_object('chave', m.chave, 'grupo', m.grupo, 'titulo', m.titulo, 'texto', m.texto,
        'atualizado_em', m.atualizado_em, 'atualizado_por', m.atualizado_por) order by m.ordem, m.chave) from public.modelos_mensagem m), '[]'),
    'infracoes', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.nome, 'leve', i.leve, 'ativa', i.ativa,
        'explicacao', i.explicacao, 'agravante', i.agravante, 'agravante_efeito', i.agravante_efeito) order by i.leve, i.ordem)
      from public.infracoes i), '[]'),
    'leves', (select jsonb_build_object('limite', leves_limite, 'janela_dias', leves_janela_dias) from public.parametros_bloqueio where id));
end $$;

create or replace function public.salvar_modelo_mensagem(p_chave text, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if not public.sou_moderador() then raise exception 'Só moderadores alteram os modelos de mensagem.' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'O texto não pode ficar vazio.'; end if;
  update public.modelos_mensagem set texto = btrim(p_texto), atualizado_em = now(), atualizado_por = public.meu_email() where chave = p_chave;
  if not found then raise exception 'Modelo não encontrado.'; end if;
end $$;

-- explicação e agravante de uma infração (moderador dos bloqueios, como as regras)
create or replace function public.salvar_explicacao_infracao(p_infracao smallint, p_explicacao text,
  p_agravante text default null, p_agravante_efeito text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ag text := nullif(btrim(coalesce(p_agravante, '')), '');
begin
  perform public.exigir_bloq('moderador');
  if ag is not null and coalesce(p_agravante_efeito, '') not in ('mais_uma', 'encerra') then
    raise exception 'Escolha o que o agravante faz (conta como a próxima ocorrência ou encerra a parceria).';
  end if;
  update public.infracoes set explicacao = nullif(btrim(coalesce(p_explicacao, '')), ''),
         agravante = ag, agravante_efeito = case when ag is not null then p_agravante_efeito end,
         atualizada_em = now(), atualizada_por = public.meu_email()
   where id = p_infracao;
  if not found then raise exception 'Infração não encontrada.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Registrar com agravante
-- ---------------------------------------------------------------------
-- punição com o agravante: mais_uma = a da próxima ocorrência; encerra = nulo
create or replace function public.horas_com_agravante(i public.infracoes, n integer)
returns numeric language sql immutable as $$
  select case when i.agravante_efeito = 'encerra' then null else public.horas_previstas(i, n + 1) end
$$;

drop function if exists public.registrar_bloqueio_agravante(text, text, text, smallint, text, text, boolean);
-- p_solucionado: só para infração com pendência (ex.: retenção). Falso = nasce o aviso rápido.
create or replace function public.registrar_bloqueio_agravante(
  p_id_app text, p_nome text, p_cidade text, p_infracao smallint, p_observacao text default null,
  p_comentario text default null, p_agravante boolean default false, p_solucionado boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id     text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  i        public.infracoes;
  b        public.bloqueios;
  ja       public.bloqueios;
  oc       record;
  usar     boolean;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if length(v_id) < 4 then raise exception 'Preencha o ID do entregador.'; end if;
  if not public.nome_valido(p_nome) then raise exception 'Preencha o nome do entregador.'; end if;
  if not exists (select 1 from public.cidades where nome = v_cidade and ativa) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  if length(coalesce(p_comentario, '')) > 1500 then raise exception 'O comentário pode ter no máximo 1500 caracteres.'; end if;
  select * into i from public.infracoes where id = p_infracao and ativa and not leve;
  if i.id is null then raise exception 'Escolha a infração.'; end if;
  usar := coalesce(p_agravante, false);
  if i.pendencia is not null and p_solucionado is null then
    raise exception 'Diga se já foi solucionado (%).', lower(i.pendencia);
  end if;
  if usar and i.agravante is null then raise exception 'Esta infração não tem agravante.'; end if;
  perform pg_advisory_xact_lock(hashtext(lower(v_id)));
  select * into ja from public.bloqueios
   where lower(id_app) = lower(v_id) and infracao_id = i.id and inicio > now() - interval '10 minutes' limit 1;
  if ja.id is not null then
    raise exception 'Este entregador já recebeu um bloqueio por esta infração há poucos minutos (registrado por %).', ja.registrado_por_nome;
  end if;
  if usar then
    select * into oc from public.calcular_ocorrencia(v_id, i.id, now());
    b := public.inserir_bloqueio(v_id, btrim(p_nome), v_cidade, i.id, now(), auth.uid(),
                                 (select nome from public.membros where email = public.meu_email()), v_obs,
                                 false, null, true, public.horas_com_agravante(i, oc.ocorrencia));
    update public.bloqueios set agravante = i.agravante where id = b.id returning * into b;
    update public.eventos_bloqueio set detalhe = detalhe || ' · agravante: ' || i.agravante
     where bloqueio_id = b.id and tipo = 'registrado';
  else
    b := public.inserir_bloqueio(v_id, btrim(p_nome), v_cidade, i.id, now(), auth.uid(),
                                 (select nome from public.membros where email = public.meu_email()), v_obs);
  end if;
  perform public.anotar_entregador(v_id, 'comentario', p_comentario, b.id);
  if i.pendencia is not null and not p_solucionado then
    insert into public.avisos_rapidos (tipo, titulo, bloqueio_id, id_app, nome, cidade, criado_por, criado_por_nome)
    values ('pendencia', i.pendencia, b.id, b.id_app, case when b.dados_pendentes then null else b.nome_entregador end, b.cidade,
            auth.uid(), public.nome_de(auth.uid()));
  end if;
  return jsonb_build_object('id', b.id, 'ocorrencia', b.ocorrencia, 'horas', b.horas, 'fim', b.fim, 'agravante', b.agravante,
    'infracao_id', i.id, 'tarefa', exists (select 1 from public.tarefas where bloqueio_id = b.id),
    'pendencia', case when i.pendencia is not null and not p_solucionado then i.pendencia end);
end $$;

-- prévia: + o agravante da infração (texto e punição com ele)
do $$
declare def text;
begin
  def := pg_get_functiondef('public.previa_bloqueio(text, smallint)'::regprocedure);
  if position('''pendencia''' in def) = 0 then
    def := replace(def, '''nome_conhecido'', conh.nome,', '''pendencia'', case when not coalesce(i.leve, false) then i.pendencia end,
    ''nome_conhecido'', conh.nome,');
    execute def;
    def := pg_get_functiondef('public.previa_bloqueio(text, smallint)'::regprocedure);
  end if;
  if position('''agravante''' in def) = 0 then
    def := replace(def, '''nome_conhecido'', conh.nome,',
      '''agravante'', case when i.agravante is not null and not coalesce(i.leve, false) and n is not null then jsonb_build_object(
        ''texto'', i.agravante, ''efeito'', i.agravante_efeito, ''horas'', public.horas_com_agravante(i, n),
        ''encerramento'', public.horas_com_agravante(i, n) is null) end,
    ''nome_conhecido'', conh.nome,');
    if position('''agravante''' in def) = 0 then raise exception '009c: não achei onde pôr o agravante na previa_bloqueio'; end if;
    execute def;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Avisos rápidos
-- ---------------------------------------------------------------------
create or replace function public.avisos_rapidos_abertos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'titulo', a.titulo, 'id_app', a.id_app,
      'nome', coalesce(a.nome, (select e.nome from public.entregadores e where e.id_app = lower(a.id_app))),
      'cidade', a.cidade, 'bloqueio_id', a.bloqueio_id, 'criado_em', a.criado_em, 'criado_por_nome', a.criado_por_nome)
      order by a.criado_em), '[]')
    from public.avisos_rapidos a where a.resolvido_em is null
$$;

-- qualquer pessoa da equipe marca como resolvido
create or replace function public.resolver_aviso_rapido(p_id bigint, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  update public.avisos_rapidos set resolvido_em = now(), resolvido_por = auth.uid(), resolvido_por_nome = public.nome_de(auth.uid()),
         nota = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_id and resolvido_em is null
  returning * into a;
  if a.id is null then raise exception 'Este aviso já foi resolvido.'; end if;
  if a.bloqueio_id is not null then
    insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
    values (a.bloqueio_id, 'pendencia_resolvida', auth.uid(), a.resolvido_por_nome, a.titulo || coalesce(' · ' || a.nota, ''));
  end if;
end $$;

-- resumo do topo: + avisos rápidos abertos (todos veem)
create or replace function public.resumo_e_avisos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'resumo', public.resumo_inicio() || jsonb_build_object(
      'pedidos_acesso', case when public.meu_papel() = 'moderador' then (select count(*) from public.pedidos_acesso) end,
      'bloqueios_revisar', case when public.meu_papel_bloq() is not null then (select count(*) from public.bloqueios where revisar is not null) end,
      'versao', (select n from public.versao_dados),
      'casos_abertos', (select count(*) from public.casos where status = 'aberto'),
      'casos_para_mim', (select count(*) from public.casos k where public.caso_para_mim(k)),
      'pedidos_cidade', case when public.sou_moderador() then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'cidade', p.cidade,
          'nome', p.nome, 'email', p.email, 'criado_em', p.criado_em,
          'papel_bloqueios', (select m.papel_bloqueios from public.membros m where m.email = p.email)) order by p.id)
        from public.pedidos_cidade p where p.status = 'pendente'), '[]') end,
      'financeiro_pendentes', (select count(*) from public.lancamentos_financeiros where registrado_por = auth.uid() and not lancado),
      'avisos_rapidos', public.avisos_rapidos_abertos()),
    'notif', public.minhas_notificacoes());
end $$;

-- o aviso de Registros entende o evento novo
do $$
declare def text;
begin
  def := pg_get_functiondef('public.aviso_evento_bloqueio()'::regprocedure);
  if position('pendencia_resolvida' in def) = 0 then
    def := replace(def, $r$when 'realocada' then 'realocou a tratativa'$r$,
      $r$when 'realocada' then 'realocou a tratativa' when 'pendencia_resolvida' then 'marcou como resolvido (' || lower(coalesce(new.detalhe, 'pendência')) || ')'$r$);
    if position('pendencia_resolvida' in def) = 0 then raise exception '009c: não achei onde pôr o evento novo no aviso de bloqueios'; end if;
    execute def;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = 'avisos_rapidos' and g.tgname = 'marcar_mudanca_ins') then
    create trigger marcar_mudanca_ins after insert on public.avisos_rapidos referencing new table as novas for each statement execute function public.marcar_mudanca_linhas();
    create trigger marcar_mudanca_upd after update on public.avisos_rapidos referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas();
    create trigger marcar_mudanca_del after delete on public.avisos_rapidos referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = 'modelos_mensagem' and g.tgname = 'marcar_mudanca_ins') then
    create trigger marcar_mudanca_ins after insert on public.modelos_mensagem referencing new table as novas for each statement execute function public.marcar_mudanca_linhas();
    create trigger marcar_mudanca_upd after update on public.modelos_mensagem referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas();
    create trigger marcar_mudanca_del after delete on public.modelos_mensagem referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas();
  end if;
end $$;
revoke all on function public.horas_com_agravante(public.infracoes, integer) from public, anon, authenticated;
revoke all on function public.avisos_rapidos_abertos() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.mensagens()', 'public.salvar_modelo_mensagem(text, text)',
                           'public.salvar_explicacao_infracao(smallint, text, text, text)',
                           'public.registrar_bloqueio_agravante(text, text, text, smallint, text, text, boolean, boolean)',
                           'public.resolver_aviso_rapido(bigint, text)', 'public.resumo_e_avisos()',
                           'public.previa_bloqueio(text, smallint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
