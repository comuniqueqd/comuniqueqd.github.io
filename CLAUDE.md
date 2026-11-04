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
npm run test:entregadores # cadastro do entregador, comentários, correção e segurança do supabase/003-entregadores.sql
npm run test:atividades # atrasos/realocação, atividades sugeridas, registros, ficha e tela inicial do supabase/004-atividades-registros.sql
npm run test:analises   # análises, resumo semanal, aprovados e bloqueios, anexos do supabase/005-analises-anexos.sql
npm run test:equipe     # regras de equipe, prazo editável, previsão, atenção do supabase/006-equipe-previsao-atencao.sql
npm run test:e2e        # o site inteiro no Chromium contra o Postgres, via testes/supabase-falso.mjs
```

- `testes/supabase-local.sql` cria num Postgres comum o mínimo do Supabase (papéis `anon`/`authenticated`, `auth.uid()`, `auth.jwt()`). Nunca rodar no Supabase real.
- `testes/supabase-falso.mjs` imita o PostgREST (`POST /rest/v1/rpc/<fn>` → `select public.<fn>(...)` com `set local role authenticated` e as claims do JWT) e o login por token do Google (confere o nonce). O e2e injeta a sessão no `localStorage` (`sb-127-auth-token`), troca o script do Google por um falso e serve o supabase-js de `node_modules`.
- Prints do e2e ficam em `testes/prints/`. Com outra versão do Chromium já instalada: `CHROMIUM=/caminho/do/chrome npm run test:e2e`.

Rodar o site localmente: `npx serve -l 8000` (o Supabase só aceita os redirecionamentos configurados, ver `SUPABASE.md`).

## Arquitetura

**Banco (fonte da verdade de regras e permissões).** O front só chama funções RPC; as tabelas não têm políticas de escrita, e as funções `security definer` conferem o papel com `exigir_papel(...)` (ativação) ou `exigir_bloq(...)` (bloqueios). Esconder um botão não é controle de acesso.
- `supabase/schema.sql` = instalação do zero (apaga tudo, inclusive as tabelas dos módulos). Migrações, em ordem e sem apagar dados: `002-bloqueios.sql`, `003-entregadores.sql`, `004-atividades-registros.sql`, `005-analises-anexos.sql`, `006-equipe-previsao-atencao.sql`. Cada uma redefine funções das anteriores: rodar uma de novo exige rodar as seguintes depois (o 002 também apaga as versões novas de `registrar_bloqueio`/`registrar_infracao_leve` para não ficarem duas). Mudanças futuras: novo arquivo `007-...sql` com `alter`/`create or replace`, testado rodando duas vezes; funções novas precisam de `grant execute ... to authenticated` (as migrações fazem em bloco no fim e revogam de novo as internas: a lista completa está no fim da última migração; funções auxiliares novas usadas só dentro de outras funções `security definer` entram nessa lista). Alterar arquivos SQL no repositório não muda o Supabase: alguém precisa rodar no SQL Editor.
- **Acesso por módulo**: `membros.papel` (ativação) e `membros.papel_bloqueios` (nulo = sem acesso). Papéis: `moderador`, `monitorador`, `suporte`. `membros.admin_final` (um só, semeado no `schema.sql`) não pode ser removido nem alterado, e é moderador nos dois módulos (constraint `membros_admin_final_moderador`).
- **Ativação**: `cadastros` guarda a situação atual (`aguardando_analise` → aprovar | reprovar→`aguardando_contato` | encerrar; `aguardando_contato` → aprovar | encerrar; transições em `decidir()`); `eventos` guarda cada ação. CPF só dígitos e único; `id_app` único sem diferenciar maiúsculas.
- **Bloqueios**: `infracoes` (regras: `horas_1a`, `horas_2a`, `terceira_encerra`, `fator` = 1,30, `janela_dias` = 60 no atraso; horas nulas = **encerramento de parceria**) e `cidades` (responsável pela tratativa). `calcular_ocorrencia()` conta por ID+infração **pela data**; com janela, a sequência só continua se cada intervalo ≤ janela (senão a punição volta à 1ª, mas `ocorrencia_total` guarda o histórico). `horas_previstas()` aplica 1ª/2ª e depois +fator a cada ocorrência, arredondando a cada passo. As horas ficam gravadas no bloqueio (mudar a regra não altera bloqueios antigos). `situacao_bloqueio()` é calculada na leitura (bloqueado/liberado/liberado_antes/encerramento): o fim do prazo libera sozinho, sem cron.
- **Infrações leves** (`infracoes.leve`, avisos de 30 min = `horas_1a` 0,5; `escala_para` = infração normal gerada): registradas por `registrar_infracao_leve()` só com ID + motivo (nome/cidade vêm de `dados_conhecidos()`; sem nome → `bloqueios.dados_pendentes` e uma tarefa `completar_dados` por ID, visível a todo o monitoramento, resolvida por `completar_dados_bloqueio()`). `leves_acumuladas()` conta as leves do ID dentro de `parametros_bloqueio.leves_janela_dias` e depois da última que já gerou bloqueio; ao chegar em `leves_limite`, a leve recebe `gerou_bloqueio` e é criado um bloqueio normal (regras normais) com tarefa `leves_acumuladas`. Leves não contam como ocorrência das infrações normais. Horas são `numeric` (o banco devolve "94.00" em SQL direto; via RPC/JSON chega como número).
- **Cadastro do entregador** (`entregadores`, 003): um registro por ID (`id_app` em minúsculas), com nome e cidade "oficiais". Nasce sozinho do primeiro bloqueio com dados (gatilho `bloqueio_cria_entregador`, nunca sobrescreve) e é a primeira fonte de `dados_conhecidos()`. Monitorador/moderador alteram com `salvar_entregador()` (opcionalmente aplicando aos bloqueios já feitos). `comentarios_entregador` guarda comentários (`registrar_*` com `p_comentario`, `comentar_entregador()`; apaga quem escreveu ou moderador) e as alterações de dados (tipo `alteracao`, não se apagam).
- **Correção de bloqueio** (`corrigir_bloqueio()`, monitorador/moderador): troca ID/nome/cidade com motivo obrigatório, limpa `revisar`, grava `eventos_bloqueio` (`corrigido`/`revisado`). Sem alteração = só marca como revisado. Horas e ocorrência gravadas não mudam. Leves: a marca `atingiu_limite` (e não `gerou_bloqueio`, que vira nulo se o bloqueio gerado for apagado) é o que zera a contagem.
- **Tratativa atrasada** (004): `tarefa_atrasada()` = pendente há mais de `parametros_bloqueio.tratativa_prazo_horas` (32), exceto `completar_dados`. Sem cron: o front chama `verificar_atrasos()` (a cada 5 min de uso), que avisa os moderadores uma vez por tarefa (`tarefas.atraso_avisado_em`). `realocar_tarefa()` (moderador) troca o responsável; `salvar_cidade()` não desfaz realocações (`realocada_em`). Liberar um encerramento = situação `revertido`.
- **Atividades sugeridas** (`atividades`, 004): `sugerir_atividade()` (todos), `sugeridas_para` uuid[] (vazio = todos); `atividade_aberta_para_mim()` = sugerida para mim, sem sugestão, ou criada há 10 min ou mais. Status `aberta` → `aceita` (`aceitar_atividade`) → `concluida` (quem aceitou ou moderador). Exclui quem criou ou moderador.
- **Registros** (`listar_registros()`, 004): feed de `eventos` + `eventos_bloqueio` + `comentarios_entregador`, paginado por `p_antes`; quem não tem o módulo de bloqueios só vê a ativação. `consultar_entregador()` traz `linha_do_tempo` por ID. `resumo_inicio()` traz os números da pessoa e da equipe e os papéis (o front percebe mudança de acesso sem recarregar).
- **Análises e Resumo semanal** (005, para todos os papéis, só agregados): `analises(p_dias, p_cidade)` e `resumo_semanal(p_data)` (semana de **terça a segunda**, `inicio_semana()`, horário de Brasília). `ativacao_ao_bloqueio()` usa a data do primeiro evento `aprovado`. `aprovados_e_bloqueios()` (monitorador/moderador) alimenta o fim do Histórico da ativação. PDF do resumo = `print()` com `@media print` mostrando só `section.view.imprimir`.
- **Anexos** (`anexos`, 005): `bytea` no banco (até 300 KB, 3 por bloqueio, teto total 200 MB), sem política de leitura na tabela: o conteúdo só sai por `baixar_anexo()`. Suporte só nos bloqueios que registrou (`pode_ver_bloqueio()`). Imagens são comprimidas no navegador (canvas → JPEG ~200 KB) antes de `anexar()`.
- **Regras de equipe** (006): `cidades.gestao` (`quero`|`operador`), `operador_id` (→ `operadores_logisticos`), tarifas; `parametros_equipe.responsavel_operadores_email`. `responsavel_cidade_email()` = responsável dos operadores se a cidade é de operador, senão `cidades.responsavel_email`; `responsavel_da_cidade()` exige monitorador/moderador nos bloqueios (senão nulo = moderadores). Mudar responsável/gestão chama `reatribuir_tarefas()`. O responsável recebe aviso de cadastro novo (gatilho `avisar_cadastro_novo`) e de tratativa atrasada (`verificar_atrasos`). `regras_equipe()` para todos; edição só moderador da ativação. A planilha de cidades é importada por SQL privado (fora do repositório).
- **Previsão de término** (006): colunas `previsao`/`previsao_por_nome` em `cadastros`, `tarefas`, `atividades`; `definir_previsao(p_tipo, p_id, p_previsao)`. Só informativa. Front: `App.u.previsao(item, tipo, id, pode)`.
- **Entregadores de atenção** (006): `entregadores_atencao()` (janela `parametros_bloqueio.atencao_janela_dias` = 50): a uma leve do limite, 2+ bloqueios, 2+ tipos, aprovado há ≤ 30 dias e já bloqueado; sem os encerrados. Prazo da tratativa: `salvar_prazo_tratativa()`.
- **Tarefas** (`tarefas`): base da aba Atividades. Tipos: `tratativa` (bloqueio ≥ 10 h), `encerramento_parceria`, `leves_acumuladas`, `completar_dados`. Criadas por `inserir_bloqueio()` (ou forçadas via `p_tarefa`) para o responsável da cidade (nulo = moderadores). `concluir_tratativa()` não libera o bloqueio e gera `notificacoes` para quem registrou. Importados da planilha: só ficam pendentes as tratativas de quem ainda está bloqueado.
- `metricas()` (ativação) e `metricas_bloqueios()` são `security definer` e devolvem só agregados para todos os papéis; `listar_cadastros`/`listar_bloqueios` são `security invoker` (o RLS faz o suporte receber só os próprios).

**Front.** `index.html` (todas as telas), `estilo.css` e `js/`:
- `js/base.js`: utilidades (`App.u`), estado comum (`App.S`), login, rotas e o ciclo `App.carregar()`/`App.render()`. Rotas `#modulo/aba` (as antigas `#pendentes`, `#novo`… continuam valendo para a ativação). Cada módulo se registra com `App.modulo({ id, acesso, abas: [{ id, secao, pode, contador }], padrao, carregar(aba), render(aba), contadores() })`; a barra de abas é montada a partir disso.
- `App.u.janela(titulo, ...conteudo)` abre um `<dialog>` (correção do bloqueio, alteração do cadastro do entregador). O alerta "revisar" é um botão para monitorador/moderador em qualquer tela.
- `App.abrirFicha(id)` (em `js/bloqueios.js`) abre a Ficha do entregador; nomes de entregador nas listas são `button.link-ficha`.
- `js/inicio.js`, `js/ativacao.js`, `js/bloqueios.js`, `js/atividades.js`, `js/analises.js`, `js/registros.js`, `js/equipe.js`. A ordem dos `<script>` importa (base primeiro).
- `render()` é adiado enquanto há um campo focado dentro de um elemento `.protege-foco` (listas que se redesenham). DOM montado por `el()` (via `textContent`, nunca `innerHTML`). Atualiza por Realtime (`postgres_changes`) e a cada 30 s.
- **Login**: botão oficial do Google (GIS, `GOOGLE_CLIENT_ID`) → `signInWithIdToken` com nonce (Google recebe o SHA-256; Supabase o valor original), para a janela do Google mostrar o domínio do site. Sem o script do Google, `botaoGoogle()` cai no `signInWithOAuth`. `supabase-config.js` tem URL, chave publishable e ID do cliente Google (todos públicos). `privacidade.html` é exigida pela tela de permissão do Google.

## Dados pessoais

O repositório é público. Não commitar planilhas, CSVs ou SQL com dados de entregadores (a importação do histórico de bloqueios é entregue à parte, fora do repositório).

## Pendências conhecidas

- **Migração 007 (combinada)**: nome do entregador no cadastro da ativação; ficha (`entregadores`) criada na aprovação; cadastro incompleto (sem nome ou sem ID, ou ID com ficha de outro nome) recebe marca "revisar" (botão no Histórico e discreto no cartão de Pendentes) e janela para completar (monitorador/moderador); aprovar com dados faltando é permitido. Novo formato de **tarefa opcional** (cartão menor, etiqueta "Opcional", reutilizável): cadastro novo incompleto gera tarefa normal para o admin final e opcional para o restante; uma tarefa só (quem aceita tira dos outros); conclui sozinha quando os dados são completados. Botão "Sugerir tarefa" na janela de revisão: sem pessoa = admin + opcional para todos; com pessoa = atividade sugerida normal. Cadastros já existentes (aprovados ou não) só ganham a marca, sem tarefa.
- **Migração 008 (planejada): notificações.** Sino abre uma tira com os avisos mais recentes (sem sair da tela); tela de Avisos com busca por palavras e filtros. Tudo o que entra em Registros e tem cidade avisa o responsável da cidade (inclusive comentários sobre o entregador). Decisões em aberto com o usuário: silenciar tipos, quem recebe quando não há responsável, "seguir cidade", moderadores recebem tudo ou não, aviso agrupado de leves.
- **009 (planejada): funções do dia a dia.** Primeira: tela para calcular o ajuste de valor de corrida quando o bairro foi cobrado errado (usar as tarifas da Regras de equipe).
- **010 (planejada): comemorativa.** Visual novo, brincadeiras/dinâmicas internas e página "Quem somos".
- **Lembrete permanente:** sempre lembrar o usuário das funções que ajudam a equipe no dia a dia (ele pediu explicitamente) e da 009.
- Objetivos do Comunique (para textos e apresentações): três pilares: (1) transformar comunicações do dia a dia em tarefas e quantificar isso (metas da gestão e pessoais; mostrar o esforço de cada um); (2) facilitar o trabalho diário, centralizando tudo num lugar só, com menos telas e dinâmicas diferentes; (3) gerar análises precisas que passam despercebidas olhando só os números principais.
- Importação incremental da planilha de bloqueios: aguardando a planilha atualizada.
- O `testes/supabase-falso.mjs` só repassa argumentos de RPC no formato `p_[a-z0-9_]+`.
