-- =====================================================================
-- Migração 003: cadastro do entregador, comentários, correção de bloqueios e segurança
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rodar DEPOIS do 002-bloqueios.sql. Não apaga dados e pode rodar mais de uma vez.
--
--   * ENTREGADORES: um registro por ID (nome e cidade "oficiais"). Nasce sozinho a partir
--     dos bloqueios (o mais recente de cada ID) e de cada novo registro. Monitorador e
--     moderador podem alterar pela tela "Consultar entregador"; a alteração vale para os
--     próximos registros e, se pedirem, também para os bloqueios já feitos com aquele ID.
--   * COMENTÁRIOS do entregador: qualquer pessoa do módulo de bloqueios pode comentar
--     (no Novo bloqueio ou na consulta). As alterações de dados também ficam registradas ali.
--   * CORREÇÃO de um bloqueio (ID, nome, cidade), com motivo obrigatório, por monitorador ou
--     moderador. Resolve o alerta "revisar". A punição aplicada e a ocorrência gravada não mudam.
--     Sem alteração, só marca o alerta como revisado.
--   * Correções: apagar o bloqueio gerado por infrações leves não faz mais a contagem de
--     leves "voltar" (antes as leves contavam de novo e geravam outro bloqueio).
--   * Segurança: funções auxiliares deixam de ser chamáveis por quem está fora da equipe.
-- =====================================================================

drop function if exists public.registrar_bloqueio(text, text, text, smallint, text);
drop function if exists public.registrar_infracao_leve(text, smallint, text);

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.entregadores (
  id_app              text primary key check (id_app = lower(id_app) and id_app ~ '^[a-z0-9]{4,40}$'),
  nome                text not null check (length(btrim(nome)) between 1 and 120),
  cidade              text references public.cidades (nome) on update cascade,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz,
  atualizado_por_nome text
);

create table if not exists public.comentarios_entregador (
  id          bigint generated always as identity primary key,
  id_app      text not null check (id_app = lower(id_app)),
  tipo        text not null default 'comentario' check (tipo in ('comentario', 'alteracao')),
  texto       text not null check (length(btrim(texto)) between 1 and 1500),
  bloqueio_id uuid references public.bloqueios (id) on delete set null,
  por         uuid,
  por_nome    text,
  em          timestamptz not null default now()
);
create index if not exists comentarios_entregador_id on public.comentarios_entregador (id_app, em desc);

-- marca permanente de "esta leve atingiu o limite" (gerou_bloqueio vira nulo se o bloqueio gerado for apagado)
alter table public.bloqueios add column if not exists atingiu_limite boolean not null default false;
update public.bloqueios set atingiu_limite = true where gerou_bloqueio is not null and not atingiu_limite;

alter table public.eventos_bloqueio drop constraint if exists eventos_bloqueio_tipo_check;
alter table public.eventos_bloqueio add constraint eventos_bloqueio_tipo_check
  check (tipo in ('registrado', 'liberado_antes', 'tratativa_concluida', 'corrigido', 'revisado'));

-- ---------------------------------------------------------------------
-- O cadastro do entregador nasce dos bloqueios (sem sobrescrever o que já existe)
-- ---------------------------------------------------------------------
create or replace function public.nome_valido(p text)
returns boolean language sql immutable as $$
  select coalesce(btrim(p), '') not in ('', '(a completar)', '(sem nome)')
$$;

create or replace function public.bloqueio_cria_entregador()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.dados_pendentes and public.nome_valido(new.nome_entregador) then
    insert into public.entregadores (id_app, nome, cidade)
    values (lower(new.id_app), btrim(new.nome_entregador), new.cidade)
    on conflict (id_app) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists bloqueio_cria_entregador on public.bloqueios;
create trigger bloqueio_cria_entregador after insert or update of id_app, nome_entregador, cidade, dados_pendentes
  on public.bloqueios for each row execute function public.bloqueio_cria_entregador();

insert into public.entregadores (id_app, nome, cidade)
select distinct on (lower(id_app)) lower(id_app), btrim(nome_entregador), cidade
  from public.bloqueios
 where not dados_pendentes and public.nome_valido(nome_entregador)
 order by lower(id_app), inicio desc
on conflict (id_app) do nothing;

-- ---------------------------------------------------------------------
-- Auxiliares (internas: não chamáveis pelo app, ver o fim do arquivo)
-- ---------------------------------------------------------------------
-- Nome e cidade de um ID: primeiro o cadastro do entregador; senão o último bloqueio
-- com dados; a cidade pode vir também do cadastro da ativação.
create or replace function public.dados_conhecidos(p_id_app text)
returns table (nome text, cidade text) language sql stable security definer set search_path = public as $$
  select coalesce((select e.nome from public.entregadores e where e.id_app = lower(p_id_app)),
                  (select b.nome_entregador from public.bloqueios b
                    where lower(b.id_app) = lower(p_id_app) and not b.dados_pendentes and public.nome_valido(b.nome_entregador)
                    order by b.inicio desc limit 1)),
         coalesce((select e.cidade from public.entregadores e where e.id_app = lower(p_id_app)),
                  (select b.cidade from public.bloqueios b
                    where lower(b.id_app) = lower(p_id_app) and not b.dados_pendentes and b.cidade is not null order by b.inicio desc limit 1),
                  (select c.cidade from public.cadastros c where lower(c.id_app) = lower(p_id_app)
                     and exists (select 1 from public.cidades x where x.nome = c.cidade) limit 1))
$$;

create or replace function public.leves_acumuladas(p_id_app text, p_momento timestamptz)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.bloqueios b, public.parametros_bloqueio par
   where lower(b.id_app) = lower(p_id_app) and b.leve and b.inicio <= p_momento
     and b.inicio > p_momento - make_interval(days => par.leves_janela_dias)
     and b.inicio > coalesce((select max(x.inicio) from public.bloqueios x
                               where lower(x.id_app) = lower(p_id_app) and x.leve and x.atingiu_limite
                                 and x.inicio <= p_momento), '-infinity')
$$;

create or replace function public.comentarios_de(p_id_app text, p_limite integer default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'texto', c.texto, 'em', c.em,
           'por', c.por, 'por_nome', c.por_nome, 'bloqueio_id', c.bloqueio_id) order by c.em desc), '[]')
    from (select * from public.comentarios_entregador where id_app = lower(p_id_app) order by em desc limit p_limite) c
$$;

create or replace function public.anotar_entregador(p_id_app text, p_tipo text, p_texto text, p_bloqueio uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.comentarios_entregador (id_app, tipo, texto, bloqueio_id, por, por_nome)
  select lower(p_id_app), p_tipo, left(btrim(p_texto), 1500), p_bloqueio, auth.uid(),
         (select nome from public.membros where email = public.meu_email())
   where nullif(btrim(coalesce(p_texto, '')), '') is not null
$$;

-- Nomes de pessoas da equipe: quem está logado mas fora da equipe recebe nulo.
-- (No SQL Editor não há usuário logado, então as views continuam mostrando os nomes.)
create or replace function public.nome_de(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and public.meu_papel() is null then null
              else coalesce((select nome from public.membros where user_id = uid), '(fora da equipe)') end
$$;

-- ---------------------------------------------------------------------
-- Registro (com comentário opcional para o cadastro do entregador)
-- ---------------------------------------------------------------------
create or replace function public.registrar_bloqueio(
  p_id_app text, p_nome text, p_cidade text, p_infracao smallint, p_observacao text default null, p_comentario text default null)
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
  if not public.nome_valido(p_nome) then raise exception 'Preencha o nome do entregador.'; end if;
  if not exists (select 1 from public.cidades where nome = v_cidade and ativa) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  if length(coalesce(p_comentario, '')) > 1500 then raise exception 'O comentário pode ter no máximo 1500 caracteres.'; end if;
  select * into i from public.infracoes where id = p_infracao and ativa and not leve;
  if i.id is null then raise exception 'Escolha a infração.'; end if;
  -- evita registro em dobro (dois cliques, duas pessoas ao mesmo tempo)
  perform pg_advisory_xact_lock(hashtext(lower(v_id)));
  select * into ja from public.bloqueios
   where lower(id_app) = lower(v_id) and infracao_id = i.id and inicio > now() - interval '10 minutes' limit 1;
  if ja.id is not null then
    raise exception 'Este entregador já recebeu um bloqueio por esta infração há poucos minutos (registrado por %).', ja.registrado_por_nome;
  end if;
  b := public.inserir_bloqueio(v_id, btrim(p_nome), v_cidade, i.id, now(), auth.uid(),
                               (select nome from public.membros where email = public.meu_email()), v_obs);
  perform public.anotar_entregador(v_id, 'comentario', p_comentario, b.id);
  return jsonb_build_object('id', b.id, 'ocorrencia', b.ocorrencia, 'horas', b.horas, 'fim', b.fim,
    'tarefa', exists (select 1 from public.tarefas where bloqueio_id = b.id));
end $$;

create or replace function public.registrar_infracao_leve(
  p_id_app text, p_infracao smallint, p_observacao text default null, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id   text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  v_obs  text := nullif(btrim(coalesce(p_observacao, '')), '');
  quem   text := (select nome from public.membros where email = public.meu_email());
  i      public.infracoes;
  par    public.parametros_bloqueio;
  conh   record;
  pend   boolean;
  b      public.bloqueios;
  nb     public.bloqueios;
  ja     public.bloqueios;
  qtd    integer;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if length(v_id) < 4 then raise exception 'Preencha o ID do entregador.'; end if;
  if length(coalesce(p_comentario, '')) > 1500 then raise exception 'O comentário pode ter no máximo 1500 caracteres.'; end if;
  select * into i from public.infracoes where id = p_infracao and ativa and leve;
  if i.id is null then raise exception 'Escolha o motivo da infração leve.'; end if;
  select * into par from public.parametros_bloqueio;
  perform pg_advisory_xact_lock(hashtext(lower(v_id)));
  select * into ja from public.bloqueios
   where lower(id_app) = lower(v_id) and infracao_id = i.id and inicio > now() - interval '10 minutes' limit 1;
  if ja.id is not null then
    raise exception 'Este entregador já recebeu este aviso há poucos minutos (registrado por %).', ja.registrado_por_nome;
  end if;
  select * into conh from public.dados_conhecidos(v_id);
  pend := conh.nome is null;
  b := public.inserir_bloqueio(v_id, coalesce(conh.nome, '(a completar)'), conh.cidade, i.id, now(), auth.uid(), quem, v_obs,
                               false, null, false, null, pend);
  if pend and not exists (select 1 from public.tarefas t join public.bloqueios x on x.id = t.bloqueio_id
                           where lower(x.id_app) = lower(v_id) and t.tipo = 'completar_dados' and t.status = 'pendente') then
    insert into public.tarefas (tipo, bloqueio_id, cidade, responsavel_email)
    values ('completar_dados', b.id, conh.cidade, public.responsavel_da_cidade(conh.cidade));
  end if;
  qtd := public.leves_acumuladas(v_id, now());
  if qtd >= par.leves_limite and i.escala_para is not null then
    nb := public.inserir_bloqueio(v_id, coalesce(conh.nome, '(a completar)'), conh.cidade, i.escala_para, now(), auth.uid(), quem,
            format('Gerado automaticamente: %s infrações leves em até %s dias.', qtd, par.leves_janela_dias),
            false, null, false, null, pend, 'leves_acumuladas');
    update public.bloqueios set gerou_bloqueio = nb.id, atingiu_limite = true where id = b.id;
  end if;
  perform public.anotar_entregador(v_id, 'comentario', p_comentario, b.id);
  return jsonb_build_object('id', b.id, 'horas', b.horas, 'fim', b.fim, 'dados_pendentes', pend,
    'nome', conh.nome, 'cidade', conh.cidade, 'leves', qtd, 'limite', par.leves_limite, 'janela_dias', par.leves_janela_dias,
    'gerado', case when nb.id is null then null else jsonb_build_object('id', nb.id, 'infracao', nb.infracao,
      'ocorrencia', nb.ocorrencia, 'horas', nb.horas, 'fim', nb.fim,
      'responsavel', coalesce(public.nome_por_email(public.responsavel_da_cidade(conh.cidade)), 'Moderadores')) end);
end $$;

-- Prévia: agora também traz o cadastro do entregador e os comentários.
create or replace function public.previa_bloqueio(p_id_app text, p_infracao smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_id  text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  i     public.infracoes;
  esc   public.infracoes;
  n     integer;
  tot   integer;
  h     numeric;
  lv    integer;
  par   public.parametros_bloqueio;
  conh  record;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into i from public.infracoes where id = p_infracao;
  select * into par from public.parametros_bloqueio;
  if i.id is not null and length(v_id) >= 4 then
    select c.ocorrencia, c.total into n, tot from public.calcular_ocorrencia(v_id, i.id, now()) c;
    h := public.horas_previstas(i, n);
  end if;
  select * into conh from public.dados_conhecidos(v_id);
  if i.leve and length(v_id) >= 4 then
    lv := public.leves_acumuladas(v_id, now()) + 1;   -- contando com esta
    select * into esc from public.infracoes where id = i.escala_para;
  end if;
  return jsonb_build_object(
    'ocorrencia', n, 'total', tot,
    'reiniciada', coalesce(n < tot, false),
    'janela_dias', i.janela_dias,
    'horas', h, 'encerramento', i.id is not null and n is not null and h is null,
    'fim', case when h is not null then now() + h::double precision * interval '1 hour' end,
    'gera_tratativa', n is not null and not coalesce(i.leve, false) and (h is null or h >= 10),
    'leve', coalesce(i.leve, false),
    'leves', case when lv is null then null else jsonb_build_object(
        'esta_sera', lv, 'limite', par.leves_limite, 'janela_dias', par.leves_janela_dias,
        'gera_bloqueio', lv >= par.leves_limite,
        'bloqueio_infracao', esc.nome,
        'bloqueio_horas', case when esc.id is not null then
            public.horas_previstas(esc, (select c.ocorrencia from public.calcular_ocorrencia(v_id, esc.id, now()) c)) end,
        'bloqueio_encerra', esc.id is not null and public.horas_previstas(esc, (select c.ocorrencia from public.calcular_ocorrencia(v_id, esc.id, now()) c)) is null) end,
    'nome_conhecido', conh.nome, 'cidade_conhecida', conh.cidade,
    'comentarios', case when length(v_id) >= 4 then public.comentarios_de(v_id, 10) else '[]' end,
    'historico', coalesce((select jsonb_agg(jsonb_build_object(
        'infracao', b.infracao, 'inicio', b.inicio, 'horas', b.horas, 'ocorrencia', b.ocorrencia, 'leve', b.leve,
        'situacao', public.situacao_bloqueio(b), 'fim', b.fim, 'nome', b.nome_entregador, 'cidade', b.cidade,
        'dados_pendentes', b.dados_pendentes, 'registrado_por_nome', b.registrado_por_nome) order by b.inicio desc)
        from public.bloqueios b where lower(b.id_app) = lower(v_id) and length(v_id) >= 4), '[]'),
    'cadastro', (select jsonb_build_object('status', c.status, 'situacao', public.status_texto(c.status), 'enviado_em', c.enviado_em, 'cidade', c.cidade)
                   from public.cadastros c where lower(c.id_app) = lower(v_id) limit 1));
end $$;

-- ---------------------------------------------------------------------
-- Correção de um bloqueio (e "marcar como revisado")
-- ---------------------------------------------------------------------
create or replace function public.corrigir_bloqueio(
  p_bloqueio uuid, p_id_app text, p_nome text, p_cidade text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b        public.bloqueios;
  v_id     text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_cidade text := nullif(upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g')), '');
  v_mot    text := nullif(btrim(coalesce(p_motivo, '')), '');
  quem     text := (select nome from public.membros where email = public.meu_email());
  mudou    boolean;
  partes   text[] := '{}';
  detalhe  text;
begin
  perform public.exigir_bloq('moderador', 'monitorador');
  select * into b from public.bloqueios where id = p_bloqueio for update;
  if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;
  if b.dados_pendentes then raise exception 'Este registro está sem nome e cidade: use "Completar dados" na tarefa.'; end if;
  if length(v_id) < 4 then raise exception 'Preencha o ID do entregador.'; end if;
  if not public.nome_valido(v_nome) or length(v_nome) > 120 then raise exception 'Preencha o nome do entregador.'; end if;
  if v_cidade is null and b.cidade is not null then raise exception 'Escolha a cidade.'; end if;
  if v_cidade is not null and not exists (select 1 from public.cidades where nome = v_cidade) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  mudou := v_id <> b.id_app or v_nome <> b.nome_entregador or v_cidade is distinct from b.cidade;
  if mudou and v_mot is null then raise exception 'Informe o motivo da correção.'; end if;
  if not mudou and b.revisar is null then raise exception 'Nada foi alterado.'; end if;

  if v_id <> b.id_app then partes := partes || format('ID: %s → %s', b.id_app, v_id); end if;
  if v_nome <> b.nome_entregador then partes := partes || format('nome: %s → %s', b.nome_entregador, v_nome); end if;
  if v_cidade is distinct from b.cidade then partes := partes || format('cidade: %s → %s', coalesce(b.cidade, '(sem cidade)'), v_cidade); end if;
  if b.revisar is not null then partes := partes || ('alerta resolvido: ' || b.revisar); end if;
  if v_mot is not null then partes := partes || ('motivo: ' || v_mot); end if;
  detalhe := left(array_to_string(partes, ' · '), 1200);

  update public.bloqueios set id_app = v_id, nome_entregador = v_nome, cidade = v_cidade, revisar = null where id = b.id;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
  values (b.id, case when mudou then 'corrigido' else 'revisado' end, auth.uid(), quem, detalhe);
  if v_cidade is distinct from b.cidade then
    update public.tarefas set cidade = v_cidade, responsavel_email = public.responsavel_da_cidade(v_cidade)
     where bloqueio_id = b.id and status = 'pendente' and tipo <> 'completar_dados';
  end if;
  if mudou then
    perform public.anotar_entregador(v_id, 'alteracao',
      format('Bloqueio de %s (%s) corrigido. %s', to_char(b.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), b.infracao, detalhe), b.id);
    if lower(v_id) <> lower(b.id_app) then
      perform public.anotar_entregador(b.id_app, 'alteracao',
        format('Bloqueio de %s (%s) passou para o ID %s. %s', to_char(b.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), b.infracao, v_id, detalhe), b.id);
    end if;
  end if;
  return public.json_bloqueio((select x from public.bloqueios x where x.id = b.id));
end $$;

-- ---------------------------------------------------------------------
-- Cadastro do entregador: alterar e comentar
-- ---------------------------------------------------------------------
-- p_aplicar: também troca nome/cidade nos bloqueios já registrados com este ID.
create or replace function public.salvar_entregador(
  p_id_app text, p_nome text, p_cidade text, p_aplicar boolean default false, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id     text := lower(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'));
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_cidade text := nullif(upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g')), '');
  v_mot    text := nullif(btrim(coalesce(p_motivo, '')), '');
  quem     text := (select nome from public.membros where email = public.meu_email());
  e        public.entregadores;
  partes   text[] := '{}';
  qtd      integer := 0;
begin
  perform public.exigir_bloq('moderador', 'monitorador');
  if length(v_id) < 4 then raise exception 'ID do entregador inválido.'; end if;
  if not public.nome_valido(v_nome) or length(v_nome) > 120 then raise exception 'Preencha o nome do entregador.'; end if;
  if v_cidade is not null and not exists (select 1 from public.cidades where nome = v_cidade) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  select * into e from public.entregadores where id_app = v_id for update;
  if e.id_app is null and not exists (select 1 from public.bloqueios where lower(id_app) = v_id)
     and not exists (select 1 from public.cadastros where lower(id_app) = v_id) then
    raise exception 'Este ID não tem registros no sistema.';
  end if;
  if e.id_app is null then partes := partes || format('cadastro criado: %s · %s', v_nome, coalesce(v_cidade, '(sem cidade)'));
  else
    if v_nome <> e.nome then partes := partes || format('nome: %s → %s', e.nome, v_nome); end if;
    if v_cidade is distinct from e.cidade then partes := partes || format('cidade: %s → %s', coalesce(e.cidade, '(sem cidade)'), coalesce(v_cidade, '(sem cidade)')); end if;
  end if;

  if p_aplicar then
    -- histórico em cada bloqueio alterado, antes de alterar
    insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
    select b.id, 'corrigido', auth.uid(), quem, left(concat_ws(' · ',
             case when b.nome_entregador <> v_nome then format('nome: %s → %s', b.nome_entregador, v_nome) end,
             case when v_cidade is not null and b.cidade is distinct from v_cidade then format('cidade: %s → %s', coalesce(b.cidade, '(sem cidade)'), v_cidade) end,
             'alteração pelo cadastro do entregador', case when v_mot is not null then 'motivo: ' || v_mot end), 1200)
      from public.bloqueios b
     where lower(b.id_app) = v_id and not b.dados_pendentes
       and (b.nome_entregador <> v_nome or (v_cidade is not null and b.cidade is distinct from v_cidade));
    get diagnostics qtd = row_count;
    update public.tarefas t set cidade = v_cidade, responsavel_email = public.responsavel_da_cidade(v_cidade)
      from public.bloqueios b
     where b.id = t.bloqueio_id and lower(b.id_app) = v_id and not b.dados_pendentes and t.status = 'pendente'
       and t.tipo <> 'completar_dados' and v_cidade is not null and b.cidade is distinct from v_cidade;
    update public.bloqueios set nome_entregador = v_nome, cidade = coalesce(v_cidade, cidade)
     where lower(id_app) = v_id and not dados_pendentes
       and (nome_entregador <> v_nome or (v_cidade is not null and cidade is distinct from v_cidade));
    if qtd > 0 then partes := partes || format('aplicado a %s bloqueio(s) já registrado(s)', qtd); end if;
  end if;

  if cardinality(partes) = 0 then raise exception 'Nada foi alterado.'; end if;
  if v_mot is not null then partes := partes || ('motivo: ' || v_mot); end if;

  insert into public.entregadores (id_app, nome, cidade, atualizado_em, atualizado_por_nome)
  values (v_id, v_nome, v_cidade, now(), quem)
  on conflict (id_app) do update set nome = excluded.nome, cidade = excluded.cidade,
    atualizado_em = now(), atualizado_por_nome = excluded.atualizado_por_nome;
  perform public.anotar_entregador(v_id, 'alteracao', 'Dados alterados: ' || array_to_string(partes, ' · '), null);
  return jsonb_build_object('bloqueios_alterados', qtd);
end $$;

create or replace function public.comentar_entregador(p_id_app text, p_texto text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id text := lower(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'Escreva o comentário.'; end if;
  if length(btrim(p_texto)) > 1500 then raise exception 'O comentário pode ter no máximo 1500 caracteres.'; end if;
  if length(v_id) < 4 or (not exists (select 1 from public.entregadores where id_app = v_id)
     and not exists (select 1 from public.bloqueios where lower(id_app) = v_id)
     and not exists (select 1 from public.cadastros where lower(id_app) = v_id)) then
    raise exception 'Este ID não tem registros no sistema.';
  end if;
  perform public.anotar_entregador(v_id, 'comentario', p_texto, null);
  return (select max(id) from public.comentarios_entregador where id_app = v_id and por = auth.uid());
end $$;

-- Comentários: apaga quem escreveu ou um moderador. Alterações de dados não se apagam.
create or replace function public.excluir_comentario(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
  c public.comentarios_entregador;
begin
  select * into c from public.comentarios_entregador where id = p_id;
  if c.id is null or c.tipo <> 'comentario' then raise exception 'Comentário não encontrado.'; end if;
  if p <> 'moderador' and c.por is distinct from auth.uid() then
    raise exception 'Só quem escreveu (ou um moderador) pode apagar este comentário.' using errcode = '42501';
  end if;
  delete from public.comentarios_entregador where id = c.id;
end $$;

-- ---------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------
-- Quem está logado mas fora do módulo de bloqueios não recebe nada.
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
    'tarefa', (select jsonb_build_object('id', t.id, 'tipo', t.tipo, 'status', t.status,
                 'responsavel_email', t.responsavel_email,
                 'responsavel_nome', coalesce(public.nome_por_email(t.responsavel_email), 'Moderadores'),
                 'criada_em', t.criada_em, 'concluida_em', t.concluida_em, 'nota', t.nota, 'importada', t.importada,
                 'concluida_por_nome', case when t.concluida_por is not null then public.nome_de(t.concluida_por) end)
               from public.tarefas t where t.bloqueio_id = b.id)) end
$$;

-- Histórico de ações de um bloqueio (registro, correções, tratativa, liberação).
create or replace function public.eventos_do_bloqueio(p_bloqueio uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
begin
  if p = 'suporte' and not exists (select 1 from public.bloqueios where id = p_bloqueio and registrado_por = auth.uid()) then
    return '[]';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'por_nome', e.por_nome, 'em', e.em, 'detalhe', e.detalhe) order by e.em, e.id)
                     from public.eventos_bloqueio e where e.bloqueio_id = p_bloqueio), '[]');
end $$;

-- Consulta: por ID exato ou parte do nome. Agrupa por ID, com o cadastro do entregador,
-- os comentários, todos os bloqueios desses IDs e o cadastro na ativação.
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
        'bloqueios', (select count(*) from public.bloqueios b where lower(b.id_app) = i),
        'comentarios', public.comentarios_de(i)) order by e.nome nulls last, i)
      from unnest(ids) i left join public.entregadores e on e.id_app = i), '[]'),
    'bloqueios', coalesce((select jsonb_agg(public.json_bloqueio(b) order by b.inicio desc) from (
        select * from public.bloqueios b where lower(b.id_app) = any (ids) order by b.inicio desc limit 300) b), '[]'),
    'cadastros', coalesce((select jsonb_agg(jsonb_build_object(
        'id_app', c.id_app, 'cidade', c.cidade, 'status', c.status, 'situacao', public.status_texto(c.status),
        'enviado_em', c.enviado_em, 'motivo', c.motivo)) from public.cadastros c
         where lower(c.id_app) = any (ids) or c.cpf = nullif(regexp_replace(q, '\D', '', 'g'), '')), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------
alter table public.entregadores enable row level security;
alter table public.comentarios_entregador enable row level security;
alter table public.parametros_bloqueio enable row level security;

drop policy if exists entregadores_leitura on public.entregadores;
create policy entregadores_leitura on public.entregadores for select to authenticated
  using ((select public.meu_papel_bloq()) is not null);
drop policy if exists comentarios_entregador_leitura on public.comentarios_entregador;
create policy comentarios_entregador_leitura on public.comentarios_entregador for select to authenticated
  using ((select public.meu_papel_bloq()) is not null);
drop policy if exists parametros_bloqueio_leitura on public.parametros_bloqueio;
create policy parametros_bloqueio_leitura on public.parametros_bloqueio for select to authenticated
  using ((select public.meu_papel_bloq()) is not null);
-- (select ...) faz o papel ser consultado uma vez por consulta, não uma vez por linha
drop policy if exists bloqueios_leitura on public.bloqueios;
create policy bloqueios_leitura on public.bloqueios for select to authenticated
  using ((select public.meu_papel_bloq()) in ('moderador', 'monitorador') or registrado_por = (select auth.uid()));

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
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
