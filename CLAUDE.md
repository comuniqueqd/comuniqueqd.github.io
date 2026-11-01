# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

"Cadastro de Entregadores": app de página única (`index.html`) para enviar cadastros de entregadores e aprovar/reprovar esses cadastros. É uma cópia versionada de um **artefato do claude.ai** (slug `4225164a-c109-4ec6-aab8-47e4fb19916a`). Toda a UI, CSS e JS ficam num único arquivo, sem build, sem dependências e sem testes. A interface e os textos são em português (pt-BR).

## Rodar / verificar

Não há build nem lint. Para conferir a sintaxe do JS:

```bash
python3 -c "import re;open('/tmp/app.js','w').write(re.search(r'<script>(.*)</script>',open('index.html').read(),re.S).group(1))" && node --check /tmp/app.js
```

Aberto fora do claude.ai (ex.: `python3 -m http.server`), a página mostra "Sem conexão com o banco": o backend só existe dentro do runtime de artefatos.

## Arquitetura

- **Backend = runtime do artefato.** `window.claude.use("db")` dá um banco tipo Firestore (`collection().onSnapshot/add/doc().set/delete`); `use("user")` dá `isOwner()`, `id()`, `can("data.write")` e `profiles(ids)`; `use("downloads")` habilita o botão "Baixar CSV". Não existe servidor próprio.
- **Duas coleções:** `cadastros` (idApp, cpf, cidade, observacao, criadoEm, criadoPor, `exemplo` opcional) e `decisoes`, cujo doc tem **o mesmo id do cadastro** (status `aprovado|reprovado`, em, por, motivo, detalhe). A ausência de decisão = `pendente`. Desfazer = apagar o doc em `decisoes`; excluir = apagar nos dois.
- **Estado e render:** objeto `S` guarda os dois `Map`s alimentados por `onSnapshot`; `render()` recalcula tudo a partir de `all()` e redesenha só a aba visível. O DOM é construído pelo helper `el()` (sempre via `textContent`, nunca `innerHTML`).
- **Rotas por hash** (`#pendentes`, `#novo`, `#painel`, `#historico`). Papéis: o dono do artefato (`isOwner`) vê as 4 abas e decide; os demais só veem "Novo cadastro" e "Painel".
- **Regras do formulário:** cidade no formato `CIDADE - UF` (lista sugerida em `CIDADES`) e pelo menos ID ou CPF (CPF validado por dígito verificador). Duplicidade por CPF/ID pede um segundo clique para confirmar. Motivos de reprovação em `MOTIVOS`.

## Sincronizar com o artefato

Ao alterar `index.html`, o artefato publicado no claude.ai não muda sozinho (e vice-versa). Para publicar, use as ferramentas `claude-artifacts` (`read_artifact` / `publish_version` com o slug acima).
