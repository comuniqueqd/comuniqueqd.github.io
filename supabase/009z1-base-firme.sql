-- 009z1 "Base firme" (20/11/2026, spec aprovada pelo usuário)
-- A5-12: adicional e ajuste de bairro sem o nome do entregador eram barrados só na tela; agora o banco recusa.
-- A5-10: quando quem aceitou uma tarefa compartilhada sai da equipe, ela fica com quem ainda participa
--        (antes voltava a aberta para todos e os outros participantes perdiam a tarefa sem aviso).
-- As funções sem uso (A7-06) NÃO entram aqui: o usuário decide antes.
-- Pode rodar mais de uma vez. Depende da 009x.

-- ---------------------------------------------------------------------
-- A5-12: lançamento financeiro sempre com o nome do entregador
-- ---------------------------------------------------------------------
create or replace function public.lancamento_exige_nome()
returns trigger language plpgsql set search_path = public as $$
begin
  if nullif(btrim(coalesce(new.nome_entregador, '')), '') is null then
    raise exception 'ID sem ficha: preencha o nome do entregador.';
  end if;
  return new;
end $$;
drop trigger if exists aae_lancamento_exige_nome on public.lancamentos_financeiros;
create trigger aae_lancamento_exige_nome before insert on public.lancamentos_financeiros
  for each row execute function public.lancamento_exige_nome();

-- ---------------------------------------------------------------------
-- A5-10: quem sai da equipe não leva a tarefa compartilhada junto (corpo inteiro; a de antes é da 009x)
-- ---------------------------------------------------------------------
create or replace function public.membro_saiu_dos_bloqueios()
returns trigger language plpgsql security definer set search_path = public as $$
declare cids text[]; sai boolean; a public.atividades; resto jsonb; prox jsonb;
begin
  sai := tg_op = 'DELETE' or (coalesce(old.papel_bloqueios::text, '') in ('moderador', 'monitorador')
                             and coalesce(new.papel_bloqueios::text, '') not in ('moderador', 'monitorador'));
  if sai then
    select coalesce(array_agg(distinct c), '{}') into cids from (
      select nome c from public.cidades where responsavel_email = old.email
      union select cidade from public.tarefas where responsavel_email = old.email and status = 'pendente' and cidade is not null) x;
    if tg_op = 'UPDATE' then
      update public.cidades set responsavel_email = null where responsavel_email = old.email;
      -- realocadas para a pessoa (não seguem a cidade): voltam para os moderadores
      update public.tarefas set responsavel_email = null where responsavel_email = old.email and status = 'pendente';
    end if;
    if cardinality(cids) > 0 then perform public.reatribuir_tarefas(cids); end if;
  end if;
  if tg_op = 'DELETE' and old.user_id is not null then
    for a in select * from public.atividades
              where status = 'aceita' and (aceita_por = old.user_id or participantes @> jsonb_build_array(jsonb_build_object('id', old.user_id::text)))
              for update loop
      resto := coalesce((select jsonb_agg(x order by x->>'desde') from jsonb_array_elements(coalesce(a.participantes, '[]')) x
                          where x->>'id' <> old.user_id::text), '[]');
      if jsonb_array_length(resto) > 0 then
        prox := resto->0;
        update public.atividades set participantes = resto,
               aceita_por = case when aceita_por = old.user_id then (prox->>'id')::uuid else aceita_por end,
               aceita_por_nome = case when aceita_por = old.user_id then prox->>'nome' else aceita_por_nome end
         where id = a.id;
        if a.aceita_por = old.user_id then
          perform public.notificar((prox->>'id')::uuid, format('%s saiu da equipe; a tarefa continua com você: %s', coalesce(old.nome, 'Alguém'), a.titulo), '#atividades/pendencias');
        end if;
      elsif a.aceita_por = old.user_id then
        update public.atividades set status = 'aberta', aceita_por = null, aceita_por_nome = null, aceita_em = null, participantes = '[]',
               pausa_seg = pausa_seg + coalesce(extract(epoch from now() - aguardando_desde)::int, 0),
               aguardando_desde = null, aguardando_motivo = null
         where id = a.id;
      end if;
    end loop;
  end if;
  return null;
end $$;

revoke all on function public.lancamento_exige_nome() from public, anon, authenticated;
revoke all on function public.membro_saiu_dos_bloqueios() from public, anon, authenticated;

notify pgrst, 'reload schema';
