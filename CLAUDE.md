# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

"Cadastro de Entregadores": app de página única (`index.html`, publicado no GitHub Pages) em que o suporte envia cadastros de entregadores e moderadores/monitoradores aprovam, reprovam ou encerram. Banco: PostgreSQL no **Supabase** (login Google pelo Supabase Auth). Sem build e sem dependências em runtime além do `supabase-js` via CDN. Interface, textos, comentários e docs em português (pt-BR).

## Comandos

Os testes precisam de um Postgres local (16+) e do Chromium do Playwright:

```bash
cd testes && npm install && npx playwright install chromium
export DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste   # banco vazio; os testes recriam tudo
npm run test:sql   # funções e permissões do supabase/schema.sql
npm run test:e2e   # index.html no Chromium contra o Postgres, via testes/supabase-falso.mjs
```

- `testes/supabase-local.sql` cria num Postgres comum o mínimo do Supabase (papéis `anon`/`authenticated`, `auth.uid()`, `auth.jwt()`). Nunca rodar no Supabase real.
- `testes/supabase-falso.mjs` imita o PostgREST: `POST /rest/v1/rpc/<fn>` → `select public.<fn>(...)` com `set local role authenticated` e as claims do JWT em `request.jwt.claims`. O e2e injeta a sessão no `localStorage` (`sb-127-auth-token`) no lugar do login Google e redireciona o CDN do supabase-js para `node_modules`.
- Prints do e2e ficam em `testes/prints/`.

Rodar a página localmente: `npx serve -l 8000` (o Supabase só aceita os redirecionamentos configurados, ver `SUPABASE.md`).

## Arquitetura

- **Toda a lógica de negócio e permissão está em `supabase/schema.sql`.** O front só chama funções RPC (`enviar_cadastro`, `decidir`, `desfazer`, `excluir_cadastro`, `listar_cadastros`, `eventos_do_cadastro`, `metricas`, `entrar`, `pedir_acesso`, `listar_equipe`, `salvar_membro`, `remover_membro`, `recusar_pedido`, `pessoas`, `listar_motivos`). As tabelas não têm políticas de escrita; as funções `security definer` conferem o papel com `exigir_papel(...)`. Esconder um botão no front não é controle de acesso.
- **Papéis** (`membros.papel`): `moderador` (tudo, inclusive Equipe, desfazer e excluir), `monitorador` (aprova/reprova/encerra), `suporte` (envia, vê só os próprios cadastros, painel agregado). `membros.admin_final` marca o moderador que ninguém pode remover nem alterar; o e-mail dele é semeado no fim do `schema.sql`.
- **Status** (`status_cadastro`): `aguardando_analise` → aprovar | reprovar (→ `aguardando_contato`) | encerrar; `aguardando_contato` → aprovar | encerrar. As transições válidas estão em `decidir()`. Reprovar/encerrar exigem motivo da tabela `motivos` do tipo certo; "Outro" exige detalhe.
- **`eventos`** registra cada ação (`enviado`, `aprovado`, `reprovado`, `encerrado`, `desfeito`). `cadastros` guarda só a situação atual. `desfazer()` só desfaz a última decisão; nas métricas, uma decisão seguida imediatamente de `desfeito` não conta.
- **CPF guardado só com dígitos**, único; `id_app` único sem diferenciar maiúsculas (`lower(id_app)`). A mensagem amigável de duplicidade vem de `enviar_cadastro`.
- **`listar_cadastros` e `eventos_do_cadastro` são `security invoker`**: o RLS (`cadastros_leitura`) garante que o suporte só receba os próprios. `metricas` é `security definer` e devolve só agregados (sem CPF) para todos os papéis; `p_pessoas` filtra cadastros enviados OU decididos por aquelas pessoas.
- **Front (`index.html`)**: objeto `S` guarda listas por escopo (`pendentes`, `meus`, `todos`), métricas e equipe; `carregar()` busca o que a aba atual precisa e `render()` redesenha só ela (adiado enquanto há um campo focado dentro dos cards/tabela de equipe). Atualiza por Realtime (`postgres_changes`) e a cada 30 s. DOM montado por `el()` (via `textContent`, nunca `innerHTML`). Rotas por hash; `VIEWS` define quais abas cada papel vê.
- **Login**: botão oficial do Google (Google Identity Services, `GOOGLE_CLIENT_ID`) → `signInWithIdToken` com nonce (o Google recebe o SHA-256, o Supabase o valor original). Assim a janela do Google mostra o domínio do site, não o do Supabase. Se o script do Google não carregar ou faltar o ID, `botaoGoogle()` mostra o botão de reserva (`signInWithOAuth`, redirecionamento). O ID do cliente precisa estar também em Supabase → Google → Client IDs.
- Site publicado em https://comuniqueqd.github.io/ (repositório `comuniqueqd/comuniqueqd.github.io`, GitHub Pages a partir da `main`). Projeto Supabase `nhgmkbfaqonojhaggwui`. `privacidade.html` é exigida pela tela de permissão do Google.
- `supabase-config.js` tem a URL do projeto, a chave publishable e o ID do cliente Google (todos públicos). `supabase/analises.sql` traz consultas de análise e a manutenção dos motivos.

## Mudanças no banco

`schema.sql` recria tudo e apaga os dados: serve só para instalação. Depois que houver dados reais, mudanças vão em arquivos novos de migração em `supabase/` (com `alter table`, `create or replace function`), aplicados no SQL Editor do Supabase, e o `schema.sql` é atualizado junto para refletir o estado final. Funções novas precisam de `grant execute ... to authenticated` (o `schema.sql` faz isso em bloco no fim).
