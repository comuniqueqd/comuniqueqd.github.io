-- aguardar_terceiro(uuid,text): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.aguardar_terceiro(p_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.atividades;
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  select * into a from public.atividades where id = p_id for update;
  if a.id is null or a.status <> 'aceita' then raise exception 'Só uma tarefa em andamento pode esperar alguém.'; end if;
  if not public.participa(a) and public.meu_papel() <> 'moderador' then
    raise exception 'Só quem está com a tarefa muda isso.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is not null then
    if a.aguardando_desde is not null then raise exception 'A tarefa já está aguardando.'; end if;
    update public.atividades set aguardando_desde = now(), aguardando_motivo = left(btrim(p_motivo), 300) where id = a.id;
  else
    if a.aguardando_desde is null then raise exception 'A tarefa não está aguardando.'; end if;
    -- o prazo anda junto com a pausa
    update public.atividades set pausa_seg = pausa_seg + extract(epoch from now() - aguardando_desde)::int,
           prazo = case when prazo is null then null else prazo + (now() - aguardando_desde) end,
           aguardando_desde = null, aguardando_motivo = null
     where id = a.id;
  end if;
end $function$;
