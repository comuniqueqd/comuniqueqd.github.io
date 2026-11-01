# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

"Cadastro de Entregadores": app de página única (`index.html`) para enviar cadastros de entregadores e aprovar/reprovar esses cadastros. Nasceu como **artefato do claude.ai** (slug `4225164a-c109-4ec6-aab8-47e4fb19916a`) e também roda fora dele (GitHub Pages / localhost) com Firebase. Sem build e sem dependências em runtime. Interface, textos, comentários e docs em português (pt-BR).

## Comandos

Conferir a sintaxe do JS embutido no `index.html` e dos scripts:

```bash
python3 -c "import re;open('/tmp/app.js','w').write(re.search(r'<script>\n(.*)</script>',open('index.html').read(),re.S).group(1))" && node --check /tmp/app.js && node --check firebase-adapter.js
```

Testes (em `testes/`; precisam de Java para os emuladores do Firebase):

```bash
cd testes && npm install && npx playwright install chromium
npm run test:regras   # regras do Firestore (firestore.rules) no emulador
npm run test:e2e      # index.html no Chromium contra emuladores de Auth + Firestore
```

Os testes rodam totalmente offline: o e2e serve o SDK de `node_modules/firebase` no lugar de `gstatic.com` e faz login com credencial do emulador no lugar do popup do Google. Prints ficam em `testes/prints/`.

Rodar localmente: `python3 -m http.server 8000`. Sem `firebase-config.js` preenchido, a página mostra "Sem conexão com o banco".

## Arquitetura

- **`index.html` só conhece a API do runtime de artefatos:** `window.claude.use("db")` (banco estilo Firestore: `collection().onSnapshot/add/doc().set/delete`), `use("user")` (`isOwner()`, `id()`, `can("data.write")`, `profiles(ids)`) e `use("downloads")` (botão "Baixar CSV").
- **`firebase-adapter.js` implementa essa mesma API com Firebase** quando `window.claude` não existe e `firebase-config.js` está preenchido. Ele mostra a tela de login Google, só libera o dono (`DONO_EMAIL`) ou e-mails em `membros/{email}`, grava `perfis/{uid}` (nome para o painel) e traduz códigos de erro do Firebase para os que o `index.html` trata (`invalid_argument`, `quota_exceeded`, `revoked`). Ao mudar o uso de `window.claude` no `index.html`, mantenha o adaptador compatível.
- **Coleções:** `cadastros` (idApp, cpf, cidade, observacao, criadoEm, criadoPor) e `decisoes`, cujo doc tem **o mesmo id do cadastro** (status `aprovado|reprovado`, em, por, motivo, detalhe). Sem decisão = `pendente`. Desfazer = apagar o doc em `decisoes`; excluir = apagar nos dois. No Firebase existem também `membros` e `perfis`.
- **Segurança fica em `firestore.rules`**, não na UI: só o dono decide/exclui/libera membros; membros leem e criam cadastros validados (campos permitidos, `criadoPor` = próprio uid). Um campo novo gravado pelo `index.html` precisa entrar em `cadastroValido`/`decisaoValida`, senão a gravação é negada. O e-mail do dono aparece em dois lugares: `firestore.rules` e `firebase-config.js`.
- **Estado e render:** objeto `S` guarda os dois `Map`s alimentados por `onSnapshot`; `render()` recalcula tudo a partir de `all()` e redesenha só a aba visível. O DOM é montado pelo helper `el()` (via `textContent`, nunca `innerHTML`).
- **Rotas por hash** (`#pendentes`, `#novo`, `#painel`, `#historico`). O dono vê as 4 abas; os demais só "Novo cadastro" e "Painel".
- **Regras do formulário:** cidade no formato `CIDADE - UF` (sugestões em `CIDADES`) e pelo menos ID ou CPF (CPF validado por dígito verificador). Duplicidade por CPF/ID pede um segundo clique. Motivos de reprovação em `MOTIVOS`.

## Sincronizar com o artefato

O artefato publicado no claude.ai não muda sozinho quando o `index.html` muda (e vice-versa). As tags `<script src="firebase-*.js">` não atrapalham no artefato: lá `window.claude` já existe e o adaptador não faz nada.
