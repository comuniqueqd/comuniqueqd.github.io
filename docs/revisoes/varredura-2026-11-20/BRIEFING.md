# Varredura da 009x (publicada em 20/11/2026), olhando o projeto inteiro — briefing comum de todos os especialistas


Você é um especialista de um time que faz a **varredura (revisão) da versão 009x (publicada em 20/11/2026), olhando o projeto inteiro do Comunique**. Leia isto inteiro antes de começar.

## O projeto
- Repositório: `/home/user/comuniqueqd.github.io` (branch `identidade-dino-009q`). Leia o `CLAUDE.md` da raiz: ele descreve TODA a arquitetura, as regras e as decisões. Ele é a fonte da verdade.
- App web estático (index.html + estilo.css + js/*.js, sem build) de uma equipe de operação de entregas (ativação de entregadores, bloqueios, tarefas, financeiro, parceiros, avisos). Banco Postgres/Supabase: tudo por funções RPC em `supabase/*.sql`. Extensão do Chrome em `extensao/`.
- Interface e textos em português do Brasil. Escreva o seu relatório em português do Brasil, simples e direto (o dono do projeto não é programador).
- Direção visual aprovada: **"Mesa de Operação"** (listas em linhas, cor só para situação e sempre com texto, âmbar só para "precisa de você", ícones próprios de linha) **mesclada com o "Caderno de Campo"** (`guardado/caderno-de-campo/`: diário do dia, pendências escritas como tarefa, hora à esquerda). Identidade Dino (tokens em `estilo.css` :root). Regras permanentes: **nenhum emoji em tela**; mensagens geradas dizem "restrição temporária", nunca "bloqueio"; o Comunique não guarda CPF; repo público (nunca dados reais de entregadores).


## Foco desta rodada (pedido do dono, 20/11/2026)
- O mapa agora é o **plano do projeto inteiro**, não só da 009: `docs/revisoes/009/mapa.json` (229 itens, com `versao` planejada e `feito`) e a página `docs/revisoes/009/mapa.html`. **Leia o mapa antes de começar** e não repita item que já está lá: se o seu achado completa um item existente, use `mais_evidencia` com o id dele no registro.
- Além dos defeitos de hoje, pense **no futuro**: o que vai travar com o crescimento, o que falta para as próximas versões e o que pode ficar melhor. Roteiro atual: 009y Mesa de Operação (repaginada visual), 009z Base firme (testes, desempenho, regras, atalhos), 010 Comemorativa (desafios, tarefas flutuantes, menos trabalho), 011 Siga o dinheiro (financeiro e análises), 012 Segurança e dados (LGPD, backup, leis; adiados pelo dono), ext = Extensão 1.4, depois.
- Em cada linha do registro, acrescente o campo `"versao"` com a versão onde o item deveria entrar (uma das acima).
- O inventário do que existe hoje está em `docs/revisoes/estudo-2026-11/inventario.json` (15 áreas, 63 ferramentas) e o estudo de nov/2026 em `docs/revisoes/estudo-2026-11/` (e1–e4 e o revisor). Use para se orientar.

## Regras do time (obrigatórias)
1. **Só ler e medir.** NÃO edite arquivos do repositório, NÃO faça git commit/push/checkout. Arquivos que você criar (scripts de medição, prints, notas) vão SÓ na sua pasta: `/tmp/claude-0/-home-user-comuniqueqd-github-io/e8000799-92c2-5b51-bea0-7146c54c2e44/scratchpad/varredura2/<seu-id>/`.
2. **Seu banco e suas portas** (outros agentes rodam ao mesmo tempo; nunca use os dos outros nem o banco `teste`):
   - Postgres já ligado em 127.0.0.1:54329, usuário postgres sem senha. Seu banco: `teste_<seu-id>` (ex.: teste_a2).
   - Carregar o banco completo (apaga e recria tudo): `cd /home/user/comuniqueqd.github.io/testes && DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste_<id> node carregar-banco.mjs`
   - e2e e extensão aceitam portas por ambiente: `PORTA_SITE=<sua> PORTA_API=<sua> DATABASE_URL=... CHROMIUM=/opt/pw-browsers/chromium node e2e.test.mjs` (o e2e deixa prints em `testes/prints/` e `testes/prints/varredura/` — eles já existem de uma rodada recente; prefira LER os que existem a rodar o e2e de novo, que demora ~10 min e escreve na pasta comum; se rodar, rode só se precisar).
   - `testes/supabase-falso.mjs` imita o Supabase (`iniciarSupabaseFalso({porta, databaseUrl})`); JWT sem verificação: payload `{sub, email, role:"authenticated"}`. Veja como `testes/e2e.test.mjs` faz login e semeia dados — copie a técnica para seus próprios scripts (na sua pasta).
   - Chromium: `/opt/pw-browsers/chromium` (`require('playwright')` funciona de qualquer pasta; não instale browsers). Rodando como root: passe `--no-sandbox` quando lançar o Chrome à mão.
3. **Skills**: use a ferramenta Skill para carregar as skills indicadas na sua missão e siga o que elas recomendam (são as ferramentas novas do projeto). Instaladas: `design-taste-frontend` (Taste; scripts em ~/.claude/skills/design-taste-frontend/scripts, precisam de `CHROME_PATH=/tmp/claude-0/-home-user-comuniqueqd-github-io/e8000799-92c2-5b51-bea0-7146c54c2e44/scratchpad/chrome.sh`), `impeccable` (detector: `~/.claude/skills/impeccable/scripts/impeccable detect <arquivo|url>`; telemetria já desligada), `ponytail`, `ponytail-audit`, `ponytail-review`, `ponytail-debt`, `graphify` (o mapa já existe em `/home/user/comuniqueqd.github.io/graphify-out/`: GRAPH_REPORT.md, graph.json; `graphify query|explain|path|god-nodes`), as do Addy Osmani (`performance-optimization`, `security-and-hardening`, `debugging-and-error-recovery`, `test-driven-development`, `deprecation-and-migration`, `documentation-and-adrs`, `code-simplification`, `doubt-driven-development`, `interview-me`, ...), `ui-ux-pro-max:ui-ux-pro-max` (busca: `python3 /root/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.15.0/src/ui-ux-pro-max/scripts/search.py "<consulta>" --domain ux|style|typography|color|chart|product`), `frontend-design:frontend-design`, `modern-web-guidance:modern-web-guidance` (`npx -y modern-web-guidance@latest search|retrieve|legacy-scan`), `security-review`.
4. **Evidência sempre**: cada achado com onde (arquivo:linha ou tela), o que acontece, a prova (número medido, trecho de código, print salvo na sua pasta) e por que importa.
5. **Além da sua missão (pedido do dono)**: pense também em **sugestões nas proximidades do que você revisou** — melhorias nas telas, funções e fluxos vizinhos ao seu tema, mesmo que não sejam defeitos. Separe-as numa seção própria.
6. Seja honesto: se não conseguiu medir algo, diga o que faltou. Não invente números.


## Régua de prioridade (obrigatória)
- crítica: dado errado gravado, dinheiro errado, acesso indevido ou dado pessoal exposto, hoje.
- alta: trava ou atrasa a equipe toda semana, ou vai quebrar com o crescimento previsto em até 6 meses.
- média: atrito real com contorno, ou risco distante. baixa: acabamento, organização, gosto.
Esforço: pequeno (até ~1 h), médio (um dia), grande (vários dias ou migração).

## Registro comum (obrigatório)
Antes de escrever um achado, leia `/tmp/claude-0/-home-user-comuniqueqd-github-io/e8000799-92c2-5b51-bea0-7146c54c2e44/scratchpad/varredura2/registro.jsonl`. Se já existe, acrescente só evidência (`{"mais_evidencia":"<id>","ag":"<seu-id>","evidencia":"..."}`). Se é novo, acrescente uma linha JSON no formato do SKILL.md, já com **objetivo** e **tela**. Se descobrir algo que atrapalha os outros agentes durante a rodada, escreva uma linha `{"tipo":"alerta",...}`. Acrescente seus números de placar em `/tmp/claude-0/-home-user-comuniqueqd-github-io/e8000799-92c2-5b51-bea0-7146c54c2e44/scratchpad/varredura2/placar.json` (chaves curtas, ex.: "a2.resumo_e_avisos_ms").

## Entrega
Salve o relatório em `/tmp/claude-0/-home-user-comuniqueqd-github-io/e8000799-92c2-5b51-bea0-7146c54c2e44/scratchpad/varredura2/<seu-id>/relatorio.md` neste formato:

```
# <Seu tema> (<seu-id>)
## Resumo (3 a 5 linhas)
## Placar de base (números medidos hoje, para comparar na próxima revisão)
## Achados
### <id-curto> · <título> — prioridade: crítica | alta | média | baixa — esforço: pequeno | médio | grande
- Onde:
- O que acontece:
- Evidência:
- Sugestão:
- Como testar (o teste que provaria a correção):
## Sugestões nas proximidades
(mesmo formato, mais curto)
## O que não consegui verificar
```

Na sua resposta final (a mensagem que você devolve), mande só: o caminho do relatório, o número de achados por prioridade e os 3 achados mais importantes em uma linha cada.
