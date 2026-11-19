-- agradecer_tarefa(uuid): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.agradecer_tarefa(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.atividades; quem text := public.nome_de(auth.uid());
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id;
  if a.id is null or a.status <> 'concluida' or a.aceita_por is null then raise exception 'Só dá para agradecer uma tarefa concluída.'; end if;
  if a.aceita_por = auth.uid() then raise exception 'Você não pode agradecer a si mesmo.'; end if;
  if exists (select 1 from public.agradecimentos where atividade_id = a.id and de = auth.uid()) then
    delete from public.agradecimentos where atividade_id = a.id and de = auth.uid();
    return false;
  end if;
  insert into public.agradecimentos (atividade_id, de, de_nome, para) values (a.id, auth.uid(), quem, a.aceita_por);
  perform public.notificar(a.aceita_por, format('%s agradeceu por: %s', quem, a.titulo), '#atividades/sugeridas');
  return true;
end $function$;
