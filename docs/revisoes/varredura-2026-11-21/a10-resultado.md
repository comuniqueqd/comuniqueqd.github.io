# Resultado da consulta no banco real (colado pelo dono em 21/11/2026)
Semanas: s0 = semana atual (terça a segunda), s1 = anterior... Só números agregados.
Painel Usage do Supabase (egress, Realtime, conexões): ainda não enviado.

Resumo dos números (texto integral está na conversa; principais linhas):
- Banco 18,2 MB (tabelas do app 3,8 MB; notificacoes 6,8%). 10 pessoas autorizadas, todas entraram. 4 moderadores, 3 monitoradores, 3 suporte (iguais nos dois módulos). 0 moderadores com "receber tudo".
- Revisar: restrições 0; cadastros com revisar 2. Fichas 386 (13 sem cidade). Cidades ativas 38, 17 sem responsável.
- Fila agora: 4 aguardando análise, 16 aguardando contato (3 há mais de 7 dias), 2 tratativas (0 atrasadas), 2 com restrição, 2 tarefas abertas sem dono, 0 automáticas abertas, 0 em andamento, 1 lançamento não lançado (R$ 23,91), 0 acordos vencidos, 0 lembretes.
- Avisos não lidos 182 (6 pessoas; maior pilha 110; 1 pessoa >50). 363 marcados lidos pelo banco (7 dias). Lidos em até 1 h: 20,3%. Avisos por pessoa por dia útil: 10,2.
- Ativação (s0,s1,s2; s3..s7 = 0): cadastros 27/38/34 (99); aprovações 19/22/32; reprovações 19/19/13; encerramentos 1/7/1; desfeitas 3; editados 5; marcados revisados 0.
- Restrições: 3/14/30 (47); leves 0/4/3 (7); geradas por leves 0; agravante 0; liberadas antes 3; corrigidas 4; pendências retenção 1; anexos 0.
- Tratativas: criadas 14; no prazo 10; fora 2; realocadas 0.
- Tarefas: pedidas 1/2/6 (9); registradas como feitas 0; recorrentes 0; automáticas 1; concluídas 8; automáticas pela meta 0, à mão 1; comentários 0; agradecimentos 0; revisões de qualidade 3. Por tipo: Fazer contato 3 pedidas/1 concluída; Aprovar entregadores 1 automática/1 concluída; Sem tipo (antigas) 6/6; todos os outros tipos 0.
- Financeiro: adicionais 8 (R$ 104,41; 100% marcados mercado; 1 origem outros); ajustes de bairro 16 (R$ 28,50); lançados 23; acordos 5 registrados, 0 ajustados. Parceiros ativados 2.
- Agora: pedidos de ajuda 1 (aceito 1, renovados 0); avisos gerais 22 (1/13/8); pendências retenção 1; passagens de turno 2 (lidas 3).
- Entregadores: fichas criadas 386 (28/51/307); pela janela Cadastrar 86; comentários 10; alterações 21; lembretes 0.
- Recursos desde sempre: metas 0; recorrentes 0; seguindo cidade 0; de olho 3; avisos silenciados 0; checklist 0; aguardando terceiro 0; tarefas com >1 participante 1; @menção 0; previsões 2; modelos editados 0 de 27; bairros 255 em 5 cidades (5 com apelido; 0 pares diferentes); pedidos de cidade 5 (5 aprovados); casos 0; anexos 0; ajudas vencidas sem ninguém 0.
- Pessoas que usaram (30 dias; s0/s1/s2): qualquer 10 (9/7/7); Agora 5; Ativação 6; Avisos 10; Entregadores 5; Financeiro 6; Parceiros 2; Restrições 6; Tarefas 4.
- Avisos por categoria (gerados; % lidos pela pessoa; % em 1 h): ajuda 7 (57%; 43%); ativacao 968 (68%; 10%); aviso_geral 163 (59%; 18%); bloqueios 332 (75%; 14%); cidades 20 (75%; 0%); comentarios 43 (72%; 14%); financeiro 141 (75%; 18%); leves 27 (70%; 15%); pessoal 191 (88,5%; 33,5%); turno 16 (69%; 31%).
- Avisos por motivo: cidade 62 (85,5% lidos); moderador 1469 (70%; s0 323, s1 662, s2 484); pessoal 191 (88,5%); sem motivo 186 (60%).
- uso_dia: 1 chave (aba:inicio/inicio, 1 vez, desde 20/11) — a 009z4 foi publicada em 21/11.
- Tabelas: notificacoes 1,24 MB (1908 linhas); bloqueios 0,33 (403); eventos_bloqueio 0,19 (424); eventos 0,16 (240); cadastros 0,14 (99); bairros 0,13 (255); entregadores 0,12 (386); tarefas 0,11 (170); atividades 0,08 (10); o resto < 0,07 MB.

## Painel Usage do Supabase (print do dono, 21/11/2026; ciclo de cobrança atual, plano grátis, nada excedido)
- Database Size 0,034 / 0,5 GB (7%)  [a consulta mediu 18,2 MB do pg_database_size; o painel conta também o que é do Supabase]
- Egress 0,101 / 5 GB (2%); Cached Egress 0
- Realtime: pico de 6 / 200 conexões; 1.167 / 2.000.000 mensagens
- Monthly Active Users 12 / 50.000
- Log Ingestion 0,103 / 1 GB (10%) — o item mais perto do limite
- Storage 0; Edge Functions 0
- Comparação com 14/11: banco 33 MB, egress 0,056 GB, 11 usuários, Realtime 1.113 mensagens, pico 6.
