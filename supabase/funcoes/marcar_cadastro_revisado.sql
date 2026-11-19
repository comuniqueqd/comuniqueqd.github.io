-- marcar_cadastro_revisado(uuid): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.marcar_cadastro_revisado(p_cadastro uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.cadastros;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into c from public.cadastros where id = p_cadastro for update;
  if c.id is null then raise exception 'Cadastro não encontrado.'; end if;
  if c.nome is null or c.id_app is null then raise exception 'Ainda falta o nome ou o ID: complete os dados.'; end if;
  update public.cadastros set revisado = true where id = c.id;
  insert into public.eventos (cadastro_id, tipo, status_anterior, status_novo, por, detalhe)
  values (c.id, 'revisado', c.status, c.status, auth.uid(), 'Dados conferidos: ' || coalesce(public.motivo_revisar_cadastro(c), 'ok'));
  perform public.concluir_tarefas_cadastro(c.id);
end $function$;
