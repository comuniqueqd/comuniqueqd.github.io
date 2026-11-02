# Configurar o Supabase

O banco de dados é um PostgreSQL no Supabase. São quatro partes, feitas uma vez só.

Antes de começar, abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) e confira o e-mail do **administrador final**, perto do fim da seção "Dados iniciais". É a conta que nunca pode ser removida.

## 1. Criar o projeto e o banco

1. Em https://supabase.com, clique em **New project**.
2. Dê um nome (ex.: `cadastro-entregadores`) e crie uma **senha do banco**. Guarde essa senha num lugar seguro e não coloque no código.
3. **Region**: `South America (São Paulo)`.
4. Espere o projeto ficar pronto (1–2 min).
5. No menu à esquerda: **SQL Editor → New query**. Cole o conteúdo inteiro de `supabase/schema.sql` e clique em **Run**. Deve aparecer "Success. No rows returned".

Para conferir: em **Table Editor** aparecem as tabelas `cadastros`, `eventos`, `membros`, `motivos` e `pedidos_acesso`.

## 2. Credencial do Google (para o botão "Entrar com Google")

Isto é feito no Google Cloud, não no Supabase.

1. No Supabase: **Authentication → Sign In / Providers → Google**. Copie a **Callback URL** que aparece ali (algo como `https://abcdefgh.supabase.co/auth/v1/callback`). Deixe essa aba aberta.
2. Em outra aba, abra https://console.cloud.google.com e crie um projeto (ex.: `cadastro-entregadores`). Você pode usar o mesmo do Firebase, se preferir.
3. No menu: **APIs e serviços → Tela de permissão OAuth** (ou **Google Auth Platform**):
   - Nome do app: `Cadastro de Entregadores`; e-mail de suporte: o seu.
   - Público: **Externo**.
   - Em **Público**, clique em **Publicar app** (sai de "Em teste" para "Em produção"). Sem isso, só e-mails cadastrados como testadores conseguem entrar. Para login simples (nome e e-mail), o Google não exige verificação.
4. **Clientes → Criar cliente** (ou **Credenciais → Criar credenciais → ID do cliente OAuth**):
   - Tipo: **Aplicativo da Web**.
   - **Origens JavaScript autorizadas**: `https://comuniqueqd.github.io` e `http://localhost:8000`
   - **URIs de redirecionamento autorizados**: a Callback URL copiada no passo 1.
   - Clique em **Criar** e copie o **ID do cliente** e a **Chave secreta do cliente**.
5. Volte ao Supabase (aba do passo 1): ative o Google, cole o ID e a chave secreta, e clique em **Save**.

A chave secreta do Google fica só no Supabase. Não coloque no código nem mande por chat.

## 3. Endereços permitidos

No Supabase: **Authentication → URL Configuration**.

- **Site URL**: `https://comuniqueqd.github.io/`
- **Redirect URLs** → **Add URL**, um de cada vez:
  - `https://comuniqueqd.github.io/`
  - `http://localhost:8000/`

## 4. Ligar a página ao projeto

No Supabase: **Project Settings → API Keys** (ou **Data API**). Copie:

- **Project URL** (ex.: `https://abcdefgh.supabase.co`)
- a chave **publishable** (começa com `sb_publishable_`) ou, na aba *Legacy*, a chave **anon**

Coloque os dois em [`supabase-config.js`](supabase-config.js). Essas duas podem ficar públicas.
**Nunca** use a chave `secret` / `service_role`: ela ignora todas as regras de acesso.

## Testar

- No computador: `npx serve -l 8000` na pasta do projeto e abra http://localhost:8000.
- Entre com o e-mail do administrador final. Você deve ver as abas Pendentes, Novo cadastro, Meus cadastros, Painel, Histórico e Equipe.
- Na aba **Equipe**, autorize as outras pessoas e escolha o acesso de cada uma. Quem entrar sem estar na lista pode clicar em **Pedir acesso**, e o pedido aparece na Equipe.

## Papéis

| | Moderador | Monitorador | Suporte |
|---|---|---|---|
| Enviar cadastros | ✓ | ✓ | ✓ |
| Pendentes | todos | todos | só os seus |
| Aprovar, reprovar, encerrar | ✓ | ✓ | – |
| Desfazer decisão, excluir cadastro | ✓ | – | – |
| Histórico completo | ✓ | ✓ | – |
| Meus cadastros e Painel | ✓ | ✓ | ✓ |
| Equipe (autorizar e escolher acesso) | ✓ | – | – |

O administrador final é um moderador que ninguém pode remover nem rebaixar.

## Situações de um cadastro

```
Aguardando análise ──Aprovar──────────────▶ Aprovado
        │ └────────Encerrar─────────────▶ Encerrado
        └─Reprovar─▶ Aguardando novo contato e documentação
                          ├──Aprovar──▶ Aprovado
                          └──Encerrar─▶ Encerrado
```

CPF e ID do entregador não se repetem. Cada ação fica registrada na tabela `eventos`, com quem fez e quando.

## Análises em SQL

O arquivo [`supabase/analises.sql`](supabase/analises.sql) tem consultas prontas para o **SQL Editor**: tempo até aprovação por cidade, taxa de reprovação por motivo, envios por pessoa por dia e outras. A view `vw_cadastros` junta tudo com os nomes das pessoas.

Os motivos de reprovação e de encerramento ficam na tabela `motivos`. Dá para acrescentar ou esconder motivos por SQL, sem mexer no app (exemplos no fim de `analises.sql`).

## Atualização: módulo de Bloqueios (migração 002)

Para quem já instalou o `schema.sql`. **Não apaga** os dados da ativação.

1. **SQL Editor → New query**: cole [`supabase/002-bloqueios.sql`](supabase/002-bloqueios.sql) inteiro e clique em **Run**.
2. (Opcional) **Importar o histórico da planilha**: rode, também no SQL Editor, o arquivo de importação gerado a partir da planilha "Controle de Bloqueios". Esse arquivo tem dados de entregadores e **não fica no repositório**. Ele recusa rodar duas vezes.
3. Publique a versão nova do site (a `main`).
4. No app, aba **Bloqueios → Regras**: escolha o responsável pela tratativa de cada cidade. Antes disso, as tratativas vão para todos os moderadores.
5. Na **Equipe**, ajuste o acesso de cada pessoa nos bloqueios (a migração copia o acesso que cada um já tinha na ativação).

Regras de bloqueio (editáveis pela aba Regras):

- a ocorrência é contada **por ID e por infração, pela data**;
- 1ª e 2ª ocorrência usam as horas da regra; da 3ª em diante, a anterior + 30%; horas vazias = **encerramento de parceria**;
- no atraso, se passar 60 dias sem atraso a punição volta a ser a da 1ª (o histórico continua);
- bloqueios de **10 h ou mais** e encerramentos geram uma **tratativa** para o responsável da cidade; resolver a tratativa avisa quem registrou e **não** libera o bloqueio;
- o bloqueio termina sozinho no fim do prazo; monitorador ou moderador pode liberar antes, com motivo.
- **infrações leves** (avisos de 30 min: reabertura de pedido e atraso na coleta) são registradas só com o ID e o motivo e contam separado dos bloqueios. Se o ID nunca apareceu, o monitoramento recebe a tarefa de completar nome e cidade. A cada **3 leves em 50 dias** (os dois motivos juntos), a última gera um **bloqueio normal** da infração correspondente e uma tarefa de contato para o responsável da cidade; depois a contagem zera. Duração, limite e período ficam na aba Regras.
