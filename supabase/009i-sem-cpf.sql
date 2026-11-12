-- 009i: o Comunique deixa de usar CPF (pedido do usuário: "tira todos os CPFs do sistema",
-- com os já gravados APAGADOS DE VEZ). O ID do entregador passa a ser obrigatório no cadastro.
--   1. apaga o CPF de todos os cadastros e casos, e o CPF escrito em textos já gravados
--      (avisos, eventos, tarefas, comentários, observações...);
--   2. o banco passa a recusar CPF (a coluna continua, sempre vazia, para não quebrar a visão
--      vw_cadastros e as funções antigas que ainda leem o campo);
--   3. enviar_cadastro e completar_cadastro exigem o ID e ignoram o CPF; os avisos sem ID dizem
--      "(sem ID)" no lugar do CPF.
-- Não tem volta. Pode rodar de novo. Rodar a 007 ou a 008 de novo exige rodar esta depois.

-- ---------------------------------------------------------------------
-- 1. Apaga os CPFs
-- ---------------------------------------------------------------------
alter table public.cadastros drop constraint if exists cadastros_check;   -- (id_app ou cpf): sai, o ID é exigido pelas funções
alter table public.cadastros drop constraint if exists cadastros_sem_cpf;
alter table public.casos drop constraint if exists casos_sem_cpf;

do $$
declare
  n_cad integer; n_sem_id integer; n_casos integer := 0; n_txt integer := 0; n integer; r record;
  -- "CPF 123.456.789-01", "CPF: 12345678901" e o CPF formatado solto
  pad_rotulo constant text := 'CPF\s*:?\s*\d{3}\.?\d{3}\.?\d{3}-?\d{2}';
  pad_solto  constant text := '\d{3}\.\d{3}\.\d{3}-\d{2}';
begin
  select count(*) filter (where cpf is not null), count(*) filter (where cpf is not null and id_app is null)
    into n_cad, n_sem_id from public.cadastros;
  update public.cadastros set cpf = null where cpf is not null;
  if to_regclass('public.casos') is not null then
    update public.casos set cpf = null where cpf is not null;
    get diagnostics n_casos = row_count;
  end if;
  -- CPF escrito em qualquer texto (ou jsonb) das tabelas do app
  for r in select c.table_name, c.column_name, c.data_type
             from information_schema.columns c
             join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
            where c.table_schema = 'public' and c.data_type in ('text', 'jsonb') and c.column_name <> 'cpf'
              and c.table_name not in ('anexos') loop
    if r.data_type = 'jsonb' then
      execute format($q$update public.%I set %I = regexp_replace(regexp_replace(%I::text, %L, 'CPF removido', 'gi'), %L, '(CPF removido)', 'g')::jsonb
                         where %I::text ~* %L or %I::text ~ %L$q$,
                     r.table_name, r.column_name, r.column_name, pad_rotulo, pad_solto, r.column_name, pad_rotulo, r.column_name, pad_solto);
    else
      execute format($q$update public.%I set %I = regexp_replace(regexp_replace(%I, %L, 'CPF removido', 'gi'), %L, '(CPF removido)', 'g')
                         where %I ~* %L or %I ~ %L$q$,
                     r.table_name, r.column_name, r.column_name, pad_rotulo, pad_solto, r.column_name, pad_rotulo, r.column_name, pad_solto);
    end if;
    get diagnostics n = row_count;
    n_txt := n_txt + n;
  end loop;
  raise notice '009i: CPF apagado de % cadastro(s) (% sem ID: ficam marcados para revisar) e de % caso(s); % texto(s) limpos.',
    n_cad, n_sem_id, n_casos, n_txt;
end $$;

-- 2. daqui em diante, nenhum CPF entra
alter table public.cadastros add constraint cadastros_sem_cpf check (cpf is null);
do $$ begin
  if to_regclass('public.casos') is not null then
    alter table public.casos add constraint casos_sem_cpf check (cpf is null);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Funções: ID obrigatório, CPF ignorado (troca de trechos, conferindo que cada um existe)
-- ---------------------------------------------------------------------
do $$
declare
  t record; def text; novo text;
begin
  for t in select * from (values
    ('public.enviar_cadastro(text, text, text, text, text)',
       $a$v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');$a$,
       $b$v_cpf    text := null;  -- 009i: o Comunique não usa mais CPF$b$),
    ('public.enviar_cadastro(text, text, text, text, text)',
       $a$if v_id_app is null and v_cpf is null then raise exception 'Preencha o ID do entregador ou o CPF.'; end if;$a$,
       $b$if v_id_app is null then raise exception 'Preencha o ID do entregador.'; end if;$b$),
    ('public.enviar_cadastro(text, text, text, text, text)',
       $a$'Este CPF ou ID já está cadastrado.'$a$, $b$'Este ID já está cadastrado.'$b$),
    ('public.completar_cadastro(uuid, text, text, text, text, text, text)',
       $a$v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');$a$,
       $b$v_cpf    text := null;  -- 009i: o Comunique não usa mais CPF$b$),
    ('public.completar_cadastro(uuid, text, text, text, text, text, text)',
       $a$if v_id_app is null and v_cpf is null then raise exception 'O cadastro precisa de um ID ou de um CPF.'; end if;$a$,
       $b$if v_id_app is null then raise exception 'O cadastro precisa do ID do entregador.'; end if;$b$),
    ('public.completar_cadastro(uuid, text, text, text, text, text, text)',
       $a$raise exception 'Outro cadastro já usa este ID ou CPF.';$a$, $b$raise exception 'Outro cadastro já usa este ID.';$b$),
    ('public.completar_cadastro(uuid, text, text, text, text, text, text)',
       $a$raise exception 'Outro cadastro já usa este ID ou CPF.' using errcode$a$, $b$raise exception 'Outro cadastro já usa este ID.' using errcode$b$),
    ('public.avisar_cadastro_novo()', $a$'CPF ' || new.cpf$a$, $b$'(sem ID)'$b$),
    ('public.avisar_decisao()', $a$'CPF ' || public.fmt_cpf(c.cpf)$a$, $b$'(sem ID)'$b$),
    ('public.criar_tarefa_cadastro(uuid, uuid)', $a$'CPF ' || public.fmt_cpf(c.cpf)$a$, $b$'(sem ID)'$b$)
  ) v(fn, de, para) loop
    def := pg_get_functiondef(t.fn::regprocedure);
    if position(t.para in def) > 0 then continue; end if;          -- já trocado (rodando de novo)
    if position(t.de in def) = 0 then raise exception '009i: trecho não encontrado em %: %', t.fn, left(t.de, 60); end if;
    novo := replace(def, t.de, t.para);
    execute novo;
  end loop;
end $$;

notify pgrst, 'reload schema';
