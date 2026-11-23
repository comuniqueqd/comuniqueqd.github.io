-- 009z12 "Missão da equipe" (23/11/2026, pedido do usuário). Pode rodar de novo.
-- "Aprovar entregadores" e "Aprovar parceiros" criadas como pedido PARA TODOS (sem escolher pessoas) nascem como
-- atividade da equipe (atividades.automatica): todos participam, sem "Eu faço"; contam as aprovações de qualquer pessoa
-- na cidade desde que a missão foi criada e fecham sozinhas ao bater a meta. Pedida para pessoas escolhidas, continua
-- só delas (como antes). "Registro do que já fiz" continua pessoal.
-- Também: o título "Aprovar 10 entregador(es)" vira "Aprovar 10 entregadores" (1 = "Aprovar 1 entregador").

-- 1. título com plural de verdade (corpo inteiro; o resto igual à 009e)
create or replace function public.titulo_tarefa(p_tipo text, c jsonb, p_titulo text default null)
returns text language sql stable set search_path = public as $$
  select left(case p_tipo
    when 'ativar_entregadores' then format('Aprovar %s %s · %s', c->>'quantidade',
                                           case when (c->>'quantidade') = '1' then 'entregador' else 'entregadores' end, c->>'cidade')
    when 'ativar_parceiro' then format('Aprovar %s %s · %s', c->>'quantidade',
                                       case when (c->>'quantidade') = '1' then 'parceiro' else 'parceiros' end, c->>'cidade')
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

-- 2. criar_tarefa (corpo inteiro; o resto igual à 009d2): aprovar para todos = missão da equipe
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
  equipe boolean;
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
    equipe := tt.tipo in ('ativar_entregadores', 'ativar_parceiro') and cardinality(para) = 0;
    insert into public.atividades (titulo, descricao, criada_por, criada_por_nome, sugeridas_para, prazo, tipo, campos, cidade, modo, meta,
                                   automatica, escalada_em)
    values (titulo, nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid(), quem, para,
            coalesce(p_prazo, now() + tt.prazo_horas * interval '1 hour'), tt.tipo, c, cid, 'solicitacao', (c->>'quantidade')::int,
            equipe, case when equipe then now() end)
    returning * into a;
    insert into public.notificacoes (para, texto, link)
    select x, format('%s pediu para você: %s', quem, titulo), '#atividades/sugeridas' from unnest(para) x where x is distinct from auth.uid();
  end if;
  return public.json_atividade(a);
end $$;

-- 3. fechar ao bater a meta (corpo inteiro): agora também as de parceiros (quem participou = quem ativou)
create or replace function public.fechar_tarefas_automaticas(p_cidade text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.atividades; nomes text; quem uuid;
begin
  for a in select * from public.atividades
            where automatica and status in ('aberta', 'aceita') and cidade = p_cidade and meta is not null
            for update loop
    if public.progresso_tarefa(a) < a.meta then continue; end if;
    -- quem fez as aprovações que contaram, mais quem estava na tarefa
    drop table if exists _gente_meta;
    create temporary table _gente_meta on commit drop as
      select distinct e.por as id from public.eventos e join public.cadastros c on c.id = e.cadastro_id
       where a.tipo = 'ativar_entregadores' and e.tipo = 'aprovado' and c.status = 'aprovado' and c.cidade = a.cidade and e.em >= a.criada_em
      union select p.criado_por from public.parceiros p
       where a.tipo = 'ativar_parceiro' and p.cidade = a.cidade and p.criado_em >= a.criada_em
      union select (p->>'id')::uuid from jsonb_array_elements(public.participantes_de(a)) p;
    select string_agg(m.nome, ', ' order by m.nome) into nomes from _gente_meta g join public.membros m on m.user_id = g.id;
    update public.atividades set status = 'concluida', concluida_em = now(), concluida_por_nome = 'Equipe',
           nota = left('Meta atingida pela equipe. Participaram: ' || coalesce(nomes, '-'), 600)
     where id = a.id;
    for quem in select id from _gente_meta where id is not null loop
      perform public.notificar(quem, format('Meta da equipe atingida: %s. Participaram: %s.', a.titulo, coalesce(nomes, '-')), '#atividades/sugeridas');
    end loop;
  end loop;
end $$;

-- ativar um parceiro também confere as missões de parceiros da cidade
create or replace function public.parceiro_fecha_tarefas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cidade is not null then perform public.fechar_tarefas_automaticas(new.cidade); end if;
  return null;
end $$;
drop trigger if exists zz_parceiro_fecha_tarefas on public.parceiros;
create trigger zz_parceiro_fecha_tarefas after insert on public.parceiros
  for each row execute function public.parceiro_fecha_tarefas();

-- 4. as que já existem: pedidas para todos viram da equipe (quem tinha pegado continua como participante)
update public.atividades
   set automatica = true, escalada_em = coalesce(escalada_em, now()),
       status = 'aberta', aceita_por = null, aceita_por_nome = null, aceita_em = null,
       pausa_seg = pausa_seg + coalesce(extract(epoch from now() - aguardando_desde)::int, 0),
       aguardando_desde = null, aguardando_motivo = null
 where tipo in ('ativar_entregadores', 'ativar_parceiro') and modo = 'solicitacao' and status in ('aberta', 'aceita')
   and not automatica and cardinality(coalesce(sugeridas_para, '{}')) = 0;

-- títulos com o plural novo
update public.atividades set titulo = public.titulo_tarefa(tipo, campos, null)
 where tipo in ('ativar_entregadores', 'ativar_parceiro') and campos ? 'quantidade' and titulo like '%(%';

-- as que já bateram a meta fecham agora
select public.fechar_tarefas_automaticas(c) from (select distinct cidade c from public.atividades
  where automatica and status in ('aberta', 'aceita') and cidade is not null) x;

do $$ begin
  execute 'revoke all on function public.titulo_tarefa(text, jsonb, text) from public, anon, authenticated';
  execute 'revoke all on function public.fechar_tarefas_automaticas(text) from public, anon, authenticated';
  execute 'revoke all on function public.parceiro_fecha_tarefas() from public, anon, authenticated';
  execute 'revoke all on function public.criar_tarefa(text, jsonb, text, text, uuid[], timestamptz, text) from public, anon';
  execute 'grant execute on function public.criar_tarefa(text, jsonb, text, text, uuid[], timestamptz, text) to authenticated';
end $$;

notify pgrst, 'reload schema';
