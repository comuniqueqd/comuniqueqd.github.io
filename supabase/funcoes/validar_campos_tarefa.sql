-- validar_campos_tarefa(text,jsonb): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.validar_campos_tarefa(p_tipo text, p_campos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c jsonb := coalesce(p_campos, '{}');
  saida jsonb := '{}';
  k text;
  v text;
  n numeric;
  obrig text[];
  opc text[];
begin
  if jsonb_typeof(c) <> 'object' then raise exception 'Campos inválidos.'; end if;
  case p_tipo
    when 'ativar_entregadores', 'ativar_parceiro' then obrig := array['cidade', 'quantidade']; opc := array['motivo'];
    when 'fazer_contato' then obrig := array['contato', 'cidade', 'motivo']; opc := array['telefone'];
    when 'contato_entregador' then obrig := array['id_app', 'tratativa']; opc := array['motivo', 'detalhe'];
    when 'pedido_problema' then obrig := array['pedido', 'cidade', 'problema']; opc := array[]::text[];
    when 'pagamento_entregador' then obrig := array['id_app', 'valor', 'motivo']; opc := array[]::text[];
    when 'revisar_registro' then obrig := array['referencia', 'motivo']; opc := array[]::text[];
    when 'criar_comunicado' then obrig := array['cidade', 'motivo']; opc := array[]::text[];
    when 'procurar_entregador' then obrig := array['cidade']; opc := array['detalhe'];
    when 'livre' then obrig := array[]::text[]; opc := array[]::text[];
    else raise exception 'Tipo de tarefa desconhecido.';
  end case;
  foreach k in array obrig || opc loop
    v := nullif(btrim(coalesce(c->>k, '')), '');
    if v is null then
      if k = any (obrig) then
        raise exception 'Preencha: %.', case k when 'cidade' then 'a cidade' when 'quantidade' then 'a quantidade' when 'contato' then 'o nome da pessoa ou do estabelecimento'
          when 'motivo' then 'o motivo' when 'id_app' then 'o ID do entregador' when 'tratativa' then 'se é tratativa' when 'pedido' then 'o código do pedido'
          when 'problema' then 'o problema' when 'valor' then 'o valor' when 'referencia' then 'o registro a revisar' else k end;
      end if;
      continue;
    end if;
    if length(v) > 600 then raise exception 'Um dos campos passou de 600 caracteres.'; end if;
    if k = 'quantidade' then
      begin n := v::numeric; exception when others then raise exception 'A quantidade precisa ser um número.'; end;
      if n < 1 or n > 1000 or n <> trunc(n) then raise exception 'A quantidade vai de 1 a 1000.'; end if;
      saida := saida || jsonb_build_object(k, n::int);
    elsif k = 'valor' then
      begin n := replace(v, ',', '.')::numeric; exception when others then raise exception 'O valor precisa ser um número.'; end;
      if n <= 0 or n > 100000 then raise exception 'O valor precisa ser maior que zero.'; end if;
      saida := saida || jsonb_build_object(k, round(n, 2));
    elsif k = 'tratativa' then
      if v not in ('true', 'false', 'sim', 'nao', 'não') then raise exception 'Diga se é tratativa.'; end if;
      saida := saida || jsonb_build_object(k, v in ('true', 'sim'));
    elsif k = 'id_app' then
      if v !~ '^[A-Za-z0-9]{4,40}$' then raise exception 'O ID do entregador tem só letras e números (4 a 40).'; end if;
      saida := saida || jsonb_build_object(k, lower(v));
    elsif k = 'cidade' then
      saida := saida || jsonb_build_object(k, upper(v));
    else
      saida := saida || jsonb_build_object(k, v);
    end if;
  end loop;
  if p_tipo = 'contato_entregador' and not (saida->>'tratativa')::boolean
     and not coalesce(saida->>'motivo' = any (public.motivos_contato_entregador()), false) then
    raise exception 'Escolha o motivo do contato.';
  end if;
  return saida;
end $function$;
