---
name: varredura-comunique
description: Receita da varredura (revisão) do Comunique com um time de agentes especialistas. Use quando o usuário pedir "rodar a varredura", "varredura leve", "varredura completa", "revisão da versão" ou "revisar a 0XX". Monta o time em lotes, dá a cada um banco e portas, aplica a régua de prioridade, junta tudo num registro comum, passa pelo revisor do contra, gera o mapa privado e o placar comparado com a rodada anterior e termina SEMPRE com a retrospectiva (agente, processo ou ideia que ficou de fora).
---

# Varredura do Comunique

Combinado com o usuário em 15/11/2026 a partir da varredura da 009 (`docs/revisoes/009/`). O Claude da sessão principal é o **orquestrador**: um sub-agente não consegue abrir outros agentes, então quem prepara, dispara os lotes, avisa os agentes, chama o revisor e consolida é sempre a sessão principal.

**Regra permanente:** antes de rodar, mostrar a spec (formato do CLAUDE.md) com o modo, os lotes e o que fica de fora. Nada muda no app durante a varredura (só ler e medir). O mapa e os relatórios são **organização interna do usuário com o Claude**: nunca entram no app.

## Dois modos
- **Leve (a cada versão publicada):** suíte de testes verde, detectores (Impeccable `detect`, Modern Web Guidance `legacy-scan`, varredura do e2e), placar comparado e o **a12 Textos e acessibilidade**. Sem os outros agentes. ~1 lote.
- **Completa (no fim de cada família de versões, ex.: fim da 009):** os 12 especialistas em 3 lotes + revisor + retrospectiva.

## O time (3 lotes, no máximo 5 agentes por vez, por causa do limite de uso)
| Lote | Id | Especialista | Skills principais |
|---|---|---|---|
| 1 base e números | a2 | Banco e servidor (massa fictícia, explain, bytes, tráfego) | performance-optimization, graphify, ponytail-audit |
| 1 | a5 | Regras e cálculos (punição, leves, prazos, fuso, semana, permissões) | debugging-and-error-recovery, test-driven-development, doubt-driven-development |
| 1 | a7 | Código e manutenção (sem uso, redefinidas, docs, testes, CI) | graphify, ponytail-audit/debt, deprecation-and-migration, documentation-and-adrs, code-simplification |
| 1 | a10 | **Dados reais** (consultas só leitura e só agregadas para o usuário rodar no SQL Editor; ver abaixo) | sql-queries, data:analyze |
| 2 uso e aparência | a1 | Operação (robô nos fluxos: cliques, campos, telas, tempo) | impeccable (critique, clarify, harden), ui-ux-pro-max, frontend-design (escrita) |
| 2 | a3 | Fluidez (tempo de tela, long tasks, INP, CLS, redesenho, peso) | modern-web-guidance, design-taste-frontend (perf.mjs), performance-optimization |
| 2 | a4 | Aparência e sistema visual (detector renderizado, desvio de tokens, 2 temas, 320/390/1024/1280) | impeccable, frontend-design, design-taste-frontend, ui-ux-pro-max |
| 2 | a11 | **Extensão** (leitura do Quero Log/Crisp com variações, login, loja, caminho de versões) | modern-web-guidance:chrome-extensions, security-and-hardening |
| 2 | a12 | **Textos e acessibilidade** (termos, verbo+objeto, aviso repete a palavra, erros e vazios que orientam, "restrição temporária", sem emoji, teclado, leitor de tela, contraste) | frontend-design (escrita), impeccable (clarify, audit), design-taste-frontend (copy) |
| 3 fora e contra | a6 | Segurança e LGPD | security-and-hardening, security-review |
| 3 | a8 | Mercado (comparativo; web se a rede deixar, senão marcar "não verificado hoje") | ui-ux-pro-max, impeccable (onboard) |
| 3 | a9 | **Revisor do contra** (tenta derrubar todo achado crítico/alto, aplica a régua, junta duplicados) | doubt-driven-development |

**a10 Dados reais:** tudo o resto mede com dados fictícios. O a10 escreve consultas `select` só de leitura que devolvem **números agregados** (nunca nome, ID, telefone ou texto livre de entregador): tamanho das tabelas, contagens por fluxo e por semana, "revisar" em aberto, fichas sem cidade, nomes repetidos, funções/telas usadas nos últimos 30 dias (pelas tabelas de eventos). O orquestrador entrega as consultas ao usuário, que roda no Supabase e cola o resultado; o a10 então interpreta. Ele nunca acessa o banco real.

## Régua de prioridade (todos usam a mesma)
- **crítica:** dado errado gravado, dinheiro errado, acesso indevido ou dado pessoal exposto, hoje.
- **alta:** trava ou atrasa a equipe toda semana, ou vai quebrar com o crescimento previsto em até 6 meses.
- **média:** atrito real, mas com contorno; ou risco distante.
- **baixa:** acabamento, organização, gosto.
Esforço: **pequeno** (até ~1 h, um arquivo), **médio** (um dia, poucos arquivos), **grande** (vários dias ou migração).

## Registro comum (contra repetição e para avisar os outros)
`<scratchpad>/varredura/registro.jsonl` — cada agente, ANTES de escrever um achado, lê o registro; se o problema já está lá, só acrescenta evidência ("mais_evidencia" com o id existente). Cada linha nova:
`{"id":"A4-03","ag":"a4","tipo":"achado|sugestao|alerta","titulo":"...","prio":"crítica|alta|média|baixa","esforco":"pequeno|médio|grande","objetivo":"menos|esforco|analises|rapidez|aparencia|regras|seguranca|base","tela":"inicio|navegacao|ativacao|bloqueios|ficha|tarefas|avisos|analises|financeiro|parceiros|equipe|extensao|geral","onde":"arquivo:linha ou tela","evidencia":"...","sugestao":"...","teste":"o teste que provaria a correção","junto":"id de outro achado ou vazio"}`
`tipo:"alerta"` é para o que afeta os outros agentes durante a rodada (ex.: "o schema.sql não apaga tudo; recriem o banco"); o orquestrador repassa na hora a quem ainda está rodando.

## Passo a passo
1. **Spec** da rodada (modo, lotes, versão de referência) e ok do usuário.
2. **Preparar:** `bash .claude/skills/varredura-comunique/scripts/preparar.sh <ids...>` (liga o Postgres, recria cada `teste_<id>` do zero e carrega todas as migrações). Portas: `PORTA_SITE=88NN`, `PORTA_API=544NN` (NN = número do agente).
3. **Briefing:** copiar `briefing.md` para `<scratchpad>/varredura/BRIEFING.md`, preencher versão e pastas. Pedir também ao a10 as consultas logo no começo (o usuário demora para rodar).
4. **Lote 1 → Lote 2 → Lote 3**, em segundo plano. Se um agente parar por limite de uso, retomar com SendMessage (o trabalho fica salvo), não abrir outro. Repassar os `alerta` do registro.
5. **Revisor (a9)** por último, com a régua.
6. **Consolidar:** `python3 .claude/skills/varredura-comunique/scripts/consolidar.py <scratchpad>/varredura docs/revisoes/<versao>` → `mapa.json`, `placar.json` e a comparação com a rodada anterior; atualizar o mapa privado (artifact) com as visões Mapa mental, Objetivos, Telas, Como seguir, Precisa de você e Placar (antes × depois).
7. **Retrospectiva (obrigatória, sempre, nos dois modos):** responder por escrito ao usuário, com base no que aconteceu na rodada:
   - **Algum agente ficou de fora?** (tema sem dono, achado que caiu entre dois agentes, área nova do app)
   - **Algum processo ficou de fora?** (preparação, régua, registro, lotes, revisão, consolidação, o que deu retrabalho ou travou)
   - **Alguma ideia ficou de fora?** (o que os agentes sugeriram fora da missão, o que o mercado mostrou, o que o usuário pediu e não entrou)
   Propor as mudanças na receita; o que o usuário aprovar entra neste arquivo e no **Histórico da receita** abaixo.
8. Salvar relatórios, mapa e placar em `docs/revisoes/<versao>/` (sem dados reais; trocar qualquer CPF/telefone de teste por zeros).

## Histórico da receita
- **v1 (15/11/2026, depois da varredura da 009):** 9 agentes viraram 12 (a10 Dados reais, a11 Extensão, a12 Textos e acessibilidade); lotes de até 5; régua de prioridade comum (o revisor ajustou 19 de 29 altos na 009); registro comum com `alerta` (o problema do schema.sql teve de ser avisado à mão); objetivo e tela marcados na origem (na 009 o orquestrador classificou por palpite); placar comparado; retrospectiva obrigatória (pedido do usuário).
