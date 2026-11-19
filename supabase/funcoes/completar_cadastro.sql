-- completar_cadastro(uuid,text,text,text,text,text,text): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.completar_cadastro(p_cadastro uuid, p_id_app text, p_cpf text, p_nome text, p_cidade text, p_observacao text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c        public.cadastros;
  v_id_app text := nullif(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'), '');
  v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  v_nome   text := nullif(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), '');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_mot    text := nullif(btrim(coalesce(p_motivo, '')), '');
  partes   text[] := '{}';
  muda     text := '';
  v_caso   uuid;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into c from public.cadastros where id = p_cadastro for update;
  if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
  if v_id_app is null and v_cpf is null then raise exception 'O cadastro precisa do ID do entregador.'; end if;
  if v_id_app is not null and length(v_id_app) < 4 then raise exception 'ID muito curto. Confira.'; end if;
  if v_cpf is not null and not public.cpf_valido(v_cpf) then raise exception 'CPF inválido. Confira os 11 números.'; end if;
  if v_cidade !~ '^\S.* - [A-Z]{2}$' then raise exception 'Use o formato CIDADE - UF, ex.: LAGARTO - SE.'; end if;
  if length(coalesce(v_nome, '')) > 120 or length(coalesce(v_obs, '')) > 600 then raise exception 'Texto muito longo.'; end if;
  if exists (select 1 from public.cadastros x where x.id <> c.id and
             ((v_cpf is not null and x.cpf = v_cpf) or (v_id_app is not null and lower(x.id_app) = lower(v_id_app)))) then
    raise exception 'Outro cadastro já usa este ID.';
  end if;

  if v_id_app is distinct from c.id_app then partes := array_append(partes, format('ID: %s → %s', coalesce(c.id_app, '(vazio)'), coalesce(v_id_app, '(vazio)'))); end if;
  if v_cpf is distinct from c.cpf then partes := array_append(partes, format('CPF: %s → %s', coalesce(public.fmt_cpf(c.cpf), '(vazio)'), coalesce(public.fmt_cpf(v_cpf), '(vazio)'))); end if;
  if v_nome is distinct from c.nome then partes := array_append(partes, format('nome: %s → %s', coalesce(c.nome, '(vazio)'), coalesce(v_nome, '(vazio)'))); end if;
  if v_cidade is distinct from c.cidade then partes := array_append(partes, format('cidade: %s → %s', c.cidade, v_cidade)); end if;
  if v_obs is distinct from c.observacao then partes := array_append(partes, 'observação alterada'); end if;
  if cardinality(partes) = 0 then raise exception 'Nada foi alterado.'; end if;
  muda := array_to_string(partes, ' · ') || case when v_mot is not null then ' · motivo: ' || v_mot else '' end;

  update public.cadastros set id_app = v_id_app, cpf = v_cpf, nome = v_nome, cidade = v_cidade, observacao = v_obs,
         revisado = case when v_id_app is distinct from c.id_app or v_nome is distinct from c.nome then false else revisado end
   where id = c.id;
  insert into public.eventos (cadastro_id, tipo, status_anterior, status_novo, por, detalhe)
  values (c.id, 'editado', c.status, c.status, auth.uid(), left(muda, 1200));
  perform public.concluir_tarefas_cadastro(c.id);
  -- cadastro aprovado que teve o nome ou o ID trocado (completar o que faltava não conta)
  if c.status = 'aprovado' and ((c.id_app is not null and lower(c.id_app) is distinct from lower(v_id_app))
                             or (c.nome is not null and public.norm_nome(c.nome) is distinct from public.norm_nome(v_nome))) then
    v_caso := public.abrir_caso('troca_aprovado', 'atencao', c.id, null, v_cpf, v_id_app, v_nome, v_cidade,
      format('Cadastro APROVADO teve os dados trocados: %s (ID %s) → %s (ID %s).',
        coalesce(c.nome, '(sem nome)'), coalesce(c.id_app, '—'), coalesce(v_nome, '(sem nome)'), coalesce(v_id_app, '—')));
  end if;
  return jsonb_build_object('revisar', public.motivo_revisar_cadastro((select x from public.cadastros x where x.id = c.id)), 'caso', v_caso);
exception when unique_violation then
  raise exception 'Outro cadastro já usa este ID.' using errcode = '23505';
end $function$;
