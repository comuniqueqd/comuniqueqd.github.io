-- =====================================================================
-- 009d (parte 1): pedir ajuda, aviso geral e passagem de turno.
--
-- * avisos_rapidos (da 009c) ganha os tipos:
--     ajuda = pedido de ajuda emergencial (Operação – Monitoramento, Suporte Crisp,
--             Suporte Blip). Aberto para todos por 10 min ou até alguém aceitar.
--             Aceito: fica só para quem pediu e quem aceitou, até resolverem.
--             Sem ninguém em 10 min: só quem pediu vê, e pode pedir de novo ou
--             mandar para os moderadores. Um pedido ativo por pessoa.
--     aviso = aviso geral: texto que fica na tela inicial de todos pelo tempo que
--             quem criou escolher (até 12 h). Quem criou ou moderador encerra antes.
-- * Avisos (sino) do pedido de ajuda e do aviso geral: categoria "ajuda" e
--   "aviso_geral" (não dá para silenciar). O front toca o som conforme a urgência.
-- * passagens_turno + passagens_lidas: quem sai escreve o que é importante e
--   decide, tarefa por tarefa, o que passa para alguém, o que fica aberto e o que
--   mantém. Quem entra vê o cartão na tela inicial até tocar em "Li".
--   panorama_turno() monta o resumo. resumo_e_avisos ganha passagens e
--   minha_passagem_hoje (o lembrete das 18h).
-- * acordos (Financeiro → Acordos): acordos fechados com estabelecimentos parceiros,
--   com data de vencimento. No dia do vencimento aparecem bem chamativos na tela
--   inicial de todos (resumo_e_avisos.resumo.acordos_vencidos) até alguém marcar
--   "Ajuste feito" (ajustar_acordo).
-- Pode rodar mais de uma vez. Rodar depois da 009c.
-- =====================================================================

alter table public.avisos_rapidos drop constraint if exists avisos_rapidos_tipo_check;
alter table public.avisos_rapidos add constraint avisos_rapidos_tipo_check check (tipo in ('pendencia', 'ajuda', 'aviso'));
alter table public.avisos_rapidos add column if not exists categoria text check (categoria in ('monitoramento', 'suporte_crisp', 'suporte_blip'));
alter table public.avisos_rapidos add column if not exists texto text check (length(texto) <= 500);
alter table public.avisos_rapidos add column if not exists link text check (length(link) <= 300);
alter table public.avisos_rapidos add column if not exists expira_em timestamptz;
alter table public.avisos_rapidos add column if not exists aceito_por uuid;
alter table public.avisos_rapidos add column if not exists aceito_por_nome text;
alter table public.avisos_rapidos add column if not exists aceito_em timestamptz;
alter table public.avisos_rapidos add column if not exists para_moderadores boolean not null default false;

create or replace function public.nome_categoria_ajuda(c text)
returns text language sql immutable as $$
  select case c when 'monitoramento' then 'Operação – Monitoramento' when 'suporte_crisp' then 'Operação – Suporte (Crisp)'
                when 'suporte_blip' then 'Operação – Suporte (Blip)' else 'Ajuda' end
$$;

-- avisa toda a equipe (menos quem fez); categoria pessoal-urgente, sem silenciar
create or replace function public.avisar_equipe(p_texto text, p_link text, p_categoria text, p_so_moderadores boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into public.notificacoes (para, texto, link, categoria)
  select m.user_id, left(p_texto, 500), p_link, p_categoria
    from public.membros m
   where m.user_id is not null and m.user_id is distinct from auth.uid() and m.papel is not null
     and (not p_so_moderadores or m.papel = 'moderador' or m.papel_bloqueios = 'moderador')
$$;

-- ---------------------------------------------------------------------
-- O que aparece em "Acontecendo agora" para quem está olhando
-- ---------------------------------------------------------------------
create or replace function public.avisos_rapidos_abertos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'titulo', a.titulo, 'id_app', a.id_app,
      'nome', coalesce(a.nome, (select e.nome from public.entregadores e where e.id_app = lower(a.id_app))),
      'cidade', a.cidade, 'bloqueio_id', a.bloqueio_id, 'criado_em', a.criado_em, 'criado_por_nome', a.criado_por_nome,
      'categoria', a.categoria, 'texto', a.texto, 'link', a.link, 'expira_em', a.expira_em,
      'aceito_por_nome', a.aceito_por_nome, 'aceito_em', a.aceito_em, 'para_moderadores', a.para_moderadores,
      'meu', a.criado_por = auth.uid(), 'aceito_por_mim', a.aceito_por = auth.uid(),
      'expirado', a.tipo = 'ajuda' and a.aceito_por is null and a.expira_em <= now())
      order by case a.tipo when 'ajuda' then 0 when 'aviso' then 1 else 2 end, a.criado_em), '[]')
    from public.avisos_rapidos a
   where a.resolvido_em is null
     and (a.tipo = 'pendencia'
          or (a.tipo = 'aviso' and a.expira_em > now())
          or (a.tipo = 'ajuda' and (
                (a.aceito_por is null and a.expira_em > now() and not a.para_moderadores)          -- aberto: todos
                or a.criado_por = auth.uid() or a.aceito_por = auth.uid()                          -- quem pediu e quem ajuda
                or (a.para_moderadores and a.aceito_por is null and public.sou_moderador()))))     -- mandado aos moderadores
$$;

-- ---------------------------------------------------------------------
-- Pedir ajuda
-- ---------------------------------------------------------------------
create or replace function public.pedir_ajuda(p_categoria text, p_texto text default null, p_link text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_categoria is null or p_categoria not in ('monitoramento', 'suporte_crisp', 'suporte_blip') then
    raise exception 'Escolha do que é a ajuda.';
  end if;
  if exists (select 1 from public.avisos_rapidos where tipo = 'ajuda' and criado_por = auth.uid() and resolvido_em is null
               and (aceito_por is not null or expira_em > now() or para_moderadores)) then
    raise exception 'Você já tem um pedido de ajuda ativo. Cancele ou resolva antes de pedir outro.';
  end if;
  -- pedidos vencidos sem resposta da mesma pessoa saem da tela
  update public.avisos_rapidos set resolvido_em = now(), resolvido_por = auth.uid(), resolvido_por_nome = quem, nota = 'substituído por um pedido novo'
   where tipo = 'ajuda' and criado_por = auth.uid() and resolvido_em is null;
  insert into public.avisos_rapidos (tipo, titulo, categoria, texto, link, expira_em, criado_por, criado_por_nome)
  values ('ajuda', public.nome_categoria_ajuda(p_categoria), p_categoria, nullif(btrim(coalesce(p_texto, '')), ''),
          nullif(btrim(coalesce(p_link, '')), ''), now() + interval '10 minutes', auth.uid(), quem)
  returning * into a;
  perform public.avisar_equipe(format('%s pediu ajuda: %s%s', quem, a.titulo, coalesce(' · ' || a.texto, '')), '#inicio', 'ajuda');
  return to_jsonb(a);
end $$;

create or replace function public.aceitar_ajuda(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.avisos_rapidos where id = p_id and tipo = 'ajuda' for update;
  if a.id is null or a.resolvido_em is not null then raise exception 'Este pedido de ajuda não está mais aberto.'; end if;
  if a.criado_por = auth.uid() then raise exception 'Você não pode aceitar o seu próprio pedido.'; end if;
  if a.aceito_por is not null then raise exception '% já está ajudando.', a.aceito_por_nome; end if;
  if a.expira_em <= now() and not (a.para_moderadores and public.sou_moderador()) then raise exception 'Este pedido expirou.'; end if;
  update public.avisos_rapidos set aceito_por = auth.uid(), aceito_por_nome = quem, aceito_em = now() where id = a.id;
  perform public.notificar(a.criado_por, format('%s vai te ajudar (%s).', quem, a.titulo), '#inicio');
end $$;

-- sem ninguém em 10 min: pedir de novo (mais 10 min, avisa todos de novo) ou mandar para os moderadores
create or replace function public.renovar_ajuda(p_id bigint, p_moderadores boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.avisos_rapidos where id = p_id and tipo = 'ajuda' and criado_por = auth.uid() and resolvido_em is null for update;
  if a.id is null then raise exception 'Pedido de ajuda não encontrado.'; end if;
  if a.aceito_por is not null then raise exception '% já está ajudando.', a.aceito_por_nome; end if;
  if coalesce(p_moderadores, false) then
    update public.avisos_rapidos set para_moderadores = true where id = a.id;
    perform public.avisar_equipe(format('Ninguém pegou o pedido de ajuda de %s: %s%s', quem, a.titulo, coalesce(' · ' || a.texto, '')), '#inicio', 'ajuda', true);
  else
    update public.avisos_rapidos set expira_em = now() + interval '10 minutes', criado_em = now() where id = a.id;
    perform public.avisar_equipe(format('%s ainda precisa de ajuda: %s%s', quem, a.titulo, coalesce(' · ' || a.texto, '')), '#inicio', 'ajuda');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Aviso geral (até 12 h)
-- ---------------------------------------------------------------------
create or replace function public.criar_aviso_geral(p_texto text, p_horas numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'Escreva o aviso.'; end if;
  if p_horas is null or p_horas < 0.25 or p_horas > 12 then raise exception 'O aviso fica na tela de 15 minutos a 12 horas.'; end if;
  insert into public.avisos_rapidos (tipo, titulo, texto, expira_em, criado_por, criado_por_nome)
  values ('aviso', 'Aviso geral', btrim(p_texto), now() + p_horas * interval '1 hour', auth.uid(), quem)
  returning * into a;
  perform public.avisar_equipe(format('Aviso geral de %s: %s', quem, a.texto), '#inicio', 'aviso_geral');
  return to_jsonb(a);
end $$;

-- encerrar antes: aviso geral (quem criou ou moderador) e pedido de ajuda (quem pediu)
create or replace function public.encerrar_aviso_rapido(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.avisos_rapidos where id = p_id and resolvido_em is null;
  if a.id is null then raise exception 'Este aviso já foi encerrado.'; end if;
  if a.tipo = 'pendencia' then raise exception 'Use "Marcar como resolvido".'; end if;
  if a.criado_por is distinct from auth.uid() and not (a.tipo = 'aviso' and public.sou_moderador()) then
    raise exception 'Só quem criou pode encerrar.' using errcode = '42501';
  end if;
  update public.avisos_rapidos set resolvido_em = now(), resolvido_por = auth.uid(), resolvido_por_nome = public.nome_de(auth.uid()),
         nota = 'encerrado' where id = a.id;
end $$;

-- resolver: pendência (qualquer um) e ajuda aceita (quem pediu ou quem ajudou)
create or replace function public.resolver_aviso_rapido(p_id bigint, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.avisos_rapidos where id = p_id;
  if a.id is null or a.resolvido_em is not null then raise exception 'Este aviso já foi resolvido.'; end if;
  if a.tipo = 'aviso' then raise exception 'Aviso geral se encerra, não se resolve.'; end if;
  if a.tipo = 'ajuda' and auth.uid() is distinct from a.criado_por and auth.uid() is distinct from a.aceito_por then
    raise exception 'Só quem pediu ou quem está ajudando marca como resolvido.' using errcode = '42501';
  end if;
  update public.avisos_rapidos set resolvido_em = now(), resolvido_por = auth.uid(), resolvido_por_nome = public.nome_de(auth.uid()),
         nota = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_id and resolvido_em is null
  returning * into a;
  if a.bloqueio_id is not null then
    insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
    values (a.bloqueio_id, 'pendencia_resolvida', auth.uid(), a.resolvido_por_nome, a.titulo || coalesce(' · ' || a.nota, ''));
  end if;
  if a.tipo = 'ajuda' and a.aceito_por is not null then
    perform public.notificar(case when auth.uid() = a.criado_por then a.aceito_por else a.criado_por end,
      format('%s marcou como resolvido o pedido de ajuda (%s).', a.resolvido_por_nome, a.titulo), '#inicio');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Passagem de turno
-- ---------------------------------------------------------------------
create table if not exists public.passagens_turno (
  id         bigint generated always as identity primary key,
  de         uuid not null,
  de_nome    text,
  criada_em  timestamptz not null default now(),
  texto      text check (length(texto) <= 1500),
  itens      jsonb not null default '[]',   -- o que foi feito com cada tarefa: [{tipo, id, titulo, acao, para_nome}]
  panorama   jsonb not null default '{}'    -- números do turno na hora da passagem
);
create table if not exists public.passagens_lidas (
  passagem_id bigint not null references public.passagens_turno (id) on delete cascade,
  para        uuid not null,
  lida_em     timestamptz not null default now(),
  primary key (passagem_id, para)
);
alter table public.passagens_turno enable row level security;
alter table public.passagens_lidas enable row level security;
revoke all on public.passagens_turno, public.passagens_lidas from anon, authenticated;

-- o que está comigo agora + o que acontece no turno
create or replace function public.panorama_turno()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare eu text := public.meu_email();
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'tarefas', coalesce((select jsonb_agg(jsonb_build_object('tipo', 'tarefa', 'id', t.id::text,
        'titulo', case t.tipo when 'tratativa' then 'Tratativa' when 'encerramento_parceria' then 'Encerramento de parceria'
                              when 'leves_acumuladas' then 'Contato por infrações leves' else 'Completar dados' end
                  || ': ' || coalesce(b.nome_entregador, b.id_app) || coalesce(' · ' || b.cidade, ''),
        'criada_em', t.criada_em, 'atrasada', public.tarefa_atrasada(t)) order by t.criada_em)
      from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
     where t.status = 'pendente' and t.responsavel_email = eu and t.tipo <> 'completar_dados'), '[]'),
    'atividades', coalesce((select jsonb_agg(jsonb_build_object('tipo', 'atividade', 'id', a.id::text, 'titulo', a.titulo,
        'criada_em', a.criada_em, 'prazo', a.prazo) order by a.aceita_em)
      from public.atividades a where a.status = 'aceita' and a.aceita_por = auth.uid()), '[]'),
    'ajudas_abertas', (select count(*) from public.avisos_rapidos where tipo = 'ajuda' and resolvido_em is null and aceito_por is null and expira_em > now()),
    'pendencias', (select count(*) from public.avisos_rapidos where tipo = 'pendencia' and resolvido_em is null),
    'liberam_6h', (select count(*) from public.bloqueios b where public.situacao_bloqueio(b) = 'bloqueado' and b.fim <= now() + interval '6 hours'),
    'tratativas_equipe', (select count(*) from public.tarefas t where t.status = 'pendente' and t.tipo <> 'completar_dados'),
    'atrasadas_equipe', (select count(*) from public.tarefas t where t.status = 'pendente' and public.tarefa_atrasada(t)),
    'adicionais_meus', (select count(*) from public.lancamentos_financeiros where registrado_por = auth.uid() and not lancado));
end $$;

-- p_itens: [{tipo: 'tarefa'|'atividade', id, titulo, acao: 'passar'|'abrir'|'manter', para (id da pessoa)}]
create or replace function public.passar_turno(p_texto text, p_itens jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu    text := public.meu_email();
  quem  text := public.nome_de(auth.uid());
  it    jsonb;
  t     public.tarefas;
  a     public.atividades;
  para  public.membros;
  feitos jsonb := '[]';
  p     public.passagens_turno;
  pano  jsonb;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  pano := public.panorama_turno() - 'tarefas' - 'atividades';
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    if it->>'acao' not in ('passar', 'abrir', 'manter') then raise exception 'Escolha o que fazer com cada tarefa.'; end if;
    para := null;
    if it->>'acao' = 'passar' then
      select * into para from public.membros where user_id = nullif(it->>'para', '')::uuid;
      if para.email is null then raise exception 'Escolha para quem passar a tarefa.'; end if;
    end if;
    if it->>'tipo' = 'tarefa' then
      select * into t from public.tarefas where id = (it->>'id')::uuid and status = 'pendente' and responsavel_email = eu for update;
      if t.id is null then raise exception 'Uma das tarefas não está mais com você.'; end if;
      if it->>'acao' = 'passar' then
        if para.papel_bloqueios is null then raise exception '% não tem acesso aos bloqueios.', para.nome; end if;
        update public.tarefas set responsavel_email = para.email, realocada_em = now(), realocada_por_nome = quem where id = t.id;
        perform public.notificar(para.user_id, format('%s te passou uma tarefa na passagem de turno.', quem), '#atividades');
      elsif it->>'acao' = 'abrir' then
        update public.tarefas set responsavel_email = null, realocada_em = now(), realocada_por_nome = quem where id = t.id;
      end if;
    elsif it->>'tipo' = 'atividade' then
      select * into a from public.atividades where id = (it->>'id')::uuid and status = 'aceita' and aceita_por = auth.uid() for update;
      if a.id is null then raise exception 'Uma das atividades não está mais com você.'; end if;
      if it->>'acao' = 'passar' then
        update public.atividades set aceita_por = para.user_id, aceita_por_nome = para.nome, aceita_em = now() where id = a.id;
        perform public.notificar(para.user_id, format('%s te passou a atividade "%s" na passagem de turno.', quem, a.titulo), '#atividades');
      elsif it->>'acao' = 'abrir' then
        update public.atividades set status = 'aberta', aceita_por = null, aceita_por_nome = null, aceita_em = null where id = a.id;
      end if;
    else
      raise exception 'Tipo de item desconhecido.';
    end if;
    feitos := feitos || jsonb_build_object('tipo', it->>'tipo', 'id', it->>'id', 'titulo', it->>'titulo', 'acao', it->>'acao', 'para_nome', para.nome);
  end loop;
  insert into public.passagens_turno (de, de_nome, texto, itens, panorama)
  values (auth.uid(), quem, nullif(btrim(coalesce(p_texto, '')), ''), feitos, pano)
  returning * into p;
  perform public.avisar_equipe(format('%s passou o turno%s', quem, coalesce(': ' || left(p.texto, 200), '.')), '#inicio', 'turno');
  return to_jsonb(p);
end $$;

create or replace function public.ler_passagem(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  insert into public.passagens_lidas (passagem_id, para) values (p_id, auth.uid()) on conflict do nothing;
end $$;

-- passagens das últimas 16 h que eu ainda não li (e não são minhas)
create or replace function public.passagens_para_mim()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'de_nome', p.de_nome, 'criada_em', p.criada_em, 'texto', p.texto,
      'itens', p.itens, 'panorama', p.panorama) order by p.criada_em desc), '[]')
    from public.passagens_turno p
   where p.criada_em > now() - interval '16 hours' and p.de <> auth.uid()
     and not exists (select 1 from public.passagens_lidas l where l.passagem_id = p.id and l.para = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Acordos fechados com parceiros (Financeiro, pedido do usuário)
-- estabelecimento, cidade, o que foi acordado e a data de vencimento.
-- No dia do vencimento (horário de Brasília) o acordo aparece num aviso bem
-- chamativo na tela inicial de todos, e fica lá (inclusive nos dias seguintes)
-- até alguém marcar "Ajuste feito".
-- ---------------------------------------------------------------------
create table if not exists public.acordos (
  id                bigint generated always as identity primary key,
  estabelecimento   text not null check (length(btrim(estabelecimento)) between 1 and 150),
  cidade            text not null check (length(btrim(cidade)) between 1 and 80),
  acordo            text not null check (length(btrim(acordo)) between 1 and 1500),
  vence_em          date not null,
  criado_em         timestamptz not null default now(),
  criado_por        uuid,
  criado_por_nome   text,
  ajustado_em       timestamptz,
  ajustado_por      uuid,
  ajustado_por_nome text,
  nota              text check (length(nota) <= 500)
);
create index if not exists acordos_abertos on public.acordos (vence_em) where ajustado_em is null;
alter table public.acordos enable row level security;
revoke all on public.acordos from anon, authenticated;

create or replace function public.hoje_brasilia()
returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public.acordo_json(a public.acordos)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(a) - 'criado_por' - 'ajustado_por' || jsonb_build_object(
    'meu', a.criado_por = auth.uid(),
    'situacao', case when a.ajustado_em is not null then 'ajustado' when a.vence_em <= public.hoje_brasilia() then 'vencido' else 'vigente' end,
    'dias', a.vence_em - public.hoje_brasilia())
$$;

create or replace function public.registrar_acordo(p_estabelecimento text, p_cidade text, p_acordo text, p_vence_em date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.acordos;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if nullif(btrim(coalesce(p_estabelecimento, '')), '') is null then raise exception 'Informe o estabelecimento parceiro.'; end if;
  if nullif(btrim(coalesce(p_cidade, '')), '') is null then raise exception 'Informe a cidade do estabelecimento.'; end if;
  if nullif(btrim(coalesce(p_acordo, '')), '') is null then raise exception 'Escreva o que foi acordado.'; end if;
  if p_vence_em is null then raise exception 'Informe a data de vencimento do acordo.'; end if;
  if p_vence_em < public.hoje_brasilia() then raise exception 'A data de vencimento já passou.'; end if;
  insert into public.acordos (estabelecimento, cidade, acordo, vence_em, criado_por, criado_por_nome)
  values (btrim(p_estabelecimento), upper(btrim(p_cidade)), btrim(p_acordo), p_vence_em, auth.uid(), public.nome_de(auth.uid()))
  returning * into a;
  return public.acordo_json(a);
end $$;

-- p_situacao: null (todos), 'abertos' (vigentes + vencidos sem ajuste), 'ajustados'
create or replace function public.listar_acordos(p_situacao text default 'abertos', p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(public.acordo_json(a) order by (a.ajustado_em is null) desc,
                                    case when a.ajustado_em is null then a.vence_em end, a.ajustado_em desc)
    from (select * from public.acordos x
           where (p_situacao is null or (p_situacao = 'abertos' and x.ajustado_em is null) or (p_situacao = 'ajustados' and x.ajustado_em is not null))
             and (p_cidade is null or x.cidade = p_cidade)
           order by x.id desc limit 300) a), '[]');
end $$;

-- ajuste feito: qualquer pessoa (tira o aviso da tela inicial de todos)
create or replace function public.ajustar_acordo(p_id bigint, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.acordos;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.acordos where id = p_id for update;
  if a.id is null then raise exception 'Acordo não encontrado.'; end if;
  if a.ajustado_em is not null then raise exception 'O ajuste deste acordo já foi feito por %.', a.ajustado_por_nome; end if;
  update public.acordos set ajustado_em = now(), ajustado_por = auth.uid(), ajustado_por_nome = public.nome_de(auth.uid()),
         nota = nullif(btrim(coalesce(p_nota, '')), '')
   where id = a.id;
  if a.criado_por is not null and a.criado_por <> auth.uid() then
    perform public.notificar(a.criado_por, format('%s fez o ajuste do acordo com %s (%s).', public.nome_de(auth.uid()), a.estabelecimento, a.cidade), '#financeiro/acordos');
  end if;
end $$;

-- excluir (cadastrado errado): quem registrou ou moderador
create or replace function public.excluir_acordo(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare a public.acordos;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.acordos where id = p_id;
  if a.id is null then raise exception 'Acordo não encontrado.'; end if;
  if a.criado_por is distinct from auth.uid() and not public.sou_moderador() then
    raise exception 'Só quem registrou ou um moderador exclui o acordo.' using errcode = '42501';
  end if;
  delete from public.acordos where id = a.id;
end $$;

-- os vencidos sem ajuste (tela inicial de todos)
create or replace function public.acordos_vencidos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.acordo_json(a) order by a.vence_em, a.id), '[]')
    from public.acordos a where a.ajustado_em is null and a.vence_em <= public.hoje_brasilia()
$$;

-- resumo do topo: + passagens e "já passei o turno hoje" (lembrete das 18h, horário de Brasília)
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
      'avisos_rapidos', public.avisos_rapidos_abertos(),
      'passagens', public.passagens_para_mim(),
      'acordos_vencidos', public.acordos_vencidos(),
      'minha_passagem_hoje', exists (select 1 from public.passagens_turno p where p.de = auth.uid()
        and (p.criada_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
        and extract(hour from p.criada_em at time zone 'America/Sao_Paulo') >= 12)),
    'notif', public.minhas_notificacoes());
end $$;

-- ---------------------------------------------------------------------
-- Permissões e tráfego
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['passagens_turno', 'passagens_lidas', 'acordos'] loop
    if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname = t and g.tgname = 'marcar_mudanca_ins') then
      execute format('create trigger marcar_mudanca_ins after insert on public.%I referencing new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_upd after update on public.%I referencing old table as antigas new table as novas for each statement execute function public.marcar_mudanca_linhas()', t);
      execute format('create trigger marcar_mudanca_del after delete on public.%I referencing old table as antigas for each statement execute function public.marcar_mudanca_linhas()', t);
    end if;
  end loop;
end $$;

revoke all on function public.nome_categoria_ajuda(text) from public, anon, authenticated;
revoke all on function public.avisar_equipe(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.avisos_rapidos_abertos() from public, anon, authenticated;
revoke all on function public.passagens_para_mim() from public, anon, authenticated;
revoke all on function public.acordos_vencidos() from public, anon, authenticated;
revoke all on function public.acordo_json(public.acordos) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.pedir_ajuda(text, text, text)', 'public.aceitar_ajuda(bigint)', 'public.renovar_ajuda(bigint, boolean)',
                           'public.criar_aviso_geral(text, numeric)', 'public.encerrar_aviso_rapido(bigint)',
                           'public.resolver_aviso_rapido(bigint, text)', 'public.panorama_turno()',
                           'public.passar_turno(text, jsonb)', 'public.ler_passagem(bigint)', 'public.resumo_e_avisos()',
                           'public.registrar_acordo(text, text, text, date)', 'public.listar_acordos(text, text)',
                           'public.ajustar_acordo(bigint, text)', 'public.excluir_acordo(bigint)', 'public.hoje_brasilia()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
