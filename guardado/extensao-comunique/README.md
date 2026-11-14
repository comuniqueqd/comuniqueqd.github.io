# Extensão do Comunique (ideia guardada, ainda não aprovada)

Conversa do usuário no chat do claude.ai em 13/11/2026. **Não começar a construir**: o usuário está juntando as funções e vai dar o "ok" quando quiser começar. Até lá, anotar aqui as ideias novas que ele mandar.

## Spec (rascunho)

**Pedido:** uma extensão do Chrome/Edge que lê a tela aberta do entregador (ID, nome e cidade) e manda direto para o Comunique, sem precisar abrir o Comunique.

**Problema:** hoje a equipe copia ID e nome à mão de uma tela para outra; já houve ID colado errado (o mesmo ID com nomes diferentes na planilha antiga de bloqueios).

**Quem usa:** a equipe de operação (monitoramento e suporte), no navegador, enquanto atende ou monitora.

**Telas onde a extensão atua** (as duas que o usuário mostrou; confirmar os seletores na hora de construir):

| Tela | ID | Nome | Cidade |
|---|---|---|---|
| Admin da Quero Log: Entregadores › Lista › página do entregador | linha "Id" do bloco Informações | trilha do topo ("Lista / Nome") | linha "Franquia" |
| Caixa de entrada do atendimento (admin.querolog.io) | campo `entregador_id` em "Dados personalizados" (painel da direita) | nome do contato no painel da direita (na tela aparece cortado com "…"; ver se o DOM tem o nome completo) | campo `cidade` em "Dados personalizados" |

**Botões da extensão:**

1. **Salvar entregador**: grava ID, nome e cidade no Comunique (ficha do entregador). Candidata: `cadastrar_entregador(p_id_app, p_nome, p_cidade, p_comentario)`.
2. **Bloquear entregador**: pega ID, nome e cidade e abre uma caixa para escolher o tipo de bloqueio (lista das `infracoes`); dá para mostrar a prévia (`previa_bloqueio`: ocorrência e horas) antes de confirmar. Candidata: `registrar_bloqueio_agravante`.
3. **Fazer adicional para entregador**: pega ID, nome e cidade, pergunta o valor e **grava o adicional no Comunique** (Financeiro), **não no admin da Quero Log**; serve para registrar o adicional sem abrir o Comunique. Candidata: `registrar_adicional`.

**O que deve acontecer:**
- Quando a pessoa clica num botão numa das duas telas, então a extensão mostra ID, nome e cidade encontrados para a pessoa conferir antes de gravar.
- Quando a tela não tem ID de entregador (ex.: conversa com cliente ou estabelecimento), então a extensão avisa "não encontrei ID de entregador nesta tela" e não grava nada.
- Quando o ID já existe no Comunique com outro nome, então a extensão avisa antes de gravar.

**Fica de fora:**
- Ler qualquer outro dado da tela: o admin mostra CPF, CNH, telefone e e-mail, e a extensão **só lê ID, nome e cidade** (coerente com a 009s, que tirou o CPF do Comunique; LGPD).
- Gravar qualquer coisa no admin da Quero Log (lançar crédito/débito etc.).

**Pronto quando:** os três botões funcionam nas duas telas, gravando no Supabase com o login da pessoa, e cada "Quando…, então…" acima tem teste.

**Dúvidas abertas:**
- **Login:** a extensão precisa da sessão do Supabase da pessoa (hoje o login é Google com `signInWithIdToken`). Caminhos: login próprio na extensão (`chrome.identity` + `signInWithIdToken`) ou aproveitar a sessão já aberta do comuniqueqd.github.io. Decidir com o usuário.
- **Permissão da empresa:** confirmar com a liderança/TI se pode instalar extensão nas telas do admin e do atendimento.
- Endereços exatos (domínios) das duas telas, para limitar a extensão só a elas.
- Botão de adicional: quais campos do `registrar_adicional` são obrigatórios além do valor (origem QD/outros, motivo, pedido…) e como pedir isso com o mínimo de cliques.
- Distribuição: instalar como "sem compactação" na equipe ou publicar na Chrome Web Store (privada).
