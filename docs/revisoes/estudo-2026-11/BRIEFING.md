# Estudo de novas funções, problemas e sugestões (nov/2026) — briefing comum

Você faz parte de um time pequeno que estuda o **Comunique** para propor o que vem depois da versão 009.
Leia isto inteiro antes de começar.

## O projeto
- Repositório: `/home/user/comuniqueqd.github.io` (branch `identidade-dino-009q`). Leia o `CLAUDE.md` da raiz:
  ele descreve a arquitetura, as regras permanentes e as decisões já tomadas. É a fonte da verdade.
- App web estático (index.html + estilo.css + js/*.js) de uma equipe de operação de entregas: ativação de
  entregadores, bloqueios (restrições temporárias), tarefas, financeiro (adicionais, ajuste de bairro, acordos),
  parceiros, avisos, análises, extensão do Chrome. Banco PostgreSQL no Supabase, tudo por funções RPC.
- Os três pilares do Comunique: (1) transformar a comunicação do dia a dia em tarefas e quantificar o esforço;
  (2) facilitar o trabalho, com tudo num lugar e menos telas; (3) análises que os números principais escondem.
- O dono não é programador. Escreva em português do Brasil, simples e direto, sem jargão sem explicação.

## O mapa do projeto (já existe)
- `docs/revisoes/009/mapa.json`: 167 itens da varredura anterior (achados e sugestões) com id, título,
  prioridade, onda e sugestão. **Leia antes** para não repetir. Se a sua ideia completa um item existente,
  cite o id dele no campo `junto` e explique o que é novo.
- Itens com `feito` já foram feitos; não proponha de novo.

## Fica FORA deste estudo (pedido do dono)
LGPD, leis, compliance, privacidade, backup. Não proponha nada sobre esses temas.

## Regras do time
1. **Só ler e medir.** Não edite nada no repositório, não faça git commit/push/checkout. Seus arquivos de
   trabalho vão na sua pasta: `/tmp/claude-0/-home-user-comuniqueqd-github-io/e8000799-92c2-5b51-bea0-7146c54c2e44/scratchpad/estudo/<seu-id>/`.
   A única exceção é o arquivo de entrega abaixo.
2. Se precisar de banco: Postgres em 127.0.0.1:54329 (usuário postgres, sem senha). Use SÓ o seu banco
   `teste_<seu-id>`: crie com `psql -h 127.0.0.1 -p 54329 -U postgres -c "create database teste_<id>"` e carregue
   com `cd /home/user/comuniqueqd.github.io/testes && DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste_<id> node carregar-banco.mjs`.
   Nunca use o banco `teste` (é dos testes principais). Para abrir o site no navegador, veja como
   `testes/e2e.test.mjs` sobe o `supabase-falso.mjs`, use portas próprias (`PORTA_SITE`/`PORTA_API`) e o
   Chromium em `/opt/pw-browsers/chromium`.
3. **Evidência sempre**: onde (arquivo:linha ou tela), o que acontece, por que importa. Não invente números.
4. Regras permanentes do app que suas ideias devem respeitar: nada de emoji nas telas; mensagens ao entregador
   dizem "restrição temporária", nunca "bloqueio"; o Comunique não guarda CPF; menos telas, não mais telas;
   a direção visual é "Mesa de Operação" (listas em linhas, cor só para situação e sempre com texto).
5. Qualidade acima de quantidade: 8 a 15 itens bons valem mais que 40 rasos. Cada sugestão precisa dizer
   **o que muda para quem usa**, em uma frase, e um primeiro passo pequeno.

## Entrega (formato obrigatório: JSON, para entrar no mapa sem perder texto)
Salve em `docs/revisoes/estudo-2026-11/<seu-id>.json` uma lista de objetos assim:

```json
[{
  "ag": "<seu-id>",
  "id": "<SEUPREFIXO>-1",
  "titulo": "frase curta do problema ou da ideia",
  "prio": "alta | média | baixa",
  "esforco": "pequeno | médio | grande",
  "tipo": "achado | sugestao",
  "onde": "arquivo:linha, tela ou função (pode ser vazio para ideia nova)",
  "sugestao": "o que fazer, em 2 a 5 frases, com o primeiro passo",
  "objetivo": "menos | rapidez | analises | aparencia | regras | base | esforco",
  "tela": "inicio | navegacao | ativacao | bloqueios | ficha | tarefas | avisos | analises | financeiro | equipe | extensao | geral",
  "onda": 1,
  "veredito": "",
  "nota": "por que importa / evidência / de onde veio a ideia",
  "junto": "ids do mapa relacionados, ou vazio"
}]
```
`objetivo`: menos = menos trabalho para a equipe; rapidez = app mais leve; analises = números que ajudam a
decidir; aparencia = visual; regras = regras e cálculos; base = código e testes; esforco = mostrar o esforço de
cada um. `onda`: 1 = agora, 2 = em seguida, 3 = depois.

Escreva também um resumo curto (5 a 10 linhas) em `docs/revisoes/estudo-2026-11/<seu-id>.md` com o que você
olhou, o que mais importa e o que não conseguiu verificar.
