-- previa_bloqueio(text,smallint): versão atual (todas as migrações até a 009x rodadas), tirada do banco com pg_get_functiondef.
-- Esta função foi mudada por "remendo" (troca de texto via pg_get_functiondef) em alguma migração, então o corpo
-- inteiro não existia escrito em nenhum arquivo. A partir daqui, mudar esta função = criar uma migração nova com
-- o corpo inteiro (create or replace) e atualizar este arquivo. O teste test:casa confere que o arquivo e o banco
-- são iguais. Rodar este arquivo sozinho no SQL Editor recria a função como está hoje.
CREATE OR REPLACE FUNCTION public.previa_bloqueio(p_id_app text, p_infracao smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id  text := regexp_replace(coalesce(p_id_app, ''), '[^A-Za-z0-9]', '', 'g');
  i     public.infracoes;
  esc   public.infracoes;
  n     integer;
  tot   integer;
  h     numeric;
  lv    integer;
  par   public.parametros_bloqueio;
  conh  record;
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  select * into i from public.infracoes where id = p_infracao;
  select * into par from public.parametros_bloqueio;
  if i.id is not null and length(v_id) >= 4 then
    select c.ocorrencia, c.total into n, tot from public.calcular_ocorrencia(v_id, i.id, now()) c;
    h := public.horas_previstas(i, n);
  end if;
  select * into conh from public.dados_conhecidos(v_id);
  if i.leve and length(v_id) >= 4 then
    lv := public.leves_acumuladas(v_id, now()) + 1;   -- contando com esta
    select * into esc from public.infracoes where id = i.escala_para;
  end if;
  return jsonb_build_object(
    'ocorrencia', n, 'total', tot,
    'reiniciada', coalesce(n < tot, false),
    'janela_dias', i.janela_dias,
    'horas', h, 'encerramento', i.id is not null and n is not null and h is null,
    'fim', case when h is not null then now() + h::double precision * interval '1 hour' end,
    'gera_tratativa', n is not null and not coalesce(i.leve, false) and (h is null or h >= 10),
    'leve', coalesce(i.leve, false),
    'leves', case when lv is null then null else jsonb_build_object(
        'esta_sera', lv, 'limite', par.leves_limite, 'janela_dias', par.leves_janela_dias,
        'gera_bloqueio', lv >= par.leves_limite,
        'bloqueio_infracao', esc.nome,
        'bloqueio_horas', case when esc.id is not null then
            public.horas_previstas(esc, (select c.ocorrencia from public.calcular_ocorrencia(v_id, esc.id, now()) c)) end,
        'bloqueio_encerra', esc.id is not null and public.horas_previstas(esc, (select c.ocorrencia from public.calcular_ocorrencia(v_id, esc.id, now()) c)) is null) end,
    'pendencia', case when not coalesce(i.leve, false) then i.pendencia end,
    'agravante', case when i.agravante is not null and not coalesce(i.leve, false) and n is not null then jsonb_build_object(
        'texto', i.agravante, 'efeito', i.agravante_efeito, 'horas', public.horas_com_agravante(i, n),
        'encerramento', public.horas_com_agravante(i, n) is null) end,
    'nome_conhecido', conh.nome, 'cidade_conhecida', conh.cidade,
    'comentarios', case when length(v_id) >= 4 then public.comentarios_de(v_id, 10) else '[]' end,
    'historico', coalesce((select jsonb_agg(jsonb_build_object(
        'infracao', b.infracao, 'inicio', b.inicio, 'horas', b.horas, 'ocorrencia', b.ocorrencia, 'leve', b.leve,
        'situacao', public.situacao_bloqueio(b), 'fim', b.fim, 'nome', b.nome_entregador, 'cidade', b.cidade,
        'dados_pendentes', b.dados_pendentes, 'registrado_por_nome', b.registrado_por_nome) order by b.inicio desc)
        from public.bloqueios b where lower(b.id_app) = lower(v_id) and length(v_id) >= 4), '[]'),
    'cadastro', (select jsonb_build_object('status', c.status, 'situacao', public.status_texto(c.status), 'enviado_em', c.enviado_em, 'cidade', c.cidade)
                   from public.cadastros c where lower(c.id_app) = lower(v_id) limit 1));
end $function$;
