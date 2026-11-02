# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

"Comunique": app web estático (GitHub Pages) da equipe de operação, com três módulos — **Ativação de entregadores** (envio e aprovação de cadastros), **Bloqueios** (registro com punição calculada, tratativas, painel) e **Atividades** (pendências e avisos de cada pessoa). Banco: PostgreSQL no **Supabase**, login Google. Sem build e sem dependências em runtime além do `supabase-js` via CDN. Interface, textos, comentários e docs em português (pt-BR).

Publicado em https://comuniqueqd.github.io/ (repositório `comuniqueqd/comuniqueqd.github.io`, Pages a partir da `main`). Projeto Supabase `nhgmkbfaqonojhaggwui`.

## Comandos

Os testes precisam de um Postgres local (16+) e do Chromium do Playwright:

```bash
cd testes && npm install && npx playwright install chromium
export DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste   # banco vazio; os testes recriam tudo
npm run test:sql        # ativação: funções e permissões do supabase/schema.sql
npm run test:bloqueios  # bloqueios: regras, tratativas, permissões do supabase/002-bloqueios.sql
npm run test:e2e        # o site inteiro no Chromium contra o Postgres, via testes/supabase-falso.mjs
```

- `testes/supabase-local.sql` cria num Postgres comum o mínimo do Supabase (papéis `anon`/`authenticated`, `auth.uid()`, `auth.jwt()`). Nunca rodar no Supabase real.
- `testes/supabase-falso.mjs` imita o PostgREST (`POST /rest/v1/rpc/<fn>` → `select public.<fn>(...)` com `set local role authenticated` e as claims do JWT) e o login por token do Google (confere o nonce). O e2e injeta a sessão no `localStorage` (`sb-127-auth-token`), troca o script do Google por um falso e serve o supabase-js de `node_modules`.
- Prints do e2e ficam em `testes/prints/`.

Rodar o site localmente: `npx serve -l 8000` (o Supabase só aceita os redirecionamentos configurados, ver `SUPABASE.md`).

## Arquitetura

**Banco (fonte da verdade de regras e permissões).** O front só chama funções RPC; as tabelas não têm políticas de escrita, e as funções `security definer` conferem o papel com `exigir_papel(...)` (ativação) ou `exigir_bloq(...)` (bloqueios). Esconder um botão não é controle de acesso.
- `supabase/schema.sql` = instalação do zero (apaga tudo, inclusive as tabelas do módulo de bloqueios). `supabase/002-bloqueios.sql` = migração aplicada depois, sem apagar dados. Mudanças futuras: novo arquivo `003-...sql` com `alter`/`create or replace`, testado rodando duas vezes; funções novas precisam de `grant execute ... to authenticated` (as migrações fazem em bloco no fim, e revogam de novo as internas: `inserir_bloqueio`, `importar_bloqueio`, `notificar`). Alterar arquivos SQL no repositório não muda o Supabase: alguém precisa rodar no SQL Editor.
- **Acesso por módulo**: `membros.papel` (ativação) e `membros.papel_bloqueios` (nulo = sem acesso). Papéis: `moderador`, `monitorador`, `suporte`. `membros.admin_final` (um só, semeado no `schema.sql`) não pode ser removido nem alterado, e é moderador nos dois módulos (constraint `membros_admin_final_moderador`).
- **Ativação**: `cadastros` guarda a situação atual (`aguardando_analise` → aprovar | reprovar→`aguardando_contato` | encerrar; `aguardando_contato` → aprovar | encerrar; transições em `decidir()`); `eventos` guarda cada ação. CPF só dígitos e único; `id_app` único sem diferenciar maiúsculas.
- **Bloqueios**: `infracoes` (regras: `horas_1a`, `horas_2a`, `terceira_encerra`, `fator` = 1,30, `janela_dias` = 60 no atraso; horas nulas = **encerramento de parceria**) e `cidades` (responsável pela tratativa). `calcular_ocorrencia()` conta por ID+infração **pela data**; com janela, a sequência só continua se cada intervalo ≤ janela (senão a punição volta à 1ª, mas `ocorrencia_total` guarda o histórico). `horas_previstas()` aplica 1ª/2ª e depois +fator a cada ocorrência, arredondando a cada passo. As horas ficam gravadas no bloqueio (mudar a regra não altera bloqueios antigos). `situacao_bloqueio()` é calculada na leitura (bloqueado/liberado/liberado_antes/encerramento): o fim do prazo libera sozinho, sem cron.
- **Tarefas** (`tarefas`): base da aba Atividades. Hoje só tratativas de bloqueio: criadas por `inserir_bloqueio()` quando horas ≥ 10 ou encerramento, para o responsável da cidade (nulo = moderadores). `concluir_tratativa()` não libera o bloqueio e gera `notificacoes` para quem registrou. Importados da planilha: só ficam pendentes as tratativas de quem ainda está bloqueado.
- `metricas()` (ativação) e `metricas_bloqueios()` são `security definer` e devolvem só agregados para todos os papéis; `listar_cadastros`/`listar_bloqueios` são `security invoker` (o RLS faz o suporte receber só os próprios).

**Front.** `index.html` (todas as telas), `estilo.css` e `js/`:
- `js/base.js`: utilidades (`App.u`), estado comum (`App.S`), login, rotas e o ciclo `App.carregar()`/`App.render()`. Rotas `#modulo/aba` (as antigas `#pendentes`, `#novo`… continuam valendo para a ativação). Cada módulo se registra com `App.modulo({ id, acesso, abas: [{ id, secao, pode, contador }], padrao, carregar(aba), render(aba), contadores() })`; a barra de abas é montada a partir disso.
- `js/inicio.js`, `js/ativacao.js`, `js/bloqueios.js`, `js/atividades.js`, `js/equipe.js`. A ordem dos `<script>` importa (base primeiro).
- `render()` é adiado enquanto há um campo focado dentro de um elemento `.protege-foco` (listas que se redesenham). DOM montado por `el()` (via `textContent`, nunca `innerHTML`). Atualiza por Realtime (`postgres_changes`) e a cada 30 s.
- **Login**: botão oficial do Google (GIS, `GOOGLE_CLIENT_ID`) → `signInWithIdToken` com nonce (Google recebe o SHA-256; Supabase o valor original), para a janela do Google mostrar o domínio do site. Sem o script do Google, `botaoGoogle()` cai no `signInWithOAuth`. `supabase-config.js` tem URL, chave publishable e ID do cliente Google (todos públicos). `privacidade.html` é exigida pela tela de permissão do Google.

## Dados pessoais

O repositório é público. Não commitar planilhas, CSVs ou SQL com dados de entregadores (a importação do histórico de bloqueios é entregue à parte, fora do repositório).
