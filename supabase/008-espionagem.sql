-- =====================================================================
-- Migração 008 · "Espionagem profissional" (casos suspeitos)
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rodar DEPOIS do 007-pao-quentinho.sql. Não apaga dados e pode rodar mais de uma vez.
--
--   * CASO SUSPEITO de uso por terceiros. Sinais:
--       - CPF que já existe tentando entrar com outro nome ou outro ID (a tentativa, que antes
--         era só recusada e se perdia, fica registrada no caso);
--       - entregador com a parceria encerrada tentando voltar (mesmo CPF, ou mesmo nome com outro ID);
--       - cadastro aprovado que teve o nome ou o ID trocado.
--     Toda a equipe recebe o aviso. Quem cadastra escolhe "Eu verifico" ou "Pedir verificação"
--     (vai para o responsável da cidade; sem responsável, para os moderadores). Checklist editável,
--     comentários e veredito (confirmado/descartado) por monitorador ou moderador.
--   * Lupa do detetive: a busca do topo acha também casos, comentários e avisos.
--   * Placar do detetive nas Análises.
-- =====================================================================

drop function if exists public.enviar_cadastro(text, text, text, text, text);   -- volta devolvendo jsonb

-- nome comparável: sem acento, sem espaço sobrando, minúsculo
create or replace function public.norm_nome(p text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(btrim(translate(coalesce(p, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.casos (
  id                    uuid primary key default gen_random_uuid(),
  tipo                  text not null check (tipo in ('cpf_repetido', 'encerrado_voltando', 'troca_aprovado')),
  nivel                 text not null check (nivel in ('forte', 'atencao')),
  cadastro_id           uuid references public.cadastros (id) on delete set null,  -- o cadastro que já existia
  novo_cadastro_id      uuid references public.cadastros (id) on delete set null,  -- o cadastro criado na tentativa (se foi criado)
  cpf                   text,          -- o que foi digitado na tentativa
  id_app                text,
  nome                  text,
  cidade                text,
  detalhe               text not null,
  status                text not null default 'aberto' check (status in ('aberto', 'confirmado', 'descartado')),
  criado_em             timestamptz not null default now(),
  criado_por            uuid,
  criado_por_nome       text,
  investigador          uuid,
  investigador_nome     text,
  investigando_desde    timestamptz,
  verificacao_pedida_em timestamptz,
  responsavel_email     text,          -- quem recebeu o pedido de verificação (nulo = moderadores)
  checklist             jsonb not null default '{}',   -- { "item": { "por": nome, "em": quando } }
  veredito_por          uuid,
  veredito_por_nome     text,
  veredito_em           timestamptz,
  veredito_nota         text
);
create index if not exists casos_status on public.casos (status, criado_em desc);
create index if not exists casos_cpf on public.casos (cpf) where cpf is not null;
create index if not exists casos_id_app on public.casos (lower(id_app)) where id_app is not null;
create index if not exists casos_cadastro on public.casos (cadastro_id) where cadastro_id is not null;

create table if not exists public.casos_comentarios (
  id       bigint generated always as identity primary key,
  caso_id  uuid not null references public.casos (id) on delete cascade,
  por      uuid,
  por_nome text,
  texto    text not null check (length(btrim(texto)) between 1 and 1500),
  em       timestamptz not null default now()
);
create index if not exists casos_comentarios_caso on public.casos_comentarios (caso_id, id);

create table if not exists public.checklist_casos (
  texto text primary key check (length(btrim(texto)) between 1 and 120),
  ordem smallint not null default 0,
  ativo boolean not null default true
);
insert into public.checklist_casos (texto, ordem) values
  ('Liguei para o entregador', 1), ('Pedi foto do documento', 2), ('Conferi no app', 3), ('Falei com quem enviou o cadastro', 4)
on conflict (texto) do nothing;

-- ---------------------------------------------------------------------
-- Sinais e abertura de casos (internas)
-- ---------------------------------------------------------------------
-- Sinais de um cadastro (o que foi digitado). p_ignorar = o próprio cadastro (edição ou recém-criado).
create or replace function public.sinais_cadastro(p_cpf text, p_id_app text, p_nome text, p_ignorar uuid default null)
returns table (tipo text, nivel text, cadastro_id uuid, detalhe text)
language sql stable security definer set search_path = public as $$
  -- CPF que já existe, com outro nome ou outro ID (se o cadastro existente foi encerrado, é sinal forte)
  select case when c.status = 'encerrado' then 'encerrado_voltando' else 'cpf_repetido' end,
         case when c.status = 'encerrado' then 'forte' else 'atencao' end,
         c.id,
         format('CPF %s já está no Comunique%s como %s (ID %s); a tentativa veio com %s (ID %s).',
           public.fmt_cpf(c.cpf), case when c.status = 'encerrado' then ' com o cadastro ENCERRADO' else '' end,
           coalesce(c.nome, '(sem nome)'), coalesce(c.id_app, '—'), coalesce(p_nome, '(sem nome)'), coalesce(p_id_app, '—'))
    from public.cadastros c
   where p_cpf is not null and c.cpf = p_cpf and c.id is distinct from p_ignorar
     and ((p_id_app is not null and c.id_app is not null and lower(c.id_app) <> lower(p_id_app))
       or (p_nome is not null and c.nome is not null and public.norm_nome(c.nome) <> public.norm_nome(p_nome)))
  union all
  -- mesmo nome de um cadastro encerrado, com outro ID e outro CPF
  select 'encerrado_voltando', 'forte', c.id,
         format('O nome %s é igual ao de um cadastro ENCERRADO (ID %s, CPF %s); a tentativa veio com o ID %s.',
           c.nome, coalesce(c.id_app, '—'), coalesce(public.fmt_cpf(c.cpf), '—'), coalesce(p_id_app, '—'))
    from public.cadastros c
   where p_nome is not null and c.status = 'encerrado' and c.id is distinct from p_ignorar
     and public.norm_nome(c.nome) = public.norm_nome(p_nome)
     and lower(coalesce(c.id_app, '')) <> lower(coalesce(p_id_app, '')) and c.cpf is distinct from p_cpf
  union all
  -- mesmo nome de um entregador com a parceria encerrada nos bloqueios, com outro ID
  select 'encerrado_voltando', 'forte', null::uuid,
         format('O nome %s é igual ao de um entregador com a PARCERIA ENCERRADA nos bloqueios (ID %s); a tentativa veio com o ID %s.',
           e.nome, e.id_app, coalesce(p_id_app, '—'))
    from public.entregadores e
   where p_nome is not null and public.norm_nome(e.nome) = public.norm_nome(p_nome)
     and e.id_app <> lower(coalesce(p_id_app, ''))
     and exists (select 1 from public.bloqueios b where lower(b.id_app) = e.id_app and not b.leve and public.situacao_bloqueio(b) = 'encerramento')
$$;

-- Abre um caso (ou devolve o que já está aberto para a mesma tentativa) e avisa a equipe toda
create or replace function public.abrir_caso(p_tipo text, p_nivel text, p_cadastro uuid, p_novo uuid,
  p_cpf text, p_id_app text, p_nome text, p_cidade text, p_detalhe text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  novo uuid;
  quem text := coalesce(public.nome_por_email(public.meu_email()), 'Sistema');
begin
  select k.id into novo from public.casos k
   where k.status = 'aberto' and k.tipo = p_tipo and k.cadastro_id is not distinct from p_cadastro
     and k.cpf is not distinct from p_cpf and lower(coalesce(k.id_app, '')) = lower(coalesce(p_id_app, ''))
     and coalesce(public.norm_nome(k.nome), '') = coalesce(public.norm_nome(p_nome), '')
   limit 1;
  if novo is not null then
    if p_novo is not null then update public.casos set novo_cadastro_id = p_novo where id = novo and novo_cadastro_id is null; end if;
    return novo;
  end if;
  insert into public.casos (tipo, nivel, cadastro_id, novo_cadastro_id, cpf, id_app, nome, cidade, detalhe, criado_por, criado_por_nome)
  values (p_tipo, p_nivel, p_cadastro, p_novo, p_cpf, p_id_app, p_nome, p_cidade, p_detalhe, auth.uid(), quem)
  returning id into novo;
  insert into public.notificacoes (para, texto, link)
  select m.user_id, format('🕵️ Caso suspeito%s aberto por %s: %s', case when p_nivel = 'forte' then ' (sinal forte)' else '' end, quem, p_detalhe), '#ativacao/casos'
    from public.membros m where m.user_id is not null and m.user_id is distinct from auth.uid();
  return novo;
end $$;

-- ---------------------------------------------------------------------
-- Envio do cadastro: com CPF repetido e outro nome/ID, registra o caso em vez de só recusar
-- Devolve { id, caso, nivel, erro }: id nulo + erro quando o cadastro não pôde ser criado.
-- ---------------------------------------------------------------------
create or replace function public.enviar_cadastro(
  p_id_app text, p_cpf text, p_cidade text, p_observacao text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id_app text := nullif(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'), '');
  v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_nome   text := nullif(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), '');
  ja       public.cadastros;
  s        record;
  novo     uuid;
  v_caso   uuid;
  v_nivel  text;
  msg      text;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if v_id_app is null and v_cpf is null then raise exception 'Preencha o ID do entregador ou o CPF.'; end if;
  if v_id_app is not null and length(v_id_app) < 4 then raise exception 'ID muito curto. Confira.'; end if;
  if v_cpf is not null and not public.cpf_valido(v_cpf) then raise exception 'CPF inválido. Confira os 11 números.'; end if;
  if v_cidade !~ '^\S.* - [A-Z]{2}$' then raise exception 'Use o formato CIDADE - UF, ex.: LAGARTO - SE.'; end if;
  if length(coalesce(v_nome, '')) > 120 then raise exception 'Nome muito longo.'; end if;

  select * into ja from public.cadastros
   where (v_cpf is not null and cpf = v_cpf) or (v_id_app is not null and lower(id_app) = lower(v_id_app)) limit 1;
  if ja.id is not null then
    msg := format('Este %s já está cadastrado (situação: %s, enviado em %s).',
      case when v_cpf is not null and ja.cpf = v_cpf then 'CPF' else 'ID' end,
      public.status_texto(ja.status), to_char(ja.enviado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'));
    -- CPF repetido com outro nome ou ID: a tentativa vira caso (e a resposta não é erro, para o caso ficar gravado)
    for s in select * from public.sinais_cadastro(v_cpf, v_id_app, v_nome) x where x.cadastro_id is not distinct from ja.id loop
      v_caso := public.abrir_caso(s.tipo, s.nivel, s.cadastro_id, null, v_cpf, v_id_app, v_nome, v_cidade, s.detalhe);
      v_nivel := s.nivel;
      exit;
    end loop;
    if v_caso is null then raise exception '%', msg; end if;
    return jsonb_build_object('id', null, 'caso', v_caso, 'nivel', v_nivel, 'erro', msg);
  end if;

  insert into public.cadastros (id_app, cpf, cidade, observacao, enviado_por, nome)
  values (v_id_app, v_cpf, v_cidade, v_obs, auth.uid(), v_nome)
  returning id into novo;
  insert into public.eventos (cadastro_id, tipo, status_novo, por)
  values (novo, 'enviado', 'aguardando_analise', auth.uid());
  if public.motivo_revisar_cadastro((select c from public.cadastros c where c.id = novo)) is not null then
    perform public.criar_tarefa_cadastro(novo, null);
  end if;
  -- entregador encerrado tentando voltar com outro ID
  for s in select * from public.sinais_cadastro(v_cpf, v_id_app, v_nome, novo) loop
    v_caso := public.abrir_caso(s.tipo, s.nivel, s.cadastro_id, novo, v_cpf, v_id_app, v_nome, v_cidade, s.detalhe);
    v_nivel := s.nivel;
    exit;
  end loop;
  return jsonb_build_object('id', novo, 'caso', v_caso, 'nivel', v_nivel);
exception when unique_violation then
  raise exception 'Este CPF ou ID já está cadastrado.' using errcode = '23505';
end $$;

-- ---------------------------------------------------------------------
-- Ações no caso
-- ---------------------------------------------------------------------
-- p_acao: 'eu' (eu verifico) | 'pedir' (pede para o responsável da cidade; sem responsável, moderadores)
create or replace function public.assumir_caso(p_caso uuid, p_acao text)
returns void language plpgsql security definer set search_path = public as $$
declare
  k    public.casos;
  quem text := public.nome_por_email(public.meu_email());
  resp text;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into k from public.casos where id = p_caso for update;
  if k.id is null then raise exception 'Caso não encontrado.'; end if;
  if k.status <> 'aberto' then raise exception 'Este caso já foi encerrado.'; end if;
  if p_acao = 'eu' then
    update public.casos set investigador = auth.uid(), investigador_nome = quem, investigando_desde = now() where id = k.id;
    insert into public.casos_comentarios (caso_id, por, por_nome, texto) values (k.id, auth.uid(), quem, 'Assumiu a verificação.');
  elsif p_acao = 'pedir' then
    resp := public.responsavel_cidade_email(k.cidade);
    update public.casos set verificacao_pedida_em = now(), responsavel_email = resp where id = k.id;
    insert into public.casos_comentarios (caso_id, por, por_nome, texto)
    values (k.id, auth.uid(), quem, 'Pediu verificação para ' || coalesce(public.nome_por_email(resp), 'os moderadores') || '.');
    insert into public.notificacoes (para, texto, link)
    select m.user_id, format('🕵️ %s pediu que você verifique um caso suspeito: %s', quem, k.detalhe), '#ativacao/casos'
      from public.membros m
     where m.user_id is not null and m.user_id is distinct from auth.uid()
       and ((resp is not null and m.email = resp) or (resp is null and m.papel = 'moderador'));
  else
    raise exception 'Ação inválida.';
  end if;
end $$;

create or replace function public.marcar_checklist_caso(p_caso uuid, p_item text, p_feito boolean)
returns void language plpgsql security definer set search_path = public as $$
declare k public.casos; quem text := public.nome_por_email(public.meu_email());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into k from public.casos where id = p_caso for update;
  if k.id is null then raise exception 'Caso não encontrado.'; end if;
  if k.status <> 'aberto' then raise exception 'Este caso já foi encerrado.'; end if;
  if not exists (select 1 from public.checklist_casos where texto = p_item) then raise exception 'Item do checklist não encontrado.'; end if;
  update public.casos
     set checklist = case when p_feito then checklist || jsonb_build_object(p_item, jsonb_build_object('por', quem, 'em', now()))
                          else checklist - p_item end
   where id = k.id;
end $$;

create or replace function public.comentar_caso(p_caso uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if v is null then raise exception 'Escreva o comentário.'; end if;
  if not exists (select 1 from public.casos where id = p_caso) then raise exception 'Caso não encontrado.'; end if;
  insert into public.casos_comentarios (caso_id, por, por_nome, texto)
  values (p_caso, auth.uid(), public.nome_por_email(public.meu_email()), left(v, 1500));
end $$;

-- Veredito: confirmado (era terceiro) ou descartado (estava tudo certo). Confirmado não age sozinho:
-- grava um comentário na ficha do entregador e o app sugere encerrar o cadastro.
create or replace function public.veredito_caso(p_caso uuid, p_veredito text, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare
  k    public.casos;
  quem text := public.nome_por_email(public.meu_email());
  v    text := nullif(btrim(coalesce(p_nota, '')), '');
  ida  text;
begin
  perform public.exigir_papel('moderador', 'monitorador');
  if p_veredito not in ('confirmado', 'descartado') then raise exception 'Veredito inválido.'; end if;
  if v is null then raise exception 'Escreva o que foi verificado.'; end if;
  select * into k from public.casos where id = p_caso for update;
  if k.id is null then raise exception 'Caso não encontrado.'; end if;
  if k.status <> 'aberto' then raise exception 'Este caso já foi encerrado.'; end if;
  update public.casos set status = p_veredito, veredito_por = auth.uid(), veredito_por_nome = quem, veredito_em = now(), veredito_nota = left(v, 1500)
   where id = k.id;
  insert into public.casos_comentarios (caso_id, por, por_nome, texto)
  values (k.id, auth.uid(), quem, case when p_veredito = 'confirmado' then 'Veredito: CONFIRMADO (era terceiro). ' else 'Veredito: descartado (estava tudo certo). ' end || left(v, 1300));
  if p_veredito = 'confirmado' then
    ida := coalesce((select id_app from public.cadastros where id = k.cadastro_id), k.id_app);
    if ida is not null then
      perform public.anotar_entregador(ida, 'comentario', '🕵️ Caso suspeito confirmado: ' || k.detalhe || ' · ' || v, null);
    end if;
  end if;
  insert into public.notificacoes (para, texto, link)
  select distinct x, format('🕵️ Caso %s por %s: %s', case when p_veredito = 'confirmado' then 'CONFIRMADO' else 'descartado' end, quem, k.detalhe), '#ativacao/casos'
    from unnest(array[k.criado_por, k.investigador]) x where x is not null and x is distinct from auth.uid();
end $$;

-- Checklist (modelo editável pelos moderadores da ativação). p_itens na ordem desejada.
create or replace function public.salvar_checklist_casos(p_itens text[])
returns void language plpgsql security definer set search_path = public as $$
declare i integer;
begin
  perform public.exigir_papel('moderador');
  if coalesce(cardinality(p_itens), 0) = 0 then raise exception 'O checklist precisa de pelo menos um item.'; end if;
  update public.checklist_casos set ativo = false where not (texto = any (p_itens));
  for i in 1 .. cardinality(p_itens) loop
    if nullif(btrim(p_itens[i]), '') is not null then
      insert into public.checklist_casos (texto, ordem, ativo) values (left(btrim(p_itens[i]), 120), i, true)
      on conflict (texto) do update set ordem = excluded.ordem, ativo = true;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------
create or replace function public.caso_para_mim(k public.casos)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(k.status = 'aberto' and (k.investigador = auth.uid()
      or (k.investigador is null and k.verificacao_pedida_em is not null
          and (k.responsavel_email = public.meu_email() or (k.responsavel_email is null and public.meu_papel() = 'moderador')))), false)
$$;

create or replace function public.json_caso(k public.casos)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', k.id, 'tipo', k.tipo, 'nivel', k.nivel, 'detalhe', k.detalhe, 'status', k.status,
    'cpf', k.cpf, 'id_app', k.id_app, 'nome', k.nome, 'cidade', k.cidade,
    'criado_em', k.criado_em, 'criado_por_nome', k.criado_por_nome,
    'investigador_nome', k.investigador_nome, 'investigando_desde', k.investigando_desde,
    'verificacao_pedida_em', k.verificacao_pedida_em,
    'responsavel_nome', case when k.verificacao_pedida_em is null then null else coalesce(public.nome_por_email(k.responsavel_email), 'Moderadores') end,
    'checklist', k.checklist,
    'veredito_por_nome', k.veredito_por_nome, 'veredito_em', k.veredito_em, 'veredito_nota', k.veredito_nota,
    'cadastro', (select jsonb_build_object('id', c.id, 'id_app', c.id_app, 'cpf', c.cpf, 'nome', c.nome, 'cidade', c.cidade,
                   'status', c.status, 'situacao', public.status_texto(c.status), 'enviado_em', c.enviado_em, 'enviado_por_nome', public.nome_de(c.enviado_por))
                   from public.cadastros c where c.id = k.cadastro_id),
    'novo_cadastro', (select jsonb_build_object('id', c.id, 'id_app', c.id_app, 'cpf', c.cpf, 'nome', c.nome, 'cidade', c.cidade,
                   'status', c.status, 'situacao', public.status_texto(c.status))
                   from public.cadastros c where c.id = k.novo_cadastro_id),
    'comentarios', coalesce((select jsonb_agg(jsonb_build_object('por_nome', x.por_nome, 'texto', x.texto, 'em', x.em) order by x.id)
                   from public.casos_comentarios x where x.caso_id = k.id), '[]'),
    'para_mim', public.caso_para_mim(k),
    'pode_veredito', k.status = 'aberto' and public.meu_papel() in ('moderador', 'monitorador'))
$$;

-- p_status: 'aberto' (padrão) | 'encerrados' (últimos 90 dias) | 'todos'
create or replace function public.listar_casos(p_status text default 'aberto')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'casos', coalesce((select jsonb_agg(public.json_caso(k) order by (k.nivel = 'forte') desc, k.criado_em desc)
               from public.casos k
              where case coalesce(p_status, 'aberto')
                      when 'aberto' then k.status = 'aberto'
                      when 'encerrados' then k.status <> 'aberto' and k.veredito_em > now() - interval '90 days'
                      else true end), '[]'),
    'checklist', coalesce((select jsonb_agg(texto order by ordem, texto) from public.checklist_casos where ativo), '[]'));
end $$;

-- casos abertos de um ID ou CPF (selo 🕵️ na ficha)
create or replace function public.casos_abertos_de(p_id_app text default null, p_cpf text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'nivel', k.nivel, 'detalhe', k.detalhe) order by k.criado_em desc)
    from public.casos k left join public.cadastros c on c.id = k.cadastro_id
   where k.status = 'aberto'
     and ((p_id_app is not null and (lower(k.id_app) = lower(p_id_app) or lower(c.id_app) = lower(p_id_app)))
       or (p_cpf is not null and (k.cpf = p_cpf or c.cpf = p_cpf)))), '[]');
end $$;

-- Placar do detetive (todos os papéis): quem verificou, confirmou e está investigando
create or replace function public.placar_detetive(p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 3650));
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'abertos', (select count(*) from public.casos where status = 'aberto'),
    'confirmados', (select count(*) from public.casos where status = 'confirmado' and veredito_em >= desde),
    'descartados', (select count(*) from public.casos where status = 'descartado' and veredito_em >= desde),
    'abertos_no_periodo', (select count(*) from public.casos where criado_em >= desde),
    'pessoas', coalesce((select jsonb_agg(x order by x.resolvidos desc, x.comentarios desc, x.nome) from (
        select m.nome,
               (select count(*) from public.casos k where k.veredito_por = m.user_id and k.veredito_em >= desde) resolvidos,
               (select count(*) from public.casos k where k.veredito_por = m.user_id and k.status = 'confirmado' and k.veredito_em >= desde) confirmados,
               (select count(*) from public.casos k where k.investigador = m.user_id and k.status = 'aberto') investigando,
               (select count(*) from public.casos_comentarios x where x.por = m.user_id and x.em >= desde) comentarios
          from public.membros m where m.user_id is not null) x
       where x.resolvidos + x.investigando + x.comentarios > 0), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Funções da 007 que ganham os casos
-- ---------------------------------------------------------------------
create or replace function public.completar_cadastro(
  p_cadastro uuid, p_id_app text, p_cpf text, p_nome text, p_cidade text, p_observacao text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c        public.cadastros;
  v_id_app text := nullif(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'), '');
  v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  v_nome   text := nullif(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), '');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_mot    text := nullif(btrim(coalesce(p_motivo, '')), '');
  partes   text[] := '{}';
  muda     text := '';
  v_caso   uuid;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into c from public.cadastros where id = p_cadastro for update;
  if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
  if v_id_app is null and v_cpf is null then raise exception 'O cadastro precisa de um ID ou de um CPF.'; end if;
  if v_id_app is not null and length(v_id_app) < 4 then raise exception 'ID muito curto. Confira.'; end if;
  if v_cpf is not null and not public.cpf_valido(v_cpf) then raise exception 'CPF inválido. Confira os 11 números.'; end if;
  if v_cidade !~ '^\S.* - [A-Z]{2}$' then raise exception 'Use o formato CIDADE - UF, ex.: LAGARTO - SE.'; end if;
  if length(coalesce(v_nome, '')) > 120 or length(coalesce(v_obs, '')) > 600 then raise exception 'Texto muito longo.'; end if;
  if exists (select 1 from public.cadastros x where x.id <> c.id and
             ((v_cpf is not null and x.cpf = v_cpf) or (v_id_app is not null and lower(x.id_app) = lower(v_id_app)))) then
    raise exception 'Outro cadastro já usa este ID ou CPF.';
  end if;

  if v_id_app is distinct from c.id_app then partes := array_append(partes, format('ID: %s → %s', coalesce(c.id_app, '(vazio)'), coalesce(v_id_app, '(vazio)'))); end if;
  if v_cpf is distinct from c.cpf then partes := array_append(partes, format('CPF: %s → %s', coalesce(public.fmt_cpf(c.cpf), '(vazio)'), coalesce(public.fmt_cpf(v_cpf), '(vazio)'))); end if;
  if v_nome is distinct from c.nome then partes := array_append(partes, format('nome: %s → %s', coalesce(c.nome, '(vazio)'), coalesce(v_nome, '(vazio)'))); end if;
  if v_cidade is distinct from c.cidade then partes := array_append(partes, format('cidade: %s → %s', c.cidade, v_cidade)); end if;
  if v_obs is distinct from c.observacao then partes := array_append(partes, 'observação alterada'); end if;
  if cardinality(partes) = 0 then raise exception 'Nada foi alterado.'; end if;
  muda := array_to_string(partes, ' · ') || case when v_mot is not null then ' · motivo: ' || v_mot else '' end;

  update public.cadastros set id_app = v_id_app, cpf = v_cpf, nome = v_nome, cidade = v_cidade, observacao = v_obs,
         revisado = case when v_id_app is distinct from c.id_app or v_nome is distinct from c.nome then false else revisado end
   where id = c.id;
  insert into public.eventos (cadastro_id, tipo, status_anterior, status_novo, por, detalhe)
  values (c.id, 'editado', c.status, c.status, auth.uid(), left(muda, 1200));
  perform public.concluir_tarefas_cadastro(c.id);
  -- cadastro aprovado que teve o nome ou o ID trocado (completar o que faltava não conta)
  if c.status = 'aprovado' and ((c.id_app is not null and lower(c.id_app) is distinct from lower(v_id_app))
                             or (c.nome is not null and public.norm_nome(c.nome) is distinct from public.norm_nome(v_nome))) then
    v_caso := public.abrir_caso('troca_aprovado', 'atencao', c.id, null, v_cpf, v_id_app, v_nome, v_cidade,
      format('Cadastro APROVADO teve os dados trocados: %s (ID %s) → %s (ID %s).',
        coalesce(c.nome, '(sem nome)'), coalesce(c.id_app, '—'), coalesce(v_nome, '(sem nome)'), coalesce(v_id_app, '—')));
  end if;
  return jsonb_build_object('revisar', public.motivo_revisar_cadastro((select x from public.cadastros x where x.id = c.id)), 'caso', v_caso);
exception when unique_violation then
  raise exception 'Outro cadastro já usa este ID ou CPF.' using errcode = '23505';
end $$;

create or replace function public.listar_cadastros(p_escopo text)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'id_app', c.id_app, 'cpf', c.cpf, 'nome', c.nome, 'cidade', c.cidade, 'observacao', c.observacao,
      'status', c.status, 'enviado_por', c.enviado_por, 'enviado_por_nome', public.nome_de(c.enviado_por),
      'enviado_em', c.enviado_em, 'status_desde', c.status_desde,
      'motivo', c.motivo, 'detalhe', c.detalhe,
      'decidido_por_nome', case when c.decidido_por is not null then public.nome_de(c.decidido_por) end,
      'decidido_em', c.decidido_em,
      'previsao', c.previsao, 'previsao_por_nome', c.previsao_por_nome,
      'revisar', public.motivo_revisar_cadastro(c), 'revisado', c.revisado,
      'caso_aberto', exists (select 1 from public.casos k where k.status = 'aberto' and (k.cadastro_id = c.id or k.novo_cadastro_id = c.id)),
      'tarefa_aberta', exists (select 1 from public.atividades a where a.cadastro_id = c.id and a.status <> 'concluida'),
      'historico', case when p_escopo = 'pendentes' and c.id_app is not null then public.historico_resumo(c.id_app) end,
      'reprovacoes', (select count(*) from public.eventos e where e.cadastro_id = c.id and e.tipo = 'reprovado'),
      'pode_desfazer', (select e.tipo in ('aprovado', 'reprovado', 'encerrado') from public.eventos e
                         where e.cadastro_id = c.id and e.tipo not in ('editado', 'revisado') order by e.id desc limit 1))
      order by c.status_desde)
    from public.cadastros c
    where case p_escopo
            when 'pendentes' then c.status in ('aguardando_analise', 'aguardando_contato')
            when 'meus' then c.enviado_por = auth.uid()
            when 'todos' then true
            else false
          end), '[]');
end $$;

create or replace function public.ver_cadastro(p_cadastro uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.cadastros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into c from public.cadastros where id = p_cadastro;
  if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
  return jsonb_build_object('id', c.id, 'id_app', c.id_app, 'cpf', c.cpf, 'nome', c.nome, 'cidade', c.cidade,
    'observacao', c.observacao, 'status', c.status, 'situacao', public.status_texto(c.status),
    'enviado_por_nome', public.nome_de(c.enviado_por), 'enviado_em', c.enviado_em,
    'revisar', public.motivo_revisar_cadastro(c), 'revisado', c.revisado,
    'casos', public.casos_abertos_de(c.id_app, c.cpf),
    'tarefa_aberta', exists (select 1 from public.atividades a where a.cadastro_id = c.id and a.status <> 'concluida'),
    'edicoes', coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'em', e.em, 'por_nome', public.nome_de(e.por), 'detalhe', e.detalhe) order by e.id desc)
                           from public.eventos e where e.cadastro_id = c.id and e.tipo in ('editado', 'revisado')), '[]'));
end $$;

create or replace function public.busca_rapida(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q   text := btrim(coalesce(p_q, ''));
  dig text := regexp_replace(q, '\D', '', 'g');
  bq  boolean := public.meu_papel_bloq() is not null;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if length(q) < 3 then return jsonb_build_object('entregadores', '[]'::jsonb, 'cadastros', '[]'::jsonb); end if;
  return jsonb_build_object(
    'entregadores', case when not bq then '[]'::jsonb else coalesce((select jsonb_agg(x) from (
        select e.id_app, e.nome, e.cidade,
               (select count(*) from public.bloqueios b where lower(b.id_app) = e.id_app and not b.leve) bloqueios
          from public.entregadores e
         where e.id_app like lower(regexp_replace(q, '[^A-Za-z0-9]', '', 'g')) || '%' or e.nome ilike '%' || q || '%'
         order by (e.id_app = lower(q)) desc, e.nome limit 6) x), '[]') end,
    'cadastros', coalesce((select jsonb_agg(x) from (
        select c.id, c.id_app, c.cpf, c.nome, c.cidade, public.status_texto(c.status) situacao, c.status
          from public.cadastros c
         where lower(c.id_app) like lower(regexp_replace(q, '[^A-Za-z0-9]', '', 'g')) || '%'
            or (length(dig) >= 5 and c.cpf like dig || '%') or c.nome ilike '%' || q || '%'
         order by c.enviado_em desc limit 5) x), '[]'),
    -- lupa do detetive: casos, comentários sobre entregadores (só com bloqueios) e os seus avisos
    'casos', coalesce((select jsonb_agg(x) from (
        select k.id, k.nivel, k.status, k.detalhe, k.criado_em from public.casos k
         where k.detalhe ilike '%' || q || '%' or k.nome ilike '%' || q || '%' or lower(k.id_app) like lower(q) || '%'
            or (length(dig) >= 5 and k.cpf like dig || '%')
         order by (k.status = 'aberto') desc, k.criado_em desc limit 5) x), '[]'),
    'comentarios', case when not bq then '[]'::jsonb else coalesce((select jsonb_agg(x) from (
        select k.id_app, k.texto, k.por_nome, k.em, (select e.nome from public.entregadores e where e.id_app = k.id_app) nome
          from public.comentarios_entregador k
         where k.tipo = 'comentario' and k.texto ilike '%' || q || '%'
         order by k.em desc limit 5) x), '[]') end,
    'avisos', coalesce((select jsonb_agg(x) from (
        select n.texto, n.link, n.criada_em from public.notificacoes n
         where n.para = auth.uid() and n.texto ilike '%' || q || '%'
         order by n.id desc limit 5) x), '[]'));
end $$;

create or replace function public.resumo_e_avisos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'resumo', public.resumo_inicio() || jsonb_build_object(
      'pedidos_acesso', case when public.meu_papel() = 'moderador' then (select count(*) from public.pedidos_acesso) end,
      'bloqueios_revisar', case when public.meu_papel_bloq() in ('moderador', 'monitorador') then (select count(*) from public.bloqueios where revisar is not null) end,
      'versao', (select n from public.versao_dados),
      'casos_abertos', (select count(*) from public.casos where status = 'aberto'),
      'casos_para_mim', (select count(*) from public.casos k where public.caso_para_mim(k))),
    'notif', public.minhas_notificacoes());
end $$;

-- ---------------------------------------------------------------------
-- Menos tráfego: as tabelas novas também contam como mudança
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['casos', 'casos_comentarios', 'checklist_casos'] loop
    execute format('drop trigger if exists marcar_mudanca on public.%I', t);
    execute format('create trigger marcar_mudanca after insert or update or delete on public.%I for each statement execute function public.marcar_mudanca()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------
alter table public.casos enable row level security;
alter table public.casos_comentarios enable row level security;
alter table public.checklist_casos enable row level security;
drop policy if exists casos_leitura on public.casos;
create policy casos_leitura on public.casos for select to authenticated using ((select public.meu_papel()) is not null);
drop policy if exists casos_comentarios_leitura on public.casos_comentarios;
create policy casos_comentarios_leitura on public.casos_comentarios for select to authenticated using ((select public.meu_papel()) is not null);
drop policy if exists checklist_casos_leitura on public.checklist_casos;
create policy checklist_casos_leitura on public.checklist_casos for select to authenticated using ((select public.meu_papel()) is not null);

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
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke select on public.anexos from authenticated;
