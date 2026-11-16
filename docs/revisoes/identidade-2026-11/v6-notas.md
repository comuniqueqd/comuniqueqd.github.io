# v6 Ilustrador: notas de desenho (16/11/2026)

Skills: `ui-ux-pro-max:design` (carregou; o gerador de ícone dela usa API externa, então não foi usado: tudo em SVG escrito à mão) e `frontend-design:frontend-design` (prancha). Nada foi alterado no repositório.

## Arquivos
- Símbolo: `simbolo-refinado.svg`, `simbolo-pequeno.svg`, `simbolo-escuro.svg`, `simbolo-mono.svg`, `alt-placas.svg`, `alt-c.svg`; folha `simbolos.png` (16, 24, 32, 64, 192 px, claro e escuro, topo floresta, cinza).
- Mascote: `cena-nada-pendente.svg`, `cena-passando-o-bastao.svg`, `cena-precisa-de-voce.svg`, `cena-ajuda-chegando.svg`, `cena-lupa-no-revisar.svg` (240x240).
- Emoticons: `emoticons/*.svg` (18, 64x64).
- Figurinhas: `figurinha-bom-dia`, `-comigo`, `-ja-vem-gente`, `-conferindo`, `-passei-o-turno`, `-valeu` (256x256, contorno branco).
- `prancha.html` (+ `prancha.png` 1200 px, `prancha-celular.png` 390 px, sem rolagem lateral: scrollWidth 390), `folha-revisao.png` (cenas a 240 e 120 px, emoticons a 64 e 24 px, claro e escuro).
- `_ferramentas/gerar.py` gera cenas, figurinhas e emoticons a partir das mesmas peças (cabeça do símbolo, corpo, olhos, bocas, plaquinhas); `prancha.py` monta a prancha. Mudar uma peça muda todas.

## Decisões de desenho
1. **Fundo do quadrado vira floresta** (M-01). Âmbar sobre jade dá 2,01:1 e nenhum âmbar ou jade de token passa de 3:1 entre si; âmbar sobre floresta dá 6,19:1. O jade fica no olho do símbolo grande (3,78:1 sobre areia) e no corpo do mascote. É a mudança de maior peso: o símbolo deixa de ser "o quadrado verde-jade".
2. **Silhueta em curvas**, sem degraus retos (M-02): crânio em arco, focinho redondo, recorte da boca arredondado, plaquinhas maiores com cantos suaves. O dino do Chrome é de blocos (pixel); o nosso não tem nenhum canto de 90 graus visível.
3. **Olho recuado para a massa da cabeça.** Na primeira versão do pequeno, olho dentro do focinho + recorte da boca liam como **alça de caneca** em 24 px. Recuar o olho resolveu (ver `folha-revisao.png` e a folha de pixels).
4. **Pequeno (16 a 23 px)** é outro desenho na grade de 24, não a redução: cabeça ocupa ~75% do quadrado, olho floresta (11,65:1), plaquinhas com 3 px de base em 16 px.
5. **Escuro** = sem quadrado, cabeça areia, olho #0F1C17 (M-03). **Mono** = máscara com olho vazado e respiro de 3,5 px entre plaquinhas e cabeça; usa `currentColor`.
6. **Mascote** usa a cabeça exata do símbolo sobre um corpo em pera, barriga areia, braços curtos (traço redondo de 14), rabo e perna de trás no jade escuro (#18774E) para dar profundidade sem degradê. Plaquinhas **apagadas** (#18774E) nas cenas calmas e **acesas** (âmbar) só em "precisa de você", "ajuda" e "revisar".
7. **Cenas em papel areia na prancha também no tema escuro** (jeito Caderno de Campo): o mascote foi desenhado para papel claro; a sombra do chão (#E5DED1) ficaria estranha sobre o verde-noite.
8. **Emoticons**: jade com olho floresta, sem contorno (v5 pedia areia com contorno floresta; troquei para ficar igual ao mascote e sem contorno pesado). Só mudam olho, boca, plaquinhas e no máximo um objeto. Chuva e São João escondem as plaquinhas (capuz, chapéu).
9. **Sem dino em erro de conexão**: a cena "Sem conexão" do v5 não foi desenhada, de propósito.

## Contraste medido (WCAG 2, relação de luminância)
| Par | Antes | v6 |
|---|---|---|
| Plaquinhas âmbar contra o fundo do símbolo | 2,01:1 (jade) | **6,19:1** (floresta) |
| Cabeça areia contra o quadrado | 3,78:1 | 11,65:1 |
| Olho contra a cabeça | 3,78:1 | 3,78:1 (jade, grande), 11,65:1 (floresta, pequeno) |
| Símbolo sem fundo sobre #0F1C17 | 1,31:1 | 15,30:1 cabeça, 8,12:1 plaquinhas |
| Quadrado contra o topo floresta | 3,08:1 | 1:1 (o quadrado some, a cabeça fica a 11,65:1; leitura melhor que antes) |
| Mascote: plaquinhas âmbar contra o fundo #FAF7F1 | – | **2,02:1** (abaixo de 3:1; ver dúvidas) |
| Mascote: corpo jade contra #FAF7F1 / #0F1C17 | – | 4,05:1 / 4,04:1 |
| Emoticon: olho floresta sobre jade | – | 3,08:1 (no limite) |

## O que ficou bom
- O refinado lê como bicho de 32 a 192 px e o pequeno lê em 16 px (plaquinhas âmbar visíveis, olho visível). No topo floresta, a cabeça areia aparece mais que o selo jade de hoje.
- O **C com plaquinhas** ficou mais forte do que eu esperava: é dino, é letra, não lembra o Chrome.
- O mascote reaproveita a cabeça do símbolo: parece da mesma família sem esforço.
- As 5 cenas leem a 120 px pela silhueta e pelo objeto (xícara, prancheta, placa, caixa, lupa).

## O que ainda pede mão de ilustrador humano
- **Mãos e objetos**: os braços são traços redondos que encostam no objeto; a xícara e a prancheta não estão "seguradas" de verdade. Um ilustrador resolve pega, dedos curtos e peso.
- **Pose de corrida** (ajuda chegando): o corpo inteiro só gira 10 graus; falta dinâmica (ombro, perna de trás estendida).
- **Pescoço**: herdado do símbolo, é um retângulo reto; no corpo inteiro fica um pouco "de encaixe". Merece transição suave.
- **Emoticons em 24 px**: a forma lê, mas as diferenças entre neutro, foco e piscando somem. Em perfil só há um olho; "piscando" não convence. Uma versão 3/4 com dois olhos resolveria (v5 deixou aberta).
- **Chuva** (capuz) é a mais fraca: lê como uma forma âmbar solta.
- Folha de modelo (frente, perfil, 3/4) para outros desenharem igual (S-02 do v5).

## Para o revisor do contra: 3 pontos de menor certeza
1. **Trocar o jade pelo floresta no quadrado.** Resolve o contraste com folga, mas o símbolo perde a cor que o identifica hoje e fica escuro como o topo (no topo, o quadrado some). Alternativa a testar: manter jade e tirar as plaquinhas para fora do quadrado (sem fundo), ou aceitar o C.
2. **A silhueta curva basta para fugir do dino do Chrome?** Ainda é um perfil virado para a direita com recorte de boca. Só um teste com 3 ou 4 pessoas da equipe (M-02 do v1) responde. Se confundir, o C com plaquinhas é o plano B.
3. **Plaquinhas do mascote a 2,02:1 contra o fundo claro.** Elas encostam no corpo jade (2,01:1) e no fundo areia; leem pela forma e pelo tamanho, não pelo contraste. Em figurinha o contorno branco não ajuda. Se for problema, dar às plaquinhas do mascote uma base floresta fina (vira contorno) ou desenhar o mascote sempre sobre papel floresta.
