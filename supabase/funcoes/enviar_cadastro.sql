-- enviar_cadastro(text,text,text,text,text): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.enviar_cadastro(p_id_app text, p_cpf text, p_cidade text, p_observacao text DEFAULT NULL::text, p_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id_app text := nullif(regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g'), '');
  v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), '');
  v_cidade text := upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g'));
  v_obs    text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_nome   text := nullif(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'), '');
  ja       public.cadastros;
  s        record;
  novo     uuid;
  v_caso   uuid;
  v_nivel  text;
  v_det    text;
  msg      text;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if v_id_app is null and v_cpf is null then raise exception 'Preencha o ID do entregador.'; end if;
  if v_id_app is not null and length(v_id_app) < 4 then raise exception 'ID muito curto. Confira.'; end if;
  if v_cpf is not null and not public.cpf_valido(v_cpf) then raise exception 'CPF inválido. Confira os 11 números.'; end if;
  if v_cidade !~ '^\S.* - [A-Z]{2}$' then raise exception 'Use o formato CIDADE - UF, ex.: LAGARTO - SE.'; end if;
  if length(coalesce(v_nome, '')) > 120 then raise exception 'Nome muito longo.'; end if;

  select * into ja from public.cadastros
   where (v_cpf is not null and cpf = v_cpf) or (v_id_app is not null and lower(id_app) = lower(v_id_app)) limit 1;
  if ja.id is not null then
    msg := format('Este %s já está cadastrado (situação: %s, enviado em %s).',
      case when v_cpf is not null and ja.cpf = v_cpf then 'CPF' else 'ID' end,
      public.status_texto(ja.status), to_char(ja.enviado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'));
    -- CPF repetido com outro nome ou ID: a tentativa vira caso (e a resposta não é erro, para o caso ficar gravado)
    for s in select * from public.sinais_cadastro(v_cpf, v_id_app, v_nome) x where x.cadastro_id is not distinct from ja.id loop
      v_caso := public.abrir_caso(s.tipo, s.nivel, s.cadastro_id, null, v_cpf, v_id_app, v_nome, v_cidade, s.detalhe);
      v_nivel := s.nivel; v_det := s.detalhe;
      exit;
    end loop;
    if v_caso is null then raise exception '%', msg; end if;
    return jsonb_build_object('id', null, 'caso', v_caso, 'nivel', v_nivel, 'detalhe', v_det, 'erro', msg);
  end if;

  insert into public.cadastros (id_app, cpf, cidade, observacao, enviado_por, nome)
  values (v_id_app, v_cpf, v_cidade, v_obs, auth.uid(), v_nome)
  returning id into novo;
  insert into public.eventos (cadastro_id, tipo, status_novo, por)
  values (novo, 'enviado', 'aguardando_analise', auth.uid());
  if public.motivo_revisar_cadastro((select c from public.cadastros c where c.id = novo)) is not null then
    perform public.criar_tarefa_cadastro(novo, null);
  end if;
  -- entregador encerrado tentando voltar com outro ID
  for s in select * from public.sinais_cadastro(v_cpf, v_id_app, v_nome, novo) loop
    v_caso := public.abrir_caso(s.tipo, s.nivel, s.cadastro_id, novo, v_cpf, v_id_app, v_nome, v_cidade, s.detalhe);
    v_nivel := s.nivel; v_det := s.detalhe;
    exit;
  end loop;
  return jsonb_build_object('id', novo, 'caso', v_caso, 'nivel', v_nivel, 'detalhe', v_det);
exception when unique_violation then
  raise exception 'Este ID já está cadastrado.' using errcode = '23505';
end $function$;
