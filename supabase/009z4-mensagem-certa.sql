-- 009z4 "A mensagem certa na hora certa" (20/11/2026, spec aprovada pelo usuário). Pode rodar de novo.
--  A16-05: modelos novos de mensagem (editáveis em Ferramentas → Mensagens prontas; só insere o que não existe):
--          adicional lançado, ajuste de bairro, prazo da prestação de contas, confirmação de acordo e 4 frases
--          prontas para o aviso geral (grupo "equipe", não vão para o entregador).
--  NF-9:   lembrete no comentário da ficha ("retornar a Fulano em…"): comentar_entregador ganha p_lembrar_em,
--          meus_lembretes(), concluir_lembrete(), verificar_lembretes() (o front chama a cada 5 min; avisa quem comentou).
--  AN-6:   renovar o pedido de ajuda não apaga a hora em que ele foi feito (renovado_em + renovacoes).
--  A16-07: uso das telas e botões sem saber quem: uso_dia(dia, recurso, qtd); contar_uso() e uso_resumo() (só o
--          administrador final).

-- ---------- A16-05: modelos novos ----------
alter table public.modelos_mensagem drop constraint if exists modelos_mensagem_grupo_check;
alter table public.modelos_mensagem add constraint modelos_mensagem_grupo_check check (grupo in ('bloqueio', 'entregador', 'cidade', 'parceiro', 'equipe'));
insert into public.modelos_mensagem (chave, grupo, tipo, opcao, titulo, texto, ordem)
values
  ('adicional_lancado', 'entregador', 'adicional_lancado', 1, 'Adicional lançado',
   'Olá, {nome}! O adicional de {valor} do pedido {pedido} já foi lançado e entra no seu próximo repasse. Obrigado pela entrega!', 7),
  ('ajuste_bairro', 'entregador', 'ajuste_bairro', 1, 'Ajuste de bairro lançado',
   'Olá, {nome}! Conferimos o pedido {pedido}: o bairro certo era {bairro_real}, e não {bairro_informado}. A diferença de {valor} foi lançada para você e entra no próximo repasse. Obrigado por avisar!', 8),
  ('retencao_prazo', 'entregador', 'retencao_prazo', 1, 'Prestação de contas pendente',
   'Olá, {nome}. Ainda está pendente a prestação de contas da sua entrega. Pedimos que você responda em até 8 horas para resolvermos juntos. Sem retorno nesse prazo, a política de conduta prevê uma medida mais grave. Qualquer dúvida, fale com a gente por aqui.', 9),
  ('acordo_confirmacao', 'parceiro', 'acordo_confirmacao', 1, 'Parceiro: confirmação do acordo',
   'Olá! Aqui é {meu_nome}, da equipe de operação. Passando para confirmar o que combinamos com {estabelecimento}: {acordo}. Vale até {vence}. Se algo mudar, é só avisar por aqui. Obrigado pela parceria!', 21),
  ('aviso_geral', 'equipe', 'aviso_geral', 1, 'Aviso geral',
   'Quero Log instável agora: anotem o que fizerem e confiram quando voltar.', 40),
  ('aviso_geral_2', 'equipe', 'aviso_geral', 2, 'Aviso geral',
   'Movimento alto agora: priorizem os pedidos atrasados e os pedidos de ajuda.', 40),
  ('aviso_geral_3', 'equipe', 'aviso_geral', 3, 'Aviso geral',
   'Faltam entregadores online em algumas cidades: quem puder, ajude a chamar.', 40),
  ('aviso_geral_4', 'equipe', 'aviso_geral', 4, 'Aviso geral',
   'Reunião rápida da equipe em 15 minutos.', 40)
on conflict (chave) do nothing;

-- ---------- NF-9: lembrete no comentário da ficha ----------
alter table public.comentarios_entregador
  add column if not exists lembrar_em timestamptz,
  add column if not exists lembrete_feito_em timestamptz,
  add column if not exists lembrete_avisado_em timestamptz;
create index if not exists comentarios_entregador_lembrete_idx on public.comentarios_entregador (por, lembrar_em)
  where lembrar_em is not null and lembrete_feito_em is null;

drop function if exists public.comentar_entregador(text, text);
create or replace function public.comentar_entregador(p_id_app text, p_texto text, p_lembrar_em timestamptz default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id text := lower(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g')); v_c bigint;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'Escreva o comentário.'; end if;
  if length(btrim(p_texto)) > 1500 then raise exception 'O comentário pode ter no máximo 1500 caracteres.'; end if;
  if p_lembrar_em is not null and (p_lembrar_em < now() - interval '5 minutes' or p_lembrar_em > now() + interval '60 days') then
    raise exception 'Escolha uma data de lembrete entre agora e os próximos 60 dias.';
  end if;
  if length(v_id) < 4 or (not exists (select 1 from public.entregadores where id_app = v_id)
     and not exists (select 1 from public.bloqueios where lower(id_app) = v_id)
     and not exists (select 1 from public.cadastros where lower(id_app) = v_id)) then
    raise exception 'Este ID não tem registros no sistema.';
  end if;
  perform public.anotar_entregador(v_id, 'comentario', p_texto, null);
  v_c := (select max(id) from public.comentarios_entregador where id_app = v_id and por = auth.uid());
  if p_lembrar_em is not null and v_c is not null then
    update public.comentarios_entregador set lembrar_em = p_lembrar_em where id = v_c;
  end if;
  return v_c;
end $$;

create or replace function public.meus_lembretes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'id_app', c.id_app,
      'nome', public.nome_do_id(c.id_app), 'texto', c.texto, 'lembrar_em', c.lembrar_em, 'em', c.em,
      'vencido', c.lembrar_em <= now()) order by c.lembrar_em), '[]')
    from public.comentarios_entregador c
   where c.por = auth.uid() and c.lembrar_em is not null and c.lembrete_feito_em is null
     and exists (select 1 from public.membros m where m.user_id = auth.uid())
$$;

create or replace function public.concluir_lembrete(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.comentarios_entregador set lembrete_feito_em = now()
   where id = p_id and por = auth.uid() and lembrar_em is not null and lembrete_feito_em is null;
  if not found then raise exception 'Lembrete não encontrado.'; end if;
end $$;

-- avisa quem comentou quando chega a hora (uma vez por lembrete); só os lembretes de quem chamou
create or replace function public.verificar_lembretes()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select c.id, c.id_app, c.texto from public.comentarios_entregador c
            where c.por = auth.uid() and c.lembrar_em <= now() and c.lembrete_feito_em is null and c.lembrete_avisado_em is null
            for update skip locked loop
    update public.comentarios_entregador set lembrete_avisado_em = now() where id = r.id;
    -- direto na tabela: notificar() não avisa a própria pessoa, e aqui o aviso é justamente para quem chamou
    insert into public.notificacoes (para, texto, link)
    values (auth.uid(), format('Hora de retornar a %s: %s', coalesce(public.nome_do_id(r.id_app), 'entregador sem nome'), left(r.texto, 160)),
            '#ficha/' || r.id_app);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- AN-6: renovar a ajuda mantém a hora do pedido ----------
alter table public.avisos_rapidos
  add column if not exists renovado_em timestamptz,
  add column if not exists renovacoes smallint not null default 0;

create or replace function public.renovar_ajuda(p_id bigint, p_moderadores boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avisos_rapidos; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.avisos_rapidos where id = p_id and tipo = 'ajuda' and criado_por = auth.uid() and resolvido_em is null for update;
  if a.id is null then raise exception 'Pedido de ajuda não encontrado.'; end if;
  if a.aceito_por is not null then raise exception '% já está ajudando.', a.aceito_por_nome; end if;
  if coalesce(p_moderadores, false) then
    update public.avisos_rapidos set para_moderadores = true, renovado_em = now(), renovacoes = renovacoes + 1 where id = a.id;
    perform public.avisar_equipe(format('Ninguém pegou o pedido de ajuda de %s: %s%s', quem, a.titulo, coalesce(' · ' || a.texto, '')), '#inicio', 'ajuda', true);
  else
    update public.avisos_rapidos set expira_em = now() + interval '10 minutes', renovado_em = now(), renovacoes = renovacoes + 1 where id = a.id;
    perform public.avisar_equipe(format('%s ainda precisa de ajuda: %s%s', quem, a.titulo, coalesce(' · ' || a.texto, '')), '#inicio', 'ajuda');
  end if;
end $$;

create or replace function public.avisos_rapidos_abertos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'titulo', a.titulo, 'id_app', a.id_app,
      'nome', coalesce(a.nome, (select e.nome from public.entregadores e where e.id_app = lower(a.id_app))),
      'cidade', a.cidade, 'bloqueio_id', a.bloqueio_id, 'criado_em', a.criado_em, 'criado_por_nome', a.criado_por_nome,
      'categoria', a.categoria, 'texto', a.texto, 'link', a.link, 'expira_em', a.expira_em,
      'aceito_por_nome', a.aceito_por_nome, 'aceito_em', a.aceito_em, 'para_moderadores', a.para_moderadores,
      'renovado_em', a.renovado_em, 'renovacoes', a.renovacoes,
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

-- ---------- A16-07: uso sem saber quem ----------
create table if not exists public.uso_dia (
  dia date not null,
  recurso text not null,
  qtd integer not null default 0,
  primary key (dia, recurso)
);
alter table public.uso_dia enable row level security;   -- sem políticas: só pelas funções

-- p_itens = {"aba:bloqueios/novo": 3, "mensagem:restricao": 1, ...}; nada de quem usou
create or replace function public.contar_uso(p_itens jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if p_itens is null or jsonb_typeof(p_itens) <> 'object' then return; end if;
  for k, v in select * from jsonb_each(p_itens) limit 80 loop
    if k !~ '^[a-z_]{2,20}(:[a-z0-9_/\-]{1,60})?$' or jsonb_typeof(v) <> 'number' then continue; end if;
    insert into public.uso_dia (dia, recurso, qtd) values (d, k, least(greatest(v::text::numeric::int, 0), 500))
    on conflict (dia, recurso) do update set qtd = public.uso_dia.qtd + excluded.qtd;
  end loop;
end $$;

create or replace function public.uso_resumo(p_dias integer default 28)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ini date := (now() at time zone 'America/Sao_Paulo')::date - greatest(1, least(coalesce(p_dias, 28), 365)) + 1;
begin
  if not exists (select 1 from public.membros where user_id = auth.uid() and admin_final) then
    raise exception 'Os números de uso são só do administrador.' using errcode = '42501';
  end if;
  return jsonb_build_object('desde', ini,
    'itens', coalesce((select jsonb_agg(jsonb_build_object('recurso', recurso, 'qtd', t, 'dias', nd) order by t desc, recurso)
       from (select recurso, sum(qtd) t, count(*) nd from public.uso_dia where dia >= ini group by recurso) x), '[]'));
end $$;

revoke all on function public.comentar_entregador(text, text, timestamptz) from public, anon;
grant execute on function public.comentar_entregador(text, text, timestamptz) to authenticated;
do $$ declare f text; begin
  foreach f in array array['meus_lembretes()', 'concluir_lembrete(bigint)', 'verificar_lembretes()', 'renovar_ajuda(bigint, boolean)',
                           'contar_uso(jsonb)', 'uso_resumo(integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.avisos_rapidos_abertos() from public, anon, authenticated';
end $$;

notify pgrst, 'reload schema';
