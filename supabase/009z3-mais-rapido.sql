-- 009z3 "Mais rápido de achar" (20/11/2026, spec aprovada pelo usuário)
-- AT5: Toda a equipe (listar_registros) juntava o histórico inteiro dos três tipos para devolver 100 linhas; agora
--      cada parte já vem ordenada e cortada no limite antes de juntar (quando não há busca nem filtro de pessoa),
--      com índices pela data. O resultado é o mesmo.
-- AT8: limpar_avisos_antigos(p_apagar): avisos já lidos com mais de 120 dias (decisão do usuário). Sem p_apagar,
--      só conta. Só moderador. Eventos e comentários são o histórico e não são apagados.
-- Pode rodar mais de uma vez.

create index if not exists eventos_em_idx on public.eventos (em desc, id desc);
create index if not exists eventos_bloqueio_em_idx on public.eventos_bloqueio (em desc, id desc);
create index if not exists comentarios_entregador_em_idx on public.comentarios_entregador (em desc, id desc);
create index if not exists notificacoes_lidas_antigas_idx on public.notificacoes (criada_em) where lida_em is not null;

CREATE OR REPLACE FUNCTION public.listar_registros(p_antes timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limite integer DEFAULT 100, p_modulo text DEFAULT NULL::text, p_pessoa text DEFAULT NULL::text, p_busca text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  bq  boolean := public.meu_papel_bloq() is not null;
  q   text := nullif(btrim(coalesce(p_busca, '')), '');
  lim integer := least(greatest(coalesce(p_limite, 100), 1), 300);
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.em desc, r.chave desc) from (
    select * from (
      -- ativação
      (select 'a' || e.id chave, e.em, 'ativacao' modulo, e.tipo,
             public.nome_de(e.por) por_nome,
             case e.tipo when 'enviado' then 'enviou o cadastro' when 'aprovado' then 'aprovou o cadastro'
                         when 'reprovado' then 'reprovou o cadastro' when 'encerrado' then 'encerrou o cadastro'
                         when 'desfeito' then 'desfez a decisão do cadastro' else e.tipo end acao,
             concat_ws(' · ', case when e.motivo is not null then e.motivo end, e.detalhe) detalhe,
             c.id_app, c.cpf, null::text nome, c.cidade
        from public.eventos e join public.cadastros c on c.id = e.cadastro_id
       where (p_antes is null or e.em < p_antes) and (p_modulo is null or p_modulo = 'ativacao')
       order by e.em desc, e.id desc limit case when q is null and p_pessoa is null then lim end)
      union all
      -- bloqueios
      (select 'b' || e.id, e.em, 'bloqueios', e.tipo, coalesce(e.por_nome, b.registrado_por_nome),
             case e.tipo
               when 'registrado' then case when b.leve then 'registrou infração leve' when b.importado then 'registrou (planilha)' else 'registrou bloqueio' end
               when 'liberado_antes' then case when b.horas is null then 'reverteu o encerramento' else 'liberou antes do prazo' end
               when 'tratativa_concluida' then 'concluiu a tratativa'
               when 'corrigido' then 'corrigiu os dados' when 'revisado' then 'marcou como revisado'
               when 'realocada' then 'realocou a tratativa' else e.tipo end,
             concat_ws(' · ', b.infracao, e.detalhe),
             b.id_app, null, b.nome_entregador, b.cidade
        from public.eventos_bloqueio e join public.bloqueios b on b.id = e.bloqueio_id
       where bq and (p_antes is null or e.em < p_antes) and (p_modulo is null or p_modulo = 'bloqueios')
       order by e.em desc, e.id desc limit case when q is null and p_pessoa is null then lim end)
      union all
      -- comentários e alterações do cadastro do entregador
      (select 'c' || k.id, k.em, 'bloqueios', k.tipo, k.por_nome,
             case k.tipo when 'alteracao' then 'alterou dados do entregador' else 'comentou sobre o entregador' end,
             k.texto, k.id_app, null, (select e.nome from public.entregadores e where e.id_app = k.id_app), null
        from public.comentarios_entregador k
       where bq and (p_antes is null or k.em < p_antes) and (p_modulo is null or p_modulo = 'bloqueios')
       order by k.em desc, k.id desc limit case when q is null and p_pessoa is null then lim end)
    ) x
    where (p_antes is null or x.em < p_antes)
      and (p_modulo is null or x.modulo = p_modulo)
      and (p_pessoa is null or x.por_nome = p_pessoa)
      and (q is null or concat_ws(' ', x.por_nome, x.acao, x.detalhe, x.id_app, x.cpf, x.nome, x.cidade) ilike '%' || q || '%'
                     or x.cpf = nullif(regexp_replace(q, '\D', '', 'g'), ''))
    order by x.em desc, x.chave desc
    limit lim) r), '[]');
end $function$;

create or replace function public.limpar_avisos_antigos(p_apagar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.sou_moderador() then raise exception 'Só um moderador pode limpar os avisos antigos.' using errcode = '42501'; end if;
  if coalesce(p_apagar, false) then
    delete from public.notificacoes where lida_em is not null and criada_em < now() - interval '120 days';
    get diagnostics n = row_count;
  else
    select count(*) into n from public.notificacoes where lida_em is not null and criada_em < now() - interval '120 days';
  end if;
  return jsonb_build_object('avisos', n, 'apagados', coalesce(p_apagar, false), 'dias', 120);
end $$;

revoke all on function public.limpar_avisos_antigos(boolean) from public, anon;
grant execute on function public.limpar_avisos_antigos(boolean) to authenticated;
revoke all on function public.listar_registros(timestamptz, integer, text, text, text) from public, anon;
grant execute on function public.listar_registros(timestamptz, integer, text, text, text) to authenticated;

notify pgrst, 'reload schema';
