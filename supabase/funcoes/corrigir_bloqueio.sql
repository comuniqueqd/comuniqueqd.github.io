-- corrigir_bloqueio(uuid,text,text,text,text): versão atual (todas as migrações até a 009z5 rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.corrigir_bloqueio(p_bloqueio uuid, p_id_app text, p_nome text, p_cidade text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b        public.bloqueios;
  v_id     text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_cidade text := nullif(upper(regexp_replace(btrim(coalesce(p_cidade, '')), '\s+', ' ', 'g')), '');
  v_mot    text := nullif(btrim(coalesce(p_motivo, '')), '');
  quem     text := (select nome from public.membros where email = public.meu_email());
  mudou    boolean;
  partes   text[] := '{}';
  detalhe  text;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into b from public.bloqueios where id = p_bloqueio for update;
  if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;
  if public.meu_papel_bloq() = 'suporte' and b.revisar is null and b.registrado_por is distinct from auth.uid() then
    raise exception 'O suporte corrige só os registros marcados “revisar” ou os que ele mesmo registrou.';
  end if;
  if b.dados_pendentes then raise exception 'Este registro está sem nome e cidade: use "Completar dados" na tarefa.'; end if;
  if length(v_id) < 4 then raise exception 'Preencha o ID do entregador.'; end if;
  if not public.nome_valido(v_nome) or length(v_nome) > 120 then raise exception 'Preencha o nome do entregador.'; end if;
  if v_cidade is null and b.cidade is not null then raise exception 'Escolha a cidade.'; end if;
  if v_cidade is not null and not exists (select 1 from public.cidades where nome = v_cidade) then
    raise exception 'Escolha uma cidade da lista.';
  end if;
  mudou := v_id <> b.id_app or v_nome <> b.nome_entregador or v_cidade is distinct from b.cidade;
  if mudou and v_mot is null then raise exception 'Informe o motivo da correção.'; end if;
  if not mudou and b.revisar is null then raise exception 'Nada foi alterado.'; end if;

  if v_id <> b.id_app then partes := partes || format('ID: %s → %s', b.id_app, v_id); end if;
  if v_nome <> b.nome_entregador then partes := partes || format('nome: %s → %s', b.nome_entregador, v_nome); end if;
  if v_cidade is distinct from b.cidade then partes := partes || format('cidade: %s → %s', coalesce(b.cidade, '(sem cidade)'), v_cidade); end if;
  if b.revisar is not null then partes := partes || ('alerta resolvido: ' || b.revisar); end if;
  if v_mot is not null then partes := partes || ('motivo: ' || v_mot); end if;
  detalhe := left(array_to_string(partes, ' · '), 1200);

  update public.bloqueios set id_app = v_id, nome_entregador = v_nome, cidade = v_cidade, revisar = null where id = b.id;
  insert into public.eventos_bloqueio (bloqueio_id, tipo, por, por_nome, detalhe)
  values (b.id, case when mudou then 'corrigido' else 'revisado' end, auth.uid(), quem, detalhe);
  if v_cidade is distinct from b.cidade then
    update public.tarefas set cidade = v_cidade, responsavel_email = public.responsavel_da_cidade(v_cidade)
     where bloqueio_id = b.id and status = 'pendente' and tipo <> 'completar_dados';
  end if;
  if mudou then
    perform public.anotar_entregador(v_id, 'alteracao',
      format('Restrição de %s (%s) corrigida. %s', to_char(b.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), b.infracao, detalhe), b.id);
    if lower(v_id) <> lower(b.id_app) then
      perform public.anotar_entregador(b.id_app, 'alteracao',
        format('Restrição de %s (%s) passou para o ID %s. %s', to_char(b.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), b.infracao, v_id, detalhe), b.id);
    end if;
  end if;
  return public.json_bloqueio((select x from public.bloqueios x where x.id = b.id));
end $function$;
