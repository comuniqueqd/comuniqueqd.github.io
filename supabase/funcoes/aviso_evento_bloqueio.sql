-- aviso_evento_bloqueio(): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.aviso_evento_bloqueio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.bloqueios; quem text;
begin
  select * into b from public.bloqueios where id = new.bloqueio_id;
  if b.id is null then return null; end if;
  quem := coalesce(new.por_nome, public.nome_de(new.por), 'Alguém');
  perform public.avisar_registro('bloqueios',
    format('%s %s: %s (%s) · %s%s', quem,
      case new.tipo
        when 'registrado' then case when b.leve then 'registrou uma infração leve' else 'registrou um bloqueio' end
        when 'liberado_antes' then case when b.horas is null then 'reverteu o encerramento' else 'liberou antes do prazo' end
        when 'tratativa_concluida' then 'concluiu a tratativa'
        when 'corrigido' then 'corrigiu os dados do bloqueio' when 'revisado' then 'marcou o bloqueio como revisado'
        when 'realocada' then 'realocou a tratativa' when 'pendencia_resolvida' then 'marcou como resolvido (' || lower(coalesce(new.detalhe, 'pendência')) || ')' else new.tipo end,
      case when b.dados_pendentes then 'sem nome' else b.nome_entregador end, b.id_app, b.infracao,
      case when b.cidade is not null then ' · ' || b.cidade else '' end),
    '#ficha/' || lower(b.id_app), b.cidade, b.id_app, true, b.leve and new.tipo = 'registrado');
  return null;
end $function$;
