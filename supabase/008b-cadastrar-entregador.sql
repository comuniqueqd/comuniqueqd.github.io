-- =====================================================================
-- 008b (ajuste urgente) · Cadastrar entregador avulso
-- Cria a ficha do entregador (ID, nome, cidade) sem precisar de um
-- cadastro na ativação nem de um bloqueio.
--
-- Não depende da 008: pode rodar antes ou depois dela, e de novo sem
-- problema. Só cria coisas novas (colunas e uma função); não redefine
-- nenhuma função das migrações anteriores.
-- =====================================================================

alter table public.entregadores add column if not exists criado_por      uuid;
alter table public.entregadores add column if not exists criado_por_nome text;

-- Todos os papéis do módulo de bloqueios (quem vê as fichas) podem cadastrar.
-- Se o ID já tem ficha, recusa e aponta para "Alterar dados" na ficha.
-- Monitorador/moderador: se o ID tem bloqueios com dados pendentes, completa
-- esses bloqueios e fecha a tarefa "completar dados" (igual a completar_dados_bloqueio).
create or replace function public.cadastrar_entregador(
  p_id_app text, p_nome text, p_cidade text default null, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p        public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
  v_id     text := lower(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'));
  v_nome   text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_cidade text := nullif(upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g')), '');
  v_com    text := nullif(btrim(coalesce(p_comentario, '')), '');
  quem     text := (select nome from public.membros where email = public.meu_email());
  e        public.entregadores;
  pend     integer := 0;
  feitos   integer := 0;
begin
  if length(v_id) < 4 or length(v_id) > 40 then raise exception 'ID do entregador inválido (de 4 a 40 letras e números).'; end if;
  if not public.nome_valido(v_nome) or length(v_nome) > 120 then raise exception 'Preencha o nome do entregador.'; end if;
  if v_cidade is not null and not exists (select 1 from public.cidades where nome = v_cidade and ativa) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  if v_com is not null and length(v_com) > 1500 then raise exception 'O comentário pode ter no máximo 1500 caracteres.'; end if;

  select * into e from public.entregadores where id_app = v_id;
  if e.id_app is not null then
    raise exception 'Este ID já tem cadastro (%). Abra a ficha para alterar os dados.', e.nome;
  end if;

  insert into public.entregadores (id_app, nome, cidade, criado_por, criado_por_nome)
  values (v_id, v_nome, v_cidade, auth.uid(), quem)
  on conflict (id_app) do nothing;
  if not found then raise exception 'Este ID acabou de ser cadastrado por outra pessoa. Abra a ficha.'; end if;

  perform public.anotar_entregador(v_id, 'alteracao',
    format('Cadastro do entregador criado: %s · %s', v_nome, coalesce(v_cidade, '(sem cidade)')), null);
  if v_com is not null then perform public.anotar_entregador(v_id, 'comentario', v_com, null); end if;

  select count(*) into pend from public.bloqueios where lower(id_app) = v_id and dados_pendentes;
  if pend > 0 and p in ('moderador', 'monitorador') and v_cidade is not null then
    update public.bloqueios set nome_entregador = v_nome, cidade = v_cidade, dados_pendentes = false
     where lower(id_app) = v_id and dados_pendentes;
    get diagnostics feitos = row_count;
    update public.tarefas set status = 'concluida', concluida_em = now(), concluida_por = auth.uid(), cidade = v_cidade,
           nota = 'Dados completados pelo cadastro do entregador: ' || v_nome || ' · ' || v_cidade
     where tipo = 'completar_dados' and status = 'pendente'
       and bloqueio_id in (select id from public.bloqueios where lower(id_app) = v_id);
    update public.tarefas set cidade = v_cidade, responsavel_email = public.responsavel_da_cidade(v_cidade)
     where tipo <> 'completar_dados' and status = 'pendente'
       and bloqueio_id in (select id from public.bloqueios where lower(id_app) = v_id);
    pend := 0;
  end if;

  return jsonb_build_object('id_app', v_id, 'nome', v_nome, 'cidade', v_cidade,
    'bloqueios_completados', feitos, 'bloqueios_pendentes', pend);
end $$;

revoke all on function public.cadastrar_entregador(text, text, text, text) from public, anon;
grant execute on function public.cadastrar_entregador(text, text, text, text) to authenticated;
