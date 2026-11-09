-- 009h: todo registro que usa o ID do entregador cria a ficha dele, se ainda não existe.
-- Pedido do usuário: um adicional com só o ID saiu "sem nome", embora o entregador já tivesse
-- recebido um lançamento antes; "tudo que utiliza o ID de entregador, se esse entregador não tem
-- registro, crie automaticamente com os dados disponíveis".
--   - Bloqueios: já criavam a ficha (gatilho bloqueio_cria_entregador, 003).
--   - Lançamentos financeiros (adicional e ajuste de bairro): passam a criar; e o nome/cidade em branco
--     vêm da ficha ou, sem ficha, do último lançamento do mesmo ID.
--   - Cadastros da ativação: criavam só quando aprovados; agora qualquer cadastro com ID e nome cria.
--   - Os registros já feitos ganham a ficha que faltava (bloqueios > lançamentos > cadastros, sempre o
--     mais recente), e os lançamentos sem nome recebem o nome da ficha.
--   - Onde só há o ID (tarefas, comentários, "de olho nele") não dá para criar: a ficha exige nome.
--     Ela nasce quando o nome aparecer em qualquer um dos registros acima.
-- Pode rodar de novo. Rodar a 007 ou a 009b de novo exige rodar esta depois.

-- ---------------------------------------------------------------------
-- Cria a ficha com os dados disponíveis (nunca sobrescreve uma que já existe)
-- ---------------------------------------------------------------------
create or replace function public.criar_ficha_se_faltar(p_id_app text, p_nome text, p_cidade text,
  p_por uuid default null, p_por_nome text default null, p_anotacao text default null, p_em timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(btrim(p_id_app), '') !~ '^[A-Za-z0-9]{4,40}$' or not public.nome_valido(p_nome) then return false; end if;
  insert into public.entregadores (id_app, nome, cidade, criado_por, criado_por_nome)
  values (lower(btrim(p_id_app)), left(regexp_replace(btrim(p_nome), '\s+', ' ', 'g'), 120),
          (select c.nome from public.cidades c where c.nome = p_cidade), p_por, p_por_nome)
  on conflict (id_app) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  if p_anotacao is not null then
    insert into public.comentarios_entregador (id_app, tipo, texto, por, por_nome, em)
    values (lower(btrim(p_id_app)), 'alteracao', p_anotacao, p_por, p_por_nome, coalesce(p_em, now()));
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Lançamentos financeiros
-- ---------------------------------------------------------------------
-- nome/cidade em branco: ficha (dados_conhecidos) > último lançamento do mesmo ID
create or replace function public.validar_entregador_lancamento(p_id_app text, p_nome text, p_cidade text,
  out id_app text, out nome text, out cidade text)
language plpgsql stable security definer set search_path = public as $$
declare k record; ant record;
begin
  id_app := btrim(coalesce(p_id_app, ''));
  if id_app !~ '^[A-Za-z0-9]{4,40}$' then raise exception 'Digite o ID do entregador (4 a 40 letras ou números).'; end if;
  select * into k from public.dados_conhecidos(id_app);
  select l.nome_entregador as nome, l.cidade into ant from public.lancamentos_financeiros l
   where lower(l.id_app) = lower(validar_entregador_lancamento.id_app) and public.nome_valido(l.nome_entregador)
   order by l.criado_em desc limit 1;
  nome := coalesce(nullif(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), ''), k.nome, ant.nome);
  cidade := coalesce(nullif(p_cidade, ''), k.cidade, ant.cidade);
  if cidade is not null and not exists (select 1 from public.cidades c where c.nome = cidade) then
    raise exception 'Cidade não encontrada.';
  end if;
end $$;

create or replace function public.lancamento_cria_entregador()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.criar_ficha_se_faltar(new.id_app, new.nome_entregador, new.cidade, new.registrado_por, new.registrado_por_nome,
    format('Ficha criada a partir de um lançamento financeiro (%s).',
           case new.tipo when 'adicional' then 'adicional' else 'ajuste de bairro' end), new.criado_em);
  return null;
end $$;
drop trigger if exists lancamento_cria_entregador on public.lancamentos_financeiros;
drop trigger if exists zzz_lancamento_cria_entregador on public.lancamentos_financeiros;
-- "zzz_": roda depois do aviso do lançamento (zz_aviso_lancamento), para o aviso que fica ser o do lançamento
create trigger zzz_lancamento_cria_entregador after insert on public.lancamentos_financeiros
  for each row execute function public.lancamento_cria_entregador();

-- ---------------------------------------------------------------------
-- Cadastros da ativação: qualquer cadastro com ID e nome (antes, só os aprovados)
-- ---------------------------------------------------------------------
create or replace function public.cadastro_cria_ficha()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id_app is not null and new.nome is not null then
    perform public.criar_ficha_se_faltar(new.id_app, new.nome, new.cidade, new.enviado_por, public.nome_de(new.enviado_por));
  end if;
  return new;
end $$;
drop trigger if exists cadastro_cria_ficha on public.cadastros;
create trigger cadastro_cria_ficha after update of status, id_app, nome on public.cadastros
  for each row execute function public.cadastro_cria_ficha();
drop trigger if exists cadastro_cria_ficha_ins on public.cadastros;
create trigger cadastro_cria_ficha_ins after insert on public.cadastros
  for each row execute function public.cadastro_cria_ficha();

-- ---------------------------------------------------------------------
-- Registros já feitos: cria as fichas que faltam e completa os lançamentos sem nome
-- ---------------------------------------------------------------------
do $$
declare r record; criadas integer := 0; nomes integer;
begin
  for r in
    select distinct on (lower(x.id_app)) x.* from (
      select b.id_app, b.nome_entregador as nome, b.cidade, b.registrado_por as por, b.registrado_por_nome as por_nome,
             b.inicio as em, 1 as prio, 'Ficha criada a partir de um bloqueio já registrado.' as anotacao
        from public.bloqueios b where not b.dados_pendentes and public.nome_valido(b.nome_entregador)
      union all
      select l.id_app, l.nome_entregador, l.cidade, l.registrado_por, l.registrado_por_nome, l.criado_em, 2,
             format('Ficha criada a partir de um lançamento financeiro (%s).', case l.tipo when 'adicional' then 'adicional' else 'ajuste de bairro' end)
        from public.lancamentos_financeiros l where public.nome_valido(l.nome_entregador)
      union all
      select c.id_app, c.nome, c.cidade, c.enviado_por, public.nome_de(c.enviado_por), c.enviado_em, 3, null
        from public.cadastros c where c.id_app is not null and public.nome_valido(c.nome)
    ) x
    where not exists (select 1 from public.entregadores e where e.id_app = lower(x.id_app))
    order by lower(x.id_app), x.prio, x.em desc
  loop
    if public.criar_ficha_se_faltar(r.id_app, r.nome, r.cidade, r.por, r.por_nome, r.anotacao, r.em) then criadas := criadas + 1; end if;
  end loop;
  update public.lancamentos_financeiros x set nome_entregador = e.nome
    from public.entregadores e
   where e.id_app = lower(x.id_app) and not public.nome_valido(x.nome_entregador);
  get diagnostics nomes = row_count;
  raise notice '009h: % ficha(s) criada(s) a partir dos registros; % lançamento(s) sem nome completado(s).', criadas, nomes;
end $$;

-- ---------------------------------------------------------------------
-- Permissões (tudo aqui é interno)
-- ---------------------------------------------------------------------
revoke all on function public.criar_ficha_se_faltar(text, text, text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.validar_entregador_lancamento(text, text, text) from public, anon, authenticated;
revoke all on function public.lancamento_cria_entregador() from public, anon, authenticated;
revoke all on function public.cadastro_cria_ficha() from public, anon, authenticated;

notify pgrst, 'reload schema';
