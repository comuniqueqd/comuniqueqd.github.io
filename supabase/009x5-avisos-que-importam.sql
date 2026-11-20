-- 009x5 "Avisos que importam" (20/11/2026, decisão do usuário a partir dos números de uso do a10):
-- 1.881 avisos em 3 semanas para 10 pessoas, 453 sem ler, uma pessoa com 317; 7 das 10 pessoas são moderadoras e
-- moderador recebia tudo. Agora:
-- 1. Moderador recebe o que é dele, o das cidades dele, o que segue e o das cidades SEM responsável; quem quiser
--    continuar recebendo tudo liga preferencias_aviso.receber_tudo (salvar_receber_tudo; minhas_preferencias devolve).
-- 2. Aviso com mais de 7 dias sem ler conta como lido (gatilho aa1_avisos_velhos_lidos, a cada aviso novo da pessoa,
--    e uma vez agora para todos).
-- 3. As restrições com "revisar" que vieram da planilha (importado) ficam como revisadas: a planilha não é mais usada
--    e ninguém vai conferir esses registros antigos (decisão do usuário).
-- Pode rodar de novo.

alter table public.preferencias_aviso add column if not exists receber_tudo boolean not null default false;

create or replace function public.avisar_registro(
  p_categoria text, p_texto text, p_link text, p_cidade text, p_id_app text, p_bq boolean, p_leve boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  resp  text;
  v_id  text := lower(p_id_app);
  cat   text := case when p_leve then 'leves' else p_categoria end;
  hoje  text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  chv   text := 'leves:' || coalesce(p_cidade, '-') || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  r     record;
  n     integer;
begin
  if auth.uid() is null or nullif(btrim(coalesce(p_texto, '')), '') is null then return; end if;
  resp := case when p_cidade is not null then public.responsavel_cidade_email(p_cidade) end;
  for r in
    select x.user_id, x.motivo from (
      select m.user_id,
             case when v_id is not null and exists (select 1 from public.seguindo s where s.para = m.user_id and s.tipo = 'entregador' and s.alvo = v_id) then 'de_olho'
                  when resp is not null and m.email = resp then 'cidade'
                  when p_cidade is not null and exists (select 1 from public.seguindo s where s.para = m.user_id and s.tipo = 'cidade' and s.alvo = p_cidade) then 'seguindo'
                  -- 009x5: moderador recebe tudo só quando a cidade não tem responsável (ou quando pediu para receber tudo)
                  when (m.papel = 'moderador' or m.papel_bloqueios = 'moderador')
                       and (resp is null or exists (select 1 from public.preferencias_aviso p where p.para = m.user_id and p.receber_tudo)) then 'moderador' end motivo
        from public.membros m
       where m.user_id is not null and m.user_id <> auth.uid()
         and (not p_bq or m.papel_bloqueios is not null)) x
     where x.motivo is not null
       and (x.motivo = 'de_olho' or not exists (select 1 from public.preferencias_aviso p where p.para = x.user_id and cat = any (p.silenciados)))
       -- um aviso por pessoa por ação (a mesma transação pode gerar vários registros)
       and not exists (select 1 from public.notificacoes k where k.para = x.user_id and k.criada_em = now())
  loop
    if p_leve and r.motivo <> 'de_olho' then
      -- leves agrupadas: tira o aviso do dia (se houver) e põe um novo no topo, somando
      select coalesce(max(contagem), 0) into n from public.notificacoes where para = r.user_id and chave = chv;
      delete from public.notificacoes where para = r.user_id and chave = chv;
      insert into public.notificacoes (para, texto, link, categoria, cidade, motivo, chave, contagem)
      values (r.user_id, left(format('%s %s %s hoje. A última: %s', n + 1,
                case when n + 1 = 1 then 'infração leve nova' else 'infrações leves novas' end,
                coalesce('em ' || p_cidade, 'sem cidade'), p_texto), 500),
              '#bloqueios/historico', 'leves', p_cidade, r.motivo, chv, n + 1);
    else
      insert into public.notificacoes (para, texto, link, categoria, cidade, id_app, motivo)
      values (r.user_id, left(p_texto, 500), p_link, cat, p_cidade, v_id, r.motivo);
    end if;
  end loop;
end $$;

create or replace function public.minhas_preferencias()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'silenciados', coalesce((select to_jsonb(silenciados) from public.preferencias_aviso where para = auth.uid()), '[]'::jsonb),
    'receber_tudo', coalesce((select receber_tudo from public.preferencias_aviso where para = auth.uid()), false),
    'sou_moderador', public.sou_moderador(),
    'seguindo', coalesce((select jsonb_agg(jsonb_build_object('tipo', s.tipo, 'alvo', s.alvo,
        'nome', case when s.tipo = 'entregador' then (select e.nome from public.entregadores e where e.id_app = s.alvo) end,
        'desde', s.criado_em) order by s.tipo, s.alvo)
      from public.seguindo s where s.para = auth.uid()), '[]'::jsonb),
    'cidades', coalesce((select jsonb_agg(c.nome order by c.nome) from public.cidades c where c.ativa), '[]'::jsonb));
end $$;

create or replace function public.salvar_receber_tudo(p_receber boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  insert into public.preferencias_aviso (para, receber_tudo) values (auth.uid(), coalesce(p_receber, false))
  on conflict (para) do update set receber_tudo = excluded.receber_tudo, atualizado_em = now();
  return public.minhas_preferencias();
end $$;

create or replace function public.avisos_velhos_lidos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.notificacoes set lida_em = now()
   where para = new.para and lida_em is null and criada_em < now() - interval '7 days';
  return null;
end $$;
drop trigger if exists aa1_avisos_velhos_lidos on public.notificacoes;
create trigger aa1_avisos_velhos_lidos after insert on public.notificacoes
  for each row execute function public.avisos_velhos_lidos();

update public.notificacoes set lida_em = now() where lida_em is null and criada_em < now() - interval '7 days';

-- as da planilha que ainda estavam com "revisar"
update public.bloqueios set revisar = null where revisar is not null and importado;

revoke all on function public.avisar_registro(text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.avisos_velhos_lidos() from public, anon, authenticated;
revoke all on function public.salvar_receber_tudo(boolean) from public, anon;
grant execute on function public.salvar_receber_tudo(boolean) to authenticated;
revoke all on function public.minhas_preferencias() from public, anon;
grant execute on function public.minhas_preferencias() to authenticated;

notify pgrst, 'reload schema';
