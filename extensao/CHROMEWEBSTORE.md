# Chrome Web Store: Comunique

Tudo o que o painel do desenvolvedor da Chrome Web Store pede, pronto para copiar.
Última atualização: 14/11/2026 · versão 1.0.0

## Antes de enviar (uma vez só)

1. **Conta:** cadastro em https://chrome.google.com/webstore/devconsole (US$ 5, uma vez), com a verificação em duas etapas ligada.
2. **Pacote:** na raiz do repositório, rode `python3 extensao/empacotar.py`. Ele gera `extensao/comunique-extensao-1.0.0.zip` só com os arquivos da extensão.
3. **Enviar como rascunho:** no painel, clique em "Novo item", envie o .zip e **não publique ainda**. A loja mostra o **ID do item** (32 letras).
4. **Supabase: liberar o login da extensão.** Em Supabase → Authentication → URL Configuration → Redirect URLs, adicione:
   `https://<ID-do-item>.chromiumapp.org/**`
   Sem isso, o botão "Entrar com Google" da extensão volta com erro.
5. Preencha as seções abaixo e envie para revisão como **Não listada**.

## Ficha da loja

- **Nome:** Comunique
- **Resumo (até 132 caracteres):** Avisos do Comunique no ícone, busca de entregadores, atalhos e botões de cadastro, bloqueio e adicional no Quero Log e no Crisp.
- **Categoria:** Ferramentas de trabalho (Workflow & Planning)
- **Idioma:** Português (Brasil)

**Descrição:**

> Extensão de uso interno da equipe de operação que usa o Comunique.
>
> • Avisos no ícone: mostra quantos avisos novos você tem no Comunique e manda uma notificação quando chega algo para você ou quando alguém da equipe pede ajuda.
> • Painel lateral: abre o Comunique ao lado da tela em que você está trabalhando, com seus avisos, os pedidos de ajuda abertos e a busca de entregadores por ID ou nome.
> • Atalhos: Nova ativação, Novo bloqueio, Registrar adicional, Calculadora de bairro e Pedir ajuda, a um clique.
> • Ver no Comunique: selecione o ID de um entregador em qualquer página, clique com o botão direito e abra a ficha dele.
> • Botões nas telas do entregador: no painel Quero Log e no Crisp, um cartão mostra os botões Cadastrar, Nova ativação, Bloquear e Adicional. Um clique abre o formulário do Comunique já preenchido com o ID, o nome e a cidade do entregador. Você confere e salva; nada é salvo sozinho.
>
> A extensão lê somente o ID, o nome e a cidade do entregador nessas telas. Celular, e-mail, CPF, endereço e o resto da página não são lidos. Entre com a mesma conta Google do Comunique.

## Imagens

| Arquivo | Uso |
|---|---|
| `icones/icone-128.png` | Ícone da loja (128×128) |
| `loja/print-1-botoes-no-painel.png` | Captura de tela 1 (1280×800): o cartão com os botões numa tela de entregador (dados fictícios) |
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
| `identity` | Entrar com a conta Google da pessoa, a mesma usada no Comunique. |
| Host `nhgmkbfaqonojhaggwui.supabase.co` | O banco de dados do Comunique: login, avisos, busca de entregadores. |
| Host `comuniqueqd.github.io` | O próprio Comunique: reaproveitar a aba já aberta em vez de abrir outra a cada clique. |
| Conteúdo em `admin.querolog.io` | Ler o ID, o nome e a cidade na tela de um entregador e mostrar os botões do Comunique. |
| Conteúdo em `app.crisp.chat` | Ler o ID (dado personalizado `entregador_id`), o nome e a cidade do contato e mostrar os botões do Comunique. |

**Código remoto:** não. Todo o código está no pacote; a extensão só troca dados (JSON) com o banco do Comunique.

## Privacidade (formulário "Práticas de privacidade")

- **Dados coletados:**
  - *Informações de identificação pessoal:* sim. É o e-mail da conta Google no login e o ID, o nome e a cidade do entregador, lidos só quando a pessoa clica num botão.
  - *Informações de autenticação:* sim (sessão de login guardada no navegador).
  - *Conteúdo do site:* sim (só o texto do ID, do nome e da cidade do entregador nas telas do Quero Log e do Crisp).
  - *Informações financeiras e de pagamento:* marcar a partir da 1.1, se o botão Adicional passar a gravar valores direto pela extensão.
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
| 1.0.0 | 14/11/2026 | Primeira versão: avisos no ícone, notificações (avisos e pedidos de ajuda), painel lateral com busca e atalhos, "Ver no Comunique" no botão direito, cartão com botões no Quero Log e no Crisp. |

## Observações para a revisão

- Uso interno de uma equipe de operação logística; o login exige uma conta autorizada no Comunique.
- Para testar sem conta: o cartão aparece em `admin.querolog.io/entregadores/<id>` e no Crisp com o dado personalizado `entregador_id`; os botões só abrem o site do Comunique com os campos preenchidos.

### Limitações conhecidas

- Se o painel Quero Log ou o Crisp mudarem o desenho da tela, o cartão pode deixar de achar o ID ou o nome; os botões continuam abrindo o formulário, e a pessoa completa o que faltar.
