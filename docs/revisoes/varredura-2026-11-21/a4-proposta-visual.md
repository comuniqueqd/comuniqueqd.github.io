# Proposta visual: "Mesa limpa" (a4, varredura da 009z4, 21/11/2026)

Pedido do dono: "quero o projeto mais bonito, mais conciso e com um visual mais moderno".
O que não muda: a identidade Dino (floresta, jade, âmbar, areia; Manrope + Inter), a Mesa de Operação com o Caderno de Campo, nenhum emoji, o nome "Comunique" e o DESIGN.md (esta proposta **aplica** o que ele já diz e acrescenta o que falta).

Protótipos (HTML estático com os tokens do `estilo.css`, dados fictícios): `a4/proto/depois-*.html`.
Prints: `a4/antes-{inicio,fila,pendentes}-{390,1280}.png` × `a4/depois-{inicio,fila,pendentes}-{390,1280}.png` (+ `depois-inicio-390-escuro.png`). Todos com deviceScaleFactor 2.

## O diagnóstico em uma frase
O app já tem uma identidade boa e quase nenhum erro de "IA" grosseiro (zero emoji, zero caixa alta, zero cor fora dos tokens). O que o deixa com cara de antigo e carregado é **estrutura**: caixa em volta de tudo (45 regras do CSS desenham uma caixa), três barras de navegação empilhadas, 5 a 7 botões por item, o mesmo número em três lugares e um subtítulo explicando cada tela. O DESIGN.md já descreve a saída; o CSS ainda não a seguiu (11 cantos, 13 tamanhos de letra, 22 espaçamentos e 20 variações de botão renderizados).

## Princípios (7)
1. **Uma superfície por tela.** Fundo + listas. Caixa só para a lista (um contorno com divisórias entre as linhas) e para o que flutua (janela, tira, toast). Nada de cartão dentro de cartão, nem caixa por frase.
2. **Uma ação por linha.** A ação principal fica visível; o resto vai para o "..." (Realocar, Gerar mensagem, Previsão, Comentar, Excluir, Pedir para alguém). Onde a linha leva a um lugar, a linha inteira é o link, com a seta.
3. **Cada número uma vez por tela.** O contador do menu diz "tem coisa sua"; a tela diz o quê. Nada de "Seus números" repetindo o "Precisa de você".
4. **O título basta.** Sem subtítulo que explica a tela. Ajuda vira uma frase no estado vazio ou ao lado do campo que precisa dela.
5. **Hierarquia pela letra e pelo espaço, não pela caixa.** Escala do DESIGN.md (12/13/15/17/22/28) com passo de 1,25 entre papéis; seções separadas por 32 px, não por bordas.
6. **Cor só com sentido.** Verde = ação e "feito"; vermelho = atrasado; âmbar = "é seu" (contador e marca da aba atual). Nada de fundo colorido decorativo (o degradê verde das notícias sai).
7. **Tempo de um jeito só.** Prazo regressivo ("vence em 23 h", "venceu há 1 dia") à direita, em número tabular. Data completa só no detalhe.

## Mudanças de sistema
| Item | Hoje (medido) | Proposta |
|---|---|---|
| Espaço | 22 valores soltos (1 a 48 px) | `--s1..--s6` = 4/8/12/16/24/32; seção = 32, grupo = 24, linha = 12×16 |
| Cantos | 11 (3px é o mais usado: 518 elementos) | 6 (pílula de texto), 10 (controle), 14 (lista e janela), 999 (pílula de situação) |
| Sombra | 3 + bordas em tudo | nenhuma na página; uma só no que flutua; sem sombra no escuro |
| Superfícies | 25 fundos | `bg` (página) → `surface` (lista) → `gray-soft` (seg e ícone de tipo); escuro com `surface-2` |
| Tipografia | 13 tamanhos, h3 14 < corpo 15 (detector: flat-type-hierarchy) | h1/h2 de tela 22 Manrope 700; grupo 17 Manrope 700; corpo 15; linha 13; meta 12; número 28/800 |
| Densidade | 300-350 px por item na Minha fila (390) | 56-64 px por linha fechada; ~150 px com ações no celular |
| Cartão/linha | 45 estilos de caixa no CSS | **um**: `.lista > li > .linha` (grade: [hora ou ícone] [título + meta 1 linha] [prazo] [pílula] [ação] [...]) |
| Botões | 20 variações (1280), 2 cores de principal (floresta e verde), média 7,5 por tela | 3 papéis: principal (accent cheio), secundário (contorno line-forte), terciário (texto accent); 36 px no computador, 44 no toque; "..." como botão-ícone |
| Cabeçalho de seção | h3 com contagem em bolha verde | título 17 + contagem em cinza ao lado ("Pedidas para você 4"); grupo atrasado com o título em vermelho |
| Navegação (computador) | barra lateral + pílulas do grupo + abas numa faixa floresta (até 170 px antes do título) | barra lateral com as abas do módulo como 2º nível (marca âmbar na aba atual); topo claro de 56 px só com busca (Ctrl K), sino e conta |
| Navegação (celular) | topo + pílulas do grupo + abas na faixa escura + barra de baixo | topo de 56 px + barra de baixo (como hoje); abas num seletor rolável abaixo do título, fora da faixa escura |
| Filtros | 3 a 6 selects empilhados | segmentado com contagem (`Tudo 13 · Vence hoje 2 · Tratativas 3`) + busca + "Mais filtros" |
| Etiquetas | 4 estilos, 10-11 px, tracejado | uma pílula de 12 px; o tipo vira o ícone da linha |
| Conta e tema | nome, papel, lua e "Sair" no topo | botão redondo com as iniciais (menu: tema, histórico de atualizações, sair) |

## Tela a tela: o que cortar e juntar
**Início.** Fica: dia + saudação + **uma frase-resumo** ("13 coisas esperam por você, 1 atrasada"); Acontecendo agora (ajuda e aviso geral em linhas, com a ação); **Precisa de você** em linhas-link (sem os 6 botões "Ver"; a linha atrasada em vermelho; a meta de cada linha diz o mais urgente: "o mais antigo espera há 3 h"); uma fileira de 4 botões: **Registrar...** (menu com as 8 criações, as mesmas do Ctrl+K), Pedir ajuda, Aviso geral, Passar o turno; **Hoje na equipe** = Notícias + Parceiros num diário com a hora à esquerda. Sai: **Seus números** (repete o Precisa de você e o menu; o detalhe já está nas Análises), os 8 atalhos coloridos, o cartão "Histórico de atualizações" (vai para o menu da conta), "Primeiros passos" vira uma linha só no topo enquanto existir. Cidades sem responsável fica uma linha discreta no fim. Antes 2.618 px no celular (e2e) → protótipo 1.411 px com mais informação útil acima da dobra.

**Minha fila.** Título sem subtítulo; segmentado com contagem (Tudo, Vence hoje, Tratativas, Cadastros, Tarefas) no lugar do botão "Vence hoje" solto; grupos **Atrasado → Com você → Pedidas para você → Cadastros e restrições → Da equipe**; cada item é uma linha com ícone do tipo, título, 1 linha de contexto, prazo e uma ação ("Tratar", "Concluir", "Eu faço", "Revisar"); o resto no "...". O item em andamento abre na própria linha (progresso, "Aguardando terceiro", Comentar, Checklist). Sai: etiqueta "Restrições"/"Ativação" em cada cartão, "Opcional para os outros" tracejado, "Sobre o quê:", a caixa cinza da descrição, "Por Fulano · 20/11/2026, 23:48 · CIDADE · Para todos · Prazo:" e "esperando há" junto de "vence em". As 4 linhas de explicação de "Atividades da equipe" viram a meta da linha ("Todos participam · 0 de 5"). Medida: ~350 px por item → ~150 px no celular.

**Tarefas (Quadro da equipe).** Mesma linha da Minha fila; "Nova tarefa" vira botão principal no topo que abre a janela (não um `details` no meio da tela); "Pegar a próxima" como botão secundário ao lado. Recorrentes e prazos por tipo vão para uma aba ou janela "Configurar" (quase sem uso, A10-22).

**Tratativas e Com restrição agora.** A grade de 8 rótulos sai: linha com nome + ID uma vez, "Mal uso · 1ª · 48 h · Lagarto", prazo/"libera em 27 min" à direita, ação principal (Tratar / Liberar antes do prazo) e "...". "Pendentes / Concluídas" vira o segmentado com contagem.

**Pendentes (ativação).** Título "Pendentes" (igual à aba); segmentado "Aguardando análise 4 · Novo contato 1" no lugar do select de situação; busca e cidade na mesma linha; cada cadastro numa linha: espera à esquerda (âmbar ao passar de 2 h), nome + ID em mono **uma vez**, cidade · quem enviou · observação, Aprovar (principal) · Reprovar (contorno vermelho) · "..." (Detalhes, Completar, Previsão). "Sem nome" já diz o que falta: a pílula "revisar/falta o nome" sai; fica só "ficha com outro nome". Motivo da reprovação vira texto vermelho na linha, sem caixa rosa.

**Nova restrição.** Formulário numa coluna de 560 px, sem caixa em volta; a prévia da punição fica fixa à direita no computador (já existe) e embaixo do botão no celular; "Restrição / Infração leve (aviso)" como segmentado no topo, sem "(aviso)".

**Ficha do entregador.** Cabeçalho com nome, ID (copiável), cidade e situação numa linha; abaixo, o diário (linha do tempo) com a hora à esquerda; ações (Comentar, De olho, Nova restrição) numa fileira só.

**Avisos.** "Para mim" e "Toda a equipe" no formato diário (hora · frase); sai a etiqueta "Para você" em cada linha da aba "Para mim"; data completa só no dia (cabeçalho "sexta-feira, 20/11"). As duas caixas de configuração ("O que você acompanha", "Cidades sem responsável") vão para um botão "Preferências" que abre a janela.

**Análises.** Números grandes soltos na página (28 px + rótulo 12 px), sem caixa por número e sem borda colorida em cima; cada bloco com título e no máximo uma frase; texto de gráfico a 12 px; as 4 abas ficam, o "Painel das tarefas" perde as metas (sem uso, vão para Minha fila → "...").

**Financeiro.** Lançamentos: a lista primeiro; o resumo (4 números) numa faixa de números soltos acima, e os 6 cartões de barras vão para as Análises (ou um `details` "Ver por cidade, motivo e origem"). Registrar adicional: uma coluna, "Seus últimos registros" vira uma lista curta abaixo do botão.

## Ordem de aplicar (cada passo publicável sozinho, com print antes/depois)
1. **Base** (pequeno): tokens de espaço e canto no `:root`; escala de letras e hierarquia (A4-20); botões em 3 papéis (A4-24); pílula única (A4-27). Nada muda de lugar.
2. **Componente linha** (médio): `.lista/.linha` + "..." (menu); aplicar em Pendentes e Minha fila (A4-22).
3. **Navegação** (médio): abas na barra lateral, topo claro (A4-21).
4. **Início** (pequeno): cortes acima (A1-20, A1-23, A4-23).
5. **Restrições** (médio): Tratativas e Com restrição agora em linhas (A4-25).
6. **Avisos, Análises, Financeiro** (médio): diário e números soltos (A4-28).
7. **Trava**: a varredura do e2e passa a cobrar cantos, tamanhos, variações de botão, altura por item e "nada de caixa dentro de caixa" (o DESIGN.md já lista; falta ligar).

## Avaliação rápida (impeccable critique, modo degradado)
⚠️ DEGRADED: single-context (sem ferramenta de sub-agente nesta sessão; avaliação e detector rodaram no mesmo contexto, avaliação feita antes de ler o detector).

| # | Heurística | Nota | Ponto principal |
|---|---|---|---|
| 1 | Situação do sistema | 3 | prazos regressivos e contadores bons; tempos que se contradizem no cartão |
| 2 | Linguagem do mundo real | 3 | "restrição", "tratativa" ok; "atividade" × "tarefa" convivem |
| 3 | Controle e liberdade | 3 | Desfazer e detalhes existem; Excluir solto ao lado das ações |
| 4 | Consistência | 2 | duas cores de principal, 4 etiquetas, 20 variações de botão, 3 barras |
| 5 | Prevenção de erro | 3 | confirmação de adicional repetido, prévia da restrição |
| 6 | Reconhecer em vez de lembrar | 3 | Ctrl K e contadores; abas escondidas em 3 níveis |
| 7 | Flexibilidade e eficiência | 2 | 5-7 ações por item; nenhuma ação em lote |
| 8 | Estético e minimalista | 1 | caixa em tudo, número repetido, subtítulos longos |
| 9 | Recuperação de erro | 3 | erros em português desde a 009z1 |
| 10 | Ajuda | 3 | ajuda abundante (até demais) |
| **Total** | | **26/40** | Aceitável; o gargalo é o 8 |

Detector (`impeccable detect --cdp`, 31 abas): 116 avisos em 1280 claro (era 150 em 20/11) e 81 em 390 escuro (era 145). Sobram: undersized-ui-text 33 (Análises), nested-cards 7 em 5 telas, border-accent-on-rounded 2, side-tab 2 (atalhos da Início), flat-type-hierarchy (Início), straggler 5. `overused-font` (Inter) e `cream-palette` aparecem em todas as telas: são decisões da identidade (o revisor da identidade mandou não trocar as fontes), não erro.

Pergunta para o dono decidir antes do passo 3: **tudo bem trocar o topo floresta por um topo claro no computador** (a cor da marca fica na barra lateral inteira)? É a mudança que mais "moderniza", e a única que muda a cara à primeira vista.
