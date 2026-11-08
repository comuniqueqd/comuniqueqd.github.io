-- =====================================================================
-- 009a: regras de punição iguais à "Política de Boas Práticas e Conduta
-- para Entregadores" (pedido do usuário em 08/11/2026).
--
-- O que muda: só as horas de cada infração normal (1ª, 2ª, se a 3ª encerra).
-- O aumento de 30% a partir da 3ª ocorrência continua (fator 1,30), e a
-- tela Bloqueios → Regras continua podendo alterar tudo depois.
-- O que NÃO muda: bloqueios já registrados (as horas ficam gravadas em
-- cada bloqueio), as infrações leves (avisos de 30 min), a janela de dias
-- do atraso, nomes, ordem e se a infração está ativa.
--
-- Política → horas (1 dia = 24 h, 1 semana = 168 h, permanente = encerramento):
--   Reabrir pedido ............ 1ª 1 h · 2ª 1 dia · depois +30%
--   Mal uso do aplicativo ..... sempre 1 h (1 h + 30% arredondado continua 1 h)
--   Atraso na coleta/entrega .. 1ª 1 h · 2ª 1 dia · depois +30%
--   Avaria de produto ......... 1ª 1 dia · 2ª 1 semana · depois +30%
--   Retenção de valores ....... 1ª 1 dia · 2ª 1 semana · depois +30%
--   Finalização falsa ......... 1ª 1 semana · 2ª encerra
--   Mau comportamento ......... 1ª 1 semana · 2ª encerra
--   Uso da conta por terceiros  1ª 1 semana · 2ª encerra
--   Furto, agressão, fraude ... encerra na 1ª
-- (Agravantes da política, como "não respondeu o suporte em 8 h" na retenção
-- ou "terceiro menor de 18" no uso da conta, ainda não são tratados pelo app.)
--
-- Pode rodar mais de uma vez. Atualiza pelo nome da infração: se alguma foi
-- renomeada na tela de Regras, ela aparece no aviso do fim como "não achada"
-- e é só ajustar na tela.
-- =====================================================================

do $$
declare n integer; faltam text;
begin
  with politica(nome, h1, h2, terceira) as (values
    ('Reabrir Pedido Após Aceite Sem Justificativa Plausível', 1::numeric, 24::numeric, false),
    ('Mal Uso Proposital do Aplicativo', 1, 1, false),
    ('Atraso na Coleta ou na Entrega Sem Justificativa', 1, 24, false),
    ('Avaria de Produto', 24, 168, false),
    ('Retenção de Valores ou Equipamentos de Pagamento', 24, 168, false),
    ('Finalização Falsa de Entrega', 168, null, false),
    ('Mau Comportamento com Clientes Finais ou Parceiros: Desrespeito ou Atitude Inapropriada', 168, null, false),
    ('Uso da Conta por Terceiros Não Autorizados', 168, null, false),
    ('Furto ou Extravio: Desvio de Produtos ou Valores', null, null, false),
    ('Agressão Física ou Assédio (Moral ou Sexual)', null, null, false),
    ('Fraude Documental', null, null, false)
  ), mudou as (
    update public.infracoes i
       set horas_1a = p.h1, horas_2a = p.h2, terceira_encerra = p.terceira, fator = 1.30,
           atualizada_em = now(), atualizada_por = 'política de conduta (009a)'
      from politica p
     where i.nome = p.nome and not i.leve
       and (i.horas_1a is distinct from p.h1 or i.horas_2a is distinct from p.h2
            or i.terceira_encerra is distinct from p.terceira or i.fator is distinct from 1.30)
    returning 1
  )
  select count(*) into n from mudou;
  select string_agg(p.nome, '; ') into faltam
    from (values ('Reabrir Pedido Após Aceite Sem Justificativa Plausível'), ('Mal Uso Proposital do Aplicativo'),
                 ('Atraso na Coleta ou na Entrega Sem Justificativa'), ('Avaria de Produto'),
                 ('Retenção de Valores ou Equipamentos de Pagamento'), ('Finalização Falsa de Entrega'),
                 ('Mau Comportamento com Clientes Finais ou Parceiros: Desrespeito ou Atitude Inapropriada'),
                 ('Uso da Conta por Terceiros Não Autorizados'), ('Furto ou Extravio: Desvio de Produtos ou Valores'),
                 ('Agressão Física ou Assédio (Moral ou Sexual)'), ('Fraude Documental')) p(nome)
   where not exists (select 1 from public.infracoes i where i.nome = p.nome);
  raise notice '009a: % infração(ões) atualizada(s) para a política.%', n,
    coalesce(' Não achadas (renomeadas?): ' || faltam, '');
end $$;

-- Conferência: a punição de cada infração da 1ª à 5ª ocorrência (nulo = encerramento).
select nome,
       public.horas_previstas(i, 1) as "1ª", public.horas_previstas(i, 2) as "2ª", public.horas_previstas(i, 3) as "3ª",
       public.horas_previstas(i, 4) as "4ª", public.horas_previstas(i, 5) as "5ª"
  from public.infracoes i
 where not i.leve
 order by i.ordem;
