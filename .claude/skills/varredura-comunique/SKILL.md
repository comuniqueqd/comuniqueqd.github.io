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

## O time (lotes de 3 agentes por vez no modo completo, por causa do limite de uso)
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
| 3 | a13 | **Explorador de agentes** (agentes do dia a dia, especialistas novos, skills e plugins que valham a pena) | SearchPlugins, web |
| 3 | a14 | **Custos e limites do Supabase** (banco, tráfego, Realtime e CPU do plano; quando passar para o pago) | performance-optimization |
| 4 | a15 | **Treinamento e materiais da equipe** (tutoriais dentro do app, passo a passo, tour, dicas, materiais de cada versão) | frontend-design (escrita), impeccable (onboard) |
| 4 | a16 | **Produto e adoção** (o que a equipe usa de fato, avisos automáticos, mensagens rápidas, o que cortar, metas de uso) | product-management:product-brainstorming, data:analyze |
| 4 | a9 | **Revisor do contra** (tenta derrubar todo achado crítico/alto, aplica a régua, junta duplicados) — sempre o último | doubt-driven-development |

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
4. **Lotes de 3 a 4 agentes, em segundo plano.** Antes de cada lote, rodar de novo o `preparar.sh` (liga o Postgres, que desliga nas pausas por limite de uso). Se um agente parar por limite de uso, retomar com SendMessage (o trabalho fica salvo), não abrir outro. Repassar os `alerta` do registro.
5. **Revisor (a9)** por último, com a régua.
6. **Consolidar:** `python3 .claude/skills/varredura-comunique/scripts/consolidar.py <scratchpad>/varredura docs/revisoes/<versao>` → `mapa.json`, `placar.json` e a comparação com a rodada anterior; atualizar o mapa privado (artifact) com as visões Mapa mental, Objetivos, Telas, Como seguir, Precisa de você e Placar (antes × depois).
7. **Retrospectiva (obrigatória, sempre, nos dois modos):** responder por escrito ao usuário, com base no que aconteceu na rodada:
   - **Algum agente ficou de fora?** (tema sem dono, achado que caiu entre dois agentes, área nova do app)
   - **Algum agente pode ser incluído no projeto?** Pensar além da varredura: agentes que trabalhem no dia a dia do Comunique (ex.: um que roda a varredura leve toda semana sozinho, um que prepara o lançamento de cada versão com novidades, tour e materiais, um que testa a extensão nas telas reais, um que acompanha os números do Supabase) e skills ou plugins novos que valham a pena. Para cada candidato: para que serve, quando roda (sob pedido, a cada versão, agendado), o custo (uso e manutenção) e se precisa de algo do usuário.
   - **Algum processo ficou de fora?** (preparação, régua, registro, lotes, revisão, consolidação, o que deu retrabalho ou travou)
   - **Alguma ideia ficou de fora?** (o que os agentes sugeriram fora da missão, o que o mercado mostrou, o que o usuário pediu e não entrou)
   Propor as mudanças na receita; o que o usuário aprovar entra neste arquivo e no **Histórico da receita** abaixo.
8. Salvar relatórios, mapa e placar em `docs/revisoes/<versao>/` (sem dados reais; trocar qualquer CPF/telefone de teste por zeros).

## Formato da entrega (desde a v1.2)
Cada linha do registro já vem no formato do mapa do projeto (`docs/revisoes/009/mapa.json`), com `objetivo`, `tela` e **`versao`** (009y, 009z, 010, 011, 012, ext ou depois). O mapa é o plano do projeto inteiro: o agente lê o mapa antes e usa `mais_evidencia` em vez de repetir.

## Histórico da receita
- **v1 (15/11/2026, depois da varredura da 009):** 9 agentes viraram 12 (a10 Dados reais, a11 Extensão, a12 Textos e acessibilidade); lotes de até 5; régua de prioridade comum (o revisor ajustou 19 de 29 altos na 009); registro comum com `alerta` (o problema do schema.sql teve de ser avisado à mão); objetivo e tela marcados na origem (na 009 o orquestrador classificou por palpite); placar comparado; retrospectiva obrigatória (pedido do usuário).
- **v1.1 (15/11/2026):** a retrospectiva também pergunta se algum agente pode ser incluído no projeto como um todo (agentes do dia a dia, agendados, skills e plugins), não só na varredura (pedido do usuário).
- **v1.2 (20/11/2026, retrospectiva da varredura de 20/11):** lotes de 3 a 4 (o limite de uso parou 5 agentes de uma vez duas vezes); `preparar.sh` antes de cada lote (o Postgres desliga nas pausas); campo `versao` em cada item e leitura do mapa do projeto antes de começar; a13 Explorador de agentes vira membro fixo; entram a14 Custos e limites do Supabase, a15 Treinamento e materiais da equipe e a16 Produto e adoção (pedido do usuário); o revisor a9 é sempre o último.
- **v1.3 (21/11/2026, retrospectiva da varredura de 21/11, aprovada pelo dono):** lotes de 3 no modo completo (o limite de uso parou 4 agentes de uma vez); cada agente grava o relatório aos poucos (seção por seção), para o trabalho não se perder numa parada; o briefing aponta o CLAUDE.md enxuto (meta ~30 KB, história das versões em `docs/versoes/`) para cada agente gastar menos; o revisor sempre confere a massa contra os números reais do a10 antes de manter um "alto" (8 de 9 altos caíram por massa inflada ou dado de antes da correção); a consulta do a10 sai no começo e o painel Usage do Supabase é pedido junto.
