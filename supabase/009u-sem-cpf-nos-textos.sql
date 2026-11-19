-- 009u "Mesa arrumada" (grupos 1 e 2 do mapa, pedido do usuário em 19/11/2026).
--   S3: CPF escrito em texto livre (comentários, observações, avisos, passagem de turno, tarefas…) vira
--       "[CPF removido]" já na gravação, com a mesma regra da 009s (formatado 000.000.000-00, ou 11 dígitos
--       logo depois da palavra CPF). Telefones ficam (decisão do usuário).
--   A4: quem_e(p_id_app) diz de quem é o ID (nome e cidade da ficha) para o formulário do adicional, que
--       é de todos os papéis da ativação (a busca rápida só traz fichas para quem tem o módulo de bloqueios).
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

revoke all on function public.linha_sem_cpf() from public, anon, authenticated;
revoke all on function public.quem_e(text) from public, anon;
grant execute on function public.quem_e(text) to authenticated;
