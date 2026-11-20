-- 009x4 (20/11/2026, pedido do usuário): "bloqueio" passa a se chamar "restrição" em tudo o que a equipe lê.
-- As mensagens aos entregadores já diziam "restrição temporária"; agora as telas e os avisos também dizem.
-- Fica igual: os nomes internos (tabelas, funções, endereços #bloqueios/...), "encerramento de parceria" e
-- "infração leve". Aqui no banco: texto_restricao(t) troca as palavras (com o gênero certo: "o bloqueio" →
-- "a restrição", "bloqueado" → "com restrição") e o gatilho aad_restricao passa em todo aviso novo; os avisos
-- já gravados também são trocados (decisão do Claude: a tela de Avisos fica com um nome só). As mesmas regras
-- estão no front (App.u.restricao em js/base.js), que traduz as mensagens de erro e os textos montados pelo banco
-- (Registros, Atenção, Análises). Mudou uma regra aqui? Mude lá também (o test:casa compara as duas listas).
-- Pode rodar de novo.

create or replace function public.texto_restricao(t text)
returns text language plpgsql immutable set search_path = public as $$
declare r text := t;
begin
  if r is null or r !~* 'bloque' then return r; end if;
  r := regexp_replace(r, '(^|[^[:alpha:]])novo bloqueio(?![[:alpha:]])', '\1nova restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Novo bloqueio(?![[:alpha:]])', '\1Nova restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])um bloqueio(?![[:alpha:]])', '\1uma restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Um bloqueio(?![[:alpha:]])', '\1Uma restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])o bloqueio(?![[:alpha:]])', '\1a restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])O bloqueio(?![[:alpha:]])', '\1A restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])os bloqueios(?![[:alpha:]])', '\1as restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Os bloqueios(?![[:alpha:]])', '\1As restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])do bloqueio(?![[:alpha:]])', '\1da restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Do bloqueio(?![[:alpha:]])', '\1Da restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])dos bloqueios(?![[:alpha:]])', '\1das restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Dos bloqueios(?![[:alpha:]])', '\1Das restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])no bloqueio(?![[:alpha:]])', '\1na restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])No bloqueio(?![[:alpha:]])', '\1Na restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])nos bloqueios(?![[:alpha:]])', '\1nas restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Nos bloqueios(?![[:alpha:]])', '\1Nas restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])ao bloqueio(?![[:alpha:]])', '\1à restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Ao bloqueio(?![[:alpha:]])', '\1À restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])aos bloqueios(?![[:alpha:]])', '\1às restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Aos bloqueios(?![[:alpha:]])', '\1Às restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])pelo bloqueio(?![[:alpha:]])', '\1pela restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Pelo bloqueio(?![[:alpha:]])', '\1Pela restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])pelos bloqueios(?![[:alpha:]])', '\1pelas restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Pelos bloqueios(?![[:alpha:]])', '\1Pelas restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])este bloqueio(?![[:alpha:]])', '\1esta restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Este bloqueio(?![[:alpha:]])', '\1Esta restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])esse bloqueio(?![[:alpha:]])', '\1essa restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Esse bloqueio(?![[:alpha:]])', '\1Essa restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])deste bloqueio(?![[:alpha:]])', '\1desta restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Deste bloqueio(?![[:alpha:]])', '\1Desta restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])desse bloqueio(?![[:alpha:]])', '\1dessa restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Desse bloqueio(?![[:alpha:]])', '\1Dessa restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])neste bloqueio(?![[:alpha:]])', '\1nesta restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Neste bloqueio(?![[:alpha:]])', '\1Nesta restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])seu bloqueio(?![[:alpha:]])', '\1sua restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Seu bloqueio(?![[:alpha:]])', '\1Sua restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])seus bloqueios(?![[:alpha:]])', '\1suas restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Seus bloqueios(?![[:alpha:]])', '\1Suas restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])outro bloqueio(?![[:alpha:]])', '\1outra restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Outro bloqueio(?![[:alpha:]])', '\1Outra restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])mesmo bloqueio(?![[:alpha:]])', '\1mesma restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Mesmo bloqueio(?![[:alpha:]])', '\1Mesma restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])primeiro bloqueio(?![[:alpha:]])', '\1primeira restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Primeiro bloqueio(?![[:alpha:]])', '\1Primeira restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])último bloqueio(?![[:alpha:]])', '\1última restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Último bloqueio(?![[:alpha:]])', '\1Última restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])1º bloqueio(?![[:alpha:]])', '\11ª restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])1º bloqueio(?![[:alpha:]])', '\11ª restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio gerado(?![[:alpha:]])', '\1restrição gerada', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio gerado(?![[:alpha:]])', '\1Restrição gerada', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueios gerados(?![[:alpha:]])', '\1restrições geradas', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueios gerados(?![[:alpha:]])', '\1Restrições geradas', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio registrado(?![[:alpha:]])', '\1restrição registrada', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio registrado(?![[:alpha:]])', '\1Restrição registrada', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueios registrados(?![[:alpha:]])', '\1restrições registradas', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueios registrados(?![[:alpha:]])', '\1Restrições registradas', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio ativo(?![[:alpha:]])', '\1restrição ativa', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio ativo(?![[:alpha:]])', '\1Restrição ativa', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueios ativos(?![[:alpha:]])', '\1restrições ativas', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueios ativos(?![[:alpha:]])', '\1Restrições ativas', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio novo(?![[:alpha:]])', '\1restrição nova', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio novo(?![[:alpha:]])', '\1Restrição nova', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio corrigido(?![[:alpha:]])', '\1restrição corrigida', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio corrigido(?![[:alpha:]])', '\1Restrição corrigida', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio normal(?![[:alpha:]])', '\1restrição normal', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio normal(?![[:alpha:]])', '\1Restrição normal', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueios normais(?![[:alpha:]])', '\1restrições normais', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueios normais(?![[:alpha:]])', '\1Restrições normais', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio apagado(?![[:alpha:]])', '\1restrição apagada', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio apagado(?![[:alpha:]])', '\1Restrição apagada', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])foi bloqueado(?![[:alpha:]])', '\1recebeu restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Foi bloqueado(?![[:alpha:]])', '\1Recebeu restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])foram bloqueados(?![[:alpha:]])', '\1receberam restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Foram bloqueados(?![[:alpha:]])', '\1Receberam restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])já bloqueado(?![[:alpha:]])', '\1já com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Já bloqueado(?![[:alpha:]])', '\1Já com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])está bloqueado(?![[:alpha:]])', '\1está com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Está bloqueado(?![[:alpha:]])', '\1Está com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])estão bloqueados(?![[:alpha:]])', '\1estão com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Estão bloqueados(?![[:alpha:]])', '\1Estão com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])ficou bloqueado(?![[:alpha:]])', '\1ficou com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Ficou bloqueado(?![[:alpha:]])', '\1Ficou com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueados(?![[:alpha:]])', '\1com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueados(?![[:alpha:]])', '\1Com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueado(?![[:alpha:]])', '\1com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueado(?![[:alpha:]])', '\1Com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueadas(?![[:alpha:]])', '\1com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueadas(?![[:alpha:]])', '\1Com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueada(?![[:alpha:]])', '\1com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueada(?![[:alpha:]])', '\1Com restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueios(?![[:alpha:]])', '\1restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueios(?![[:alpha:]])', '\1Restrições', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloqueio(?![[:alpha:]])', '\1restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloqueio(?![[:alpha:]])', '\1Restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])bloquear(?![[:alpha:]])', '\1aplicar restrição', 'g');
  r := regexp_replace(r, '(^|[^[:alpha:]])Bloquear(?![[:alpha:]])', '\1Aplicar restrição', 'g');
  return r;
end $$;

create or replace function public.aviso_restricao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.texto := public.texto_restricao(new.texto);
  return new;
end $$;
drop trigger if exists aad_restricao on public.notificacoes;
create trigger aad_restricao before insert or update of texto on public.notificacoes
  for each row execute function public.aviso_restricao();

-- os avisos já gravados (o update passa pelo gatilho)
update public.notificacoes set texto = texto where texto ~* 'bloque';

revoke all on function public.aviso_restricao() from public, anon, authenticated;
grant execute on function public.texto_restricao(text) to authenticated;

notify pgrst, 'reload schema';
