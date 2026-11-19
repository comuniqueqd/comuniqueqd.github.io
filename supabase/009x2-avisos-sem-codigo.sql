-- 009x2 (20/11/2026): conserto da 009x nos avisos sem o código do entregador.
-- A 009x (PB-6) passou a limpar só avisos com link #ficha/#cadastro ou de certas categorias. Mas os avisos
-- pessoais sobre cadastros ("Seu cadastro ID abc foi aprovado", "Cadastro novo em X: ID abc", "cadastro para
-- completar (ID abc)") têm links como #ativacao/meus, e as leves agrupadas têm categoria 'leves': o código voltou
-- a aparecer neles. Regra nova: o código sai quando é de um entregador conhecido (tem ficha, cadastro ou
-- bloqueio), venha de onde vier o aviso. Pedido de ajuda, aviso geral e passagem de turno continuam como a pessoa
-- escreveu (a placa "(QWE1A23)" fica). Os avisos já gravados com código conhecido também são limpos.
-- Também: nenhum aviso começa com emoji (o "✅" da revisão de qualidade escapava).
-- Pode rodar de novo.

create or replace function public.notificacao_sem_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare m text[]; cand text;
begin
  -- sem emoji nas telas: tira o do começo do aviso (o 👏 do agradecimento, o ✅ da revisão de qualidade...)
  new.texto := regexp_replace(new.texto, '^\s*[\u2600-\u27BF\U0001F000-\U0001FAFF]\uFE0F?\s*', '');
  if coalesce(new.categoria, '') in ('ajuda', 'aviso_geral', 'turno') then
    return new;   -- texto escrito pela equipe: fica como está
  end if;
  if new.id_app is null and coalesce(new.link, '') ~ '^#cadastro/[0-9a-fA-F-]{36}$' then
    select lower(c.id_app) into new.id_app from public.cadastros c where c.id::text = lower(substring(new.link from 11));
  end if;
  if new.id_app is null and coalesce(new.link, '') ~ '^#ficha/[A-Za-z0-9]{4,40}$' then new.id_app := lower(substring(new.link from 8)); end if;
  if new.id_app is null then
    -- candidatos: "(abc123)", "(ID abc123)" ou "ID abc123"; vale o primeiro que é de um entregador conhecido
    for m in select regexp_matches(new.texto, '\((?:ID\s+)?([A-Za-z0-9]{4,40})\)|\mID\s+([A-Za-z0-9]{4,40})\M', 'g') loop
      cand := lower(coalesce(m[1], m[2]));
      if exists (select 1 from public.entregadores e where e.id_app = cand)
         or exists (select 1 from public.cadastros c where lower(c.id_app) = cand)
         or exists (select 1 from public.bloqueios b where lower(b.id_app) = cand) then
        new.id_app := cand; exit;
      end if;
    end loop;
  end if;
  if new.id_app is not null and new.texto ~* ('\m' || new.id_app || '\M') then
    new.texto := public.aviso_tira_id(new.texto, new.id_app, public.nome_do_id(new.id_app));
  end if;
  return new;
end $$;

-- os avisos gravados enquanto valia a regra da 009x (o update dispara o gatilho, que limpa)
update public.notificacoes set texto = texto
 where coalesce(categoria, '') not in ('ajuda', 'aviso_geral', 'turno')
   and (texto ~ '\((ID\s+)?[A-Za-z0-9]{4,40}\)|\mID\s+[A-Za-z0-9]{4,40}' or texto ~ '^\s*[\u2600-\u27BF\U0001F000-\U0001FAFF]');

revoke all on function public.notificacao_sem_id() from public, anon, authenticated;
