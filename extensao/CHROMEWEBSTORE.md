# Chrome Web Store: Comunique

Tudo o que o painel do desenvolvedor da Chrome Web Store pede, pronto para copiar.
Última atualização: 14/11/2026 · versão 1.2.1

## Antes de enviar (uma vez só)

1. **Conta:** cadastro em https://chrome.google.com/webstore/devconsole (US$ 5, uma vez), com a verificação em duas etapas ligada.
2. **Pacote:** na raiz do repositório, rode `python3 extensao/empacotar.py`. Ele gera `extensao/comunique-extensao-<versão>.zip` só com os arquivos da extensão.
3. **Enviar como rascunho:** no painel, clique em "Novo item", envie o .zip e **não publique ainda**. A loja mostra o **ID do item** (32 letras).
4. **Supabase: liberar o login da extensão.** Em Supabase → Authentication → URL Configuration → Redirect URLs, adicione:
   `https://<ID-do-item>.chromiumapp.org/**`
   Sem isso, o botão "Entrar com Google" da extensão volta com erro.
5. Preencha as seções abaixo e envie para revisão como **Não listada**.

## Ficha da loja

- **Nome:** Comunique
- **Resumo (até 132 caracteres):** Avisos do Comunique no ícone e, no painel lateral, bloqueio, ativação, adicional e ajuste de bairro com os dados da tela aberta.
- **Categoria:** Ferramentas de trabalho (Workflow & Planning)
- **Idioma:** Português (Brasil)

**Descrição:**

> Extensão de uso interno da equipe de operação que usa o Comunique.
>
> • Registrar sem trocar de tela: com a tela de um entregador aberta no painel Quero Log ou no Crisp, o painel lateral da extensão lê o ID, o nome e a cidade e preenche o formulário ali mesmo. Novo bloqueio (escolha o motivo e veja a punição antes de confirmar), Nova ativação, Registrar adicional, Cadastrar entregador e Calculadora de bairro (mostra o ajuste e registra; falta só o código do pedido). Você confere, muda o que precisar e registra.
> • Pedir ajuda e ajudar: peça ajuda à equipe pelo painel e aceite os pedidos dos colegas com "Eu ajudo".
> • Avisos no ícone: mostra quantos avisos novos você tem e manda notificação quando chega algo para você ou quando alguém pede ajuda.
> • Busca de entregadores por ID ou nome e "Ver no Comunique" ao selecionar um ID em qualquer página (botão direito).
> • Conferência: se o ID da tela já está no Comunique com outro nome, o formulário avisa antes de gravar; se a tela não tem ID de entregador, o formulário abre vazio para digitar.
>
> A extensão lê somente o ID, o nome e a cidade do entregador nessas telas, e só quando você abre um formulário ou o painel. Celular, e-mail, CPF, endereço e o resto da página não são lidos, e a página não é alterada. Nada é gravado sem você confirmar. Entre com a mesma conta Google do Comunique.

## Imagens

| Arquivo | Uso |
|---|---|
| `icones/icone-128.png` | Ícone da loja (128×128) |
| `loja/print-1-bloqueio-no-painel.png` | Captura de tela 1 (1280×800): o Novo bloqueio no painel lateral, preenchido com os dados da tela ao lado (dados fictícios) |
| `loja/print-2-painel-lateral.png` | Captura de tela 2 (1280×800): o painel lateral com avisos e pedido de ajuda (dados fictícios) |
| `loja/bloco-promocional-440x280.png` | Bloco promocional pequeno (440×280) |

As imagens são geradas por `testes/prints-extensao.mjs`, só com dados fictícios. Refazer quando a tela mudar.

## Finalidade única

> Levar o Comunique, o sistema da equipe de operação, para as telas de trabalho da equipe: avisos, busca de entregadores, atalhos e o preenchimento automático dos formulários do Comunique a partir das telas de entregador do painel Quero Log e do Crisp.

## Justificativa das permissões

| Permissão | Por quê |
|---|---|
| `storage` | Guardar no navegador a sessão de login do Comunique e quais avisos já foram mostrados, para não notificar duas vezes. |
| `alarms` | Conferir a cada minuto se chegaram avisos novos ou pedidos de ajuda, para atualizar o número no ícone. |
| `notifications` | Mostrar a notificação de aviso novo e de pedido de ajuda da equipe. |
| `contextMenus` | O item "Ver no Comunique" ao clicar com o botão direito sobre o ID de um entregador selecionado. |
| `sidePanel` | Abrir o painel lateral do Comunique ao lado da página. |
| `scripting` | Colocar o leitor (o mesmo script do pacote, `telas/leitor.js`) nas abas do Quero Log e do Crisp que já estavam abertas quando a extensão foi instalada ou atualizada, sem a pessoa precisar recarregar a página. |
| `identity` | Entrar com a conta Google da pessoa, a mesma usada no Comunique. |
| Host `nhgmkbfaqonojhaggwui.supabase.co` | O banco de dados do Comunique: login, avisos, busca de entregadores. |
| Host `comuniqueqd.github.io` | O próprio Comunique: reaproveitar a aba já aberta em vez de abrir outra a cada clique. |
| Host `admin.querolog.io` e `app.crisp.chat` | Os mesmos sites do leitor; exigidos pela permissão `scripting` para colocar o leitor numa aba já aberta. |
| Conteúdo em `admin.querolog.io` | Ler o ID, o nome e a cidade na tela de um entregador quando a pessoa abre um formulário no painel lateral. A página não é alterada. |
| Conteúdo em `app.crisp.chat` | Ler o ID (dado personalizado `entregador_id`), o nome e a cidade do contato quando a pessoa abre um formulário no painel lateral. A página não é alterada. |

**Código remoto:** não. Todo o código está no pacote; a extensão só troca dados (JSON) com o banco do Comunique.

## Privacidade (formulário "Práticas de privacidade")

- **Dados coletados:**
  - *Informações de identificação pessoal:* sim. É o e-mail da conta Google no login e o ID, o nome e a cidade do entregador, lidos só quando a pessoa clica num botão.
  - *Informações de autenticação:* sim (sessão de login guardada no navegador).
  - *Conteúdo do site:* sim (só o texto do ID, do nome e da cidade do entregador nas telas do Quero Log e do Crisp).
  - *Informações financeiras e de pagamento:* sim, a partir da 1.1 (o botão Adicional grava os valores pagos ao entregador fora da corrida).
- **Não coleta:** saúde, comunicações pessoais (as conversas do Crisp não são lidas), localização, histórico da Web, atividade do usuário.
- **Certificações:** os dados não são vendidos a terceiros; não são usados nem transferidos para fins não relacionados à finalidade única; não são usados para avaliar crédito ou conceder empréstimos.
- **Política de privacidade:** https://comuniqueqd.github.io/privacidade.html (seção 3, "Extensão do Comunique para o Chrome").

## Distribuição

- **Visibilidade:** Não listada (só quem tem o link instala).
- **Regiões:** Brasil.
- **Preço:** gratuita.

## Histórico de versões

| Versão | Data | O que mudou |
|---|---|---|
| 1.2.1 | 14/11/2026 | Abas abertas antes da atualização: o leitor novo entra sozinho (sem recarregar a página) e tira o cartão antigo; botão "↻ Ler a tela de novo" no formulário. |
| 1.2.0 | 14/11/2026 | Tudo no painel lateral: os botões leem a tela aberta e registram ali mesmo (bloqueio com motivo e prévia, ativação, adicional, cadastrar, calculadora de bairro com registro do ajuste, pedir ajuda); "Eu ajudo" aceita pedidos da equipe; o cartão na página saiu; nome lido do caminho "Lista / Nome" mesmo com outros "Lista" na tela. |
| 1.1.0 | 14/11/2026 | Os botões do cartão gravam direto (com conferência): ficha, ativação, bloqueio com prévia e adicional com valores; aviso de ID com outro nome no Comunique; o painel lateral diz "não encontrei ID de entregador nesta tela". |
| 1.0.0 | 14/11/2026 | Primeira versão: avisos no ícone, notificações (avisos e pedidos de ajuda), painel lateral com busca e atalhos, "Ver no Comunique" no botão direito, cartão com botões no Quero Log e no Crisp. |

## Conferência antes de enviar (lista da skill chrome-extensions, 14/11/2026, 1.2.1)

- [x] Manifest V3, versão maior que a última enviada (1.0.0), nome "Comunique", descrição com 128 de 132 caracteres
- [x] Pacote só com os arquivos da extensão (sem testes, loja, este arquivo, .git)
- [x] Ícones 16/32/48/128 existem no tamanho certo; a notificação usa `icones/icone-128.png`
- [x] Painel lateral abre pelo ícone (`openPanelOnActionClick`), sem popup junto
- [x] Sem `activeTab`: o painel lê a aba com `scripting` + host do Quero Log e do Crisp; sem `<all_urls>`
- [x] Toda permissão em uso e justificada (tabela acima); nenhuma sobrando
- [x] Service worker sem estado em variáveis (sessão em `chrome.storage.local`, regras em `chrome.storage.session`); `onMessage` com `return true`
- [x] Sem `eval`, sem `innerHTML`, sem script inline, sem código remoto, sem ofuscação
- [x] Menu "Ver no Comunique" dá retorno (abre a ficha numa aba)
- [x] 2 capturas 1280×800 e bloco 440×280 atuais (1.2.1), com dados fictícios
- [ ] Política de privacidade no ar (abrir https://comuniqueqd.github.io/privacidade.html antes de enviar)
- [ ] E-mail de contato verificado no painel do desenvolvedor
- [ ] Formulário de dados igual à seção "Privacidade" acima (marcar também "Informações financeiras")
- [ ] Opcional: campo `key` no manifesto (ver abaixo)

**ID igual no teste e na loja (`key`):** a extensão carregada sem compactação tem um ID diferente da loja, e cada ID precisa da sua Redirect URL no Supabase. Copiando a **chave pública** do item (painel do desenvolvedor → item → Pacote → "Chave pública") para o campo `"key"` do `manifest.json`, o teste passa a ter o mesmo ID da loja, e basta uma Redirect URL.

**Nomes de outras empresas:** a descrição cita "Quero Log" e "Crisp" só para dizer em que telas a extensão funciona, sem logos nem imagens deles. As capturas usam telas genéricas com dados fictícios.

## Observações para a revisão

- Uso interno de uma equipe de operação logística; o login exige uma conta autorizada no Comunique.
- Para testar sem conta: em `admin.querolog.io/entregadores/<id>` ou no Crisp com o dado personalizado `entregador_id`, abra o painel lateral e clique num botão de registrar: o formulário abre preenchido com o ID, o nome e a cidade, e nada é gravado sem confirmar.

### Limitações conhecidas

- Se o painel Quero Log ou o Crisp mudarem o desenho da tela, o painel pode deixar de achar o ID ou o nome; o formulário abre mesmo assim, e a pessoa completa o que faltar.
