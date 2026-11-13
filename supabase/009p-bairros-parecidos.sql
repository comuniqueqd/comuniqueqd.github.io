-- =====================================================================
-- 009p: bairros com nomes parecidos (pedido do usuário, 11/2026)
-- "Detecte automaticamente quando um bairro for registrado com um nome parecido a outro, e faça que seja o mesmo valor."
--
-- Ao cadastrar um bairro, o nome é comparado com os bairros (e apelidos) da mesma cidade:
--   igual    = só muda acento, maiúscula, espaço ou pontuação ("Várzea" × "VARZEA")      → junta sozinho
--   quase    = uma letra de diferença, nomes com 5+ letras ("Aldemar" × "Ademar")        → junta sozinho
--   parecido = duas letras (nomes com 7+ letras) ou um nome dentro do outro sem os
--              prefixos comuns ("Pirinel" × "Parque Regente Pirinel")                    → pergunta antes
-- Números e algarismos romanos diferentes nunca juntam ("Conjunto 1" × "Conjunto 2", "Jardim I" × "Jardim II").
-- Juntar = o nome novo vira apelido do bairro que já existe e vale o valor dele (o entregador recebe o mesmo).
-- Pares que a pessoa disse que NÃO são o mesmo ficam em bairros_diferentes e não voltam a ser apontados.
--
-- Rode depois da 009h. Pode rodar de novo (create or replace / if not exists).
-- =====================================================================

create table if not exists public.bairros_diferentes (
  bairro_a   bigint not null references public.bairros (id) on delete cascade,
  bairro_b   bigint not null references public.bairros (id) on delete cascade,
  decidido_por text,
  decidido_em  timestamptz not null default now(),
  primary key (bairro_a, bairro_b),
  check (bairro_a < bairro_b)
);
alter table public.bairros_diferentes enable row level security;  -- sem políticas: só pelas funções

-- nome para comparar: maiúsculas, sem acento, sem pontuação, espaços simples
create or replace function public.nome_bairro_norm(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(
           translate(upper(coalesce(t, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN'),
           '[^A-Z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- números e algarismos romanos do nome (em ordem), para nunca juntar "Conjunto 1" com "Conjunto 2"
create or replace function public.numeros_bairro(t text)
returns text language sql immutable as $$
  select coalesce(string_agg(p, ' ' order by p), '')
    from unnest(string_to_array(public.nome_bairro_norm(t), ' ')) p
   where p ~ '^[0-9]+$' or p ~ '^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$'
$$;

-- sem os prefixos comuns de nome de bairro (para "Pirinel" × "Parque Regente Pirinel")
create or replace function public.nucleo_bairro(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(' ' || public.nome_bairro_norm(t) || ' ',
    ' (BAIRRO|POVOADO|POV|CONJUNTO|CONJ|RESIDENCIAL|RES|LOTEAMENTO|LOT|PARQUE|JARDIM|JD|VILA|SITIO|FAZENDA|CONDOMINIO|COND|DE|DA|DO|DAS|DOS) ',
    ' ', 'g'))
$$;

-- distância de edição (Levenshtein) sem depender de extensão
create or replace function public.distancia_texto(a text, b text)
returns int language plpgsql immutable as $$
declare
  la int := length(a); lb int := length(b);
  ant int[]; atual int[]; i int; j int; custo int;
begin
  if a = b then return 0; end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  ant := array(select generate_series(0, lb));
  for i in 1..la loop
    atual := array[i];
    for j in 1..lb loop
      custo := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      atual := atual || least(atual[j] + 1, ant[j + 1] + 1, ant[j] + custo);
    end loop;
    ant := atual;
  end loop;
  return ant[lb + 1];
end $$;

-- grau de parecença entre dois nomes: 'igual' | 'quase' | 'parecido' | null
create or replace function public.grau_bairro(a text, b text)
returns text language plpgsql immutable as $$
declare
  na text := public.nome_bairro_norm(a); nb text := public.nome_bairro_norm(b);
  ca text := public.nucleo_bairro(a);    cb text := public.nucleo_bairro(b);
  m int; d int;
begin
  if na = '' or nb = '' then return null; end if;
  if na = nb then return 'igual'; end if;
  if public.numeros_bairro(a) <> public.numeros_bairro(b) then return null; end if;
  m := least(length(na), length(nb));
  if abs(length(na) - length(nb)) <= 2 then
    d := public.distancia_texto(replace(na, ' ', ''), replace(nb, ' ', ''));
    if d = 0 then return 'igual'; end if;                -- só espaços diferentes
    if d = 1 and m >= 5 then return 'quase'; end if;
    if d = 2 and m >= 7 then return 'parecido'; end if;
  end if;
  if length(ca) >= 4 and length(cb) >= 4 and (ca = cb
     or (least(length(ca), length(cb)) >= 5 and (' ' || ca || ' ' like '% ' || cb || ' %' or ' ' || cb || ' ' like '% ' || ca || ' %'))) then
    return 'parecido';
  end if;
  return null;
end $$;

-- o bairro ativo da cidade mais parecido com o nome (comparando com o nome e os apelidos)
create or replace function public.bairro_parecido(p_cidade text, p_nome text, p_ignorar bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.bairros; nome_c text; melhor jsonb; ordem int; melhor_ordem int := 9; g text;
begin
  for b in select * from public.bairros where cidade = p_cidade and ativo and id is distinct from p_ignorar order by nome loop
    foreach nome_c in array (array[b.nome] || b.apelidos) loop
      g := public.grau_bairro(p_nome, nome_c);
      if g is null then continue; end if;
      ordem := case g when 'igual' then 1 when 'quase' then 2 else 3 end;
      if ordem < melhor_ordem then
        melhor_ordem := ordem;
        melhor := jsonb_build_object('id', b.id, 'nome', b.nome, 'comparado_com', nome_c, 'grau', g,
                                     'valor', b.valor, 'recebe', public.recebe_bairro(b));
      end if;
    end loop;
  end loop;
  return melhor;
end $$;

-- achar o bairro: nome/apelido exato (como antes) e, se não achar, um praticamente igual (igual/quase)
create or replace function public.achar_bairro(p_cidade text, p_nome text)
returns public.bairros language plpgsql stable security definer set search_path = public as $$
declare b public.bairros; p jsonb;
begin
  select x.* into b from public.bairros x
   where x.cidade = p_cidade and x.ativo
     and (upper(btrim(x.nome)) = upper(btrim(p_nome))
          or upper(btrim(p_nome)) = any (select upper(btrim(a)) from unnest(x.apelidos) a))
   order by (upper(btrim(x.nome)) = upper(btrim(p_nome))) desc
   limit 1;
  if b.id is not null then return b; end if;
  p := public.bairro_parecido(p_cidade, p_nome);
  if p is not null and p->>'grau' in ('igual', 'quase') then
    select x.* into b from public.bairros x where x.id = (p->>'id')::bigint;
  end if;
  return b;
end $$;

-- salvar bairro: agora com a conferência de nome parecido (só ao cadastrar um novo).
-- p_decisao: nulo = conferir; 'juntar' = juntar ao parecido (p_juntar_com); 'separado' = é outro bairro, salvar mesmo assim.
drop function if exists public.salvar_bairro(bigint, text, text, numeric, numeric, text[], boolean);
create or replace function public.salvar_bairro(p_id bigint, p_cidade text, p_nome text, p_valor numeric, p_taxa_log numeric,
                                                p_apelidos text[] default '{}', p_ativo boolean default true,
                                                p_decisao text default null, p_juntar_com bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n   text := upper(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  ap  text[] := coalesce((select array_agg(distinct upper(regexp_replace(btrim(a), '\s+', ' ', 'g')))
                            from unnest(coalesce(p_apelidos, '{}')) a where nullif(btrim(a), '') is not null), '{}');
  b   public.bairros;
  par jsonb;
  dest public.bairros;
begin
  perform public.exigir_papel('moderador');
  if length(n) < 2 then raise exception 'Digite o nome do bairro.'; end if;
  if not exists (select 1 from public.cidades where nome = p_cidade) then raise exception 'Cidade não encontrada.'; end if;
  if p_decisao is not null and p_decisao not in ('juntar', 'separado') then raise exception 'Decisão inválida.'; end if;
  -- cadastro novo: confere se já existe um bairro com nome parecido na cidade
  if p_id is null and coalesce(p_decisao, '') <> 'separado' then
    if p_decisao = 'juntar' then
      select * into dest from public.bairros where id = p_juntar_com and cidade = p_cidade;
      if dest.id is null then raise exception 'Bairro para juntar não encontrado.'; end if;
    else
      par := public.bairro_parecido(p_cidade, n);
      if par is not null and par->>'grau' = 'parecido' then
        return jsonb_build_object('precisa_confirmar', true, 'parecido', par);  -- a tela pergunta se é o mesmo
      end if;
      if par is not null then select * into dest from public.bairros where id = (par->>'id')::bigint; end if;
    end if;
    if dest.id is not null then
      -- é o mesmo bairro: o nome novo (e os apelidos dados) viram apelidos dele, com o valor que ele já tem
      update public.bairros
         set apelidos = (select coalesce(array_agg(distinct a), '{}') from unnest(dest.apelidos || n || ap) a where a <> upper(dest.nome)),
             ativo = true, atualizado_em = now(), atualizado_por = public.meu_email()
       where id = dest.id
      returning * into b;
      return public.json_bairro(b) || jsonb_build_object('juntado_com', b.nome, 'grau', coalesce(par->>'grau', 'confirmado'),
                                                          'valor_informado', p_valor);
    end if;
  end if;
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
    -- "é outro bairro": não apontar mais o par
    if p_decisao = 'separado' and p_juntar_com is not null then
      insert into public.bairros_diferentes (bairro_a, bairro_b, decidido_por)
      values (least(b.id, p_juntar_com), greatest(b.id, p_juntar_com), public.meu_email()) on conflict do nothing;
    end if;
  else
    update public.bairros set cidade = p_cidade, nome = n, valor = p_valor, taxa_log = p_taxa_log,
           apelidos = array_remove(ap, n), ativo = coalesce(p_ativo, true), atualizado_em = now(), atualizado_por = public.meu_email()
     where id = p_id
    returning * into b;
    if b.id is null then raise exception 'Bairro não encontrado.'; end if;
  end if;
  return public.json_bairro(b);
end $$;

-- pares de bairros ativos da mesma cidade com nomes parecidos (para o moderador resolver)
create or replace function public.bairros_parecidos(p_cidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((
    select jsonb_agg(jsonb_build_object('cidade', a.cidade, 'grau', g.grau,
             'a', public.json_bairro(a), 'b', public.json_bairro(b)) order by a.cidade, a.nome, b.nome)
      from public.bairros a
      join public.bairros b on b.cidade = a.cidade and b.id > a.id and b.ativo
      cross join lateral (select public.grau_bairro(a.nome, b.nome) as grau) g
     where a.ativo and g.grau is not null and (p_cidade is null or a.cidade = p_cidade)
       and not exists (select 1 from public.bairros_diferentes d where d.bairro_a = a.id and d.bairro_b = b.id)), '[]');
end $$;

-- juntar dois bairros já cadastrados: fica o valor do p_manter; o outro vira apelido dele e é desativado
create or replace function public.juntar_bairros(p_manter bigint, p_juntar bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.bairros; j public.bairros;
begin
  perform public.exigir_papel('moderador');
  select * into m from public.bairros where id = p_manter;
  select * into j from public.bairros where id = p_juntar;
  if m.id is null or j.id is null then raise exception 'Bairro não encontrado.'; end if;
  if m.id = j.id then raise exception 'Escolha dois bairros diferentes.'; end if;
  if m.cidade <> j.cidade then raise exception 'Os bairros são de cidades diferentes.'; end if;
  update public.bairros
     set apelidos = (select coalesce(array_agg(distinct a), '{}') from unnest(m.apelidos || upper(j.nome) || j.apelidos) a where a <> upper(m.nome)),
         ativo = true, atualizado_em = now(), atualizado_por = public.meu_email()
   where id = m.id returning * into m;
  update public.bairros set ativo = false, apelidos = '{}', atualizado_em = now(), atualizado_por = public.meu_email() where id = j.id;
  return public.json_bairro(m);
end $$;

-- "não são o mesmo bairro": o par deixa de aparecer na lista
create or replace function public.bairros_sao_diferentes(p_a bigint, p_b bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador');
  if p_a = p_b then raise exception 'Escolha dois bairros diferentes.'; end if;
  insert into public.bairros_diferentes (bairro_a, bairro_b, decidido_por)
  values (least(p_a, p_b), greatest(p_a, p_b), public.meu_email()) on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
grant execute on function public.salvar_bairro(bigint, text, text, numeric, numeric, text[], boolean, text, bigint) to authenticated;
grant execute on function public.bairros_parecidos(text) to authenticated;
grant execute on function public.juntar_bairros(bigint, bigint) to authenticated;
grant execute on function public.bairros_sao_diferentes(bigint, bigint) to authenticated;
revoke all on function public.bairro_parecido(text, text, bigint) from public, anon, authenticated;
revoke all on function public.achar_bairro(text, text) from public, anon, authenticated;
revoke all on function public.grau_bairro(text, text) from public, anon, authenticated;
revoke all on function public.distancia_texto(text, text) from public, anon, authenticated;
revoke all on function public.nome_bairro_norm(text) from public, anon, authenticated;
revoke all on function public.numeros_bairro(text) from public, anon, authenticated;
revoke all on function public.nucleo_bairro(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
