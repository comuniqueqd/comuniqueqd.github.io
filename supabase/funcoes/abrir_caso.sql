-- abrir_caso(text,text,uuid,uuid,text,text,text,text,text): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.abrir_caso(p_tipo text, p_nivel text, p_cadastro uuid, p_novo uuid, p_cpf text, p_id_app text, p_nome text, p_cidade text, p_detalhe text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  novo uuid;
  quem text := coalesce(public.nome_por_email(public.meu_email()), 'Sistema');
begin
  -- casos guardados para depois: com o interruptor desligado, não abre caso nem avisa ninguém
  if not coalesce((select ligado from public.parametros_casos where unico), false) then return null; end if;
  select k.id into novo from public.casos k
   where k.status = 'aberto' and k.tipo = p_tipo and k.cadastro_id is not distinct from p_cadastro
     and k.cpf is not distinct from p_cpf and lower(coalesce(k.id_app, '')) = lower(coalesce(p_id_app, ''))
     and coalesce(public.norm_nome(k.nome), '') = coalesce(public.norm_nome(p_nome), '')
   limit 1;
  if novo is not null then
    if p_novo is not null then update public.casos set novo_cadastro_id = p_novo where id = novo and novo_cadastro_id is null; end if;
    return novo;
  end if;
  insert into public.casos (tipo, nivel, cadastro_id, novo_cadastro_id, cpf, id_app, nome, cidade, detalhe, criado_por, criado_por_nome)
  values (p_tipo, p_nivel, p_cadastro, p_novo, p_cpf, p_id_app, p_nome, p_cidade, p_detalhe, auth.uid(), quem)
  returning id into novo;
  insert into public.notificacoes (para, texto, link)
  select m.user_id, format('🕵️ Caso suspeito%s aberto por %s: %s', case when p_nivel = 'forte' then ' (sinal forte)' else '' end, quem, p_detalhe), '#casos'
    from public.membros m where m.user_id is not null and m.user_id is distinct from auth.uid();
  return novo;
end $function$;
