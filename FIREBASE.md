# Configurar o Firebase

Fora do claude.ai, o banco de dados e o login vêm do Firebase. São uns 15 minutos de configuração, uma vez só. O plano gratuito (Spark) basta para este app.

## 1. Criar o projeto

1. Acesse https://console.firebase.google.com e clique em **Criar um projeto**.
2. Dê um nome (ex.: `cadastro-entregadores`). O Google Analytics não é necessário.

## 2. Ligar o login com Google

1. No menu: **Criação → Authentication → Vamos começar**.
2. Aba **Método de login** → **Google** → **Ativar** → escolha o e-mail de suporte → **Salvar**.
3. Aba **Configurações → Domínios autorizados** → **Adicionar domínio** → `mateuslopesmb-png.github.io`.
   O `localhost` já vem liberado.

## 3. Criar o banco (Firestore)

1. No menu: **Criação → Firestore Database → Criar banco de dados**.
2. Local: `southamerica-east1 (São Paulo)`.
3. Modo: **produção**.
4. Aba **Regras**: apague tudo, cole o conteúdo de [`firestore.rules`](firestore.rules), troque `dono@exemplo.com` pelo e-mail de quem aprova (em minúsculas) e clique em **Publicar**.

## 4. Ligar a página ao projeto

1. Engrenagem ⚙️ → **Configurações do projeto** → **Seus apps** → ícone **`</>`** (Web).
2. Dê um apelido, **não** marque Firebase Hosting, e clique em **Registrar app**.
3. Copie os valores de `firebaseConfig` para [`firebase-config.js`](firebase-config.js) e preencha `window.DONO_EMAIL` com o mesmo e-mail das regras.

Esses valores (`apiKey` etc.) não são senhas e podem ficar no repositório público. Quem protege os dados são as regras do passo 3.

## 5. Liberar quem envia cadastros

O dono entra sem precisar de liberação. Para cada outra pessoa:

1. **Firestore Database → Dados → Iniciar coleção** (na primeira vez) com o nome `membros`.
2. **ID do documento**: o e-mail Google da pessoa, em minúsculas (ex.: `fulano@gmail.com`).
3. Adicione um campo qualquer (ex.: `nome` = `Fulano`) e salve.

Para tirar o acesso, apague o documento. Quem não estiver na lista vê "ainda não tem acesso" e não consegue ler nem gravar nada.

## 6. Testar e publicar

- **No seu computador**: na pasta do projeto, rode `python3 -m http.server 8000` e abra http://localhost:8000.
- **No GitHub Pages**: no repositório, **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**. Em um ou dois minutos o app fica em https://mateuslopesmb-png.github.io/aprovacao-entregs/.

## Quem pode o quê

| | Dono | Membro | Outros |
|---|---|---|---|
| Enviar cadastro | ✓ | ✓ | – |
| Ver painel | ✓ | ✓ | – |
| Ver pendentes e histórico | ✓ | – | – |
| Aprovar, reprovar, desfazer, excluir | ✓ | – | – |
| Liberar membros | ✓ | – | – |

As abas escondidas na tela não protegem nada sozinhas: quem garante isso são as regras do Firestore, testadas em [`testes/`](testes/).

## Dados que já estão no artefato

Os cadastros feitos no artefato do claude.ai não passam sozinhos para o Firebase. Baixe o CSV pelo artefato (aba Histórico → Baixar CSV) para guardar ou importar depois.
