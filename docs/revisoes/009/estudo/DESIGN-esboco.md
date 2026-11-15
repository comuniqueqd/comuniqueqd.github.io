---
name: Comunique
description: A mesa da operação (ativação, bloqueios, tarefas e avisos da equipe), com o caderno do dia ao lado.
# ESBOÇO (estudo b3, 15/11/2026). Ainda não aplicado. Números de partida: placar do a4 (docs/revisoes/009/a4.md).
# Valores marcados "proposto" mudam o que existe hoje em estilo.css e precisam do ok do dono.
colors:
  # Identidade Dino (009q), sem mudança
  floresta: "#14352B"          # tinta, botão principal, topo/lateral no claro
  floresta-funda: "#0E2820"    # hover do botão principal
  jade: "#1F8A5B"              # símbolo e enfeites; nunca texto pequeno (4,33:1 no branco)
  jade-texto: "#18774E"        # links, foco, sublinhado da aba atual (5,5:1)
  ambar: "#E8A33D"             # SÓ "precisa de você"; sempre com texto floresta (6,2:1)
  areia: "#F4EFE6"             # fundo do Caderno (Início, Avisos > Equipe, Turno)
  papel: "#FFFDF8"             # nota de pendência no Caderno (proposto)
  # Neutros da Mesa (claro)
  mesa-fundo: "#F5F6F3"        # proposto; hoje #FAF7F1 em tudo
  superficie: "#FFFFFF"
  tinta: "#14352B"
  tinta-suave: "#4B5B54"       # meta, placeholder (7:1)
  linha: "#E5DED1"             # só divisória entre linhas de lista
  linha-forte: "#9C9385"       # proposto; borda de campo e controle (3,0:1 no branco)
  # Situação (sempre com texto)
  ok: "#1B7A46"
  ok-suave: "#E3F4EA"
  ruim: "#B3261E"
  ruim-suave: "#FBE7E5"
  atencao: "#8A5300"           # "perto do prazo" em texto; não é o âmbar
  atencao-suave: "#FBEFD9"
  neutro-suave: "#EEE9DF"
  # Tema escuro (verde-noite, 3 camadas com passo visível; proposto pelo a4 AP-15)
  noite-fundo: "#0E1A15"
  noite-superficie: "#16261F"
  noite-elevada: "#1E3229"
  noite-tinta: "#EDE7DB"
  noite-tinta-suave: "#A7B4AC"
  noite-linha: "#273A31"
  noite-linha-forte: "#5E7468" # 3,1:1 sobre noite-superficie
  noite-acao: "#6CCB9A"        # só ação principal e foco
typography:
  headline:
    fontFamily: "Manrope, 'Segoe UI', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  display:
    fontFamily: "Manrope, 'Segoe UI', system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.1
    fontFeature: "'tnum'"
  title:
    fontFamily: "Manrope, 'Segoe UI', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif"   # recomendado; hoje Inter
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "'tnum'"
  label:
    fontFamily: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  r1: "6px"      # etiqueta de texto, item de menu
  r2: "10px"     # campo, botão, lista, linha aberta
  r3: "14px"     # janela, painel, nota de pendência
  pilula: "999px" # só pílula de situação e contador
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
components:
  button-principal:
    backgroundColor: "{colors.floresta}"
    textColor: "{colors.areia}"
    rounded: "{rounded.r2}"
    padding: "0 16px"
    height: "40px"
  button-principal-hover:
    backgroundColor: "{colors.floresta-funda}"
  button-secundario:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.r2}"
    padding: "0 14px"
    height: "40px"
  button-perigo:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.ruim}"
    rounded: "{rounded.r2}"
    padding: "0 14px"
    height: "40px"
  button-link:
    textColor: "{colors.jade-texto}"
    padding: "0 4px"
    height: "40px"
  button-compacto:
    rounded: "{rounded.r2}"
    padding: "0 12px"
    height: "32px"
  campo:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.r2}"
    padding: "0 12px"
    height: "40px"
  linha-mesa:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    typography: "{typography.body}"
    padding: "8px 16px"
    height: "52px"
  entrada-diario:
    textColor: "{colors.tinta}"
    typography: "{typography.body}"
    padding: "10px 0"
  nota-pendencia:
    backgroundColor: "{colors.papel}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.r3}"
    padding: "14px 16px"
  pilula-situacao:
    textColor: "{colors.tinta}"
    typography: "{typography.label}"
    rounded: "{rounded.pilula}"
    padding: "2px 10px"
  contador-precisa-de-voce:
    backgroundColor: "{colors.ambar}"
    textColor: "{colors.floresta}"
    typography: "{typography.label}"
    rounded: "{rounded.pilula}"
    padding: "1px 8px"
  contador-neutro:
    backgroundColor: "{colors.neutro-suave}"
    textColor: "{colors.tinta-suave}"
    typography: "{typography.label}"
    rounded: "{rounded.pilula}"
    padding: "1px 8px"
  barra-lateral:
    backgroundColor: "{colors.floresta}"
    textColor: "{colors.areia}"
    width: "232px"
  topo:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    height: "56px"
  janela:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.r3}"
    padding: "24px"
---

# Design System: Comunique

## Overview

**Nome-guia: "A mesa com o caderno ao lado"**

O Comunique é a mesa de trabalho da operação: quem está no turno abre, vê o que espera por ela, age e volta para a fila. Quase tudo é **Mesa de Operação**: listas em linhas densas, colunas fixas, um botão principal por linha, cor só para dizer a situação e sempre acompanhada de texto. Ao lado da mesa fica o **Caderno de Campo**: as poucas telas em que a pessoa lê o dia (o que aconteceu, o que passou de um turno para o outro) viram diário, com hora à esquerda, frase de gente e papel areia.

A regra que separa as duas: **Mesa onde se trabalha a fila, Caderno onde se lê o dia.** Caderno: Início (parte de cima), Avisos → Toda a equipe, Passagem de turno, Resumo do dia do sino, linha do tempo da Ficha. Todo o resto é Mesa. As duas usam os mesmos tokens, o mesmo botão e a mesma pílula de situação; a areia é o único sinal de que se está no caderno.

A identidade é o Dino sério (009q): floresta, jade, âmbar e areia, Manrope nos títulos. O nome é sempre "Comunique". Nada de imagem da marca Quero, nada de emoji em tela nenhuma.

**Características:**
- Linhas, não cartões. Cartão só para o que é uma coisa à parte (janela, nota de pendência).
- Âmbar é raro de propósito: aparece só onde a pessoa precisa agir.
- Plano: profundidade por tom e linha, sombra só na camada que flutua.
- Português de gente, caixa normal, verbos claros.
- Funciona em 320 px sem rolagem lateral; alvos de 44 px no toque.

## Colors

Verde-floresta como tinta e estrutura, jade como enfeite, âmbar como chamado, areia como papel do diário.

### Primary
- **Floresta** (#14352B): tinta do texto no claro, barra lateral, botão principal.
- **Jade-texto** (#18774E): links, foco, sublinhado da aba atual. O **Jade** puro (#1F8A5B) fica no símbolo e em enfeites grandes; com texto pequeno não passa de 4,5:1.

### Secondary
- **Âmbar** (#E8A33D): contador e ponto de "precisa de você" (minha fila, tratativa minha, pedido de ajuda aberto para mim). Sempre com texto floresta em cima.

### Neutral
- **Fundo da Mesa** (#F5F6F3): fundo das telas de trabalho (proposto; hoje é #FAF7F1 em tudo).
- **Areia** (#F4EFE6) e **Papel** (#FFFDF8): só nas telas do Caderno.
- **Superfície** (#FFFFFF), **Tinta-suave** (#4B5B54, meta e placeholder), **Linha** (#E5DED1, divisória de lista) e **Linha-forte** (#9C9385, borda de campo e controle, 3,0:1).
- **Situação:** ok #1B7A46, ruim #B3261E, atenção #8A5300, com fundos suaves. Sempre ponto + texto ("Bloqueado", "Vence em 40 min"), nunca só a cor.
- **Escuro:** fundo #0E1A15, superfície #16261F, elevada #1E3229 (passo visível entre camadas), linha-forte #5E7468, ação #6CCB9A só em botão principal e foco. Topo e lateral no escuro usam a superfície com divisória, não a mesma cor do fundo.

### Named Rules
**A regra do âmbar.** Âmbar só quando a pessoa precisa agir. Aba atual, números da equipe, gráficos e enfeites não usam âmbar. Se tudo é âmbar, nada chama.
**A regra da cor com nome.** Toda cor de situação vem com a palavra ao lado. Faixa colorida na borda de cartão não existe.
**A regra da areia.** Areia só no Caderno. Numa tela de fila, areia é erro.

## Typography

**Títulos e números grandes:** Manrope (600–800)
**Texto:** Source Sans 3 (recomendado; hoje Inter). Alternativa: manter Inter.
**IDs:** Source Sans 3 com `tnum` e `letter-spacing: .02em`; IBM Plex Mono só se "Il1O0" ficarem ambíguos no teste.

**Caráter:** a geometria da Manrope dá o tom da marca nos títulos; a Source Sans 3, humanista e um pouco estreita, cabe mais numa linha de lista e lê bem acento, ç e til.

### Hierarchy (6 tamanhos, nenhum outro)
- **Display** (Manrope 800, 28px, 1.1, `tnum`): o dia na Início; número principal de um KPI. No máximo um por tela.
- **Headline** (Manrope 800, 22px, 1.25): título da tela (`h2`).
- **Title** (Manrope 700, 17px, 1.3): título de grupo ("Esperando análise 6"), título de janela.
- **Body** (Source Sans 3 400/600, 15px, 1.5): texto, linhas de lista, campos. Até 72ch em texto corrido.
- **Meta** (Source Sans 3 400, 13px, `tnum`): hora, quem, cidade, prazo nas colunas da linha.
- **Label** (Source Sans 3 600, 12px): pílula, contador, rótulo pequeno. Caixa normal. Nada abaixo de 12px, inclusive no eixo dos gráficos (rótulos em HTML ou com o tamanho corrigido pela escala do SVG).

Se a Source Sans 3 ficar pequena a 15px por ter o olho menor, o corpo vai a 16px e a escala vira 12/13/16/17/22/28: continuam 6.

### Named Rules
**A regra da caixa normal.** Nenhum `text-transform: uppercase`. Rótulo em caixa alta em 11px é difícil de ler e é marca de modelo pronto.
**A regra dos números em fila.** Hora, prazo, contagem e valor sempre com `font-variant-numeric: tabular-nums`.

## Layout

- **Moldura no computador (≥ 1024px):** barra lateral de 232px (módulos; abas do módulo aberto como sub-itens, com contador à direita) + topo de 56px (busca com Ctrl+K, sino, tema, conta). Conteúdo até 1120px, alinhado à esquerda.
- **Moldura no celular (< 1024px):** topo de 56px (símbolo, busca em ícone, sino, menu) + barra inferior com 4 destinos. Topo + navegação ≤ 120px em 320×568. Abas do módulo num seletor rolável com sombra nas pontas.
- **Pedido de ajuda** é parte da moldura: faixa visível em qualquer tela enquanto estiver aberto.
- **Mesa:** listas em linhas de 48–56px (até 2 andares no celular, ≤ 160px). Colunas fixas: quando · o quê · quem · cidade · situação · ação. Um botão principal, o resto em "…". Barra de filtros em cima: busca à esquerda, botões segmentados com contagem, "Mais filtros".
- **Caderno:** coluna única com mais respiro (24px entre blocos), hora à esquerda numa coluna de 52px, divisória tracejada entre entradas, o dia como divisória.
- **Espaçamento:** 4 / 8 / 12 / 16 / 24 / 32. Apertado dentro da linha (8–12), folgado entre grupos (24–32).
- **Listas longas:** "Mostrar mais" de 50 em 50; desenho por chave (a linha com o mesmo id é reaproveitada).

## Elevation & Depth

Plano por padrão. Profundidade vem do tom (fundo → superfície → elevada) e da linha. Sombra existe só para o que flutua por cima do resto: janela, tira do sino, aviso flutuante, balão do tour, menu "…".

### Shadow Vocabulary
- **Camada de cima** (`box-shadow: 0 8px 24px rgb(20 53 43 / .14)`): todas as camadas flutuantes, a mesma. No escuro, sem sombra: superfície elevada + borda linha-forte.

### Named Rules
**A regra do plano.** Lista, linha, painel e cartão não têm sombra nem sobem no hover.

## Shapes

Três cantos e uma pílula: **6px** (etiqueta, item de menu), **10px** (campo, botão, bloco de lista, linha aberta), **14px** (janela, painel, nota de pendência), **999px** só para pílula de situação e contador. Bordas de 1px; nenhuma borda colorida de 2–5px em lateral ou topo (exceção: a linha vertical da linha do tempo). Ícones: SVG de linha de um conjunto só, traço 1.9, 16 ou 20px.

## Components

### Buttons
Diretos e iguais em toda tela.
- **Forma:** canto 10px; altura 40px (padrão) ou 32px (compacto, só em tabela no computador; no toque a área sobe para 44px com padding ou `::after`).
- **Principal:** fundo floresta, texto areia (escuro: fundo #6CCB9A, texto #0E1A15). Um por linha ou formulário.
- **Secundário:** superfície, borda linha-forte, texto tinta.
- **Perigo:** texto e borda ruim; preenchido só no botão de confirmação de excluir/encerrar.
- **Link:** texto jade-texto sublinhado, área de 40px.
- **Foco:** contorno 2px jade-texto, afastado 2px. Hover: borda tinta-suave (secundário) ou floresta-funda (principal). Sem levantar, sem girar ícone.
- Rótulo = verbo + objeto ("Confirmar resolução"), sem "→".

### Pílula de situação e contador
- **Pílula:** ponto 7px + texto label 12px, fundo suave da situação. A cor repete a palavra; a palavra é que informa.
- **Contador âmbar:** só "precisa de você". **Contador neutro:** todo o resto.

### Linha (Mesa)
O componente central. Hora/prazo à esquerda em meta tabular; o quê em body 600; quem e cidade em meta; pílula de situação; botão principal; "…". Abrir a linha mostra observação, histórico e ações raras. Sem repetir na linha o que já está no título (nome e ID uma vez só).

### Barra de filtros
Busca à esquerda; botões segmentados com contagem (`Todos 15 · Bloqueados 5 · Revisar 3`) com `aria-pressed`; "Mais filtros" abre cidade, infração e pessoa. Substitui os quadrinhos de números. Último filtro lembrado por tela.

### Entrada de diário (Caderno)
Hora (meta, tabular, tinta-suave) numa coluna de 52px; frase "**Fulano** aprovou o cadastro de Maria" em body; divisória tracejada linha. O dia como título de grupo. A categoria é um ícone à esquerda, não uma etiqueta.

### Nota de pendência (Caderno, "precisa de você")
Papel #FFFDF8, borda linha, canto 14px, respiro 14×16. Título em title ("Falar com Maria sobre o atraso na coleta"), contexto em meta, ponto âmbar + "com você", um botão principal.

### Inputs / Fields
Superfície, borda linha-forte (3:1), canto 10px, altura 40px, placeholder em tinta-suave. Erro: borda e texto ruim, mensagem logo abaixo do campo (`aria-describedby`), todos os erros de uma vez, foco no primeiro. Ao abrir um formulário, o foco vai para o 1º campo.

### Navigation
Barra lateral floresta, item em body 600 areia-suave; item atual com fundo areia e texto floresta (sem âmbar); sub-itens recuados 12px. Celular: barra inferior de 4 destinos com ícone + rótulo, atual em jade-texto.

### Janela e aviso flutuante
Janela: canto 14px, respiro 24px, sombra da camada de cima, lista de dados (`dl`) em vez de chips. Aviso flutuante: um componente só (canto 10px), duração pelo tamanho do texto (4 a 10s), "Desfazer" quando a ação permite.

## Do's and Don'ts

### Do:
- **Do** usar linha para tudo o que é fila ou histórico; cartão só para janela e nota de pendência.
- **Do** escrever a situação em texto ao lado da cor ("Vence em 40 min", "Atrasada há 2 h").
- **Do** mostrar prazo como contagem ("vence em 3 h 20 min"), com a data no `title`.
- **Do** manter 6 tamanhos de letra, 3 cantos + pílula, 4 papéis de botão em 2 alturas.
- **Do** garantir 3:1 nas bordas de controle e 4,5:1 no texto, nos dois temas.
- **Do** dar 44×44px de área de toque no celular.
- **Do** chamar a punição de "restrição temporária" em toda mensagem gerada (regra jurídica).

### Don't:
- **Don't** usar faixa colorida na lateral ou no topo de cartão, linha ou quadrinho.
- **Don't** usar âmbar fora de "precisa de você" (nem na aba atual, nem em número da equipe).
- **Don't** usar emoji em tela, botão, aviso, notificação ou texto vindo do banco.
- **Don't** usar caixa alta, "→" em botão ou link (só em "informado → real") nem "·" juntando 5 informações (vira coluna).
- **Don't** pôr areia em tela de fila.
- **Don't** mostrar código interno ("pendencia_resolvida", "009s") para quem opera.
- **Don't** usar sombra em lista, painel ou no tema escuro; nem botão que sobe no hover.
- **Don't** criar canto, tamanho de letra ou cor fora dos tokens; um valor novo entra primeiro aqui.
- **Don't** usar imagens da marca Quero; o nome é sempre "Comunique".
