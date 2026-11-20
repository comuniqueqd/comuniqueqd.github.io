-- 009z2 "Funções sem uso" (20/11/2026, decisão do usuário: "pode tirar todas")
-- A7-06: 13 funções que nem o site, nem a extensão, nem outra função chamam. Primeiro só perdem o acesso
-- (dá para devolver com um grant); na versão seguinte, se nada reclamar, são apagadas numa migração separada.
-- registrar_bloqueio também fecha a brecha A5-3 (registrava retenção sem a pendência de prestação de contas;
-- o site e a extensão usam registrar_bloqueio_agravante). Os dados dos casos continuam guardados.
-- Pode rodar mais de uma vez.
do $$
declare f text;
begin
  foreach f in array array[
    'public.aprovados_e_bloqueios()',
    'public.salvar_cidade(text, text, boolean)',
    'public.salvar_telefone(text, text)',
    'public.sugerir_atividade(text, text, uuid[], timestamp with time zone)',
    'public.registrar_bloqueio(text, text, text, smallint, text, text)',
    'public.assumir_caso(uuid, text)', 'public.comentar_caso(uuid, text)', 'public.listar_casos(text)',
    'public.json_caso(public.casos)', 'public.marcar_checklist_caso(uuid, text, boolean)', 'public.placar_detetive(integer)',
    'public.salvar_checklist_casos(text[])', 'public.veredito_caso(uuid, text, text)'] loop
    if to_regprocedure(f) is not null then execute format('revoke all on function %s from public, anon, authenticated', f); end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
