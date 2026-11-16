# Briefing comum: revisão da identidade visual do Comunique (15/11/2026)

## O produto
Comunique: app web interno da equipe de operação de uma empresa de delivery do Nordeste (monitoramento e suporte a entregadores parceiros). Telas: ativação de entregadores, bloqueios (restrições), tarefas, avisos, análises, financeiro, parceiros. Usuários: ~11 pessoas da operação, o dia inteiro no Chrome/Edge, computador e celular. Também tem uma extensão do Chrome (painel lateral).
Repositório (só leitura para você): /home/user/comuniqueqd.github.io
- estilo.css (tokens em :root, tema escuro), index.html (símbolo SVG inline no topo e na tela de entrada), js/icones.js (ícones SVG próprios, ~36), privacidade.html, manifest.webmanifest, icones/
- extensao/painel/ (painel lateral com a mesma identidade)
- identidade/dino-comu/ (kit: tokens.css, simbolo.svg, simbolo-sem-fundo.svg, icones/, README.md)
- testes/prints/varredura/ (60 prints de todas as telas em 1200px e 390px, tema claro)
- CLAUDE.md (história e decisões; procure 009l, 009q, 009r, "Linha editorial estética", "Sem emojis")
- guardado/caderno-de-campo/ (direção guardada "Caderno de Campo")

## A identidade atual: "Dino sério" (009q)
Verde-floresta #14352B (cabeçalho, botões, texto), jade #1F8A5B (símbolo), accent #18774E (texto/links), âmbar #E8A33D (aba atual, alertas, "precisa de você"), areia #F4EFE6, fundo #FAF7F1; escuro verde-noite (#0F1C17, accent #6CCB9A). Fontes Manrope (títulos) + Inter (texto). Símbolo: cabeça de dino geométrica com duas plaquinhas âmbar. Nome sempre "Comunique".

## Regras fixas (não proponha contra elas sem dizer explicitamente que é uma exceção para o usuário decidir)
- Nada de imagens da marca da empresa (Quero Delivery) no app; o nome é "Comunique".
- Sem emojis em nenhuma tela do app/extensão; ícones = SVG de linha de um conjunto só. Emojis/figurinhas são permitidos FORA do app (WhatsApp, chat da equipe).
- Direção editorial escolhida: "Mesa de Operação" (listas em linhas, cor só para situação e sempre com texto, âmbar só para "precisa de você") mesclada com "Caderno de Campo".
- Mensagens para entregadores dizem "restrição temporária", nunca "bloqueio".

## Como trabalhar
- Só leitura e medição: NÃO altere nada no repositório. Escreva só no seu arquivo de saída e na sua pasta.
- Use as skills indicadas (ferramenta Skill) quando existirem; se uma não carregar, siga sem ela e diga.
- Cada achado com EVIDÊNCIA (arquivo:linha, print, número medido, link/fonte).
- O usuário pediu TODO tipo de sugestão de melhoria: além de problemas, traga ideias, oportunidades e "nas proximidades" do que você revisou.
- Régua de prioridade: [3] agir já (quebra, ilegível, contraste reprovado, incoerência grave) · [2] importante (melhora clara, esforço razoável) · [1] bom ter · [0] só registro.
- Esforço: P (horas) · M (um dia) · G (uma versão).
- Português do Brasil, frases curtas, sem emojis.

## Formato da saída (arquivo <seu-id>.md na pasta do briefing)
1. Resumo em 5 linhas e uma NOTA de 0 a 10 para a sua dimensão, com a justificativa.
2. Tabela de achados: id (ex.: M-01) | prioridade | esforço | o que vi (evidência) | sugestão.
3. Sugestões livres (ideias que não são problema), também com prioridade.
4. O que NÃO mudar (o que está bom e deve ficar), com o porquê.
5. Para o revisor do contra: os 3 achados de que você tem menos certeza.
