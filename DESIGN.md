---
name: Comunique
description: A mesa da operação: ativação, restrições, tarefas e avisos da equipe, num lugar só. Direção "Mesa de Operação" com páginas de diário do "Caderno de Campo".
# Linha editorial estética do Comunique (009y1, 20/11/2026), a partir da proposta do a4 na varredura de 20/11.
# O teste "DESIGN.md" do e2e (varredura visual) cobra as regras marcadas como trava.
colors:
  # identidade Dino (sem mudança de valor)
  floresta: "#14352B"
  jade: "#1F8A5B"          # só símbolo e enfeite; nunca texto sobre branco (4,33:1)
  ambar: "#E8A33D"         # só "precisa de você"; sempre com texto floresta (6,19:1)
  areia: "#F4EFE6"         # fundo das páginas-diário (Caderno)
  # claro
  bg: "#FAF7F1"
  surface: "#FFFFFF"
  papel: "#FFFDF8"         # nota do Caderno sobre areia
  ink: "#14352B"
  muted: "#4B5B54"         # 6,7:1 sobre bg
  line: "#E5DED1"          # só divisória entre linhas de uma lista
  line-forte: "#8F8676"    # NOVO: borda de controle (campo, botão secundário), 3,6:1 sobre branco
  accent: "#18774E"
  ok: "#1B7A46"
  bad: "#B3261E"
  warn: "#8A5300"
  # escuro (três camadas com passo visível)
  bg-escuro: "#0F1C17"
  surface-escuro: "#16261F"
  surface-2-escuro: "#1E3229"   # NOVO: cabeçalho/barra lateral e janela; 1,29:1 sobre bg (hoje 1,04:1)
  line-forte-escuro: "#6B8577"  # NOVO: 3,9:1 sobre surface
  accent-escuro: "#6CCB9A"
typography:
  titulo:   { fontFamily: "Manrope, Inter, system-ui, sans-serif", fontWeight: 700 }
  corpo:    { fontFamily: "Inter, system-ui, sans-serif", fontSize: "15px", lineHeight: 1.5, fontWeight: 400 }
  fs-1: "12px"   # meta, pílula, eixo de gráfico (mínimo da casa)
  fs-2: "13px"   # linha densa de lista, tabela
  fs-3: "15px"   # corpo
  fs-4: "17px"   # título de grupo (h3)
  fs-5: "22px"   # título de tela (h2) e o "dia" do Caderno
  fs-6: "28px"   # número grande (KPI)
rounded:
  r-1: "6px"     # tag, pílula de texto, célula do mapa de calor
  r-2: "10px"    # controle (campo, botão), lista, linha aberta
  r-3: "14px"    # janela, painel, balão do tour
  pilula: "999px"  # só pílula de situação e contador
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
components:
  botao-principal:  { backgroundColor: "{colors.accent}", textColor: "#FFFFFF", rounded: "{rounded.r-2}", height: "40px", padding: "0 16px", typography: "600 14px corpo" }
  botao-secundario: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", rounded: "{rounded.r-2}", height: "40px", padding: "0 14px" }
  botao-perigo:     { backgroundColor: "{colors.surface}", textColor: "{colors.bad}", rounded: "{rounded.r-2}", height: "40px" }
  botao-link:       { textColor: "{colors.accent}", height: "40px" }
  botao-compacto:   { height: "32px", padding: "0 10px" }   # só em linha de tabela no computador
  campo:            { backgroundColor: "{colors.surface}", rounded: "{rounded.r-2}", height: "40px", padding: "0 12px" }
  linha-lista:      { padding: "10px 12px", typography: "13px corpo" }
  pilula-situacao:  { rounded: "{rounded.pilula}", padding: "1px 8px", typography: "600 12px corpo" }
  janela:           { backgroundColor: "{colors.surface}", rounded: "{rounded.r-3}", padding: "20px" }
  entrada-diario:   { padding: "10px 0", typography: "13.5px corpo" }
---

## Overview
Ferramenta de trabalho (modo Operate): quem abre quer resolver a próxima coisa. A casa é a **Mesa de Operação**: listas em linhas densas, uma ação principal por linha, cor só para situação e sempre com texto, âmbar só para "precisa de você". Por cima dela, nas telas onde o tempo e a narrativa importam (Início, Avisos → Toda a equipe, passagem de turno, resumo do dia), entra a página **Caderno de Campo**: o dia como título, a frase-resumo, pendências escritas como tarefa e o diário com a hora à esquerda. A identidade é a Dino (floresta, jade, âmbar, areia; Manrope + Inter). Sem imagens da marca Quero; sem mascote no app; sem emoji.

## Colors
- **Situação = cor + texto, nunca só cor.** Com restrição/atrasado = `bad`; aguardando/precisa = `warn`/`ambar`; feito/liberado = `ok`; neutro = `muted`.
- **Âmbar** só em: contador do que é seu, ponto "com você", aba atual do topo. Nunca em enfeite.
- **Jade puro** só no símbolo. Texto e link usam `accent`.
- `line` só separa linhas de uma lista; todo controle (campo, select, botão secundário) usa `line-forte` (WCAG 1.4.11, 3:1).
- Escuro: `bg` → `surface` → `surface-2`, cada passo visível; sem sombra no escuro.
- **Nenhum hex fora de `:root`**, nem em `style=""` de JS.

## Typography
Seis tamanhos (`fs-1`…`fs-6`), três pesos (400, 600, 700; 800 só no número grande). Mínimo 12 px na tela, inclusive rótulo de gráfico (desenhar fora do SVG ou compensar a escala do viewBox). Números (hora, ID, valor) com `font-variant-numeric: tabular-nums`. Sem `text-transform: uppercase`. Sem "·" juntando 5 informações: meta vai em colunas fixas da linha.

## Layout
- Computador (≥ 1024 px): **barra lateral** de 232 px com os módulos e as abas do módulo aberto como 2º nível; topo de 56 px (busca, sino, tema, conta).
- Celular (< 1024 px): topo de 56 px + **barra inferior** com Início, Entregadores, Atividades, Avisos e Mais (decisão do usuário em 20/11/2026); abas do módulo num seletor rolável com sombra nas pontas.
- Conteúdo em coluna de até 1120 px; 16 px de margem lateral no celular; nenhuma rolagem lateral em 320 px.
- Alvo de toque: 44×44 no celular (`@media (pointer: coarse)`), 32 px de altura mínima no computador.

## Elevation & Depth
Duas camadas só: a página e "o que flutua" (janela, tira do sino, toast, tour). Uma sombra só para o que flutua no claro (`0 12px 32px rgb(20 53 43 / .18)`), nenhuma no escuro (borda `line-forte`). Hover não levanta cartão.

## Shapes
Quatro cantos: `r-1` 6, `r-2` 10, `r-3` 14, `pilula` 999. Nada de borda lateral colorida (side-tab), borda de cima colorida em quadrinho ou moldura tracejada.

## Components
- **Linha de fila** (Pendentes, Minha fila, Tratativas, Com restrição agora, Atenção, Acordos, Pendentes do financeiro): `[hora tabular] [o que é + quem, 1 linha] [pílula de situação] [ação principal] [⋯]`. Detalhe abre na própria linha (`details`) ou na janela. Nada repetido (nome/ID uma vez).
- **Barra de filtros com contagem** (Históricos, Lançamentos, Ativações): botões segmentados `Todos 15 · Com restrição 5 …` com `aria-pressed`, busca à esquerda, "Mais filtros".
- **Nota do Caderno** (pendência escrita como tarefa): título em frase, contexto em `muted`, um botão.
- **Entrada do diário**: grade `52px 1fr`, hora à esquerda, linha tracejada entre entradas, `**Fulano** fez tal coisa`.
- **Aviso urgente** (acordo vencido, ajuda): linha com fundo `bad-soft`, texto `bad`, o botão quebra para baixo em < 480 px.
- **Ícones**: só os de `js/icones.js` (grade 24, traço 1,75). Ícone nunca sozinho sem rótulo ou `aria-label`.

## Do's and Don'ts
- Faça: uma ação principal por linha; contador âmbar só para o que é da pessoa; texto ao lado de toda cor.
- Faça: medir antes de publicar (`npm run test:visual`, ver abaixo).
- Não faça: cartão dentro de cartão; faixa lateral; atalho que repete o menu; emoji; "bloqueio" em qualquer texto (na tela é "restrição"; para o entregador, "restrição temporária"); CPF em tela; código interno (`pendencia_resolvida`) em tela.

## Escrita
1. **Glossário (uma palavra para cada coisa):**
   - **Ativação**: pedido de entrada do entregador.
   - **Ficha**: o registro do entregador.
   - **Restrição**: o que antes se chamava bloqueio, em toda tela, aviso e extensão. Para o entregador, **restrição temporária**; o **encerramento de parceria** tem nome próprio.
   - **Infração leve**: nunca "(aviso)" na tela da equipe.
   - **Tarefa**: nunca "atividade" em texto.
   - **Pegar**: assumir uma tarefa.
   - **Aviso**: só o que chega no sino.
   - **Pendência**: os avisos rápidos de prestação de contas.
   - **Tratativa**: o contato depois da restrição.
   - **Excluir** para registro; **Remover** para pessoa ou acesso.
2. **Botões:** verbo + objeto ("Registrar adicional", "Excluir acordo"). Nada de "OK", "Sim" ou "Enviar" sozinhos. Confirmação repete o verbo ("Confirmar exclusão").
3. **Sucesso:** repete a palavra do botão no passado e diz só o que muda ("Adicional registrado. Falta lançar no sistema.").
4. **Erro:** o que falhou + como resolver, sem culpar a pessoa. Nunca código, inglês ou nome de função.
5. **Tela vazia:** o que é a lista + o próximo passo. Com filtro, "Limpar filtros".
6. **Números:** contador sempre com a palavra para o leitor de tela.
7. **Nada de** emoji, palavra_com_sublinhado, código de versão ("009x"), "toast", "RPC" ou nome de tabela.
8. **Nome da aba = começo do título da tela.**
9. **Ícone sozinho** sempre com `aria-label`. Seta (→, ←) é decoração, com `aria-hidden`.

## O que o teste já cobra (009y1)
A varredura visual do e2e (`testes/e2e.test.mjs`, 1200 e 390 px, todas as abas do administrador) e o teste de contraste falham com:
rolagem lateral, texto quebrado ("null", "NaN"), CPF, emoji, a palavra "bloqueio", texto < 4,5:1 (grande < 3:1), **borda de campo < 3:1**,
**placeholder < 4,5:1**, **cor escrita fora de `:root`** em `estilo.css` (teste estático) e **passo do tour apontando para algo que sumiu**.
Os demais itens da "Trava" acima entram tela a tela na 009y2, junto da troca de cartões por linhas.

## Trava (teste visual que impede a volta do desvio)
`testes/visual.test.mjs` (proposta; reaproveita a varredura do e2e), em 320, 390, 1024 e 1280, claro e escuro, em todas as abas permitidas ao administrador. Falha quando, nas telas já migradas (lista `MIGRADAS`, cresce a cada passo):
1. canto computado fora de {0, 6, 10, 14, 999 px, 50%};
2. tamanho de letra fora de {12, 13, 15, 17, 22, 28 px} (texto visível);
3. variações de botão (altura × canto × fundo × borda × letra) > 6;
4. `border-left`/`border-inline-start` ≥ 2 px em caixa com canto (side-tab) ou `border-top` ≥ 3 px em quadrinho;
5. alvo clicável < 44 px de altura em 320/390 acima do teto (teto baixa a cada versão);
6. `header`+navegação > 120 px em 320×568 ou > 64 px no computador;
7. borda de controle < 3:1, texto < 4,5:1, placeholder < 4,5:1;
8. `text-transform: uppercase`, caractere `\p{Extended_Pictographic}`, texto `/\b[a-z]+_[a-z_]+\b/` fora de `code`;
9. `impeccable detect` com `side-tab`, `border-accent-on-rounded`, `nested-cards`, `low-contrast`, `dark-glow`.
E um teste estático: nenhum hex/rgb literal em `estilo.css` fora de `:root` e nenhum `style:` com cor/canto/tamanho de letra em `js/*.js`.
