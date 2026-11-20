-- 009x6 (20/11/2026, pedidos do usuário):
-- 1. O suporte VÊ tudo (só leitura): os cadastros de todos no Histórico da ativação, as restrições de todos no
--    Histórico, as tratativas de todas as cidades, "Com restrição agora" e os anexos. O que ele pode FAZER não muda
--    (não aprova, não faz tratativa, não libera, só anexa nas que registrou). Avisos continuam só do que é dele
--    (decisão dos cadastros que enviou, tratativa das restrições que registrou, e o que escolheu acompanhar).
--    O monitorador também passa a ver as tratativas de todas as cidades (antes só as dele); 'minha' continua
--    dizendo em quais ele age. Pendentes da ativação: o front mostra ao suporte só os que ele enviou (é fila de quem decide).
-- 2. Notícias rápidas = tarefas concluídas nos últimos 7 dias (antes eram as ativações de parceiros).
--    Parceiros ganham o bloco próprio: parceiros_semana() = os 10 últimos ativados + quantos nesta semana e na
--    anterior (terça a segunda, Brasília).
-- Pode rodar de novo.

drop policy if exists cadastros_leitura on public.cadastros;
create policy cadastros_leitura on public.cadastros for select to authenticated
  using ((select public.meu_papel()) is not null);

drop policy if exists bloqueios_leitura on public.bloqueios;
create policy bloqueios_leitura on public.bloqueios for select to authenticated
  using ((select public.meu_papel_bloq()) is not null);

-- anexar continua só para quem registrou (ou monitorador/moderador); ver e baixar passam a valer para todos do módulo
create or replace function public.pode_anexar(p_bloqueio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.meu_papel_bloq() in ('moderador', 'monitorador')
      or exists (select 1 from public.bloqueios where id = p_bloqueio and registrado_por = auth.uid())
$$;

create or replace function public.anexar(p_bloqueio uuid, p_nome text, p_tipo text, p_base64 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  dados bytea;
  novo  uuid;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  if not exists (select 1 from public.bloqueios where id = p_bloqueio) then raise exception 'Bloqueio não encontrado.'; end if;
  if not public.pode_anexar(p_bloqueio) then raise exception 'Você só pode anexar nas restrições que registrou.' using errcode = '42501'; end if;
  if p_tipo not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'Anexe uma imagem (JPG, PNG) ou um PDF.';
  end if;
  begin dados := decode(coalesce(p_base64, ''), 'base64');
  exception when others then raise exception 'Arquivo inválido.'; end;
  if length(dados) = 0 then raise exception 'Arquivo vazio.'; end if;
  if length(dados) > 307200 then raise exception 'O arquivo passou de 300 KB. Use uma imagem menor ou um PDF mais leve.'; end if;
  perform pg_advisory_xact_lock(hashtext('anexos:' || p_bloqueio::text));
  if (select count(*) from public.anexos where bloqueio_id = p_bloqueio) >= 3 then
    raise exception 'Cada bloqueio pode ter no máximo 3 anexos.';
  end if;
  if (select coalesce(sum(tamanho), 0) from public.anexos) + length(dados) > 200 * 1024 * 1024 then
    raise exception 'O espaço para anexos do sistema está cheio (200 MB). Fale com um moderador.';
  end if;
  insert into public.anexos (bloqueio_id, nome, tipo, tamanho, conteudo, por, por_nome)
  values (p_bloqueio, left(btrim(coalesce(nullif(btrim(p_nome), ''), 'anexo')), 120), p_tipo, length(dados), dados, auth.uid(),
          (select nome from public.membros where email = public.meu_email()))
  returning id into novo;
  return novo;
end $$;

create or replace function public.pode_ver_bloqueio(p_bloqueio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.meu_papel_bloq() is not null and exists (select 1 from public.bloqueios where id = p_bloqueio)
$$;

create or replace function public.listar_tarefas(p_status text default 'pendente')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
begin
  return coalesce((
    select jsonb_agg(public.json_tarefa(t) || jsonb_build_object(
      'cidade', t.cidade,
      'minha', p = 'moderador' or t.responsavel_email = public.meu_email() or (t.tipo = 'completar_dados' and p = 'monitorador'),
      'bloqueio', public.json_bloqueio(b)) order by t.criada_em)
    from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
    where (p_status is null or t.status = p_status)
      -- 009x6: todos veem todas (só leitura); quem age continua sendo decidido por 'minha'
      ), '[]');
end $$;

create or replace function public.listar_tarefas_concluidas(
  p_limite integer default 100, p_busca text default null, p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p   public.papel := public.exigir_bloq('moderador', 'monitorador', 'suporte');
  lim integer := least(greatest(coalesce(p_limite, 100), 1), 2000);
  q   text := public.norm_nome(p_busca);
  res jsonb;
begin
  with visiveis as (
    select t, b from public.tarefas t join public.bloqueios b on b.id = t.bloqueio_id
     where t.status = 'concluida'
       -- 009x6: todos veem todas
       ),
  filtradas as (
    select v.* from visiveis v
     where (p_cidade is null or (v.b).cidade = p_cidade)
       and (q is null or public.norm_nome(concat_ws(' ', (v.b).id_app, (v.b).nome_entregador, (v.b).infracao, (v.b).cidade,
              (v.b).registrado_por_nome, public.nome_por_email((v.t).responsavel_email))) like '%' || q || '%')
     order by (v.t).concluida_em desc nulls last limit lim + 1)
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(public.json_tarefa(f.t) || jsonb_build_object(
        'cidade', (f.t).cidade,
        'minha', p = 'moderador' or (f.t).responsavel_email = public.meu_email() or ((f.t).tipo = 'completar_dados' and p = 'monitorador'),
        'bloqueio', public.json_bloqueio(f.b)) order by (f.t).concluida_em desc nulls last)
        from (select * from filtradas order by (t).concluida_em desc nulls last limit lim) f), '[]'),
    'mais', (select count(*) from filtradas) > lim,
    'cidades', coalesce((select jsonb_agg(distinct (v.b).cidade order by (v.b).cidade) from visiveis v where (v.b).cidade is not null), '[]'))
  into res;
  return res;
end $$;

create or replace function public.noticias_rapidas(p_limite int default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(x order by x->>'quando' desc) from (
    select jsonb_build_object('tipo', 'tarefa', 'id', a.id, 'titulo', a.titulo, 'cidade', a.cidade,
             'quem', coalesce(a.concluida_por_nome, a.aceita_por_nome, a.criada_por_nome), 'quando', a.concluida_em,
             'equipe', a.automatica, 'eu', coalesce(a.concluida_por, a.aceita_por) = auth.uid()) x
      from public.atividades a
     where a.status = 'concluida' and a.concluida_em > now() - interval '7 days'
       and (not a.opcional or a.concluida_em is not null)
     order by a.concluida_em desc
     limit greatest(1, least(coalesce(p_limite, 6), 20))) s), '[]');
end $$;

create or replace function public.parceiros_semana()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ini date := public.inicio_semana((now() at time zone 'America/Sao_Paulo')::date);
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'esta_semana', (select count(*) from public.parceiros p where (p.criado_em at time zone 'America/Sao_Paulo')::date >= ini),
    'semana_passada', (select count(*) from public.parceiros p where (p.criado_em at time zone 'America/Sao_Paulo')::date >= ini - 7
                                                              and (p.criado_em at time zone 'America/Sao_Paulo')::date < ini),
    'ultimos', coalesce((select jsonb_agg(x order by x->>'quando' desc) from (
        select jsonb_build_object('id', p.id, 'estabelecimento', p.estabelecimento, 'cidade', p.cidade,
                 'quem', p.criado_por_nome, 'quando', p.criado_em, 'eu', p.criado_por = auth.uid()) x
          from public.parceiros p order by p.criado_em desc limit 10) s), '[]'));
end $$;

revoke all on function public.pode_ver_bloqueio(uuid) from public, anon, authenticated;
revoke all on function public.pode_anexar(uuid) from public, anon, authenticated;
revoke all on function public.anexar(uuid, text, text, text) from public, anon;
grant execute on function public.anexar(uuid, text, text, text) to authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.listar_tarefas(text)', 'public.listar_tarefas_concluidas(integer, text, text)',
                           'public.noticias_rapidas(integer)', 'public.parceiros_semana()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
