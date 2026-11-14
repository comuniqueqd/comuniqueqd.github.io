# Cartão da extensão nas telas (guardado)

Na 1.1 da extensão, a página do entregador no Quero Log e no Crisp ganhava um cartão no canto
inferior direito (shadow DOM) com Cadastrar · Nova ativação · Bloquear · Adicional · Ver ficha,
cada um abrindo um formulário curto ali mesmo, e o aviso de ID com outro nome no Comunique.

O usuário pediu (14/11/2026) para tirar o cartão e resolver tudo no **painel lateral** da extensão,
mas **guardar para depois**: "em breve atualizaremos mais a extensão e ela será utilizada".

- `leitor-com-cartao.js`: o `telas/leitor.js` da 1.1 completo (leitura da tela + cartão + formulários).
  Os formulários dele foram depois unificados em `extensao/formularios.js` (usado pelo painel lateral);
  para religar o cartão, o melhor é montar o cartão com `ComuniqueForms.montar(...)` em vez do código antigo.
- Para religar: incluir `formularios.js` antes de `telas/leitor.js` em `content_scripts` no `manifest.json`,
  pôr `icones/simbolo.svg` de volta em `web_accessible_resources` e trazer de volta a parte do cartão.
- O service worker ainda aceita do cartão as chamadas da lista `PERMITIDAS` (`sw.js`).
- Imagem do cartão: `extensao/loja/print-1-botoes-no-painel.png` no histórico do git (commit da 1.1, dados fictícios).
