-- 009s "Sem CPF" (pedido do usuário, 14/11/2026, opção c: apagar de vez).
-- O Comunique deixa de guardar CPF (LGPD):
--   1. nenhum CPF novo é gravado: o gatilho aaa_cadastro_sem_cpf zera a coluna em todo insert/update;
--   2. cadastro novo exige o ID do entregador (a regra antiga "ID ou CPF" sai);
--   3. os CPFs já guardados são apagados (cadastros e casos) e os escritos em textos e jsonb
--      (avisos, eventos, comentários, detalhes) viram "[CPF removido]";
--   4. as mensagens de erro deixam de citar CPF.
-- As funções antigas continuam aceitando p_cpf (para não quebrar quem chamar), mas o valor é descartado.
-- Pode rodar de novo. Não tem volta: os CPFs apagados não são recuperáveis.

-- 1 e 2: gatilho que roda antes de todos os outros (ordem alfabética)
create or replace function public.cadastro_sem_cpf()
returns trigger language plpgsql set search_path = public as $$
begin
  new.cpf := null;
  if tg_op = 'INSERT' and new.id_app is null then
    raise exception 'Preencha o ID do entregador.';
  end if;
  if tg_op = 'UPDATE' and new.id_app is null and old.id_app is not null then
    raise exception 'O cadastro precisa do ID do entregador.';
  end if;
  return new;
end $$;

drop trigger if exists aaa_cadastro_sem_cpf on public.cadastros;
create trigger aaa_cadastro_sem_cpf before insert or update on public.cadastros
  for each row execute function public.cadastro_sem_cpf();

-- a regra antiga "ID ou CPF" (cadastros antigos só com CPF ficam sem os dois, identificados pelo nome)
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.cadastros'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%id_app IS NOT NULL%cpf IS NOT NULL%'
  loop
    execute format('alter table public.cadastros drop constraint %I', r.conname);
  end loop;
end $$;

-- 3: apagar o que já está guardado
update public.cadastros set cpf = null where cpf is not null;

do $$
begin
  if to_regclass('public.casos') is not null then
    execute 'update public.casos set cpf = null where cpf is not null';
  end if;
end $$;

-- CPF escrito em textos e jsonb de qualquer tabela: formatado (000.000.000-00) ou depois da palavra CPF
do $$
declare r record; n bigint;
  pad_fmt constant text := '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}';
  pad_rot constant text := '(CPF[^0-9]{0,4})[0-9]{11}';
  pad_json constant text := '"cpf": *"[0-9]{11}"';
begin
  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.data_type in ('text', 'jsonb', 'character varying') and c.column_name <> 'cpf'
  loop
    if r.data_type = 'jsonb' then
      execute format($f$update public.%I set %I = regexp_replace(regexp_replace(regexp_replace(%I::text, %L, '[CPF removido]', 'g'),
                       %L, '\1[CPF removido]', 'gi'), %L, '"cpf": null', 'g')::jsonb
                      where %I::text ~ %L or %I::text ~* %L or %I::text ~ %L$f$,
        r.table_name, r.column_name, r.column_name, pad_fmt, pad_rot, pad_json,
        r.column_name, pad_fmt, r.column_name, pad_rot, r.column_name, pad_json);
    else
      execute format($f$update public.%I set %I = regexp_replace(regexp_replace(%I, %L, '[CPF removido]', 'g'), %L, '\1[CPF removido]', 'gi')
                      where %I ~ %L or %I ~* %L$f$,
        r.table_name, r.column_name, r.column_name, pad_fmt, pad_rot, r.column_name, pad_fmt, r.column_name, pad_rot);
    end if;
    get diagnostics n = row_count;
    if n > 0 then raise notice 'CPF removido de %.%: % linha(s)', r.table_name, r.column_name, n; end if;
  end loop;
end $$;

-- 4: mensagens de erro sem CPF (troca só o texto dentro das funções, sem reescrever a lógica)
do $$
declare r record; def text; novo text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prokind = 'f'
       and (p.prosrc like '%Este CPF ou ID já está cadastrado.%' or p.prosrc like '%Outro cadastro já usa este ID ou CPF.%'
         or p.prosrc like '%Preencha o ID do entregador ou o CPF.%' or p.prosrc like '%O cadastro precisa de um ID ou de um CPF.%')
  loop
    def := pg_get_functiondef(r.oid);
    novo := replace(replace(replace(replace(def,
      'Este CPF ou ID já está cadastrado.', 'Este ID já está cadastrado.'),
      'Outro cadastro já usa este ID ou CPF.', 'Outro cadastro já usa este ID.'),
      'Preencha o ID do entregador ou o CPF.', 'Preencha o ID do entregador.'),
      'O cadastro precisa de um ID ou de um CPF.', 'O cadastro precisa do ID do entregador.');
    if novo <> def then execute novo; end if;
  end loop;
end $$;

revoke all on function public.cadastro_sem_cpf() from public, anon, authenticated;
