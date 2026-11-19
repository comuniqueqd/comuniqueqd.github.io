# i1 Inventário: o que o Comunique tem hoje (20/11/2026)

O mapa completo está em `inventario.json`: 15 áreas, 63 ferramentas em uso (mais 5 itens na área Guardado) e 12 rotinas automáticas.

**Como contei** (detalhe em `numeros_como` no JSON):
- 31 telas (seções `v-...` do `index.html`); 254 funções no banco (nomes distintos em `create function`), das quais 141 são chamadas pelo site e 14 pela extensão.
- 27 arquivos de migração (`supabase/0*.sql`), 25 arquivos de teste com cerca de 1.200 conferências.
- Linhas: 5.645 de JS do site, 899 da extensão, 9.933 de SQL, 1.669 de HTML+CSS.
- Áreas e ferramentas: tirei dos `App.modulo` de `js/*.js` (abas), das chamadas `rpc(...)`, do `index.html`, da `extensao/` e do CLAUDE.md.

**O que não deu para confirmar**
- A versão de entrada ("desde") de algumas ferramentas vem do CLAUDE.md, não do histórico do git; as mais antigas aparecem como "início".
- A 009x ("Casa em ordem") está no repositório, mas o site ainda diz 009w. Ela também não está no CLAUDE.md. Por isso marquei as listas em páginas como "009x, em andamento".
- Não abri o app no navegador. Os textos de "quem usa" vêm das regras do código (`pode`, `acesso`, `exigir_*`), não do que cada papel vê de fato na tela.
- Não conferi quais das 254 funções do banco são internas e quais estão sobrando.
