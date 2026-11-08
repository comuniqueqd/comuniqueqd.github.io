-- =====================================================================
-- 009b: Ferramentas (calculadora de bairro, tarifas) e Financeiro
-- (adicionais e ajustes de bairro, adicionais pendentes, resumo).
--
-- * bairros: tarifa de cada bairro por cidade (valor cobrado e taxa do log).
--   O entregador recebe valor − taxa do log. A lista entra por um SQL de
--   importação privado (fora do repositório) e depois é editada no app
--   (Ferramentas → Tarifas, só moderador da ativação).
-- * lancamentos_financeiros: uma tabela só para tudo o que é pago ao
--   entregador fora da corrida normal, com tipo:
--     ajuste_bairro = cliente informou um bairro e a entrega terminou em outro;
--                     valor = recebe(real) − recebe(informado), nunca negativo;
--                     os valores dos bairros ficam gravados (mudar a tarifa
--                     depois não muda o ajuste antigo).
--     adicional     = valor combinado − valor da entrega.
--   "Já lançado no sistema?" (lancado): se não, aparece em Adicionais
--   pendentes para quem registrou. Qualquer pessoa pode marcar como lançado.
-- * Aviso a cada lançamento: categoria nova "financeiro" (responsável da
--   cidade, moderadores e quem segue a cidade; dá para silenciar).
--
-- Pode rodar mais de uma vez. Rodar depois da 008d (redefine avisar via
-- avisar_registro, salvar_preferencias e resumo_e_avisos).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.bairros (
  id            bigint generated always as identity primary key,
  cidade        text not null references public.cidades (nome) on update cascade,
  nome          text not null check (length(btrim(nome)) between 2 and 80),
  valor         numeric(8, 2) not null check (valor >= 0),
  taxa_log      numeric(8, 2) not null default 0,
  lat           numeric(12, 8),
  lon           numeric(12, 8),
  apelidos      text[] not null default '{}',
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  unique (cidade, nome)
);

create table if not exists public.lancamentos_financeiros (
  id                  bigint generated always as identity primary key,
  tipo                text not null check (tipo in ('ajuste_bairro', 'adicional')),
  cidade              text references public.cidades (nome) on update cascade,
  id_app              text not null check (id_app ~ '^[A-Za-z0-9]{4,40}$'),
  nome_entregador     text check (length(btrim(nome_entregador)) between 1 and 120),
  pedido              text check (length(pedido) <= 60),
  origem              text not null check (origem in ('qd', 'outros')),
  mercado             boolean,
  motivo              text check (length(motivo) <= 60),
  -- ajuste de bairro (valores do momento do registro)
  bairro_informado    text,
  bairro_real         text,
  recebe_informado    numeric(8, 2),
  recebe_real         numeric(8, 2),
  -- adicional
  valor_entrega       numeric(10, 2) check (valor_entrega >= 0),
  valor_pedido        numeric(10, 2) check (valor_pedido >= 0),
  valor_combinado     numeric(10, 2) check (valor_combinado >= 0),
  -- o que vai para o entregador
  valor               numeric(10, 2) not null check (valor >= 0),
  lancado             boolean not null default false,
  lancado_em          timestamptz,
  lancado_por         uuid,
  lancado_por_nome    text,
  observacao          text check (length(observacao) <= 500),
  registrado_por      uuid not null,
  registrado_por_nome text,
  criado_em           timestamptz not null default now()
);
create index if not exists lancamentos_pendentes on public.lancamentos_financeiros (registrado_por) where not lancado;
create index if not exists lancamentos_data on public.lancamentos_financeiros (criado_em desc);

alter table public.bairros enable row level security;
alter table public.lancamentos_financeiros enable row level security;
-- sem políticas: tudo passa pelas funções abaixo
revoke all on public.bairros, public.lancamentos_financeiros from anon, authenticated;

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create or replace function public.recebe_bairro(b public.bairros)
returns numeric language sql immutable as $$ select b.valor - b.taxa_log $$;

-- acha o bairro pelo nome ou por um apelido (sem diferenciar maiúsculas e espaços)
create or replace function public.achar_bairro(p_cidade text, p_nome text)
returns public.bairros language sql stable security definer set search_path = public as $$
  select b.* from public.bairros b
   where b.cidade = p_cidade and b.ativo
     and (upper(btrim(b.nome)) = upper(btrim(p_nome))
          or upper(btrim(p_nome)) = any (select upper(btrim(a)) from unnest(b.apelidos) a))
   order by (upper(btrim(b.nome)) = upper(btrim(p_nome))) desc
   limit 1
$$;

create or replace function public.json_bairro(b public.bairros)
returns jsonb language sql stable as $$
  select jsonb_build_object('id', b.id, 'cidade', b.cidade, 'nome', b.nome, 'valor', b.valor, 'taxa_log', b.taxa_log,
    'recebe', public.recebe_bairro(b), 'apelidos', to_jsonb(b.apelidos), 'ativo', b.ativo,
    'lat', b.lat, 'lon', b.lon, 'atualizado_em', b.atualizado_em, 'atualizado_por', b.atualizado_por)
$$;

create or replace function public.json_lancamento(l public.lancamentos_financeiros)
returns jsonb language sql stable as $$
  select to_jsonb(l) - 'registrado_por' - 'lancado_por'
    || jsonb_build_object('meu', l.registrado_por = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Tarifas (consulta para todos; edição: moderador da ativação)
-- ---------------------------------------------------------------------
create or replace function public.tarifas_bairros()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'pode_editar', public.meu_papel() = 'moderador',
    'cidades', coalesce((select jsonb_agg(jsonb_build_object('nome', c.nome, 'tarifa_tipo', c.tarifa_tipo,
        'bairros', (select count(*) from public.bairros b where b.cidade = c.nome and b.ativo)) order by c.nome)
      from public.cidades c where c.ativa), '[]'),
    'bairros', coalesce((select jsonb_agg(public.json_bairro(b) order by b.cidade, b.nome) from public.bairros b), '[]'));
end $$;

create or replace function public.salvar_bairro(p_id bigint, p_cidade text, p_nome text, p_valor numeric, p_taxa_log numeric,
                                                p_apelidos text[] default '{}', p_ativo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n   text := upper(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  ap  text[] := coalesce((select array_agg(distinct upper(regexp_replace(btrim(a), '\s+', ' ', 'g')))
                            from unnest(coalesce(p_apelidos, '{}')) a where nullif(btrim(a), '') is not null), '{}');
  b   public.bairros;
begin
  perform public.exigir_papel('moderador');
  if length(n) < 2 then raise exception 'Digite o nome do bairro.'; end if;
  if not exists (select 1 from public.cidades where nome = p_cidade) then raise exception 'Cidade não encontrada.'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Informe o valor do bairro.'; end if;
  if p_taxa_log is null then raise exception 'Informe a taxa do log (pode ser 0).'; end if;
  if p_valor - p_taxa_log < 0 then raise exception 'A taxa do log é maior que o valor: o entregador receberia um valor negativo.'; end if;
  if exists (select 1 from public.bairros x where x.cidade = p_cidade and x.id is distinct from p_id
               and (upper(x.nome) = n or n = any (x.apelidos) or upper(x.nome) = any (ap))) then
    raise exception 'Já existe um bairro com esse nome (ou apelido) nesta cidade.';
  end if;
  if p_id is null then
    insert into public.bairros (cidade, nome, valor, taxa_log, apelidos, ativo, atualizado_por)
    values (p_cidade, n, p_valor, p_taxa_log, array_remove(ap, n), coalesce(p_ativo, true), public.meu_email())
    returning * into b;
  else
    update public.bairros set cidade = p_cidade, nome = n, valor = p_valor, taxa_log = p_taxa_log,
           apelidos = array_remove(ap, n), ativo = coalesce(p_ativo, true), atualizado_em = now(), atualizado_por = public.meu_email()
     where id = p_id
    returning * into b;
    if b.id is null then raise exception 'Bairro não encontrado.'; end if;
  end if;
  return public.json_bairro(b);
end $$;

-- ---------------------------------------------------------------------
-- Registrar (todos os papéis da ativação)
-- ---------------------------------------------------------------------
create or replace function public.validar_entregador_lancamento(p_id_app text, p_nome text, p_cidade text,
  out id_app text, out nome text, out cidade text)
language plpgsql stable security definer set search_path = public as $$
declare k record;
begin
  id_app := btrim(coalesce(p_id_app, ''));
  if id_app !~ '^[A-Za-z0-9]{4,40}$' then raise exception 'Digite o ID do entregador (4 a 40 letras ou números).'; end if;
  select * into k from public.dados_conhecidos(id_app);
  nome := coalesce(nullif(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), ''), k.nome);
  cidade := coalesce(nullif(p_cidade, ''), k.cidade);
  if cidade is not null and not exists (select 1 from public.cidades c where c.nome = cidade) then
    raise exception 'Cidade não encontrada.';
  end if;
end $$;

create or replace function public.registrar_ajuste_bairro(
  p_cidade text, p_informado text, p_real text, p_id_app text, p_nome text, p_origem text,
  p_lancado boolean default false, p_pedido text default null, p_motivo text default null, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bi public.bairros; br public.bairros; v record; l public.lancamentos_financeiros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_cidade is null then raise exception 'Escolha a cidade.'; end if;
  bi := public.achar_bairro(p_cidade, p_informado);
  br := public.achar_bairro(p_cidade, p_real);
  if bi.id is null then raise exception 'Bairro informado pelo cliente não encontrado em %.', p_cidade; end if;
  if br.id is null then raise exception 'Bairro onde a entrega terminou não encontrado em %.', p_cidade; end if;
  if bi.id = br.id then raise exception 'Os dois bairros são iguais: não há ajuste.'; end if;
  if p_origem is null or p_origem not in ('qd', 'outros') then raise exception 'Escolha de onde veio o pedido (QD ou outros).'; end if;
  select * into v from public.validar_entregador_lancamento(p_id_app, p_nome, p_cidade);
  insert into public.lancamentos_financeiros (tipo, cidade, id_app, nome_entregador, pedido, origem, motivo,
      bairro_informado, bairro_real, recebe_informado, recebe_real, valor,
      lancado, lancado_em, lancado_por, lancado_por_nome, observacao, registrado_por, registrado_por_nome)
  values ('ajuste_bairro', p_cidade, v.id_app, v.nome, nullif(btrim(coalesce(p_pedido, '')), ''), p_origem, nullif(btrim(coalesce(p_motivo, '')), ''),
      bi.nome, br.nome, public.recebe_bairro(bi), public.recebe_bairro(br),
      greatest(public.recebe_bairro(br) - public.recebe_bairro(bi), 0),
      coalesce(p_lancado, false), case when p_lancado then now() end, case when p_lancado then auth.uid() end,
      case when p_lancado then public.nome_de(auth.uid()) end,
      nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(), public.nome_de(auth.uid()))
  returning * into l;
  return public.json_lancamento(l);
end $$;

create or replace function public.registrar_adicional(
  p_cidade text, p_id_app text, p_nome text, p_origem text, p_mercado boolean, p_motivo text,
  p_valor_entrega numeric, p_valor_pedido numeric, p_valor_combinado numeric,
  p_lancado boolean default false, p_pedido text default null, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; l public.lancamentos_financeiros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_origem is null or p_origem not in ('qd', 'outros') then raise exception 'Escolha de onde veio o pedido (QD ou outros).'; end if;
  if p_mercado is null then raise exception 'Diga se o pedido é de mercado.'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escolha o motivo do adicional.'; end if;
  if p_valor_entrega is null or p_valor_pedido is null or p_valor_combinado is null then
    raise exception 'Preencha o valor da entrega, o valor do pedido e o valor combinado.';
  end if;
  if p_valor_entrega < 0 or p_valor_pedido < 0 or p_valor_combinado < 0 then raise exception 'Os valores não podem ser negativos.'; end if;
  if p_valor_combinado <= p_valor_entrega then
    raise exception 'O valor combinado precisa ser maior que o valor da entrega (o adicional é a diferença).';
  end if;
  select * into v from public.validar_entregador_lancamento(p_id_app, p_nome, p_cidade);
  if v.cidade is null then raise exception 'Escolha a cidade.'; end if;
  insert into public.lancamentos_financeiros (tipo, cidade, id_app, nome_entregador, pedido, origem, mercado, motivo,
      valor_entrega, valor_pedido, valor_combinado, valor,
      lancado, lancado_em, lancado_por, lancado_por_nome, observacao, registrado_por, registrado_por_nome)
  values ('adicional', v.cidade, v.id_app, v.nome, nullif(btrim(coalesce(p_pedido, '')), ''), p_origem, p_mercado, btrim(p_motivo),
      p_valor_entrega, p_valor_pedido, p_valor_combinado, p_valor_combinado - p_valor_entrega,
      coalesce(p_lancado, false), case when p_lancado then now() end, case when p_lancado then auth.uid() end,
      case when p_lancado then public.nome_de(auth.uid()) end,
      nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(), public.nome_de(auth.uid()))
  returning * into l;
  return public.json_lancamento(l);
end $$;

-- qualquer pessoa da equipe pode marcar como lançado (ou desfazer)
create or replace function public.marcar_lancado(p_id bigint, p_lancado boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.lancamentos_financeiros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  update public.lancamentos_financeiros
     set lancado = coalesce(p_lancado, true),
         lancado_em = case when coalesce(p_lancado, true) then now() end,
         lancado_por = case when coalesce(p_lancado, true) then auth.uid() end,
         lancado_por_nome = case when coalesce(p_lancado, true) then public.nome_de(auth.uid()) end
   where id = p_id
  returning * into l;
  if l.id is null then raise exception 'Lançamento não encontrado.'; end if;
  return public.json_lancamento(l);
end $$;

-- apagar: quem registrou ou moderador
create or replace function public.excluir_lancamento(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare l public.lancamentos_financeiros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into l from public.lancamentos_financeiros where id = p_id;
  if l.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if l.registrado_por <> auth.uid() and not public.sou_moderador() then
    raise exception 'Só quem registrou ou um moderador pode apagar.' using errcode = '42501';
  end if;
  delete from public.lancamentos_financeiros where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Consultar
-- ---------------------------------------------------------------------
-- p_pendentes: só os não lançados; p_meus: só os que eu registrei
create or replace function public.listar_lancamentos(p_tipo text default null, p_cidade text default null,
  p_pendentes boolean default false, p_meus boolean default false, p_dias integer default 30, p_limite integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim integer := least(greatest(coalesce(p_limite, 200), 1), 5000);
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'itens', coalesce((select jsonb_agg(public.json_lancamento(x) order by x.criado_em desc)
      from (select l.* from public.lancamentos_financeiros l
             where (p_tipo is null or p_tipo = '' or l.tipo = p_tipo)
               and (p_cidade is null or p_cidade = '' or l.cidade = p_cidade)
               and (not coalesce(p_pendentes, false) or not l.lancado)
               and (not coalesce(p_meus, false) or l.registrado_por = auth.uid())
               and (coalesce(p_pendentes, false) or p_dias is null or l.criado_em >= now() - make_interval(days => p_dias))
             order by l.criado_em desc limit lim) x), '[]'),
    'cidades', coalesce((select jsonb_agg(distinct cidade) from public.lancamentos_financeiros where cidade is not null), '[]'));
end $$;

-- números do Financeiro (para todos, por enquanto)
create or replace function public.resumo_financeiro(p_dias integer default 30, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return (with l as (
      select * from public.lancamentos_financeiros
       where criado_em >= now() - make_interval(days => coalesce(p_dias, 30))
         and (p_cidade is null or p_cidade = '' or cidade = p_cidade))
    select jsonb_build_object(
      'total', coalesce(sum(valor), 0), 'n', count(*),
      'ajustes', jsonb_build_object('total', coalesce(sum(valor) filter (where tipo = 'ajuste_bairro'), 0), 'n', count(*) filter (where tipo = 'ajuste_bairro')),
      'adicionais', jsonb_build_object('total', coalesce(sum(valor) filter (where tipo = 'adicional'), 0), 'n', count(*) filter (where tipo = 'adicional'),
         'pedidos', coalesce(sum(valor_pedido) filter (where tipo = 'adicional'), 0)),
      'pendentes', jsonb_build_object('n', count(*) filter (where not lancado), 'total', coalesce(sum(valor) filter (where not lancado), 0)),
      'por_cidade', coalesce((select jsonb_agg(jsonb_build_object('cidade', coalesce(cidade, 'Sem cidade'), 'total', t, 'n', n,
            'ajustes', a, 'adicionais', d) order by t desc)
          from (select cidade, sum(valor) t, count(*) n, sum(valor) filter (where tipo = 'ajuste_bairro') a,
                       sum(valor) filter (where tipo = 'adicional') d from l group by cidade) x), '[]'),
      'por_pessoa', coalesce((select jsonb_agg(jsonb_build_object('nome', coalesce(registrado_por_nome, '—'), 'total', t, 'n', n) order by t desc)
          from (select registrado_por_nome, sum(valor) t, count(*) n from l group by registrado_por_nome) x), '[]'),
      'por_motivo', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'total', t, 'n', n) order by t desc)
          from (select motivo, sum(valor) t, count(*) n from l where tipo = 'adicional' group by motivo) x), '[]'),
      'por_origem', coalesce((select jsonb_agg(jsonb_build_object('origem', origem, 'total', t, 'n', n) order by t desc)
          from (select origem, sum(valor) t, count(*) n from l group by origem) x), '[]'),
      'mercado', jsonb_build_object(
          'sim', jsonb_build_object('total', coalesce(sum(valor) filter (where tipo = 'adicional' and mercado), 0), 'n', count(*) filter (where tipo = 'adicional' and mercado)),
          'nao', jsonb_build_object('total', coalesce(sum(valor) filter (where tipo = 'adicional' and not mercado), 0), 'n', count(*) filter (where tipo = 'adicional' and not mercado))),
      'faixas_pedido', coalesce((select jsonb_agg(jsonb_build_object('faixa', faixa, 'total', t, 'n', n, 'pct_pedido',
            case when p > 0 then round(100 * t / p, 1) end) order by ordem)
          from (select case when valor_pedido < 50 then 'Até R$ 50' when valor_pedido < 150 then 'R$ 50 a 150'
                            when valor_pedido < 300 then 'R$ 150 a 300' else 'Acima de R$ 300' end faixa,
                       min(case when valor_pedido < 50 then 1 when valor_pedido < 150 then 2 when valor_pedido < 300 then 3 else 4 end) ordem,
                       sum(valor) t, count(*) n, sum(valor_pedido) p
                  from l where tipo = 'adicional' group by 1) x), '[]'),
      'pares_bairros', coalesce((select jsonb_agg(jsonb_build_object('cidade', cidade, 'informado', bairro_informado, 'real', bairro_real,
            'n', n, 'total', t) order by n desc, t desc)
          from (select cidade, bairro_informado, bairro_real, count(*) n, sum(valor) t from l
                 where tipo = 'ajuste_bairro' group by 1, 2, 3 order by n desc, t desc limit 10) x), '[]'))
    from l);
end $$;

-- ---------------------------------------------------------------------
-- Aviso a cada lançamento (categoria "financeiro")
-- ---------------------------------------------------------------------
create or replace function public.aviso_lancamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.avisar_registro('financeiro',
    format('%s registrou %s de %s para %s (%s)%s%s', coalesce(new.registrado_por_nome, 'Alguém'),
      case new.tipo when 'adicional' then 'um adicional' else 'um ajuste de bairro' end,
      'R$ ' || replace(to_char(new.valor, 'FM999G990D00'), '.', ','),
      coalesce(new.nome_entregador, 'sem nome'), new.id_app,
      case when new.cidade is not null then ' · ' || new.cidade else '' end,
      case when new.tipo = 'ajuste_bairro' then ' · ' || new.bairro_informado || ' → ' || new.bairro_real
           else coalesce(' · ' || new.motivo, '') end),
    '#financeiro/lancamentos', new.cidade, new.id_app, false, false);
  return null;
end $$;
drop trigger if exists zz_aviso_lancamento on public.lancamentos_financeiros;
create trigger zz_aviso_lancamento after insert on public.lancamentos_financeiros
  for each row execute function public.aviso_lancamento();

-- preferências: "financeiro" pode ser silenciado
create or replace function public.salvar_preferencias(p_silenciados text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_silenciados, '{}')) x where x is not null), '{}');
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if exists (select 1 from unnest(v) x where x not in ('ativacao', 'bloqueios', 'leves', 'comentarios', 'cidades', 'financeiro')) then
    raise exception 'Tipo de aviso desconhecido.';
  end if;
  insert into public.preferencias_aviso (para, silenciados) values (auth.uid(), v)
  on conflict (para) do update set silenciados = excluded.silenciados, atualizado_em = now();
  return public.minhas_preferencias();
end $$;

-- resumo do topo: + quantos lançamentos meus ainda não foram lançados no sistema
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
      'financeiro_pendentes', (select count(*) from public.lancamentos_financeiros where registrado_por = auth.uid() and not lancado)),
    'notif', public.minhas_notificacoes());
end $$;

-- ---------------------------------------------------------------------
-- Permissões e tráfego
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['bairros', 'lancamentos_financeiros'] loop
    if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = t and g.tgname = 'marcar_mudanca_ins') then
      execute format('create trigger marcar_mudanca_ins after insert on public.%I referencing new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_upd after update on public.%I referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_del after delete on public.%I referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas()', t);
    end if;
  end loop;
end $$;

revoke all on function public.recebe_bairro(public.bairros) from public, anon, authenticated;
revoke all on function public.achar_bairro(text, text) from public, anon, authenticated;
revoke all on function public.json_bairro(public.bairros) from public, anon, authenticated;
revoke all on function public.json_lancamento(public.lancamentos_financeiros) from public, anon, authenticated;
revoke all on function public.validar_entregador_lancamento(text, text, text) from public, anon, authenticated;
revoke all on function public.aviso_lancamento() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.tarifas_bairros()',
                           'public.salvar_bairro(bigint, text, text, numeric, numeric, text[], boolean)',
                           'public.registrar_ajuste_bairro(text, text, text, text, text, text, boolean, text, text, text)',
                           'public.registrar_adicional(text, text, text, text, boolean, text, numeric, numeric, numeric, boolean, text, text)',
                           'public.marcar_lancado(bigint, boolean)', 'public.excluir_lancamento(bigint)',
                           'public.listar_lancamentos(text, text, boolean, boolean, integer, integer)',
                           'public.resumo_financeiro(integer, text)',
                           'public.salvar_preferencias(text[])', 'public.resumo_e_avisos()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- avisa a API do Supabase que há funções novas
notify pgrst, 'reload schema';
