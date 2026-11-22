-- 009z6 "Pedidos fora do limite" (22/11/2026, spec aprovada pelo usuário). Pode rodar de novo.
-- Os pedidos vêm dos arquivos baixados do Tableau (um dia de atraso), juntados no navegador:
--   "Entregas por Loja (com tempo)" (etapas) + "Resumo filtro" (nome do entregador) + "Tempo de entrega dos
--   entregadores" (nome → ID). Só os campos abaixo vão para o banco: nada do cliente (nome, telefone, endereço).
-- Regras (decididas pelo usuário em 22/11; números em parametros_pedidos):
--   * Demora para chegar na loja: do aceite até chegar na loja > 15 min.
--   * Pedido acima de 45 min: do chamado (solicitação) até ENTREGUE > 45 min. A causa diz onde o tempo foi gasto:
--     entregador (chegada > 15 ou entrega > 35 min do aceite numa rota só dele), rota com vários pedidos (saiu da
--     loja junto com outro, até 5 min de diferença), demora para alguém aceitar (> 10 min), espera na loja (> 10 min).
--   * Finalização tardia: entregue e só finalizado mais de 10 min depois (sinal à parte, para orientação ou leve).
--   * "Precisa de atenção" = demora para chegar na loja, ou acima de 45 min por causa do entregador. Os outros ficam
--     como informação, mas qualquer um pode virar restrição (a pessoa decide).
--   * Os dois tipos viram a infração "Atraso na Coleta ou na Entrega Sem Justificativa" (por enquanto).
--   * Nada vira restrição sozinho (LGPD, art. 20): uma pessoa confirma ou descarta, com o motivo registrado.
--   * Pedidos sem nenhum sinal são apagados depois de 20 dias (parametros_pedidos.guardar_dias).
-- Quem: qualquer papel das restrições confirma ou descarta (em teste); só o moderador das restrições envia os arquivos
-- e reabre uma decisão.

create table if not exists public.parametros_pedidos (
  unico            boolean primary key default true check (unico),
  chegada_min      numeric(5, 1) not null default 15,
  total_min        numeric(5, 1) not null default 45,
  entrega_min      numeric(5, 1) not null default 35,
  aceitar_min      numeric(5, 1) not null default 10,
  espera_min       numeric(5, 1) not null default 10,
  finalizar_min    numeric(5, 1) not null default 10,
  rota_janela_min  numeric(5, 1) not null default 5,
  guardar_dias     integer not null default 20 check (guardar_dias between 1 and 365),
  infracao_id      smallint references public.infracoes (id)
);
insert into public.parametros_pedidos (unico) values (true) on conflict do nothing;
update public.parametros_pedidos set infracao_id = (select id from public.infracoes
  where nome = 'Atraso na Coleta ou na Entrega Sem Justificativa' and not leve)
 where unico and infracao_id is null;
alter table public.parametros_pedidos enable row level security;

create table if not exists public.pedidos_log (
  entrega_id          text primary key check (length(entrega_id) between 6 and 40),
  codigo              text,
  cidade              text,
  loja                text,
  loja_id             text,
  pedido_em           timestamptz,
  chamado_em          timestamptz,
  aceite_em           timestamptz,
  chegou_em           timestamptz,
  saiu_em             timestamptz,
  entregue_em         timestamptz,
  finalizado_em       timestamptz,
  distancia_m         integer,
  entregador_nome     text,
  entregador_id       text,
  entregador_situacao text not null default 'sem_id' check (entregador_situacao in ('ok', 'conferir', 'escolher', 'sem_id')),
  entregador_opcoes   jsonb not null default '[]',
  rota_n              smallint not null default 1,
  t_chegada           numeric(7, 1),
  t_total             numeric(7, 1),
  t_entrega           numeric(7, 1),
  t_aceitar           numeric(7, 1),
  t_espera            numeric(7, 1),
  t_finalizar         numeric(7, 1),
  sinal_chegada       boolean not null default false,
  sinal_total         boolean not null default false,
  sinal_finalizacao   boolean not null default false,
  causa               text check (causa in ('entregador', 'rota', 'aceite', 'loja', 'outras')),
  atencao             boolean not null default false,
  tem_sinal           boolean not null default false,
  decisao             text check (decisao in ('restricao', 'descartado')),
  motivo              text check (length(motivo) <= 500),
  decidido_por        uuid,
  decidido_por_nome   text,
  decidido_em         timestamptz,
  bloqueio_id         uuid references public.bloqueios (id) on delete set null,
  importado_em        timestamptz not null default now(),
  importado_por       uuid
);
alter table public.pedidos_log add column if not exists distancia_m integer;

-- quantos pedidos houve em cada dia e cidade (os pedidos sem sinal são apagados depois de 20 dias, mas o "de N pedidos"
-- dos números do topo continua certo para os períodos antigos)
create table if not exists public.pedidos_dia (
  dia     date not null,
  cidade  text not null,
  pedidos integer not null default 0,
  primary key (dia, cidade)
);
alter table public.pedidos_dia enable row level security;

create index if not exists pedidos_log_chamado_idx on public.pedidos_log (chamado_em);
create index if not exists pedidos_log_sinal_idx on public.pedidos_log (tem_sinal, chamado_em desc);
create index if not exists pedidos_log_rota_idx on public.pedidos_log (lower(entregador_nome), saiu_em);
alter table public.pedidos_log enable row level security;   -- sem políticas: tudo por função

-- textos livres sem CPF (como as outras tabelas desde a 009u) e o tráfego avisando que algo mudou (008c)
drop trigger if exists aab_sem_cpf on public.pedidos_log;
create trigger aab_sem_cpf before insert or update on public.pedidos_log for each row execute function public.linha_sem_cpf();
drop trigger if exists marcar_mudanca_ins on public.pedidos_log;
drop trigger if exists marcar_mudanca_upd on public.pedidos_log;
drop trigger if exists marcar_mudanca_del on public.pedidos_log;
create trigger marcar_mudanca_ins after insert on public.pedidos_log referencing new table as novas for each statement execute function public.marcar_mudanca_linhas();
create trigger marcar_mudanca_upd after update on public.pedidos_log referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas();
create trigger marcar_mudanca_del after delete on public.pedidos_log referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas();

-- ---------- regras ----------
create or replace function public.regras_pedidos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into par from public.parametros_pedidos where unico;
  return to_jsonb(par) - 'unico' || jsonb_build_object('infracao', (select nome from public.infracoes where id = par.infracao_id));
end $$;

-- minutos entre dois momentos (nulo se faltar um)
create or replace function public.minutos_entre(a timestamptz, b timestamptz)
returns numeric language sql immutable as $$
  select case when a is null or b is null then null else round((extract(epoch from b - a) / 60)::numeric, 1) end
$$;

-- recalcula rota, tempos e sinais dos pedidos chamados entre p_de e p_ate (com um dia de folga para as rotas).
-- Uma passada só, com janela (RANGE de 5 min por entregador): 31 mil pedidos em poucos segundos. Só grava o que mudou.
create or replace function public.classificar_pedidos(p_de timestamptz, p_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos;
begin
  select * into par from public.parametros_pedidos where unico;
  with base as (
    select p.entrega_id,
           case when p.saiu_em is null or p.entregador_nome is null then 1
                else count(*) over (partition by lower(p.entregador_nome), (p.saiu_em is null) order by p.saiu_em
                       range between par.rota_janela_min * interval '1 minute' preceding and par.rota_janela_min * interval '1 minute' following) end::smallint rota_n,
           public.minutos_entre(p.aceite_em, p.chegou_em) t_chegada, public.minutos_entre(p.chamado_em, p.entregue_em) t_total,
           public.minutos_entre(p.aceite_em, p.entregue_em) t_entrega, public.minutos_entre(p.chamado_em, p.aceite_em) t_aceitar,
           public.minutos_entre(p.chegou_em, p.saiu_em) t_espera, public.minutos_entre(p.entregue_em, p.finalizado_em) t_finalizar
      from public.pedidos_log p
     where p.chamado_em between p_de - interval '1 day' and p_ate + interval '1 day'),
  s as (
    select b.*, coalesce(b.t_chegada > par.chegada_min, false) sc, coalesce(b.t_total > par.total_min, false) st,
           coalesce(b.t_finalizar > par.finalizar_min, false) sf, coalesce(b.t_entrega > par.entrega_min, false) and b.rota_n <= 1 so
      from base b),
  x as (
    select s.*, case when not s.st then null when s.sc or s.so then 'entregador' when s.rota_n > 1 then 'rota'
                     when coalesce(s.t_aceitar > par.aceitar_min, false) then 'aceite'
                     when coalesce(s.t_espera > par.espera_min, false) then 'loja' else 'outras' end causa,
           s.sc or (s.st and s.so) atencao, s.sc or s.st or s.sf tem_sinal
      from s)
  update public.pedidos_log p set rota_n = x.rota_n, t_chegada = x.t_chegada, t_total = x.t_total, t_entrega = x.t_entrega,
         t_aceitar = x.t_aceitar, t_espera = x.t_espera, t_finalizar = x.t_finalizar, sinal_chegada = x.sc, sinal_total = x.st,
         sinal_finalizacao = x.sf, causa = x.causa, atencao = x.atencao, tem_sinal = x.tem_sinal
    from x
   where p.entrega_id = x.entrega_id
     and (p.rota_n, p.t_chegada, p.t_total, p.t_entrega, p.t_aceitar, p.t_espera, p.t_finalizar, p.sinal_chegada, p.sinal_total,
          p.sinal_finalizacao, p.causa, p.atencao, p.tem_sinal)
         is distinct from (x.rota_n, x.t_chegada, x.t_total, x.t_entrega, x.t_aceitar, x.t_espera, x.t_finalizar, x.sc, x.st, x.sf,
          x.causa, x.atencao, x.tem_sinal);
end $$;

-- ---------- importar ----------
-- p_itens: lista de pedidos já juntados no navegador (até 2.000 por chamada). Reenviar não duplica: atualiza os
-- tempos e o entregador, e nunca mexe numa decisão já tomada.
create or replace function public.importar_pedidos(p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.exigir_bloq('moderador');
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Envie uma lista de pedidos.'; end if;
  if jsonb_array_length(p_itens) > 2000 then raise exception 'Envie no máximo 2.000 pedidos por vez.'; end if;
  insert into public.pedidos_log as p (entrega_id, codigo, cidade, loja, loja_id, pedido_em, chamado_em, aceite_em, chegou_em,
         saiu_em, entregue_em, finalizado_em, distancia_m, entregador_nome, entregador_id, entregador_situacao, entregador_opcoes, importado_por)
  select btrim(x.entrega_id), nullif(btrim(x.codigo), ''), nullif(upper(btrim(x.cidade)), ''), nullif(btrim(x.loja), ''),
         nullif(btrim(x.loja_id), ''), x.pedido_em, x.chamado_em, x.aceite_em, x.chegou_em, x.saiu_em, x.entregue_em, x.finalizado_em,
         case when x.distancia_m between 0 and 500000 then x.distancia_m end, nullif(btrim(x.entregador_nome), ''), nullif(regexp_replace(coalesce(x.entregador_id, ''), '[^A-Za-z0-9]', '', 'g'), ''),
         case when x.entregador_situacao in ('ok', 'conferir', 'escolher', 'sem_id') then x.entregador_situacao else 'sem_id' end,
         coalesce(x.entregador_opcoes, '[]'), auth.uid()
    from jsonb_to_recordset(p_itens) as x(entrega_id text, codigo text, cidade text, loja text, loja_id text, pedido_em timestamptz,
         chamado_em timestamptz, aceite_em timestamptz, chegou_em timestamptz, saiu_em timestamptz, entregue_em timestamptz,
         finalizado_em timestamptz, distancia_m integer, entregador_nome text, entregador_id text, entregador_situacao text, entregador_opcoes jsonb)
   where length(btrim(coalesce(x.entrega_id, ''))) between 6 and 40
  on conflict (entrega_id) do update set
         codigo = excluded.codigo, cidade = excluded.cidade, loja = excluded.loja, loja_id = excluded.loja_id,
         pedido_em = excluded.pedido_em, chamado_em = excluded.chamado_em, aceite_em = excluded.aceite_em,
         chegou_em = excluded.chegou_em, saiu_em = excluded.saiu_em, entregue_em = excluded.entregue_em,
         finalizado_em = excluded.finalizado_em, distancia_m = excluded.distancia_m, entregador_nome = excluded.entregador_nome,
         entregador_id = case when p.decisao is null then excluded.entregador_id else p.entregador_id end,
         entregador_situacao = case when p.decisao is null then excluded.entregador_situacao else p.entregador_situacao end,
         entregador_opcoes = excluded.entregador_opcoes, importado_em = now(), importado_por = auth.uid();
  get diagnostics n = row_count;
  return jsonb_build_object('gravados', n);
end $$;

-- depois de enviar todos os lotes: calcula rotas e sinais do período e apaga os pedidos sem sinal mais velhos que o prazo
create or replace function public.fechar_importacao_pedidos(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos; apagados integer;
begin
  perform public.exigir_bloq('moderador');
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido.'; end if;
  perform public.classificar_pedidos(p_de, p_ate);
  select * into par from public.parametros_pedidos where unico;
  insert into public.pedidos_dia (dia, cidade, pedidos)
  select (chamado_em at time zone 'America/Sao_Paulo')::date, cidade, count(*) from public.pedidos_log
   where chamado_em between p_de and p_ate and cidade is not null group by 1, 2
  on conflict (dia, cidade) do update set pedidos = greatest(public.pedidos_dia.pedidos, excluded.pedidos);
  delete from public.pedidos_log
   where not tem_sinal and decisao is null
     and coalesce(finalizado_em, entregue_em, chamado_em, importado_em) < now() - par.guardar_dias * interval '1 day';
  get diagnostics apagados = row_count;
  return (select jsonb_build_object(
      'pedidos', count(*), 'com_sinal', count(*) filter (where tem_sinal), 'atencao', count(*) filter (where atencao),
      'chegada', count(*) filter (where sinal_chegada), 'total', count(*) filter (where sinal_total),
      'finalizacao', count(*) filter (where sinal_finalizacao),
      'sem_id', count(*) filter (where tem_sinal and entregador_situacao in ('escolher', 'sem_id')),
      'apagados', apagados)
    from public.pedidos_log where chamado_em between p_de and p_ate);
end $$;

-- ---------- listar ----------
-- cada pedido + a sugestão: para quem tem ID, a ocorrência e a punição que viriam hoje (como a prévia da Nova restrição)
create or replace function public.json_pedido(p public.pedidos_log)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare par public.parametros_pedidos; i public.infracoes; n integer; h numeric;
begin
  select * into par from public.parametros_pedidos where unico;
  if p.decisao is null and p.entregador_id is not null and par.infracao_id is not null then
    select * into i from public.infracoes where id = par.infracao_id;
    select c.ocorrencia into n from public.calcular_ocorrencia(p.entregador_id, i.id, now()) c;
    h := public.horas_previstas(i, n);
  end if;
  return to_jsonb(p) - 'importado_por' - 'decidido_por' - 'loja_id'
    || jsonb_build_object('pode_reabrir', p.decisao is not null and public.meu_papel_bloq() = 'moderador',
         'sugestao', case when n is not null then jsonb_build_object('infracao', i.nome, 'ocorrencia', n,
             'janela_dias', i.janela_dias, 'horas', h, 'encerramento', h is null) end);
end $$;

create or replace function public.listar_pedidos(p_de date default null, p_ate date default null, p_cidade text default null,
  p_loja text default null, p_busca text default null, p_tipo text default null, p_situacao text default null,
  p_limite integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(lower(btrim(coalesce(p_busca, ''))), '');
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if p_tipo is not null and p_tipo not in ('atrasos', 'atencao', 'chegada', 'total', 'loja', 'finalizacao') then raise exception 'Tipo inválido.'; end if;
  if p_situacao is not null and p_situacao not in ('a_decidir', 'restricao', 'descartado') then raise exception 'Situação inválida.'; end if;
  return (with periodo as (
      select p.* from public.pedidos_log p
       where (p_de is null or (p.chamado_em at time zone 'America/Sao_Paulo')::date >= p_de)
         and (p_ate is null or (p.chamado_em at time zone 'America/Sao_Paulo')::date <= p_ate)
         and (p_cidade is null or p.cidade = p_cidade)
         and (p_loja is null or p.loja = p_loja)
         and (q is null or lower(coalesce(p.entregador_nome, '')) like '%' || q || '%' or lower(coalesce(p.entregador_id, '')) = q
              or lower(coalesce(p.codigo, '')) = q or lower(p.entrega_id) = q)),
    base as (select * from periodo where tem_sinal),
    tipo as (select * from base where p_tipo is null or (p_tipo = 'atrasos' and (sinal_chegada or sinal_total)) or (p_tipo = 'atencao' and atencao) or (p_tipo = 'chegada' and sinal_chegada)
               or (p_tipo = 'total' and sinal_total) or (p_tipo = 'finalizacao' and sinal_finalizacao)
               or (p_tipo = 'loja' and sinal_total and not sinal_chegada and causa <> 'entregador')),
    sit as (select * from tipo where p_situacao is null or (p_situacao = 'a_decidir' and decisao is null) or decisao = p_situacao)
    select jsonb_build_object(
      'itens', coalesce((select jsonb_agg(public.json_pedido(s) order by (s.decisao is null) desc, s.atencao desc, s.chamado_em desc)
                 from (select * from sit order by (decisao is null) desc, atencao desc, chamado_em desc
                       limit least(greatest(coalesce(p_limite, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) s), '[]'),
      'total', (select count(*) from sit),
      'tipos', (select jsonb_build_object('todos', count(*), 'atrasos', count(*) filter (where sinal_chegada or sinal_total), 'atencao', count(*) filter (where atencao),
                  'chegada', count(*) filter (where sinal_chegada), 'total', count(*) filter (where sinal_total),
                  'finalizacao', count(*) filter (where sinal_finalizacao),
                  'loja', count(*) filter (where sinal_total and not sinal_chegada and causa <> 'entregador'))
                  from base where p_situacao is null or (p_situacao = 'a_decidir' and decisao is null) or decisao = p_situacao),
      'situacoes', (select jsonb_build_object('todos', count(*), 'a_decidir', count(*) filter (where decisao is null),
                  'restricao', count(*) filter (where decisao = 'restricao'), 'descartado', count(*) filter (where decisao = 'descartado'))
                  from tipo),
      'cidades', coalesce((select jsonb_agg(distinct cidade order by cidade) from public.pedidos_log where tem_sinal and cidade is not null), '[]'),
      'lojas', coalesce((select jsonb_agg(distinct loja order by loja) from base where loja is not null), '[]'),
      'periodo', (select jsonb_build_object('de', min((chamado_em at time zone 'America/Sao_Paulo')::date),
                                            'ate', max((chamado_em at time zone 'America/Sao_Paulo')::date))
                    from public.pedidos_log where tem_sinal),
      'importado_em', (select max(importado_em) from public.pedidos_log),
      -- números do topo: no período e cidade escolhidos (o total de pedidos vem de pedidos_dia)
      'numeros', (select jsonb_build_object(
          'pedidos', (select coalesce(sum(d.pedidos), 0) from public.pedidos_dia d
                       where (p_de is null or d.dia >= p_de) and (p_ate is null or d.dia <= p_ate) and (p_cidade is null or d.cidade = p_cidade)),
          'chegada', count(*) filter (where sinal_chegada), 'total', count(*) filter (where sinal_total),
          'loja', count(*) filter (where sinal_total and not sinal_chegada and causa <> 'entregador'),
          'confirmados', count(*) filter (where decisao = 'restricao'), 'descartados', count(*) filter (where decisao = 'descartado'),
          'esperando', count(*) filter (where decisao is null and (sinal_chegada or sinal_total)))
        from base),
      'regras', public.regras_pedidos()));
end $$;

-- ---------- decidir ----------
-- antes de confirmar: a prévia da restrição (ocorrência e punição) e se já existe restrição por atraso do mesmo
-- entregador nas últimas 24 h (aí a pessoa junta este pedido a ela, em vez de registrar outra).
create or replace function public.preparar_restricao_pedido(p_entrega_id text, p_id_app text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos; v_id text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'); b public.bloqueios;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into par from public.parametros_pedidos where unico;
  if par.infracao_id is null then raise exception 'A infração de atraso não foi encontrada nas Regras.'; end if;
  if length(v_id) >= 4 then
    select * into b from public.bloqueios where lower(id_app) = lower(v_id) and infracao_id = par.infracao_id
       and inicio > now() - interval '24 hours' order by inicio desc limit 1;
  end if;
  return jsonb_build_object('infracao', (select jsonb_build_object('id', id, 'nome', nome) from public.infracoes where id = par.infracao_id),
    'previa', case when length(v_id) >= 4 then public.previa_bloqueio(v_id, par.infracao_id) end,
    'juntar', case when b.id is not null then jsonb_build_object('id', b.id, 'inicio', b.inicio, 'registrado_por_nome', b.registrado_por_nome,
        'horas', b.horas, 'ocorrencia', b.ocorrencia,
        'pedidos', (select count(*) from public.pedidos_log where bloqueio_id = b.id)) end);
end $$;

create or replace function public.pedido_virar_restricao(p_entrega_id text, p_id_app text, p_nome text, p_cidade text,
  p_comentario text default null, p_juntar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare par public.parametros_pedidos; p public.pedidos_log; b public.bloqueios; r jsonb;
        v_id text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into par from public.parametros_pedidos where unico;
  select * into p from public.pedidos_log where entrega_id = p_entrega_id for update;
  if p.entrega_id is null then raise exception 'Pedido não encontrado (pode ter sido apagado pelo prazo de guarda).'; end if;
  if p.decisao is not null then
    raise exception 'Este pedido já foi decidido por % em %.', p.decidido_por_nome,
      to_char(p.decidido_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;
  if coalesce(p_juntar, false) then
    if length(v_id) < 4 then raise exception 'Preencha o ID do entregador.'; end if;
    select * into b from public.bloqueios where lower(id_app) = lower(v_id) and infracao_id = par.infracao_id
       and inicio > now() - interval '24 hours' order by inicio desc limit 1;
    if b.id is null then raise exception 'Não há restrição por atraso das últimas 24 h deste entregador para juntar.'; end if;
    perform public.anotar_entregador(b.id_app, 'comentario', p_comentario, b.id);
    r := jsonb_build_object('id', b.id, 'ocorrencia', b.ocorrencia, 'horas', b.horas, 'fim', b.fim, 'juntado', true);
  else
    r := public.registrar_bloqueio_agravante(v_id, p_nome, p_cidade, par.infracao_id, null, p_comentario, false, null);
    select * into b from public.bloqueios where id = (r ->> 'id')::uuid;
  end if;
  update public.pedidos_log set decisao = 'restricao', bloqueio_id = b.id, decidido_por = auth.uid(),
         decidido_por_nome = public.nome_de(auth.uid()), decidido_em = now(), motivo = null,
         entregador_id = b.id_app, entregador_situacao = 'ok'
   where entrega_id = p.entrega_id;
  return r;
end $$;

create or replace function public.descartar_pedido(p_entrega_id text, p_motivo text, p_texto text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.pedidos_log; m text; t text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  m := case p_motivo when 'loja' then 'Demora da loja' when 'rota' then 'Rota com vários pedidos' when 'app' then 'Problema no app'
                     when 'cliente' then 'Problema com o cliente' when 'aceite' then 'Demorou para alguém aceitar'
                     when 'outro' then 'Outro' end;
  if m is null then raise exception 'Escolha o motivo.'; end if;
  if p_motivo = 'outro' and t is null then raise exception 'Escreva o motivo.'; end if;
  if length(coalesce(t, '')) > 400 then raise exception 'O motivo pode ter no máximo 400 caracteres.'; end if;
  select * into p from public.pedidos_log where entrega_id = p_entrega_id for update;
  if p.entrega_id is null then raise exception 'Pedido não encontrado (pode ter sido apagado pelo prazo de guarda).'; end if;
  if p.decisao is not null then
    raise exception 'Este pedido já foi decidido por % em %.', p.decidido_por_nome,
      to_char(p.decidido_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;
  update public.pedidos_log set decisao = 'descartado', motivo = m || coalesce(': ' || t, ''), decidido_por = auth.uid(),
         decidido_por_nome = public.nome_de(auth.uid()), decidido_em = now()
   where entrega_id = p.entrega_id;
  return jsonb_build_object('ok', true);
end $$;

-- moderador desfaz uma decisão (a restrição registrada continua: liberar é no Histórico/Com restrição agora)
create or replace function public.reabrir_pedido(p_entrega_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.pedidos_log;
begin
  perform public.exigir_bloq('moderador');
  select * into p from public.pedidos_log where entrega_id = p_entrega_id for update;
  if p.entrega_id is null then raise exception 'Pedido não encontrado.'; end if;
  if p.decisao is null then raise exception 'Este pedido ainda não foi decidido.'; end if;
  update public.pedidos_log set decisao = null, motivo = null, decidido_por = null, decidido_por_nome = null, decidido_em = null,
         bloqueio_id = null
   where entrega_id = p.entrega_id;
  return jsonb_build_object('ok', true, 'tinha_restricao', p.bloqueio_id is not null);
end $$;

-- ---------- acesso ----------
do $$ declare f text; begin
  foreach f in array array['regras_pedidos()', 'importar_pedidos(jsonb)', 'fechar_importacao_pedidos(timestamp with time zone, timestamp with time zone)',
      'listar_pedidos(date, date, text, text, text, text, text, integer, integer)', 'preparar_restricao_pedido(text, text)',
      'pedido_virar_restricao(text, text, text, text, text, boolean)', 'descartar_pedido(text, text, text)', 'reabrir_pedido(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['classificar_pedidos(timestamp with time zone, timestamp with time zone)', 'json_pedido(public.pedidos_log)',
      'minutos_entre(timestamp with time zone, timestamp with time zone)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
