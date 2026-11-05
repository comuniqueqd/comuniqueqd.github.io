# Casos suspeitos (008, "Espionagem profissional"): guardado

Retirado do app em 11/2026, a pedido do usuário, antes da 008b. A ideia continua valendo, mas
precisa ser revista antes de voltar. Nada aqui é carregado pelo site.

## A ideia

Achar sinais de que o cadastro de um entregador está sendo usado por outra pessoa e investigar
com método, em equipe:

- **Sinais** (`sinais_cadastro()`):
  - CPF que já existe tentando entrar com outro nome ou outro ID (🔴 forte);
  - entregador encerrado tentando voltar: mesmo CPF, ou mesmo nome com outro ID, inclusive quem
    tem a parceria encerrada nos bloqueios (🔴 forte);
  - troca de nome ou ID num cadastro já aprovado (🟡 atenção).
- **Caso**: cada tentativa vira um caso (a tentativa fica registrada, em vez de só ser recusada).
- **Checklist** de verificação (modelo editável pelos moderadores), comentários e **veredito**
  (confirmado ou descartado, com nota) por monitorador ou moderador. Confirmado grava um
  comentário na ficha do entregador e o app sugere encerrar o cadastro.
- Selo 🕵️ "caso aberto" nos cadastros e na ficha; aprovar com caso aberto pede um clique a mais.
- **Lupa do detetive** (a busca do topo achava casos) e **Placar do detetive** nas Análises.

Ideias anotadas para quando voltar:
- **Ruído:** "nome igual ao de um encerrado" pode pegar homônimo. Exigir a mesma cidade, ou deixar
  🟡 quando a cidade for diferente.
- Todo caso novo avisava a equipe inteira, e isso pode virar ruído. As preferências de aviso da
  008b parte 2 resolvem.
- Faltam "reabrir caso" e "excluir caso aberto por engano", que hoje só são possíveis pelo SQL.
- Mais sinais: ID com bloqueio ativo num cadastro novo com outro nome; reprovado ou encerrado por
  fraude voltando com outro CPF e o mesmo nome; mesmo ID com nomes diferentes nos bloqueios.

## A dinâmica de "pegar" (guardar para as atividades em aberto)

O usuário pediu para reaproveitar o jeito de pegar um caso nas **atividades que estão em aberto**,
na repaginada das sugestões de tarefas e nas tarefas flutuantes (010).

1. Assim que algo aberto aparece, quem está na tela escolhe uma de duas coisas:
   - **"Eu verifico"**: assume na hora; o item fica com a pessoa e aparece nas Pendências dela;
   - **"Pedir verificação"**: manda para o **responsável da cidade** (sem responsável, para os
     **moderadores**), que recebe um aviso.
   No banco: `assumir_caso(p_caso, p_acao 'eu'|'pedir')`, com o investigador, o pedido de
   verificação e quem pediu. A pergunta aparecia numa janela logo depois do envio
   (`App.casos.avisar`), com "Decidir depois" como terceira opção.
2. Enquanto está com alguém: **checklist** marcável por qualquer pessoa, **comentários** de todos
   e a decisão final por quem tem o papel para isso (com nota obrigatória).
3. Na tela, os itens se separam em **"Para você verificar"**, **"Abertos"** e **"Encerrados"**.
   O contador do menu fica vermelho só quando há algo esperando por você.
4. **Placar**: quem verificou, quantos e em quanto tempo (o "Placar do detetive"). Serve também
   para os desafios da 010.

## O que está guardado

- `casos.js`: o módulo do front (tela Casos, janela na hora do envio, selo, placar).
- `telas.html`: as seções do `index.html` (tela Casos e Placar do detetive).
- `casos.css`: os estilos.
- `e2e-casos.mjs`: o trecho do teste no navegador.
- As integrações nas outras telas (Novo cadastro, Pendentes, ficha, lupa, tela inicial, Pendências,
  Análises) estão no histórico do git: o commit `59294d9` é a última versão completa com Casos.

## E o banco?

A `008-espionagem.sql` já rodou no Supabase. As tabelas (`casos`, `casos_comentarios`,
`checklist_casos`), as funções e os casos já registrados continuam lá. A `008b-notificacoes.sql`
cria um interruptor (`parametros_casos.ligado`, desligado): sem ele, nenhum caso novo é aberto,
ninguém é avisado, e CPF repetido volta a ser só a recusa de sempre.

## Para religar

1. Rever a ideia com o usuário (ver acima).
2. No Supabase: `update public.parametros_casos set ligado = true where unico;`
3. Front:
   - voltar `casos.js` para `js/` e as seções de `telas.html` para o `index.html` (com a tag
     `<script>` e o item `casos` em `App.grupos.entregadores`);
   - reaplicar as integrações do commit `59294d9`;
   - voltar os estilos.
4. Testes: o `testes/espiao.test.mjs` continua rodando (ele carrega só até a 008); voltar o trecho
   `e2e-casos.mjs` para o e2e.
