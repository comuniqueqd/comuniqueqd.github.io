-- =====================================================================
-- Migração 007 · "Pão quentinho" (tudo conectado)
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rodar DEPOIS do 006-equipe-previsao-atencao.sql. Não apaga dados e pode rodar mais de uma vez.
--
--   * Cadastro da ativação ganha o NOME do entregador; aprovado com ID e nome, a FICHA
--     (entregadores) nasce na hora.
--   * Cadastro incompleto (sem nome, sem ID, ou ID com ficha de outro nome) fica com a marca
--     "revisar" (calculada na leitura). Qualquer pessoa da equipe completa ou edita os dados,
--     com o antes e o depois no histórico. Monitorador/moderador podem marcar como revisado.
--   * TAREFA OPCIONAL (formato novo, reutilizável): atividade com `opcional`; é normal para quem
--     foi sugerido e aparece como opcional, discreta, para o resto da equipe. Cadastro novo
--     incompleto gera uma para o administrador final; conclui sozinha quando os dados ficam completos.
--   * Quem enviou o cadastro é avisado quando ele é aprovado, reprovado, encerrado ou desfeito.
--   * Histórico do ID no Novo cadastro e nos Pendentes; busca rápida no topo.
--   * Menos tráfego: `ultima_mudanca()` (o app só recarrega quando algo mudou), Histórico de
--     bloqueios paginado no banco e resumo + avisos numa chamada só.
-- =====================================================================

drop function if exists public.enviar_cadastro(text, text, text, text);

-- ---------------------------------------------------------------------
-- Colunas e tipos novos
-- ---------------------------------------------------------------------
alter table public.cadastros add column if not exists nome text;
alter table public.cadastros drop constraint if exists cadastros_nome_check;
alter table public.cadastros add constraint cadastros_nome_check check (nome is null or length(btrim(nome)) between 1 and 120);
alter table public.cadastros add column if not exists revisado boolean not null default false;

alter table public.eventos drop constraint if exists eventos_tipo_check;
alter table public.eventos add constraint eventos_tipo_check
  check (tipo in ('enviado', 'aprovado', 'reprovado', 'encerrado', 'desfeito', 'editado', 'revisado'));

alter table public.atividades add column if not exists opcional boolean not null default false;
alter table public.atividades add column if not exists cadastro_id uuid references public.cadastros (id) on delete cascade;
create index if not exists atividades_cadastro on public.atividades (cadastro_id) where cadastro_id is not null;

-- ---------------------------------------------------------------------
-- "Revisar" do cadastro (calculado: some sozinho quando os dados ficam certos)
-- ---------------------------------------------------------------------
create or replace function public.motivo_revisar_cadastro(c public.cadastros)
returns text language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(' · ',
    case when c.nome is null then 'falta o nome do entregador' end,
    case when c.id_app is null then 'falta o ID do entregador' end,
    case when not c.revisado and c.id_app is not null and c.nome is not null
              and exists (select 1 from public.entregadores e where e.id_app = lower(c.id_app)
                           and lower(btrim(e.nome)) <> lower(btrim(c.nome)))
         then 'o ID já tem ficha com outro nome: ' || (select e.nome from public.entregadores e where e.id_app = lower(c.id_app)) end), '')
$$;

-- Resumo do histórico de um ID (para o Novo cadastro e os Pendentes). Só para quem tem o módulo de bloqueios.
create or replace function public.historico_resumo(p_id_app text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.meu_papel_bloq() is null or coalesce(btrim(p_id_app), '') = '' then null else (
    select case when e.id_app is null and x.total = 0 then null else jsonb_build_object(
      'nome', e.nome, 'cidade', e.cidade, 'bloqueios', x.normais, 'leves', x.leves,
      'comentarios', (select count(*) from public.comentarios_entregador k where k.id_app = lower(p_id_app) and k.tipo = 'comentario'),
      'bloqueado_agora', x.agora, 'encerrado', x.encerrado,
      'ultimo_infracao', x.ultimo_infracao, 'ultimo_em', x.ultimo_em, 'encerrado_infracao', x.enc_infracao, 'encerrado_em', x.enc_em) end
      from (select count(*) total, count(*) filter (where not b.leve) normais, count(*) filter (where b.leve) leves,
                   bool_or(not b.leve and public.situacao_bloqueio(b) = 'bloqueado') agora,
                   bool_or(not b.leve and public.situacao_bloqueio(b) = 'encerramento') encerrado,
                   (array_agg(b.infracao order by b.inicio desc))[1] ultimo_infracao, max(b.inicio) ultimo_em,
                   (array_agg(b.infracao order by b.inicio desc) filter (where not b.leve and public.situacao_bloqueio(b) = 'encerramento'))[1] enc_infracao,
                   max(b.inicio) filter (where not b.leve and public.situacao_bloqueio(b) = 'encerramento') enc_em
              from public.bloqueios b where lower(b.id_app) = lower(p_id_app)) x
      left join public.entregadores e on e.id_app = lower(p_id_app)) end
$$;

-- No Novo cadastro, ao digitar o ID ou o CPF: o que o sistema já sabe
create or replace function public.historico_id(p_id_app text default null, p_cpf text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_id  text := nullif(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  c public.cadastros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if v_id is not null and length(v_id) < 4 then v_id := null; end if;
  if v_cpf is not null and length(v_cpf) <> 11 then v_cpf := null; end if;
  select * into c from public.cadastros
   where (v_id is not null and lower(id_app) = lower(v_id)) or (v_cpf is not null and cpf = v_cpf) limit 1;
  return jsonb_build_object(
    'cadastro', case when c.id is null then null else jsonb_build_object('situacao', public.status_texto(c.status),
                  'enviado_em', c.enviado_em, 'nome', c.nome, 'por_id', v_id is not null and lower(c.id_app) = lower(v_id)) end,
    'historico', case when v_id is null then null else public.historico_resumo(v_id) end,
    'tem_bloqueios_modulo', public.meu_papel_bloq() is not null);
end $$;

-- ---------------------------------------------------------------------
-- Tarefa opcional (atividade com `opcional`)
-- ---------------------------------------------------------------------
create or replace function public.atividade_aberta_para_mim(a public.atividades)
returns boolean language sql stable security definer set search_path = public as $$
  select a.opcional or cardinality(a.sugeridas_para) = 0 or auth.uid() = any (a.sugeridas_para)
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
    'opcional', a.opcional, 'opcional_para_mim', a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false),
    'cadastro_id', a.cadastro_id,
    'prazo', a.prazo, 'status', a.status,
    'aceita_por', a.aceita_por, 'aceita_por_nome', a.aceita_por_nome, 'aceita_em', a.aceita_em,
    'concluida_por_nome', a.concluida_por_nome, 'concluida_em', a.concluida_em, 'nota', a.nota,
    'previsao', a.previsao, 'previsao_por_nome', a.previsao_por_nome,
    'pode_aceitar', a.status = 'aberta' and public.atividade_aberta_para_mim(a),
    'pode_concluir', a.status = 'aceita' and (a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'),
    'pode_prever', a.status = 'aceita' and (a.aceita_por = auth.uid() or public.meu_papel() = 'moderador'),
    'pode_excluir', a.criada_por = auth.uid() or public.meu_papel() = 'moderador')
$$;

-- Cria a tarefa de completar um cadastro. p_para nulo = normal para o admin final e opcional
-- para o resto da equipe; com uma pessoa = atividade sugerida normal só para ela.
create or replace function public.criar_tarefa_cadastro(p_cadastro uuid, p_para uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c     public.cadastros;
  quem  text := coalesce((select nome from public.membros where email = public.meu_email()), 'Sistema');
  admin uuid := (select user_id from public.membros where admin_final);
  para  uuid[];
  novo  uuid;
  rot   text;
begin
  select * into c from public.cadastros where id = p_cadastro;
  rot := coalesce(c.nome, coalesce('ID ' || c.id_app, 'CPF ' || public.fmt_cpf(c.cpf)));
  para := case when p_para is not null then array[p_para] when admin is not null then array[admin] else '{}' end;
  insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, opcional, cadastro_id)
  values (left('Completar cadastro: ' || rot || ' · ' || c.cidade, 150),
          'Cadastro da ativação com dados faltando ou conflitantes: ' || coalesce(public.motivo_revisar_cadastro(c), 'conferir os dados') || '.',
          coalesce(auth.uid(), c.enviado_por), quem, para, p_para is null, c.id)
  returning id into novo;
  insert into public.notificacoes (para, texto, link)
  select x, format('%s: cadastro para completar (%s).', quem, rot), '#atividades/sugeridas'
    from unnest(para) x where x is distinct from auth.uid();
  return novo;
end $$;

create or replace function public.fmt_cpf(p text)
returns text language sql immutable as $$
  select case when p ~ '^[0-9]{11}$' then substr(p, 1, 3) || '.' || substr(p, 4, 3) || '.' || substr(p, 7, 3) || '-' || substr(p, 10, 2) else p end
$$;

create or replace function public.sugerir_tarefa_cadastro(p_cadastro uuid, p_para uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.cadastros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into c from public.cadastros where id = p_cadastro;
  if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
  if public.motivo_revisar_cadastro(c) is null then raise exception 'Este cadastro já está completo.'; end if;
  if exists (select 1 from public.atividades where cadastro_id = c.id and status <> 'concluida') then
    raise exception 'Já existe uma tarefa aberta para este cadastro.';
  end if;
  if p_para is not null and not exists (select 1 from public.membros where user_id = p_para) then
    raise exception 'Essa pessoa não faz parte da equipe.';
  end if;
  return public.criar_tarefa_cadastro(c.id, p_para);
end $$;

-- conclui as tarefas do cadastro quando ele deixa de precisar de revisão
create or replace function public.concluir_tarefas_cadastro(p_cadastro uuid)
returns void language sql security definer set search_path = public as $$
  update public.atividades set status = 'concluida', concluida_em = now(),
         concluida_por_nome = coalesce((select nome from public.membros where email = public.meu_email()), 'Sistema'),
         nota = coalesce(nota, 'Dados do cadastro completados.')
   where cadastro_id = p_cadastro and status <> 'concluida'
     and public.motivo_revisar_cadastro((select c from public.cadastros c where c.id = p_cadastro)) is null
$$;

-- ---------------------------------------------------------------------
-- Envio, edição e revisão do cadastro
-- ---------------------------------------------------------------------
create or replace function public.enviar_cadastro(
  p_id_app text, p_cpf text, p_cidade text, p_observacao text default null, p_nome text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id_app text := nullif(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'), '');
  v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_nome   text := nullif(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), '');
  ja       public.cadastros;
  novo     uuid;
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
    raise exception 'Este % já está cadastrado (situação: %, enviado em %).',
      case when v_cpf is not null and ja.cpf = v_cpf then 'CPF' else 'ID' end,
      public.status_texto(ja.status), to_char(ja.enviado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;

  insert into public.cadastros (id_app, cpf, cidade, observacao, enviado_por, nome)
  values (v_id_app, v_cpf, v_cidade, v_obs, auth.uid(), v_nome)
  returning id into novo;
  insert into public.eventos (cadastro_id, tipo, status_novo, por)
  values (novo, 'enviado', 'aguardando_analise', auth.uid());
  if public.motivo_revisar_cadastro((select c from public.cadastros c where c.id = novo)) is not null then
    perform public.criar_tarefa_cadastro(novo, null);
  end if;
  return novo;
exception when unique_violation then
  raise exception 'Este CPF ou ID já está cadastrado.' using errcode = '23505';
end $$;

-- Qualquer pessoa da equipe completa ou corrige os dados (o histórico guarda o antes e o depois)
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
  return jsonb_build_object('revisar', public.motivo_revisar_cadastro((select x from public.cadastros x where x.id = c.id)));
exception when unique_violation then
  raise exception 'Outro cadastro já usa este ID ou CPF.' using errcode = '23505';
end $$;

-- Abre um cadastro para completar (a partir da tarefa ou da busca), mesmo que não seja de quem pede
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
    'tarefa_aberta', exists (select 1 from public.atividades a where a.cadastro_id = c.id and a.status <> 'concluida'),
    'edicoes', coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'em', e.em, 'por_nome', public.nome_de(e.por), 'detalhe', e.detalhe) order by e.id desc)
                           from public.eventos e where e.cadastro_id = c.id and e.tipo in ('editado', 'revisado')), '[]'));
end $$;

-- "Os dados estão certos" (ex.: o nome da ficha é de outra pessoa que usou o mesmo ID)
create or replace function public.marcar_cadastro_revisado(p_cadastro uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cadastros;
begin
  perform public.exigir_papel('moderador', 'monitorador');
  select * into c from public.cadastros where id = p_cadastro for update;
  if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
  if c.nome is null or c.id_app is null then raise exception 'Ainda falta o nome ou o ID: complete os dados.'; end if;
  update public.cadastros set revisado = true where id = c.id;
  insert into public.eventos (cadastro_id, tipo, status_anterior, status_novo, por, detalhe)
  values (c.id, 'revisado', c.status, c.status, auth.uid(), 'Dados conferidos: ' || coalesce(public.motivo_revisar_cadastro(c), 'ok'));
  perform public.concluir_tarefas_cadastro(c.id);
end $$;

-- Aprovado com ID e nome: a ficha nasce (nunca sobrescreve uma ficha que já existe)
create or replace function public.cadastro_cria_ficha()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'aprovado' and new.id_app is not null and new.nome is not null then
    insert into public.entregadores (id_app, nome, cidade)
    values (lower(new.id_app), new.nome, case when exists (select 1 from public.cidades where nome = new.cidade) then new.cidade end)
    on conflict (id_app) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists cadastro_cria_ficha on public.cadastros;
create trigger cadastro_cria_ficha after update of status, id_app, nome on public.cadastros
  for each row execute function public.cadastro_cria_ficha();

-- O "pão quentinho": quem enviou fica sabendo da decisão na hora
create or replace function public.avisar_decisao()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.cadastros; rot text;
begin
  if new.tipo not in ('aprovado', 'reprovado', 'encerrado', 'desfeito') then return new; end if;
  select * into c from public.cadastros where id = new.cadastro_id;
  rot := coalesce(c.nome || ' (ID ' || c.id_app || ')', c.nome, 'ID ' || c.id_app, 'CPF ' || public.fmt_cpf(c.cpf));
  perform public.notificar(c.enviado_por,
    format('Seu cadastro %s %s por %s%s.', rot,
      case new.tipo when 'aprovado' then 'foi aprovado' when 'reprovado' then 'foi reprovado' when 'encerrado' then 'foi encerrado'
                    else 'teve a decisão desfeita' end,
      coalesce(public.nome_de(new.por), 'alguém da equipe'),
      case when new.motivo is not null and new.tipo <> 'desfeito' then ': ' || new.motivo || coalesce(' (' || new.detalhe || ')', '') else '' end),
    '#ativacao/meus');
  return new;
end $$;
drop trigger if exists avisar_decisao on public.eventos;
create trigger avisar_decisao after insert on public.eventos for each row execute function public.avisar_decisao();

-- ---------------------------------------------------------------------
-- Leitura dos cadastros (com nome, revisar, tarefa e histórico do ID)
-- ---------------------------------------------------------------------
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

-- desfazer ignora as edições e revisões ao procurar a última decisão
create or replace function public.desfazer(p_cadastro uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c   public.cadastros;
  ult public.eventos;
  ant public.eventos;
begin
  perform public.exigir_papel('moderador');
  select * into c from public.cadastros where id = p_cadastro for update;
  if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
  select * into ult from public.eventos where cadastro_id = c.id and tipo not in ('editado', 'revisado') order by id desc limit 1;
  if ult.tipo not in ('aprovado', 'reprovado', 'encerrado') then raise exception 'Não há decisão para desfazer.'; end if;
  select * into ant from public.eventos
   where cadastro_id = c.id and id < ult.id and status_novo = ult.status_anterior
     and tipo in ('aprovado', 'reprovado', 'encerrado')
   order by id desc limit 1;
  update public.cadastros
     set status = ult.status_anterior, status_desde = coalesce(ant.em, c.enviado_em),
         motivo = ant.motivo, detalhe = ant.detalhe, decidido_por = ant.por, decidido_em = ant.em
   where id = c.id;
  insert into public.eventos (cadastro_id, tipo, status_anterior, status_novo, por, motivo)
  values (c.id, 'desfeito', c.status, ult.status_anterior, auth.uid(), 'Desfeito: ' || ult.tipo);
end $$;

-- ---------------------------------------------------------------------
-- Busca rápida (topo do app): fichas e cadastros por ID, CPF ou nome
-- ---------------------------------------------------------------------
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
         order by c.enviado_em desc limit 5) x), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Menos tráfego
-- ---------------------------------------------------------------------
create table if not exists public.versao_dados (
  unico boolean primary key default true check (unico),
  n     bigint not null default 0,
  em    timestamptz not null default now()
);
insert into public.versao_dados (unico) values (true) on conflict do nothing;

create or replace function public.marcar_mudanca()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.versao_dados set n = n + 1, em = now();
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['cadastros', 'eventos', 'membros', 'pedidos_acesso', 'bloqueios', 'eventos_bloqueio', 'tarefas',
                           'atividades', 'comentarios_entregador', 'notificacoes', 'cidades', 'infracoes', 'parametros_bloqueio',
                           'entregadores', 'operadores_logisticos', 'parametros_equipe', 'anexos', 'motivos'] loop
    execute format('drop trigger if exists marcar_mudanca on public.%I', t);
    execute format('create trigger marcar_mudanca after insert or update or delete on public.%I for each statement execute function public.marcar_mudanca()', t);
  end loop;
end $$;

-- O app pergunta isto a cada ciclo; só recarrega as listas quando o número muda
create or replace function public.ultima_mudanca()
returns bigint language sql stable security definer set search_path = public as $$
  select case when public.meu_papel() is null then null else (select n from public.versao_dados) end
$$;

-- tela inicial: as tarefas opcionais (dos outros) não entram no contador "para aceitar"; contam à parte
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
      'para_aceitar', count(*) filter (where a.status = 'aberta' and public.atividade_aberta_para_mim(a) and a.criada_por is distinct from auth.uid()
                                         and not (a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false))),
      'opcionais', count(*) filter (where a.status = 'aberta' and a.opcional and not coalesce(auth.uid() = any (a.sugeridas_para), false)),
      'minhas_em_andamento', count(*) filter (where a.status = 'aceita' and a.aceita_por = auth.uid()),
      'equipe_abertas', count(*) filter (where a.status in ('aberta', 'aceita')))
      from public.atividades a),
    'notificacoes', (select count(*) from public.notificacoes where para = auth.uid() and lida_em is null));
end $$;

-- resumo da tela inicial + avisos do sino (+ pedidos de acesso, para os moderadores) numa chamada só
create or replace function public.resumo_e_avisos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'resumo', public.resumo_inicio() || jsonb_build_object(
      'pedidos_acesso', case when public.meu_papel() = 'moderador' then (select count(*) from public.pedidos_acesso) end,
      'bloqueios_revisar', case when public.meu_papel_bloq() in ('moderador', 'monitorador') then (select count(*) from public.bloqueios where revisar is not null) end,
      'versao', (select n from public.versao_dados)),
    'notif', public.minhas_notificacoes());
end $$;

-- Histórico de bloqueios paginado e filtrado no banco (o app baixa só a página da tela)
-- p_situacao: '' | bloqueado | liberado | liberado_antes | encerramento | revertido | revisar | dados_pendentes
create or replace function public.listar_bloqueios_pagina(
  p_pagina integer default 1, p_por integer default 100, p_busca text default null, p_situacao text default null,
  p_cidade text default null, p_infracao smallint default null, p_quem text default null, p_tipo text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  q   text := nullif(btrim(coalesce(p_busca, '')), '');
  por integer := least(greatest(coalesce(p_por, 100), 1), 5000);
  pg  integer := greatest(coalesce(p_pagina, 1), 1);
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return (with f as (
      select b.* from public.bloqueios b
       where (q is null or concat_ws(' ', b.id_app, b.nome_entregador, b.cidade, b.infracao, b.registrado_por_nome) ilike '%' || q || '%')
         and (p_situacao is null or p_situacao = ''
              or (p_situacao = 'revisar' and b.revisar is not null)
              or (p_situacao = 'dados_pendentes' and b.dados_pendentes)
              or public.situacao_bloqueio(b) = p_situacao)
         and (p_cidade is null or p_cidade = '' or b.cidade = p_cidade)
         and (p_infracao is null or b.infracao_id = p_infracao)
         and (p_quem is null or p_quem = '' or b.registrado_por_nome = p_quem)
         and (p_tipo is null or p_tipo = '' or (p_tipo = 'leve') = b.leve))
    select jsonb_build_object(
      'total', (select count(*) from f),
      'total_geral', (select count(*) from public.bloqueios),
      'pagina', pg, 'por', por,
      'itens', coalesce((select jsonb_agg(public.json_bloqueio(x) order by x.inicio desc)
                           from (select * from f order by inicio desc offset (pg - 1) * por limit por) x), '[]'),
      'quem', coalesce((select jsonb_agg(distinct registrado_por_nome) from public.bloqueios), '[]'),
      'cidades', coalesce((select jsonb_agg(distinct cidade) from public.bloqueios where cidade is not null), '[]')));
end $$;

-- ---------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------
alter table public.versao_dados enable row level security;
drop policy if exists versao_dados_leitura on public.versao_dados;
create policy versao_dados_leitura on public.versao_dados for select to authenticated using ((select public.meu_papel()) is not null);

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
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke select on public.anexos from authenticated;
