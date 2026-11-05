-- =====================================================================
-- 008b · "Espião ou fofoqueiro? Virou rede social?" · parte 1: avisos
-- Para quem já rodou a 008 e o 008b-cadastrar-entregador.sql.
-- Não apaga nada e pode rodar mais de uma vez.
--
-- 1. Tudo o que entra em Registros avisa os moderadores (de qualquer
--    módulo) e o responsável da cidade. Quem fez a ação não recebe, e
--    cada pessoa recebe um aviso só por ação.
-- 2. Cidade sem responsável: qualquer pessoa pede para ser a responsável;
--    um moderador (ou o administrador final) aprova ou recusa.
-- 3. Tela de Avisos com busca e filtros (listar_avisos) e a tira do sino.
-- 4. O suporte também revisa: corrigir um registro "revisar" dos bloqueios
--    e marcar "Os dados estão certos" num cadastro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Avisos: de onde vêm (para filtrar e buscar)
-- ---------------------------------------------------------------------
alter table public.notificacoes add column if not exists categoria text;  -- ativacao | bloqueios | comentarios | cidades (nulo = pessoal: tarefas, decisões, casos)
alter table public.notificacoes add column if not exists cidade    text;
alter table public.notificacoes add column if not exists id_app    text;
alter table public.notificacoes add column if not exists motivo    text;  -- moderador | cidade (por que a pessoa recebeu)
create index if not exists notificacoes_para_nao_lidas on public.notificacoes (para) where lida_em is null;

-- Cidade de operador sem responsável dos operadores: vale o responsável da própria cidade
-- (assim o pedido aprovado funciona também nessas cidades).
create or replace function public.responsavel_cidade_email(p_cidade text)
returns text language sql stable security definer set search_path = public as $$
  select case when c.gestao = 'operador'
              then coalesce((select responsavel_operadores_email from public.parametros_equipe), c.responsavel_email)
              else c.responsavel_email end
    from public.cidades c where c.nome = p_cidade
$$;

create or replace function public.sou_moderador()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.meu_papel() = 'moderador' or public.meu_papel_bloq() = 'moderador', false)
$$;

-- Distribui um aviso de Registros. p_bq = assunto dos bloqueios (só vai para quem tem o módulo).
-- Sem usuário logado (SQL Editor, importação da planilha) não avisa ninguém.
create or replace function public.avisar_registro(
  p_categoria text, p_texto text, p_link text, p_cidade text, p_id_app text, p_bq boolean)
returns void language plpgsql security definer set search_path = public as $$
declare resp text;
begin
  if auth.uid() is null or nullif(btrim(coalesce(p_texto, '')), '') is null then return; end if;
  resp := case when p_cidade is not null then public.responsavel_cidade_email(p_cidade) end;
  insert into public.notificacoes (para, texto, link, categoria, cidade, id_app, motivo)
  select m.user_id, left(p_texto, 500), p_link, p_categoria, p_cidade, lower(p_id_app),
         case when m.papel = 'moderador' or m.papel_bloqueios = 'moderador' then 'moderador' else 'cidade' end
    from public.membros m
   where m.user_id is not null and m.user_id <> auth.uid()
     and (m.papel = 'moderador' or m.papel_bloqueios = 'moderador' or m.email = resp)
     and (not p_bq or m.papel_bloqueios is not null)
     -- um aviso por pessoa por ação (a mesma transação pode gerar vários registros)
     and not exists (select 1 from public.notificacoes n where n.para = m.user_id and n.criada_em = now());
end $$;

-- ativação: cada evento de cadastro
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
    '#cadastro/' || c.id, c.cidade, c.id_app, false);
  return null;
end $$;
drop trigger if exists aviso_evento_ativacao on public.eventos;
drop trigger if exists zz_aviso_evento_ativacao on public.eventos;
-- "zz_": os gatilhos rodam em ordem alfabética; este roda depois dos avisos pessoais (ex.: avisar_decisao)
create trigger zz_aviso_evento_ativacao after insert on public.eventos
  for each row execute function public.aviso_evento_ativacao();

-- bloqueios: registro, liberação, tratativa, correção...
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
    '#ficha/' || lower(b.id_app), b.cidade, b.id_app, true);
  return null;
end $$;
drop trigger if exists aviso_evento_bloqueio on public.eventos_bloqueio;
drop trigger if exists zz_aviso_evento_bloqueio on public.eventos_bloqueio;
-- "zz_": os gatilhos rodam em ordem alfabética; este roda depois dos avisos pessoais (ex.: avisar_decisao)
create trigger zz_aviso_evento_bloqueio after insert on public.eventos_bloqueio
  for each row execute function public.aviso_evento_bloqueio();

-- comentários e alterações na ficha do entregador
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
    '#ficha/' || new.id_app, e.cidade, new.id_app, true);
  return null;
end $$;
drop trigger if exists aviso_comentario on public.comentarios_entregador;
drop trigger if exists zz_aviso_comentario on public.comentarios_entregador;
-- "zz_": os gatilhos rodam em ordem alfabética; este roda depois dos avisos pessoais (ex.: avisar_decisao)
create trigger zz_aviso_comentario after insert on public.comentarios_entregador
  for each row execute function public.aviso_comentario();

-- Aviso pessoal (tarefa, decisão, tratativa...): se a mesma ação já gerou para a pessoa o aviso
-- de Registros, fica só o pessoal (um aviso por ação).
create or replace function public.notificar(p_para uuid, p_texto text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_para is null or p_para is not distinct from auth.uid() then return; end if;
  delete from public.notificacoes
   where para = p_para and criada_em = now() and categoria in ('ativacao', 'bloqueios', 'comentarios');
  insert into public.notificacoes (para, texto, link) values (p_para, p_texto, p_link);
end $$;

-- Sino: os 20 mais recentes (a tela de Avisos busca o resto com listar_avisos)
create or replace function public.minhas_notificacoes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'nao_lidas', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'link', link, 'criada_em', criada_em,
        'lida', lida_em is not null, 'categoria', categoria, 'cidade', cidade, 'motivo', motivo) order by id desc)
      from (select * from public.notificacoes where para = auth.uid() order by id desc limit 20) n), '[]'));
end $$;

-- Tela de Avisos: busca por palavras e filtros, 50 por vez (p_antes = id do último já mostrado).
-- p_filtro: pessoal (o que é para você: tarefas, decisões, casos) | ativacao | bloqueios | comentarios | cidades
create or replace function public.listar_avisos(
  p_busca text default null, p_filtro text default null, p_cidade text default null,
  p_nao_lidos boolean default false, p_antes bigint default null, p_limite integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q   text := nullif(btrim(coalesce(p_busca, '')), '');
  lim integer := least(greatest(coalesce(p_limite, 50), 1), 200);
  res jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'texto', n.texto, 'link', n.link, 'criada_em', n.criada_em,
           'lida', n.lida_em is not null, 'categoria', n.categoria, 'cidade', n.cidade, 'motivo', n.motivo) order by n.id desc), '[]')
    into res
    from (select * from public.notificacoes x
           where x.para = auth.uid()
             and (p_antes is null or x.id < p_antes)
             and (not coalesce(p_nao_lidos, false) or x.lida_em is null)
             and (p_filtro is null or (p_filtro = 'pessoal' and x.categoria is null) or x.categoria = p_filtro)
             and (p_cidade is null or x.cidade = p_cidade)
             and (q is null or x.texto ilike '%' || q || '%' or x.id_app = lower(q))
           order by x.id desc limit lim + 1) n;
  return jsonb_build_object(
    'itens', case when jsonb_array_length(res) > lim then res - lim else res end,
    'mais', jsonb_array_length(res) > lim,
    'cidades', coalesce((select jsonb_agg(distinct x.cidade) from public.notificacoes x where x.para = auth.uid() and x.cidade is not null), '[]'),
    'nao_lidas', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null));
end $$;

-- ---------------------------------------------------------------------
-- Pedir para ser responsável por uma cidade sem responsável
-- ---------------------------------------------------------------------
create table if not exists public.pedidos_cidade (
  id                bigint generated always as identity primary key,
  cidade            text not null references public.cidades (nome) on update cascade on delete cascade,
  email             text not null,
  nome              text not null,
  criado_em         timestamptz not null default now(),
  status            text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  decidido_por_nome text,
  decidido_em       timestamptz,
  nota              text
);
create unique index if not exists pedidos_cidade_um_pendente on public.pedidos_cidade (cidade, email) where status = 'pendente';
alter table public.pedidos_cidade enable row level security;
drop policy if exists pedidos_cidade_leitura on public.pedidos_cidade;
create policy pedidos_cidade_leitura on public.pedidos_cidade for select to authenticated using ((select public.meu_papel()) is not null);

drop trigger if exists marcar_mudanca on public.pedidos_cidade;
create trigger marcar_mudanca after insert or update or delete on public.pedidos_cidade
  for each statement execute function public.marcar_mudanca();

-- Cidades ativas sem responsável (os avisos delas só vão para os moderadores), com os pedidos.
create or replace function public.cidades_sem_responsavel()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare eu text := public.meu_email();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'cidades', coalesce((select jsonb_agg(jsonb_build_object('cidade', c.nome, 'gestao', c.gestao,
        'meu_pedido', exists (select 1 from public.pedidos_cidade p where p.cidade = c.nome and p.email = eu and p.status = 'pendente'),
        'pedidos', (select count(*) from public.pedidos_cidade p where p.cidade = c.nome and p.status = 'pendente')) order by c.nome)
      from public.cidades c where c.ativa and public.responsavel_cidade_email(c.nome) is null), '[]'),
    'meus', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'cidade', p.cidade, 'status', p.status, 'criado_em', p.criado_em,
        'decidido_por_nome', p.decidido_por_nome, 'nota', p.nota) order by p.id desc)
      from (select * from public.pedidos_cidade where email = eu order by id desc limit 10) p), '[]'));
end $$;

create or replace function public.pedir_cidade(p_cidade text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  eu text := public.meu_email();
  quem text := (select nome from public.membros where email = eu);
  novo bigint;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if not exists (select 1 from public.cidades where nome = v_cidade and ativa) then raise exception 'Escolha uma cidade da lista.'; end if;
  if public.responsavel_cidade_email(v_cidade) is not null then raise exception 'Esta cidade já tem responsável.'; end if;
  if exists (select 1 from public.pedidos_cidade where cidade = v_cidade and email = eu and status = 'pendente') then
    raise exception 'Você já pediu esta cidade. Aguarde a resposta de um moderador.';
  end if;
  insert into public.pedidos_cidade (cidade, email, nome) values (v_cidade, eu, quem) returning id into novo;
  insert into public.notificacoes (para, texto, link, categoria, cidade, motivo)
  select m.user_id, format('%s pediu para ser responsável por %s. Aprove ou recuse nas suas Pendências.', quem, v_cidade),
         '#atividades/pendencias', 'cidades', v_cidade, 'moderador'
    from public.membros m
   where m.user_id is not null and m.email <> eu and (m.papel = 'moderador' or m.papel_bloqueios = 'moderador');
  return novo;
end $$;

-- Quem pediu desiste (ou o moderador recusa / aprova).
create or replace function public.cancelar_pedido_cidade(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  update public.pedidos_cidade set status = 'recusado', decidido_em = now(), decidido_por_nome = nome, nota = 'Pedido cancelado por quem pediu.'
   where id = p_id and email = public.meu_email() and status = 'pendente';
  if not found then raise exception 'Pedido não encontrado.'; end if;
end $$;

create or replace function public.decidir_pedido_cidade(p_id bigint, p_aprovar boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p    public.pedidos_cidade;
  quem text := (select nome from public.membros where email = public.meu_email());
  uid  uuid;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if not public.sou_moderador() then raise exception 'Só moderadores aprovam pedidos de cidade.' using errcode = '42501'; end if;
  select * into p from public.pedidos_cidade where id = p_id for update;
  if p.id is null or p.status <> 'pendente' then raise exception 'Este pedido já foi respondido.'; end if;
  if p_aprovar and public.responsavel_cidade_email(p.cidade) is not null then
    raise exception 'Esta cidade já tem responsável. Recuse o pedido ou troque o responsável na Regras de equipe.';
  end if;
  if not p_aprovar and nullif(btrim(coalesce(p_nota, '')), '') is null then raise exception 'Diga o motivo da recusa.'; end if;
  if not exists (select 1 from public.membros where email = p.email) then raise exception 'Esta pessoa não está mais na equipe.'; end if;
  update public.pedidos_cidade set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         decidido_em = now(), decidido_por_nome = quem, nota = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p.id;
  uid := (select user_id from public.membros where email = p.email);
  if p_aprovar then
    update public.cidades set responsavel_email = p.email where nome = p.cidade;
    perform public.reatribuir_tarefas(array[p.cidade]);
    update public.pedidos_cidade set status = 'recusado', decidido_em = now(), decidido_por_nome = quem, nota = 'Outra pessoa foi aprovada para esta cidade.'
     where cidade = p.cidade and status = 'pendente' and id <> p.id;
    perform public.notificar(uid, format('Pedido aprovado por %s: agora você é responsável por %s e recebe os avisos dela.', quem, p.cidade), '#atividades/avisos');
  else
    perform public.notificar(uid, format('Pedido para ser responsável por %s recusado por %s: %s', p.cidade, quem, btrim(p_nota)), '#atividades/avisos');
  end if;
end $$;

-- Pendências do moderador: os pedidos esperando resposta
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
        from public.pedidos_cidade p where p.status = 'pendente'), '[]') end),
    'notif', public.minhas_notificacoes());
end $$;

-- ---------------------------------------------------------------------
-- O suporte também revisa (motivo obrigatório e histórico continuam iguais)
-- ---------------------------------------------------------------------
do $$
declare
  f   text;
  def text;
begin
  foreach f in array array['public.corrigir_bloqueio(uuid, text, text, text, text)', 'public.marcar_cadastro_revisado(uuid)'] loop
    def := pg_get_functiondef(f::regprocedure);
    def := replace(replace(def,
      $x$exigir_bloq('moderador', 'monitorador')$x$, $x$exigir_bloq('moderador', 'monitorador', 'suporte')$x$),
      $x$exigir_papel('moderador', 'monitorador')$x$, $x$exigir_papel('moderador', 'monitorador', 'suporte')$x$);
    -- o suporte corrige só o que está marcado "revisar" ou o que ele mesmo registrou
    if f like '%corrigir_bloqueio%' and def not like '%O suporte corrige só%' then
      def := replace(def, $x$if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;$x$,
        $x$if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;
  if public.meu_papel_bloq() = 'suporte' and b.revisar is null and b.registrado_por is distinct from auth.uid() then
    raise exception 'O suporte corrige só os registros marcados “revisar” ou os que ele mesmo registrou.';
  end if;$x$);
      if def not like '%O suporte corrige só%' then raise exception 'Não consegui limitar a correção do suporte.'; end if;
    end if;
    if def not like '%''suporte''%' then raise exception 'Não consegui liberar % para o suporte.', f; end if;
    execute def;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Casos suspeitos (008) guardados para depois: desligados por um interruptor.
-- Tabelas, funções e casos já registrados continuam no banco; com o
-- interruptor desligado, nenhum caso novo é aberto, ninguém é avisado, e
-- CPF repetido volta a ser só a recusa de sempre ("Este CPF já está cadastrado").
-- Para religar (junto com o front guardado em guardado/casos/):
--   update public.parametros_casos set ligado = true where unico;
-- ---------------------------------------------------------------------
create table if not exists public.parametros_casos (
  unico  boolean primary key default true check (unico),
  ligado boolean not null default false
);
insert into public.parametros_casos (unico, ligado) values (true, false) on conflict do nothing;
alter table public.parametros_casos enable row level security;
drop policy if exists parametros_casos_leitura on public.parametros_casos;
create policy parametros_casos_leitura on public.parametros_casos for select to authenticated using ((select public.meu_papel()) is not null);

do $$
declare def text := pg_get_functiondef('public.abrir_caso(text, text, uuid, uuid, text, text, text, text, text)'::regprocedure);
begin
  if def not like '%parametros_casos%' then
    def := replace(def, $x$begin
  select k.id into novo from public.casos k$x$, $x$begin
  -- casos guardados para depois: com o interruptor desligado, não abre caso nem avisa ninguém
  if not coalesce((select ligado from public.parametros_casos where unico), false) then return null; end if;
  select k.id into novo from public.casos k$x$);
    if def not like '%parametros_casos%' then raise exception 'Não consegui desligar os casos.'; end if;
    execute def;
  end if;
end $$;

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
revoke execute on function public.criar_tarefa_cadastro(uuid, uuid) from authenticated;
revoke execute on function public.concluir_tarefas_cadastro(uuid) from authenticated;
revoke execute on function public.cadastro_cria_ficha() from authenticated;
revoke execute on function public.avisar_decisao() from authenticated;
revoke execute on function public.marcar_mudanca() from authenticated;
revoke execute on function public.sinais_cadastro(text, text, text, uuid) from authenticated;
revoke execute on function public.abrir_caso(text, text, uuid, uuid, text, text, text, text, text) from authenticated;
revoke execute on function public.caso_para_mim(public.casos) from authenticated;
revoke execute on function public.json_caso(public.casos) from authenticated;
revoke execute on function public.avisar_registro(text, text, text, text, text, boolean) from authenticated;
revoke execute on function public.aviso_evento_ativacao() from authenticated;
revoke execute on function public.aviso_evento_bloqueio() from authenticated;
revoke execute on function public.aviso_comentario() from authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke select on public.anexos from authenticated;
