-- 009v (pedido do usuário, 19/11/2026): as tarefas em aberto geram número em Atividades.
-- E a correção dos avisos "sem nome" (ver no fim).
-- resumo_inicio().atividades ganha 'abertas_para_pegar' = tarefas abertas (sem dono) que não fui eu que criei, inclusive
-- as opcionais e as criadas há menos de 10 min (o para_aceitar continua como era). Só acrescenta o campo, via
-- pg_get_functiondef (rodar a 007 de novo exige rodar a 009v depois). Pode rodar de novo.
do $$
declare def text; novo text;
begin
  def := pg_get_functiondef('public.resumo_inicio()'::regprocedure);
  if position('abertas_para_pegar' in def) > 0 then return; end if;
  novo := replace(def, $a$'equipe_abertas', count(*) filter (where a.status in ('aberta', 'aceita')))$a$,
    $a$'equipe_abertas', count(*) filter (where a.status in ('aberta', 'aceita')),
      'abertas_para_pegar', count(*) filter (where a.status = 'aberta' and a.criada_por is distinct from auth.uid()))$a$);
  if novo = def then raise exception '009v: não achei o bloco de atividades em resumo_inicio()'; end if;
  execute novo;
end $$;

-- Correção da 009u (o usuário viu "Cadastro novo em …: sem nome" num cadastro com nome): alguns avisos traziam só
-- o ID ("Cadastro novo em X: ID abc", "Seu cadastro ID abc foi aprovado"). Sem o código, agora entra o nome do
-- entregador (ficha; senão o cadastro mais recente com esse ID). "sem nome" só quando não há nome em lugar nenhum.
create or replace function public.nome_do_id(p_id text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select d.nome from public.dados_conhecidos(p_id) d),
                  (select c.nome from public.cadastros c where lower(c.id_app) = lower(p_id) and public.nome_valido(c.nome)
                    order by c.enviado_em desc limit 1))
$$;

create or replace function public.aviso_sem_id(t text, p_id text, p_nome text)
returns text language plpgsql immutable set search_path = public as $$
declare
  cod constant text := '(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,40}';
  quem constant text := replace(coalesce(nullif(btrim(p_nome), ''), 'sem nome'), '\', '\\');
  r text := t;
begin
  if r is null then return null; end if;
  if p_id is not null and length(p_id) >= 4 then
    r := regexp_replace(r, '\s*\((ID\s+)?' || p_id || '\)', '', 'gi');
    r := regexp_replace(r, '\mID\s+' || p_id || '\M', quem, 'gi');
    r := regexp_replace(r, '\m' || p_id || '\M', quem, 'gi');
  end if;
  r := regexp_replace(r, '\s*\((ID\s+)?' || cod || '\)', '', 'g');
  r := regexp_replace(r, '\mID\s+' || cod, 'sem nome', 'g');
  r := regexp_replace(r, '(:\s)' || cod || '(\s·|\.|,|$)', '\1sem nome\2', 'g');
  r := regexp_replace(r, '^👏\s*', '');
  return r;
end $$;

create or replace function public.aviso_sem_id(t text, p_id text)
returns text language sql immutable set search_path = public as $$ select public.aviso_sem_id(t, p_id, null) $$;

create or replace function public.notificacao_sem_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare achado text;
begin
  if new.id_app is null then
    achado := substring(new.texto from '\((?:ID\s+)?((?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,40})\)');
    if achado is null then achado := substring(new.texto from '\mID\s+((?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,40})'); end if;
    if achado is null then achado := substring(new.texto from ':\s((?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,40})(?:\s·|\.|,|$)'); end if;
    if achado is not null then new.id_app := lower(achado); end if;
  end if;
  new.texto := public.aviso_sem_id(new.texto, new.id_app,
    case when new.id_app is not null and new.texto ~* ('\m' || new.id_app || '\M') then public.nome_do_id(new.id_app) end);
  return new;
end $$;

-- os avisos que a 009u deixou com "sem nome" mas cujo ID tem nome: "sem nome" (minúsculo, como a 009u escreveu) vira o nome
update public.notificacoes n set texto = regexp_replace(n.texto, '\msem nome\M', replace(public.nome_do_id(n.id_app), '\', '\\'), 'g')
 where n.id_app is not null and n.texto ~ '\msem nome\M' and public.nome_do_id(n.id_app) is not null;

revoke all on function public.nome_do_id(text) from public, anon, authenticated;
revoke all on function public.aviso_sem_id(text, text, text) from public, anon, authenticated;
revoke all on function public.notificacao_sem_id() from public, anon, authenticated;
