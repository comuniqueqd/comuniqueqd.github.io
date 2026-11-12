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

**Se depois de rodar o módulo Bloqueios não aparecer** (ou surgir "Erro ao carregar dados" mencionando `resumo_inicio`), a migração não entrou inteira: rode o `002-bloqueios.sql` de novo, do começo ao fim (e depois o `003-entregadores.sql` e o `004-atividades-registros.sql`, se já tiverem rodado). Ele foi feito para poder rodar mais de uma vez sem apagar nada. Depois recarregue o site com Ctrl+F5.

Regras de bloqueio (editáveis pela aba Regras):

- a ocorrência é contada **por ID e por infração, pela data**;
- 1ª e 2ª ocorrência usam as horas da regra; da 3ª em diante, a anterior + 30%; horas vazias = **encerramento de parceria**;
- no atraso, se passar 60 dias sem atraso a punição volta a ser a da 1ª (o histórico continua);
- bloqueios de **10 h ou mais** e encerramentos geram uma **tratativa** para o responsável da cidade; resolver a tratativa avisa quem registrou e **não** libera o bloqueio;
- o bloqueio termina sozinho no fim do prazo; monitorador ou moderador pode liberar antes, com motivo.
- **infrações leves** (avisos de 30 min: reabertura de pedido e atraso na coleta) são registradas só com o ID e o motivo e contam separado dos bloqueios. Se o ID nunca apareceu, o monitoramento recebe a tarefa de completar nome e cidade. A cada **3 leves em 50 dias** (os dois motivos juntos), a última gera um **bloqueio normal** da infração correspondente e uma tarefa de contato para o responsável da cidade; depois a contagem zera. Duração, limite e período ficam na aba Regras.

## Atualização: cadastro do entregador, comentários e correções (migração 003)

Para quem já rodou o `002-bloqueios.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/003-entregadores.sql`](supabase/003-entregadores.sql) inteiro e clique em **Run**. Deve aparecer "Success. No rows returned".
2. Só depois publique a versão nova do site (a `main`): o site novo usa funções que só existem depois do passo 1.

O que muda:

- **Cadastro do entregador**: cada ID ganha nome e cidade "oficiais", criados a partir dos bloqueios. Em **Consultar entregador**, monitorador e moderador podem alterar esses dados (e, se quiserem, aplicar aos bloqueios já registrados). Os próximos registros do ID já vêm preenchidos com eles.
- **Comentários**: no Novo bloqueio há um campo opcional de comentários adicionais, que vai para o cadastro do entregador. Na consulta, qualquer pessoa do módulo de bloqueios pode comentar; quem escreveu ou um moderador pode apagar.
- **Revisar / Corrigir**: o alerta "revisar" virou um botão. Ele abre uma janela para corrigir ID, nome e cidade (motivo obrigatório) ou marcar como revisado. Também há o botão **Corrigir** no histórico, nos cartões e na consulta. A punição aplicada não muda.
- **Segurança**: funções internas deixam de poder ser chamadas por quem está logado mas fora da equipe.

**Se rodar uma migração de novo**, rode também as seguintes, em ordem (002 → 003 → 004 → 005 → 006 → 007 → 008).

## Atualização: atividades sugeridas, registros, tratativas atrasadas (migração 004)

Para quem já rodou o `003-entregadores.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/004-atividades-registros.sql`](supabase/004-atividades-registros.sql) inteiro e clique em **Run**.
2. Só depois publique a versão nova do site (a `main`).

O que muda:

- **Tratativa atrasada**: pendente há mais de 32 h fica vermelha. Os moderadores recebem um aviso no sino (uma vez por tarefa) e podem **realocar** a tarefa para outro monitorador ou moderador. O aviso é gerado quando alguém da equipe abre o app (não há serviço agendado). O prazo fica em `parametros_bloqueio.tratativa_prazo_horas`.
- **Atividades sugeridas** (Atividades → Atividades sugeridas): qualquer pessoa cria, com prazo opcional, e pode indicar pessoas. Se ninguém indicado aceitar em 10 minutos, fica aberta para todos. Quem aceitou conclui (ou um moderador); quem criou ou um moderador exclui.
- **Registros**: feed único das ações dos dois módulos, para todos os papéis.
- **Consultar entregador**: linha do tempo dos dois módulos, leves separadas e o cadastro da ativação. Clicar no nome de um entregador em qualquer tela abre a ficha.
- **Tela inicial**: os seus números e os da equipe.
- **Reverter encerramento**: no lugar de "liberar antes do prazo" num encerramento de parceria.
- A lista de cidades do formulário da ativação passa a vir da aba Regras.

## Atualização: Análises, Resumo semanal e anexos (migração 005)

Para quem já rodou o `004-atividades-registros.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/005-analises-anexos.sql`](supabase/005-analises-anexos.sql) inteiro e clique em **Run**.
2. Só depois publique a versão nova do site (a `main`).

O que muda:

- **Análises** (módulo novo, para todos, só números): eficácia da punição, tempo até reincidir, quando a equipe registra (dia × hora), bloqueados agora por cidade (vindos da ativação ou só dos bloqueios), conversão das infrações leves, tratativas por responsável e **da ativação ao bloqueio**.
- **Resumo semanal** (aba das Análises): semana de **terça a segunda**, qualquer semana anterior, comparação com outra semana e download em **CSV** ou **PDF** (pela janela de impressão do navegador: "Salvar como PDF").
- **Histórico da ativação**: no fim, a lista dos aprovados e se/quando foram bloqueados depois.
- **Anexos** nos bloqueios: até 3 por bloqueio; imagens comprimidas no navegador (~200 KB), PDF até 300 KB. Ficam no banco, com as mesmas regras de acesso (o suporte só nos bloqueios que registrou), teto total de 200 MB. Ao anexar aparece o aviso para não anexar documentos pessoais.

## Atualização: Regras de equipe, previsão e entregadores de atenção (migração 006)

Para quem já rodou o `005-analises-anexos.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/006-equipe-previsao-atencao.sql`](supabase/006-equipe-previsao-atencao.sql) inteiro e clique em **Run**.
2. (Opcional) **Importar a planilha de cidades**: rode o arquivo de importação gerado a partir da planilha "Cidades do Quero Log e taxas" (aba JULHO 2026). Ele tem telefones e **não fica no repositório**. Pode rodar de novo (atualiza). No fim, ele lista as cidades e quem recebe os avisos; quem aparecer como "escolher na tela" se ajusta em Equipe → Regras de equipe (o responsável pelos operadores fica em Equipe → Operadores logísticos).
3. Só depois publique a versão nova do site (a `main`).

O que muda:

- **Equipe → Regras de equipe** (todos veem; moderadores editam): cidades com gestão (Quero Delivery ou Operador Logístico), operador logístico e contato, tarifas e responsável. Cidades de operador logístico usam o **responsável pelos operadores** (um só para todas). O responsável recebe as tratativas, um aviso a cada cadastro novo da cidade e o aviso de tratativa atrasada. A lista de responsáveis da aba Bloqueios → Regras passou para cá.
- **Previsão de término** nos cadastros da ativação, nas tratativas e nas atividades sugeridas (só informativa).
- **Bloqueios → Atenção**: entregadores perto de uma punição maior.
- **Prazo da tratativa** editável na aba Bloqueios → Regras.
- **Histórico de bloqueios** com páginas de 100.

## Atualização: "Pão quentinho" · tudo conectado (migração 007)

Para quem já rodou o `006-equipe-previsao-atencao.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/007-pao-quentinho.sql`](supabase/007-pao-quentinho.sql) inteiro e clique em **Run**.
2. Só depois publique a versão nova do site (a `main`).

O que muda:

- **Aviso para quem enviou o cadastro** quando ele é aprovado, reprovado, encerrado ou desfeito (no sino; quem decidiu não recebe o próprio aviso).
- **Nome do entregador no Novo cadastro.** Aprovado com ID e nome, a ficha do entregador nasce na hora (nunca sobrescreve uma ficha que já existe).
- **Marca "revisar" nos cadastros incompletos** (sem nome, sem ID, ou ID com ficha de outro nome), no Histórico (filtro "Para revisar") e discreta no cartão de Pendentes. **Qualquer pessoa da equipe** completa ou corrige os dados (ID, CPF, nome, cidade, observação), com o antes e o depois no histórico do cadastro. Monitorador e moderador podem marcar "Os dados estão certos". Aprovar com dados faltando continua permitido. Os cadastros que já existiam só ganham a marca, sem tarefa.
- **Tarefa opcional** (formato novo): cadastro novo incompleto gera uma tarefa normal para o administrador final e opcional, em cartão menor, para o resto da equipe; quem pega tira dos outros; conclui sozinha quando os dados ficam completos. Na janela de revisão, **Sugerir tarefa** (sem pessoa = administrador + opcional para todos; com pessoa = só para ela).
- **Um cartão opcional "Revisar registros da planilha: faltam N"** para monitoradores e moderadores dos bloqueios, que abre o Histórico filtrado e some quando chega a zero.
- **Histórico do ID**: no Novo cadastro, ao digitar o ID ou o CPF, aparece o que o Comunique já sabe (ficha, bloqueios, leves, comentários, parceria encerrada). Só informa, não impede o envio. O mesmo resumo aparece no cartão de Pendentes.
- **Busca rápida no topo** (ID, CPF ou nome): fichas de entregador (só para quem tem o módulo de bloqueios) e cadastros da ativação.
- **"O que há de novo"**: janela com as novidades, uma vez por pessoa a cada versão.
- **Menos tráfego**: o app pergunta um número barato (`ultima_mudanca()`) e só recarrega as listas quando algo mudou (e tudo a cada 5 min); sem mexer no mouse/teclado por 5 min, atualiza a cada 2 min; resumo e avisos numa chamada só; a lista da equipe só na tela Equipe; Histórico de bloqueios paginado e filtrado no banco (o CSV baixa até 5000 linhas com os filtros da tela).

## Atualização: "Espionagem profissional" · casos suspeitos (migração 008)

Para quem já rodou o `007-pao-quentinho.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/008-espionagem.sql`](supabase/008-espionagem.sql) inteiro e clique em **Run**.
2. Só depois publique a versão nova do site (a `main`). Nesta versão a ordem importa: o site novo não funciona com o banco antigo.

O que muda:

- **Casos suspeitos de uso por terceiros** (menu **Casos 🕵️**). Viram caso: CPF que já existe tentando entrar com outro nome ou outro ID (a tentativa fica registrada; antes era só recusada); entregador encerrado tentando voltar (mesmo CPF, ou mesmo nome com outro ID, inclusive quem tem a parceria encerrada nos bloqueios), com sinal 🔴 forte; e troca de nome ou ID num cadastro já aprovado.
- **Toda a equipe recebe o aviso** de cada caso novo. Quem cadastrou escolhe **Eu verifico** ou **Pedir verificação** (vai para o responsável da cidade; sem responsável, para os moderadores). Os casos para você aparecem nas Pendências.
- **Checklist de verificação** (modelo editável pelos moderadores na tela Casos), comentários e **veredito** (confirmado ou descartado, com nota) por monitorador ou moderador. Confirmado grava um comentário na ficha do entregador e o app sugere encerrar o cadastro; nada é encerrado sozinho.
- **Aprovar com caso aberto** continua permitido, com um clique a mais.
- **Selo 🕵️ "caso aberto"** nos cadastros e na ficha; **lupa do detetive**: a busca do topo acha também casos, comentários e os seus avisos; **Placar do detetive** nas Análises.

## Ajuste urgente: cadastrar entregador avulso (migração 008b)

Para quem já rodou o `007-pao-quentinho.sql`. **Não depende da 008** (pode rodar antes ou depois dela), **não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/008b-cadastrar-entregador.sql`](supabase/008b-cadastrar-entregador.sql) inteiro e clique em **Run**.
2. Depois publique o site.

O que muda:

- **Módulo novo no menu: Entregadores → Cadastrar entregador**: cria a ficha do entregador (ID, nome, cidade e um comentário opcional) sem precisar de ativação nem de bloqueio, e mostra ao lado os **cadastrados recentemente**. Também se chega lá pelo botão “+ Cadastrar entregador” em Consultar entregador, e por **Cadastrar este entregador** quando a busca não acha ninguém (já com o ID buscado).
- O módulo aparece para quem tem o módulo de bloqueios (moderador, monitorador e suporte). ID que já tem ficha é recusado (para mudar os dados, use **Alterar dados** na ficha).
- Os próximos registros deste ID (bloqueios e infrações leves) já vêm com nome e cidade. Se o ID tinha infrações leves esperando os dados, o monitorador ou moderador que cadastra completa esses registros e fecha a tarefa “completar dados”; quando é o suporte, a tarefa continua para o monitoramento.

## Atualização: "Espião ou fofoqueiro? Virou rede social?" · avisos (migração 008b, parte 1)

Para quem já rodou a `008-espionagem.sql` e o `008b-cadastrar-entregador.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/008b-notificacoes.sql`](supabase/008b-notificacoes.sql) inteiro e clique em **Run**.
2. Só depois publique o site (a tela de Avisos nova usa as funções desta migração).

O que muda:

- **Tudo o que entra em Registros vira aviso** para os **moderadores** (de qualquer módulo) e para o **responsável da cidade**: cadastros enviados e decididos, bloqueios, infrações leves, tratativas, liberações, correções, comentários e alterações na ficha. Quem fez a ação não recebe, e cada pessoa recebe **um aviso só por ação** (o aviso pessoal, como "seu cadastro foi aprovado", tem preferência). Assuntos dos bloqueios só vão para quem tem o módulo. Importações feitas pelo SQL Editor não geram avisos.
- **Sino com tira**: os avisos recentes abrem por cima da tela. **Tela de Avisos** com busca por palavras (nome, ID, cidade…), filtros por tipo e cidade, "só os não lidos" e "Carregar mais".
- **Cidades sem responsável**: listadas na tela de Avisos; qualquer pessoa pede para ser a responsável. O pedido aparece nas **Pendências dos moderadores**, que aprovam ou recusam (recusa com motivo). Aprovado, a pessoa vira o responsável da cidade (Regras de equipe) e passa a receber os avisos dela; as tratativas só vão para ela se for monitorador ou moderador dos bloqueios. Cidade de operador sem responsável dos operadores passa a usar o responsável da própria cidade.
- **Casos suspeitos guardados**: a tela Casos saiu do app (guardada em `guardado/casos/` para voltar depois de revista). Os dados continuam no banco, mas um interruptor desligado (`parametros_casos.ligado`) faz com que nenhum caso novo seja aberto: CPF repetido volta a ser só a recusa de sempre.
- **O suporte também revisa**: corrige os registros dos bloqueios marcados "revisar" e os que ele mesmo registrou (com motivo, como sempre), e marca "Os dados estão certos" nos cadastros.

## Atualização 008c: análises simples e complexas, tela inicial com atalhos

Para quem já rodou o `008b-notificacoes.sql`. **Não apaga** nada, não muda funções antigas e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/008c-analises.sql`](supabase/008c-analises.sql) inteiro e clique em **Run**.
2. Só depois publique o site (as Análises novas usam as funções desta migração).

O que muda:

- **Tela inicial**: em cima, as funções do dia a dia como botões grandes (Nova ativação, Cadastrar entregador, Sugerir atividade, Registros); embaixo, "Seus números", menores.
- **Ativação** abre no **Novo cadastro** (Pendentes vem em seguida, com o número na aba); **Bloqueios** abre no **Novo bloqueio** (depois, Tratativas).
- **Análises simples** (`analises_simples`): ativação (agora e no período, taxa de aprovação, horas até aprovar), **por que não aprovou** (motivos das reprovações e encerramentos), bloqueios agora e **quem sai hoje** (por hora), bloqueados por cidade, **quando você registra** e quando a equipe registra (com o pico), você no período, atividades, tempo até reincidir, conversão das leves, infrações mais registradas e tratativas no prazo.
- **Menos telas**: a Ativação fica com Novo cadastro · Pendentes · Histórico (o Histórico junta o antigo "Meus cadastros") e os Bloqueios perdem o Painel e o "Meus registros" (o Histórico passa a ser de todos; o suporte vê só os seus). O que só existia nos Painéis foi para as Análises. Os endereços antigos continuam abrindo a tela nova.
- **Revisão (desempenho e segurança)**: o número de "algo mudou" só sobe quando uma linha muda de verdade (antes, abrir o app ou marcar avisos como lidos fazia todo mundo recarregar); o tempo real do Supabase passa a ouvir só os avisos (as outras tabelas saem da publicação do Realtime); e quem não é da equipe não consegue mais descobrir o nome da ficha de um ID por uma função interna.
- **Análises complexas** (`analises_complexas`): eficácia da punição, **qual infração mais se repete**, **escada da reincidência**, **cidades** (bloqueios por entregador, reincidentes, encerramentos, leves), **tempo de resposta da ativação** (por quem decidiu e pelo dia do envio), **punições desfeitas**, tratativas por responsável e da ativação ao bloqueio.

## Atualização 008d: fecha a 008 (de olho nele, seguir cidade, preferências, leves agrupadas, previsão vencida, resumo do dia)

Para quem já rodou o `008c-analises.sql`. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/008d-avisos-parte2.sql`](supabase/008d-avisos-parte2.sql) inteiro e clique em **Run**.
2. Só depois publique o site.

O que muda:

- **"De olho nele"**: botão "Ficar de olho" na ficha do entregador. Quem marca recebe tudo o que acontecer com ele, de qualquer cidade.
- **Seguir cidade** e **preferências** em Avisos → "O que você acompanha e recebe": escolher as cidades e os tipos de aviso que quer receber. O que é para a pessoa (tarefas, decisões dos cadastros dela, previsões vencidas) e o "de olho nele" sempre chegam.
- **Infrações leves agrupadas**: um aviso só por cidade e por dia, que vai somando ("3 infrações leves novas em LAGARTO hoje") e volta para o topo como não lido.
- **Previsão vencida**: quem deu a previsão de um cadastro, tratativa ou atividade recebe um aviso quando ela passa (uma vez por previsão).
- **Resumo do dia** no topo da tira do sino.
- **O suporte também revisa a planilha**: o cartão "Revisar registros da planilha" abre a lista para ele.
- **Histórico de bloqueios mais completo**, como o da ativação: quadrinhos com os totais (clicar filtra), "Só os que eu registrei" e o histórico de cada registro ao clicar na linha.

## Atualização 009a: punições iguais à Política de Boas Práticas e Conduta

Para quem já rodou a 008d. Só muda as horas das infrações normais (os bloqueios já registrados guardam as horas de quando foram feitos). Pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/009a-regras-politica.sql`](supabase/009a-regras-politica.sql) inteiro e clique em **Run**. No fim aparece a tabela da 1ª à 5ª ocorrência de cada infração, para conferir.
2. Se o aviso disser que alguma infração "não foi achada", ela foi renomeada na tela de Regras: ajuste por lá.

## Atualização 009b: Ferramentas (calculadora de bairro, tarifas) e Financeiro (adicionais)

Para quem já rodou a 009a. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/009b-ferramentas-financeiro.sql`](supabase/009b-ferramentas-financeiro.sql) inteiro e clique em **Run**.
2. Rode o arquivo de **importação dos bairros** (entregue à parte, fora do repositório): Tobias Barreto, Lagarto e Itabaiana. Pode rodar de novo (atualiza valores). No fim ele mostra quantos bairros cada cidade tem.
3. Só depois publique o site.

O que muda:

- **Ferramentas** (menu novo): **Calculadora de bairro** (o entregador recebe valor − taxa do log; ajuste = bairro real − bairro informado, nunca negativo) e **Tarifas dos bairros** (consulta para todos; moderador da ativação cria e edita, com apelidos para nomes repetidos).
- **Financeiro** (menu novo): **Registrar adicional** (adicional = valor combinado − valor da entrega; origem QD/outros, mercado, motivo), **Adicionais pendentes** (o que a pessoa registrou e ainda não lançou no sistema; qualquer um pode marcar como lançado) e **Lançamentos** (lista, números e CSV).
- **Aviso** a cada adicional ou ajuste para o responsável da cidade, moderadores e quem segue a cidade (categoria "Financeiro", dá para silenciar).

## Atualização 009c: mensagens prontas e agravante

Para quem já rodou a 009b. **Não apaga** nada e pode rodar mais de uma vez.

1. **SQL Editor → New query**: cole [`supabase/009c-mensagens-agravante.sql`](supabase/009c-mensagens-agravante.sql) inteiro e clique em **Run**.
2. Só depois publique o site.

O que muda:

- **Gerar mensagem** depois de registrar um bloqueio ou uma infração leve, e no Histórico: texto pronto com o primeiro nome do entregador, o motivo, a regra explicada (da Política de Boas Práticas e Conduta), o tempo e o término previsto. Bloqueio temporário aparece como **"restrição temporária"**.
- **Agravante** no Novo bloqueio: retenção de valores sem resposta ao suporte em 8 h (conta como a próxima ocorrência) e uso da conta por terceiro menor de 18 anos (encerra a parceria). Fica anotado no registro.
- **Avisos rápidos** na tela inicial: na retenção de valores, o Novo bloqueio pergunta "Já foi solucionado?". Se não, aparece para todos como "Aguardando prestação de contas" (com o nome do entregador, ou o ID) até alguém marcar como resolvido; a resolução fica no histórico do bloqueio.
- **009i (`supabase/009i-sem-cpf.sql`, rodar depois da 009h, pode rodar de novo)**: o Comunique deixa de usar CPF. **Apaga de vez** os CPFs gravados nos cadastros (e escritos em avisos, históricos e observações) e o banco passa a recusar CPF; o ID do entregador vira obrigatório no cadastro. Mostra no fim quantos apagou. **Não tem volta.**
- **009h (`supabase/009h-entregador-pelo-lancamento.sql`, rodar depois da 009g, pode rodar de novo)**: todo adicional, ajuste de bairro ou cadastro na ativação com ID e nome cria a ficha do entregador, se ainda não existe; nome e cidade em branco num lançamento vêm da ficha ou do último lançamento do mesmo ID. Ao rodar, cria as fichas que faltavam nos registros já feitos e mostra quantas criou (aba Messages / Notices do SQL Editor).
- **009g (`supabase/009g-tarefas-compartilhadas.sql`, rodar depois da 009f, pode rodar de novo)**: tarefas de aprovar entregadores/parceiros compartilhadas ("Entrar junto") e a tarefa "Aprovar 5 entregadores" que nasce (ou soma 5) quando um parceiro é ativado.
- **009f (`supabase/009f-parceiros-completo.sql`, rodar depois da 009e, pode rodar de novo)**: parceiros por cidade e as notícias rápidas da tela inicial (só funções novas).
- **009e (`supabase/009e-parceiros.sql`, rodar depois da 009d3, pode rodar de novo)**: parceiros (registro direto), tarefas "Aprovar entregadores"/"Aprovar parceiros" que contam sozinhas as aprovações de quem está com elas e metas de aprovação.
- **009d3 (`supabase/009d3-painel-metas-recorrentes.sql`, rodar depois da 009d2, pode rodar de novo)**: painel das tarefas, metas pessoais (em teste), placar (só o administrador), tarefas que se repetem e revisão de qualidade por amostragem.
- **009d2 (`supabase/009d2-tarefas-cards.sql`, rodar depois da 009d, pode rodar de novo)**: tarefas em cards: tipos com campos e prazo padrão, pedir × registrar o que já fiz, progresso (Ativar entregadores conta sozinho), aguardando terceiro, checklist, comentários com @menções, agradecimentos, "Pegar a próxima" e aviso de tarefa sem dono/atrasada.
- **009d (`supabase/009d-ajuda-aviso-turno.sql`, rodar depois da 009c2, pode rodar de novo)**: pedido de ajuda (10 min ou até alguém aceitar; depois, pedir de novo ou mandar aos moderadores), aviso geral (até 12 h), passagem de turno (panorama, recado e o que passa/fica aberto/fica comigo, com lembrete às 18h) e **acordos com parceiros** (Financeiro → Acordos; no vencimento ficam na tela inicial de todos até "Ajuste feito"). Os sons dos avisos são do navegador (nada no banco).
- **009c2 (`supabase/009c2-mensagens-opcoes.sql`, rodar depois da 009c, pode rodar de novo)**: três opções de texto para cada mensagem de engajamento, versão "para a cidade" do movimento alto (sem nome do entregador) e a mensagem do parceiro avisando do PDF e do áudio. Textos já editados no app não são trocados.
- **Ferramentas → Mensagens prontas**: engajamento de entregadores e primeiro contato com o parceiro. Moderadores editam os modelos e a explicação de cada regra.

