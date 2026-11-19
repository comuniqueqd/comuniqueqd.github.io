-- 009u "Mesa arrumada" (grupos 1 e 2 do mapa, pedido do usuário em 19/11/2026).
--   S3: CPF escrito em texto livre (comentários, observações, avisos, passagem de turno, tarefas…) vira
--       "[CPF removido]" já na gravação, com a mesma regra da 009s (formatado 000.000.000-00, ou 11 dígitos
--       logo depois da palavra CPF). Telefones ficam (decisão do usuário).
--   A4: quem_e(p_id_app) diz de quem é o ID (nome e cidade da ficha) para o formulário do adicional, que
--       é de todos os papéis da ativação (a busca rápida só traz fichas para quem tem o módulo de bloqueios).
--   Avisos sem o código do entregador (aviso_sem_id + gatilho aac_aviso_sem_id em notificacoes), sem emoji no agradecimento.
--   AT1: entregadores_atencao() sem o custo quadrático (mesmo resultado).
-- Só funções e gatilhos novos. Pode rodar de novo.

create or replace function public.texto_sem_cpf(t text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(t, '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}', '[CPF removido]', 'g'),
                        '(CPF[^0-9]{0,4})[0-9]{11}', '\1[CPF removido]', 'gi')
$$;

-- gatilho genérico: passa a regra em toda coluna de texto (e nos textos dentro de jsonb) da linha
create or replace function public.linha_sem_cpf()
returns trigger language plpgsql set search_path = public as $$
declare j jsonb := to_jsonb(new); k text; v jsonb; muda jsonb := '{}'::jsonb; t text;
begin
  for k, v in select * from jsonb_each(j) loop
    if jsonb_typeof(v) = 'string' then
      t := public.texto_sem_cpf(v #>> '{}');
      if t is distinct from v #>> '{}' then muda := muda || jsonb_build_object(k, t); end if;
    elsif jsonb_typeof(v) in ('object', 'array') then
      t := public.texto_sem_cpf(v::text);
      if t is distinct from v::text then muda := muda || jsonb_build_object(k, t::jsonb); end if;
    end if;
  end loop;
  if muda <> '{}'::jsonb then new := jsonb_populate_record(new, muda); end if;
  return new;
end $$;

-- "aab": depois do aaa_cadastro_sem_cpf e antes dos outros gatilhos (avisos, fichas), que já leem o texto limpo
do $$
declare tab text;
begin
  foreach tab in array array['acordos', 'atividades', 'avisos_rapidos', 'bloqueios', 'cadastros', 'comentarios_entregador',
    'comentarios_tarefa', 'eventos', 'eventos_bloqueio', 'lancamentos_financeiros', 'notificacoes', 'parceiros',
    'passagens_turno', 'revisoes_qualidade', 'tarefas', 'tarefas_recorrentes', 'entregadores']
  loop
    if to_regclass('public.' || tab) is not null then
      execute format('drop trigger if exists aab_sem_cpf on public.%I', tab);
      execute format('create trigger aab_sem_cpf before insert or update on public.%I for each row execute function public.linha_sem_cpf()', tab);
    end if;
  end loop;
end $$;

-- A4: de quem é o ID (só nome e cidade; nada de telefone, observação ou histórico)
create or replace function public.quem_e(p_id_app text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d record; v text := lower(regexp_replace(coalesce(p_id_app, ''), '\s', '', 'g'));
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  if length(v) < 4 then return null; end if;
  select * into d from public.dados_conhecidos(v);
  return jsonb_build_object('id_app', v, 'nome', d.nome, 'cidade', d.cidade,
    'tem_ficha', exists (select 1 from public.entregadores e where e.id_app = v));
end $$;

-- Avisos sem o código do entregador (pedido do usuário, 19/11/2026: "fica informação demais"). O nome continua; o link
-- leva para a ficha ou o cadastro, e a busca da tela de Avisos acha pelo ID (coluna id_app, que é preenchida aqui
-- quando o texto trazia o código e a coluna estava vazia). Sem nome, o texto diz "sem nome".
create or replace function public.aviso_sem_id(t text, p_id text)
returns text language plpgsql immutable set search_path = public as $$
declare
  cod constant text := '(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,40}';   -- letras e números juntos
  r text := t;
begin
  if r is null then return null; end if;
  if p_id is not null and length(p_id) >= 4 then
    r := regexp_replace(r, '\s*\((ID\s+)?' || p_id || '\)', '', 'gi');
    r := regexp_replace(r, '\mID\s+' || p_id || '\M', 'sem nome', 'gi');
    r := regexp_replace(r, '\m' || p_id || '\M', 'sem nome', 'gi');
  end if;
  r := regexp_replace(r, '\s*\((ID\s+)?' || cod || '\)', '', 'g');                 -- "Fulano (abc123)" → "Fulano"
  r := regexp_replace(r, '\mID\s+' || cod, 'sem nome', 'g');                         -- "cadastro ID abc123" → "cadastro sem nome"
  r := regexp_replace(r, '(:\s)' || cod || '(\s·|\.|,|$)', '\1sem nome\2', 'g');     -- "cadastro: abc123 · CIDADE"
  r := regexp_replace(r, '^👏\s*', '');                                               -- sem emoji nas telas (agradecimento)
  return r;
end $$;

create or replace function public.notificacao_sem_id()
returns trigger language plpgsql set search_path = public as $$
declare achado text;
begin
  if new.id_app is null then
    achado := substring(new.texto from '\((?:ID\s+)?((?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,40})\)');
    if achado is null then achado := substring(new.texto from '\mID\s+((?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,40})'); end if;
    if achado is not null then new.id_app := lower(achado); end if;
  end if;
  new.texto := public.aviso_sem_id(new.texto, new.id_app);
  return new;
end $$;

drop trigger if exists aac_aviso_sem_id on public.notificacoes;
create trigger aac_aviso_sem_id before insert or update of texto on public.notificacoes
  for each row execute function public.notificacao_sem_id();

-- os avisos já gravados também
update public.notificacoes set texto = texto
 where texto ~ '\((ID\s+)?[A-Za-z0-9]*[0-9][A-Za-z0-9]*\)|\mID\s+[A-Za-z0-9]*[0-9]|^👏|:\s[A-Za-z]+[0-9]|:\s[0-9]+[A-Za-z]';

-- o agradecimento deixa de começar com emoji
do $$
declare r record; def text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prosrc like '%👏 %s agradeceu%'
  loop
    def := pg_get_functiondef(r.oid);
    execute replace(def, '👏 %s agradeceu', '%s agradeceu');
  end loop;
end $$;

-- AT1: entregadores_atencao() roda em toda recarga de todo mundo (resumo_inicio). Mesmo resultado, sem o custo
-- quadrático: a contagem "bloqueado depois de aprovado" vira um CTE agregado (bapos). Redefine a da 006.
create or replace function public.entregadores_atencao()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  jan  integer := (select atencao_janela_dias from public.parametros_bloqueio);
  lim  integer := (select leves_limite from public.parametros_bloqueio);
  desde timestamptz := now() - make_interval(days => jan);
begin
  perform public.exigir_bloq('moderador', 'monitorador', 'suporte');
  return coalesce((
    with jb as (select * from public.bloqueios where inicio >= desde),
    ag as (
      select lower(b.id_app) id,
             (array_agg(b.nome_entregador order by b.inicio desc) filter (where not b.dados_pendentes))[1] nome_bloqueio,
             (array_agg(b.cidade order by b.inicio desc) filter (where b.cidade is not null))[1] cidade_bloqueio,
             max(b.inicio) ultimo,
             count(*) filter (where not b.leve) normais,
             count(distinct b.infracao_id) filter (where not b.leve) tipos,
             bool_or(not b.leve and public.situacao_bloqueio(b) = 'bloqueado') bloqueado_agora,
             bool_or(not b.leve and public.situacao_bloqueio(b) = 'encerramento') encerrado
        from jb b group by 1),
    aprov as (
      select lower(c.id_app) id, min(ev.em) aprovado_em
        from public.cadastros c join public.eventos ev on ev.cadastro_id = c.id and ev.tipo = 'aprovado'
       where c.status = 'aprovado' and c.id_app is not null group by 1),
    -- 009u (AT1): bloqueios depois da aprovação contados uma vez só (antes, uma subconsulta por ID: custo quadrático)
    bapos as (
      select lower(b.id_app) id, count(*) n from jb b join aprov ap on ap.id = lower(b.id_app)
       where not b.leve and b.inicio >= ap.aprovado_em and ap.aprovado_em > now() - interval '30 days' group by 1),
    x as (
      select ag.*, coalesce(e.nome, ag.nome_bloqueio) nome, coalesce(e.cidade, ag.cidade_bloqueio) cidade,
             public.leves_acumuladas(ag.id, now()) leves, ap.aprovado_em,
             coalesce(ba.n, 0) bloq_apos
        from ag left join aprov ap on ap.id = ag.id left join public.entregadores e on e.id_app = ag.id left join bapos ba on ba.id = ag.id
       where not ag.encerrado),
    m as (
      select x.*, array_remove(array[
               case when lim > 1 and x.leves = lim - 1 then format('a uma infração leve do limite (%s de %s)', x.leves, lim) end,
               case when x.normais >= 2 then format('reincidente: %s bloqueios em %s dias', x.normais, jan) end,
               case when x.tipos >= 2 then format('%s tipos de infração em %s dias', x.tipos, jan) end,
               case when x.aprovado_em > now() - interval '30 days' and x.bloq_apos > 0 then 'aprovado há pouco e já bloqueado' end], null) motivos
        from x)
    select jsonb_agg(jsonb_build_object('id_app', m.id, 'nome', m.nome, 'cidade', m.cidade, 'ultimo', m.ultimo,
             'bloqueios', m.normais, 'tipos', m.tipos, 'leves', m.leves, 'bloqueado_agora', m.bloqueado_agora,
             'aprovado_em', m.aprovado_em, 'motivos', to_jsonb(m.motivos))
             order by cardinality(m.motivos) desc, m.ultimo desc)
      from m where cardinality(m.motivos) > 0), '[]');
end $$;

revoke all on function public.notificacao_sem_id() from public, anon, authenticated;
revoke all on function public.aviso_sem_id(text, text) from public, anon, authenticated;
revoke all on function public.linha_sem_cpf() from public, anon, authenticated;
revoke all on function public.quem_e(text) from public, anon;
grant execute on function public.quem_e(text) to authenticated;
