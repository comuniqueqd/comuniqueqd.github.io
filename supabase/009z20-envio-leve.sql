-- 009z20 "Envio leve" (28/11/2026, defeito real: "statement timeout" ao gravar os lotes de pedidos no Supabase).
-- Cada pedido gravado ou recalculado passava por duas verificações que não servem aos pedidos do Tableau:
--   * aab_sem_cpf (procura CPF em todas as colunas de texto da linha): agora só quando há motivo escrito por alguém
--     (descarte), a única coluna de texto livre da tabela;
--   * marcar_mudanca_* (sobe o número de "tem novidade" do app e compara todas as linhas antes/depois): os pedidos
--     não usam esse número (o Monitoramento carrega ao abrir a aba), então saem desta tabela.
-- Pode rodar de novo.
drop trigger if exists aab_sem_cpf on public.pedidos_log;
create trigger aab_sem_cpf before insert or update of motivo on public.pedidos_log
  for each row when (new.motivo is not null) execute function public.linha_sem_cpf();
drop trigger if exists marcar_mudanca_ins on public.pedidos_log;
drop trigger if exists marcar_mudanca_upd on public.pedidos_log;
drop trigger if exists marcar_mudanca_del on public.pedidos_log;
