# Revisor do contra (rev): estudo de nov/2026

Revisei os 62 itens (NF-1 a NF-12, PB-1 a PB-13, AN-1 a AN-15, LG-1 a LG-15 e C-1 a C-7) conferindo os arquivos e as linhas citadas. No banco `teste_rev` reproduzi os problemas que pesam mais: PB-1, PB-2, PB-3, PB-4, PB-5, PB-6 e AN-6. Todos se confirmaram. O script está no scratchpad, em `estudo/rev/repro.mjs`. O veredito de cada item está em `rev.json`.

## Os 10 primeiros

1. **PB-1**: o número de tarefas em aberto que saiu na 009v conta tarefas que a pessoa não vê. A suporte vê "1" e não acha nada para pegar. O conserto é uma linha.
2. **PB-3**: quando alguém perde o módulo de bloqueios, a tratativa continua no nome dessa pessoa, que nem consegue mais abrir a tela. O conserto mínimo é chamar `reatribuir_tarefas()` em `salvar_membro`/`remover_membro`.
3. **PB-6**: a limpeza do "aviso sem código" muda o texto que a equipe escreveu. Uma placa de moto some do pedido de ajuda, e "NATAL25" vira "sem nome".
4. **PB-11 + PB-4** (fechar antes de publicar a 009x): a busca do Histórico ainda redesenha o app inteiro e faz 3 chamadas a cada pausa na digitação. A busca nas tratativas concluídas não acha quem registrou.
5. **NF-1**: mensagem pronta depois de aprovar ou reprovar um cadastro. A tarefa é diária e os motivos de reprovação já são uma lista fechada. Falta o usuário aprovar os textos.
6. **NF-4 + AN-10**: na tratativa, um botão "Tentei, sem resposta" e o resultado escolhido numa lista curta. Assim o esforço aparece, e depois dá para medir se o contato funciona (AN-1).
7. **PB-2**: quem "entra junto" numa tarefa compartilhada não entra no número da própria fila nem recebe o aviso de atraso.
8. **PB-8**: a frase "nesta semana × semana passada" em Parceiros compara a semana pela metade com a semana inteira, e quase sempre diz que o resultado caiu.
9. **NF-6**: botão da mensagem de boas-vindas logo depois de ativar um parceiro. O texto já existe no banco. É uma linha de código.
10. **AN-6**: renovar um pedido de ajuda apaga a hora em que ele foi feito. É dado perdido, que não se recupera depois.

Logo depois deles: NF-7 (avisar o acordo na véspera), AN-4 (resumo semanal com o financeiro e os parceiros), C-1 (link "Abrir no Quero Log") e LG-10 (o painel da extensão mostrar avisos gerais e pendências).

## Derrubados

- **NF-12**: já existe. O resultado da infração leve tem "Gerar mensagem" com a contagem (`js/bloqueios.js:552`), e "Registrar outra" volta o foco para o ID.
- **AN-15**: a tela já diz o certo. O mapa se chama "Quando a equipe registra" e o texto explica o que entra nele (`js/analises.js:147`).

## Duplicatas (qual id fica)

- **NF-6** fica; **LG-2** é a mesma proposta.
- **NF-7** fica; **LG-4** é o mesmo aviso de acordo. Levar o "acordos de amanhã na passagem de turno" para o NF-7.
- **LG-13** fica; **NF-10** é a mesma ideia. O primeiro passo do NF-10 estava errado: a lista PERMITIDAS do sw.js não é usada desde a 1.2 (ver S9).
- **AN-5** entra no **M9** (o mapa já tem o alerta por limite); o método de mediana com mínimo de casos vai junto.
- **LG-14** entra no **A7-08** (o código comum da extensão já está proposto lá).
- Fazer como uma entrega só (não são duplicatas): NF-4 + AN-10 + LG-3 (tratativa); PB-1 + PB-7 (números das Atividades); PB-9 + C-7 (concluídas); LG-5 + AN-8 + C-4 (acordos e parceiros ligados); AN-3 com o MK-4.

## O que mudei de prioridade e por quê

- **Extensão (LG-1, LG-9 e outros)**: baixei de alta para média. Ela ainda não foi publicada nem está em uso pela equipe.
- **NF-3**: o próprio app diz "o sistema retira sozinho nesse horário". Então o botão "Liberei no Quero Log" não é preciso; sobra a mensagem de fim da restrição.
- **NF-5**: o cartão já mostra há quanto tempo o cadastro aguarda contato. Falta só a ação de um clique.
- **NF-11**: a ficha não tem telefone, então a lista de "quem chamar" não deixa chamar ninguém sem ir a outro sistema.
- **LG-12**: o Crisp troca de conversa sem recarregar a página, então o evento proposto não dispara. O esforço é médio, não pequeno.
- **AN-1, AN-7, AN-8, AN-13**: com o volume de uma equipe pequena, os grupos ficam pequenos demais por meses.
- **LG-7**: pagamento ao entregador nem sempre é adicional. Perguntar ao usuário antes de mandar tudo para o Financeiro.

## O que não verifiquei

Não abri nada no navegador. PB-7, PB-9, PB-10, PB-12 e PB-13 foram confirmados só pela leitura do código. Também não sei como são os IDs reais do Quero Log; disso depende a prioridade do PB-5.
