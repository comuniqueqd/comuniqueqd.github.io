// Busca rápida no topo (ID, CPF ou nome → ficha do entregador ou cadastro da ativação) e a
// janela "O que há de novo", que aparece uma vez por pessoa a cada versão publicada.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, fmtCPF, rpc, msgErro, janela } = App.u;
  const S = App.S;

  // ---------- busca rápida ----------
  const form = $("#busca-topo"), campo = $("#q-topo"), res = $("#busca-res");
  let tempo = null, ultima = "";
  const fechar = () => { res.hidden = true; };
  const ir = (f) => { fechar(); campo.value = ""; ultima = ""; campo.blur(); f(); };
  async function buscar() {
    const q = campo.value.trim();
    if (q === ultima) return;
    ultima = q;
    if (q.length < 3) return fechar();
    let r;
    try { r = await rpc("busca_rapida", { p_q: q }); } catch (e) { res.replaceChildren(el("p", { class: "meta", style: "margin:6px 8px", text: msgErro(e) })); res.hidden = false; return; }
    if (q !== campo.value.trim()) return;
    const bloq = !!S.me?.papel_bloqueios;
    const linhas = [];
    if (r.entregadores.length) linhas.push(el("h4", { text: "Entregadores" }), ...r.entregadores.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(x.id_app)) },
        el("span", { text: x.nome || "(sem nome)" }),
        el("span", { class: "meta mono", text: `${x.id_app} · ${x.cidade || "sem cidade"} · ${x.bloqueios} bloqueio(s)` }))));
    if (r.cadastros.length) linhas.push(el("h4", { text: "Cadastros da ativação" }), ...r.cadastros.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => App.abrirCadastro(x.id)) },
        el("span", { text: x.nome || (x.id_app ? "ID " + x.id_app : "CPF " + fmtCPF(x.cpf)) }),
        el("span", { class: "meta mono", text: [x.id_app, x.cpf && fmtCPF(x.cpf), x.cidade, x.situacao].filter(Boolean).join(" · ") }))));
    // lupa: comentários sobre entregadores e os seus avisos
    const corta = (t, n = 90) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    if (r.comentarios?.length) linhas.push(el("h4", { text: "Comentários" }), ...r.comentarios.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(x.id_app)) },
        el("span", { text: corta(x.texto) }),
        el("span", { class: "meta", text: `${x.nome || x.id_app} · ${x.por_nome || "—"} · ${dt(x.em)}` }))));
    if (r.avisos?.length) linhas.push(el("h4", { text: "Seus avisos" }), ...r.avisos.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => (location.hash = x.link || "#avisos/para-mim")) },
        el("span", { text: corta(x.texto) }), el("span", { class: "meta", text: dt(x.criada_em) }))));
    if (!linhas.length) linhas.push(el("p", { class: "meta", style: "margin:6px 8px", text: "Nada encontrado." }));
    if (bloq) linhas.push(el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(q)) }, el("span", { class: "meta", text: `Consultar “${q}” na tela Consultar entregador →` })));
    res.replaceChildren(...linhas);
    App.u.grifar("busca-topo", res, q);  // 009l: grifa o termo nos resultados
    res.hidden = false;
  }
  campo.addEventListener("input", () => { clearTimeout(tempo); tempo = setTimeout(buscar, 300); });
  campo.addEventListener("focus", () => { if (res.childElementCount && campo.value.trim().length >= 3) res.hidden = false; });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(tempo); ultima = ""; buscar(); });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") { fechar(); campo.blur(); } });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) fechar(); });

  // ---------- o que há de novo ----------
  const VERSAO = "009p";
  // 008, 008b e 008c saem como atualizações ligadas: cada uma no seu bloco, da mais nova para a mais antiga
  // (pedido do usuário: acrescentar as novas sem tirar as anteriores).
  const VERSOES = [
    { versao: "009p", tema: "🏘️ Bairros sem repetição", itens: [
      ["Bairro com nome parecido", "Cadastrou um bairro com o nome quase igual a outro (Aldemar e Ademar, Várzea e VARZEA)? O Comunique entende que é o mesmo: o nome novo vira outro nome dele, com o mesmo valor. Se a dúvida for maior, ele pergunta antes."],
      ["Calculadora mais esperta", "Na Calculadora de bairro, um erro pequeno de digitação no nome do bairro não atrapalha mais: ela mostra qual bairro entendeu."],
      ["Juntar bairros repetidos", "Em Tarifas dos bairros, quem edita vê os pares com nome parecido que já existem e pode juntar (fica o valor escolhido) ou marcar que são diferentes."],
    ] },
    { versao: "009o", tema: "🧹 Tudo no lugar", itens: [
      ["Avisos arrumados", "A tela de Avisos ficou mais organizada: as duas caixas de configuração lado a lado e os filtros juntos num painel. “Só os não lidos” voltou a ficar ao lado da caixinha."],
      ["Listas sem buracos", "Avisos, Registros e as listas de cartões não deixam mais um espaço em branco no fim enquanto você rola."],
      ["Celular", "Os cartões de Pendentes e os filtros dos Históricos não passam mais da borda da tela no celular."],
    ] },
    { versao: "009n", tema: "📲 Comunique no seu computador", itens: [
      ["Instalar como app", "Quando o navegador permitir, aparece o botão 📲 Instalar no topo: o Comunique ganha ícone próprio e abre numa janela só dele, como um programa."],
      ["Tour das novidades", "Depois desta janela, uns balõezinhos mostram onde ficou o que mudou. Aparecem uma vez só."],
      ["Lançamentos mais leves", "Listas com muitos lançamentos ficaram mais leves para rolar."],
    ] },
    { versao: "009m", tema: "🧭 Tudo mais perto", itens: [
      ["Avisos no menu", "Avisos agora é um item do menu de cima, com duas abas: Para mim (os seus avisos) e Toda a equipe (o que antes ficava em Registros). O sino continua levando para lá."],
      ["Minha fila", "Em Atividades, “Pendências” virou Minha fila: as tarefas para você ou com você aparecem com o cartão completo, dá para aceitar e concluir ali mesmo."],
      ["Painel nas Análises", "O Painel das tarefas mudou para Análises → Tarefas, junto com os outros números."],
      ["Cadastrar entregador em janela", "Cadastrar entregador abre numa janela por cima da tela, pelo botão da tela inicial, pelo Consultar entregador ou pela busca. Saiu da barra de Entregadores."],
    ] },
    { versao: "009l", tema: "💜 Com as cores da Quero", itens: [
      ["Cores da Quero Delivery", "O Comunique ganhou as cores da marca: o roxo no topo e nos botões, o amarelo no item do menu em que você está e o rosa nos números de alerta."],
      ["Ordenar as tabelas", "Em Lançamentos, Tarifas dos bairros, Regras de equipe e Operadores, clique no nome da coluna para ordenar (de novo, inverte). A ordem fica mesmo quando a lista atualiza."],
      ["Busca grifada", "O que você digitou aparece grifado nos resultados da busca do topo, nos Avisos e nos Registros."],
      ["Interruptores", "As preferências de avisos e de sons viraram interruptores de liga/desliga."],
      ["Tabelas longas", "Lançamentos e Tarifas rolam por dentro, com o cabeçalho sempre à vista e uma sombrinha avisando que tem mais embaixo."],
    ] },
    { versao: "009k", tema: "🧹 Menos telas", itens: [
      ["Menos telas", "As Tarifas dos bairros agora ficam dentro da Calculadora de bairro (é só abrir “Tarifas dos bairros” no fim da tela)."],
      ["Pendentes nos Lançamentos", "Os seus adicionais e ajustes que faltam lançar ficam no topo da aba Lançamentos, com o número na aba. Os links antigos continuam levando para o lugar certo."],
    ] },
    { versao: "009j", tema: "⚡ Leve e veloz", itens: [
      ["Troca de tela suave", "Mudar de tela ou de aba agora desliza: o destaque do menu acompanha e nada pisca. (Quem pediu menos movimento no computador continua com a troca na hora.)"],
      ["Tema escuro", "Novo botão 🌙 no topo: deixa o Comunique escuro (ou claro) só para você. Tocar de novo volta a seguir o computador."],
      ["Copiar o ID", "Ao lado do ID na ficha e nos cartões tem um botãozinho de copiar: um clique e ele está na área de transferência."],
      ["Tarefas mais enxutas", "Os cartões de tarefa ficaram mais curtos: quem pediu, quando, para quem e o prazo numa linha só; o tempo junto do andamento."],
      ["Sem tela piscando", "Enquanto carrega, aparece o formato da lista em vez de “Carregando…”; janelas e avisos entram suavemente; os campos de texto crescem com o que você escreve."],
      ["Avisos sempre à vista", "O aviso de “copiado”, “salvo” etc. aparece por cima das janelas abertas, e a tira do sino fecha com Esc ou clicando fora."],
      ["Horário de Brasília", "Datas e horas aparecem sempre no horário de Brasília, mesmo num computador com outro fuso."],
    ] },
    { versao: "009g", tema: "🤝 Tarefas em equipe", itens: [
      ["Parceiro novo puxa entregadores", "Ativou um parceiro? Nasce sozinha a tarefa “Aprovar 5 entregadores” na cidade dele, aberta para a equipe. Se já existe uma na cidade, ela só sobe 5."],
      ["Entrar junto", "Nas tarefas de aprovar entregadores e parceiros, quem aceita não fecha para os outros: dá para “Entrar junto”, e as aprovações de todo mundo contam na mesma meta."],
      ["Tira de avisos", "A tira do sino ficou um pouco mais larga."],
      ["Mensagens prontas", "Agora dá para escolher também restrição temporária, encerramento de parceria, liberação antes do prazo e aviso de infração leve, escolhendo o entregador com restrição (tudo já vem preenchido) ou preenchendo à mão."],
      ["Ficha do entregador automática", "Todo adicional, ajuste de bairro ou cadastro na ativação com o ID e o nome do entregador já cria a ficha dele, se ainda não existe. No próximo lançamento, basta o ID: nome e cidade vêm sozinhos."],
      ["Ativações", "Em Parceiros, a aba Ativações (antes Por cidade) mostra quantos parceiros entraram nesta semana comparado à semana passada, cada cidade e o histórico: “Fulano ativou tal parceiro em tal cidade!”."]] },
    { versao: "009f", tema: "🎉 Parceiros completo e Notícias rápidas", itens: [
      ["Parceiros ativos", "A lista de todos os parceiros ativados, com busca, filtro por cidade e “Só os que eu ativei”."],
      ["Por cidade", "Cada cidade com os parceiros ativos, quantos entraram nos últimos 30 dias, o último ativado e quem mais ativou."],
      ["Notícias rápidas", "Na tela inicial: cada parceiro ativado vira uma notícia comemorativa com o nome de quem ativou, por 7 dias."]] },
    { versao: "009e", tema: "🏪 Parceiros", itens: [
      ["Ativar parceiro", "Menu Parceiros (e o botão na tela inicial): registre o estabelecimento que você ativou, com a cidade e uma observação. A lista de todos os parceiros tem busca e filtro por cidade."],
      ["Aprovar parceiros e entregadores", "As tarefas “Aprovar parceiros” e “Aprovar entregadores” (quantidade e cidade, para você ou para alguém) contam sozinhas cada aprovação que a pessoa faz na cidade. Dá para concluir à mão quando quiser."],
      ["Contou para…", "Depois de aprovar um entregador ou ativar um parceiro, o aviso mostra em quais tarefas suas a aprovação entrou."],
      ["Metas de aprovação", "Nas suas metas, os tipos de aprovação contam direto as aprovações do dia ou da semana."],
      ["Testar avisos e sons", "Em Equipe → Regras de equipe (para todos), o botão “🔔 Testar avisos e sons” toca cada nível e testa a notificação do sistema neste navegador."]] },
    { versao: "009d3", tema: "📊 Painel das tarefas", itens: [
      ["Painel", "Atividades → Painel: o que está aberto agora, o que foi feito no período, no prazo e em quanto tempo, por tipo, por cidade e por dia e hora. Cada um vê a própria linha; a liderança vê a de todos."],
      ["Suas metas (em teste)", "Crie metas só suas (ex.: 5 tarefas por dia). O progresso conta sozinho com as tarefas que você concluir."],
      ["Tarefas que se repetem", "No fim da aba Tarefas: uma tarefa que aparece sozinha todo dia, toda semana ou todo mês, já com o checklist."],
      ["Revisão de qualidade", "Os moderadores sorteiam tarefas concluídas para conferir; quem fez recebe o retorno."]] },
    { versao: "009d2", tema: "🗂️ Tarefas em cards", itens: [
      ["Tarefas por tipo", "Em Atividades → Tarefas, “Nova tarefa” tem tipos com os campos certos: Ativar entregadores, Ativar parceiro, Fazer contato, Contato com entregador, Pedido com problema, Pagamento ao entregador, Revisar registro, Criar comunicado, Procurar entregador ou texto livre."],
      ["Pedir ou registrar", "Peça para alguém, para a equipe, ou registre o que você já fez (entra direto nos seus números)."],
      ["Prazo e tempos", "Cada tipo tem um prazo padrão (o moderador ajusta). O card mostra quanto esperou até alguém pegar e quanto levou. “⏳ Aguardando terceiro” pausa o relógio."],
      ["Progresso", "Ativar entregadores conta sozinho os cadastros aprovados da cidade; nos outros com meta é só tocar em +1."],
      ["Checklist, comentários e 👏", "Checklist dentro da tarefa, comentários com @ para avisar alguém e “Agradecer” quem fez."],
      ["Pegar a próxima", "O botão escolhe a tarefa mais justa para você: primeiro as pedidas para você, depois a de prazo mais perto."]] },
    { versao: "009d", tema: "🆘 Acontecendo agora", itens: [
      ["Pedir ajuda", "Na tela inicial, “🆘 Pedir ajuda”: escolha Monitoramento, Suporte (Crisp) ou Suporte (Blip). Toda a equipe vê, com som, por 10 minutos ou até alguém tocar em “Eu ajudo”. Ninguém pegou? Peça de novo ou mande para os moderadores."],
      ["Aviso geral", "“📢 Aviso geral” deixa um recado na tela inicial de todos pelo tempo que você escolher (até 12 h). Quem criou ou um moderador encerra antes."],
      ["Passar o turno", "“🔁 Passar o turno”: o panorama do turno, um recado e, tarefa por tarefa, o que você passa para alguém, deixa aberto ou mantém para continuar quando voltar. Perto das 18h o app lembra."],
      ["Acontecendo agora", "Os pedidos de ajuda, os avisos gerais, as passagens de turno e as pendências (como “Aguardando prestação de contas”) ficam juntos no topo da tela inicial."],
      ["Acordos com parceiros", "Em Financeiro → Acordos: estabelecimento, cidade, o que foi acordado e quando vence. No dia do vencimento, um aviso vermelho aparece no topo da tela inicial de todos e só sai quando alguém marcar “Ajuste feito”."],
      ["Sons", "Avisos novos tocam um som conforme a urgência (4 níveis; o pedido de ajuda é o mais forte). Em Atividades → Avisos você ouve cada um, desliga o que quiser e liga a notificação do sistema."]] },
    { versao: "009c", tema: "✉️ Mensagens prontas e agravante", itens: [
      ["Gerar mensagem", "Depois de registrar um bloqueio ou uma leve (e no Histórico), o botão “Gerar mensagem” traz o texto pronto, já com o nome do entregador, o motivo, a regra explicada e o tempo. É só copiar."],
      ["Restrição temporária", "Nas mensagens ao entregador, o bloqueio temporário aparece como “restrição temporária”."],
      ["Agravante", "Algumas infrações têm agravante na política (ex.: não responder o suporte em 8 horas na retenção). Marque a caixinha no Novo bloqueio e a punição sobe."],
      ["Avisos rápidos", "Retenção de valores ainda não resolvida? Marque “Não” em “Já foi solucionado?” e ela fica na tela inicial de todos como “Aguardando prestação de contas”, até alguém marcar como resolvido."],
      ["Mensagens prontas", "Em Ferramentas: engajamento de entregadores (3 opções de texto cada) e o primeiro contato com o parceiro, que avisa do PDF e do áudio. Sem o nome do entregador, o “movimento alto” sai para a cidade toda."],
      ["O que diz cada regra", "A explicação de cada infração, tirada da política, fica em Ferramentas → Mensagens prontas."]] },
    { versao: "009b", tema: "🧮 Ferramentas do dia a dia e o Financeiro", itens: [
      ["Calculadora de bairro", "Em Ferramentas: o cliente informou um bairro e a entrega terminou em outro? Escolha os dois e veja quanto falta pagar ao entregador. Dá para registrar o ajuste ali mesmo."],
      ["Tarifas dos bairros", "Quanto cada bairro custa e quanto o entregador recebe (valor menos a taxa do log), por cidade."],
      ["Registrar adicional", "No Financeiro: valor da entrega, do pedido e o combinado; o app calcula o adicional. Com botões de adicional rápido (+R$ 2, +R$ 5…)."],
      ["Adicionais pendentes", "Registrou e ainda não lançou no sistema? Fica na sua lista de pendentes, com o número no menu, até alguém lançar."],
      ["Lançamentos e números", "Quanto se paga a mais por cidade, motivo, tamanho do pedido, origem (QD ou outros), mercado e os bairros mais trocados."],
      ["Regras pela política", "As punições seguem a Política de Boas Práticas e Conduta (continuam editáveis em Bloqueios → Regras)."],
      ["Aviso de adicional", "O responsável da cidade recebe um aviso a cada adicional ou ajuste (dá para silenciar em Avisos)."]] },
    { versao: "008d", tema: "👀 De olho em tudo (e só no que importa)", itens: [
      ["De olho nele", "Na ficha do entregador, “Ficar de olho”: você recebe tudo o que acontecer com ele (bloqueio, leve, comentário, cadastro), de qualquer cidade."],
      ["Seguir cidade", "Em Avisos, “O que você acompanha e recebe”: siga as cidades que quiser, mesmo sem ser a responsável."],
      ["Silenciar o que não precisa", "Escolha que tipos de aviso receber. O que é para você e o “de olho nele” sempre chegam."],
      ["Leves agrupadas", "As infrações leves viram um aviso só por cidade e dia, que vai somando: “3 infrações leves novas em LAGARTO hoje”."],
      ["Previsão vencida", "Passou a previsão que você deu para um cadastro, tratativa ou atividade? Você recebe um aviso."],
      ["Resumo do dia no sino", "Ao abrir o sino: o que rolou hoje na equipe e quantos registros você fez."],
      ["O suporte revisa a planilha", "O cartão “Revisar registros da planilha” agora abre a lista também para o suporte."],
      ["Operadores logísticos com aba própria", "Em Equipe: a aba Operadores logísticos tem o responsável por eles e a lista com os contatos. A Regras de equipe ficou só com as cidades."],
      ["Histórico de bloqueios mais completo", "Como o da ativação: quadrinhos com os totais (clique para filtrar), “Só os que eu registrei” e o histórico de cada registro ao clicar na linha."],
    ] },
    { versao: "008c", tema: "🧭 Tudo mais à mão", itens: [
      ["Tela inicial com atalhos", "Nova ativação, Novo bloqueio, Cadastrar entregador, Sugerir atividade e Registros viraram botões grandes, logo no início. Os seus números ficaram embaixo, mais discretos."],
      ["Começa pelo que mais se faz", "Ativação abre no Novo cadastro (Pendentes vem em seguida, com o número na aba) e Bloqueios abre no Novo bloqueio (depois, as Tratativas)."],
      ["Menos telas", "“Meus cadastros” e “Meus registros” viraram o Histórico de cada módulo (quem é do suporte vê ali só o que enviou). Os Painéis viraram parte das Análises."],
      ["Análises simples e complexas", "Nas simples: por que não aprovou, quem sai do bloqueio hoje, bloqueados por cidade, quando você registra (e o seu pico), o que você fez no período, gráficos por dia e mais. Nas complexas: qual infração mais se repete, escada da reincidência, cidades, tempo de resposta da ativação, punições desfeitas e por pessoa."],
      ["Mais leve", "O app só recarrega as listas quando algo mudou de verdade: menos espera e menos consumo."],
    ] },
    { versao: "008b", tema: "📣 Espião ou fofoqueiro? Virou rede social?", itens: [
      ["Sino com tira", "Clique no sino: os avisos recentes abrem ali mesmo. Clicar num aviso leva direto para a ficha ou o cadastro."],
      ["Avisos com busca e filtros", "Busque por nome, ID, cidade ou palavra; filtre por tipo, cidade ou só os não lidos."],
      ["Sua cidade, seus avisos", "O responsável da cidade recebe tudo o que acontece nela; os moderadores recebem tudo. Cidade sem responsável? Peça para ser a responsável na tela de Avisos."],
      ["O suporte também revisa", "Registros marcados “revisar” e os que você registrou podem ser corrigidos pelo suporte (com motivo); e “Os dados estão certos” nos cadastros."],
    ] },
    { versao: "008", tema: "🕵️ Espionagem profissional", itens: [
      ["Cadastrar entregador", "A ficha do entregador (ID, nome e cidade) pode ser criada sem ativar nem bloquear."],
      ["Menu mais enxuto", "Ativação, Bloqueios e Cadastrar entregador ficam dentro de Entregadores, numa segunda barra."],
      ["Busca do topo mais esperta", "A busca acha também comentários sobre entregadores e os seus avisos."],
      ["Casos suspeitos: em revisão", "A tela de casos saiu por enquanto e vai voltar revisada."],
    ] },
  ];
  const NOVIDADES = { tema: VERSOES[0].tema, versoes: VERSOES, itens: VERSOES.flatMap((v) => v.itens) };

  // grava na hora (o evento "close" chega um instante depois; recarregar logo em seguida perderia a marca)
  const marcarVisto = () => { try { localStorage.setItem("comunique-novidades", VERSAO); } catch (_) {} };
  function mostrarNovidades() {
    let visto = null;
    try { visto = localStorage.getItem("comunique-novidades"); } catch (_) {}
    if (visto === VERSAO) return setTimeout(iniciarTour, 600);  // 009n: janela já vista: o tour pode aparecer
    const d = janela("O que há de novo",
      ...VERSOES.map((v, i) => el("div", { class: "bloco-versao" + (i ? " antiga" : "") },
        el("h4", {}, el("span", { class: "tag", text: v.versao }), " ", v.tema),
        el("ol", { class: "novidades" }, v.itens.map(([t, x]) => el("li", {}, el("b", { text: t + ": " }), x))))),
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: () => { marcarVisto(); d.close(); } }, "Entendi")));
    d.addEventListener("close", marcarVisto);  // o ✕ e o Esc também contam como visto
    d.addEventListener("close", () => setTimeout(iniciarTour, 300));  // 009n: depois da janela, o tour mostra onde fica o que mudou
  }

  // ---------- 009n: tour das novidades (persistent-app-tours) ----------
  // Balõezinhos que apontam para o que mudou nesta versão, um de cada vez. popover="manual" (não some com um clique
  // fora), role="dialog" com título, e o foco vai para dentro do balão. Sem anchor positioning no navegador, a posição
  // é calculada pelo tamanho do alvo. Aparece uma vez por versão (localStorage "comunique-tour").
  const TOUR = { versao: "009m", passos: [
    ['nav.modulos a[data-mod="avisos"]', "Avisos agora fica aqui", "Para mim: os seus avisos. Toda a equipe: o que antes ficava em Registros. O sino continua levando para cá."],
    ['nav.modulos a[data-mod="atividades"]', "Minha fila", "Em Atividades, a Minha fila junta tudo o que está com você, com os cartões completos das suas tarefas."],
    ['nav.modulos a[data-mod="analises"]', "O Painel mudou de lugar", "O Painel das tarefas agora fica em Análises → Tarefas."],
  ] };
  let tourAtivo = false;
  function iniciarTour() {
    let visto = null;
    try { visto = localStorage.getItem("comunique-tour"); } catch (_) {}
    if (tourAtivo || visto === TOUR.versao || document.querySelector("dialog:modal") || !App.u.temPopover) return;
    const passos = TOUR.passos.filter(([sel]) => { const n = document.querySelector(sel); return n && n.offsetParent; });
    if (!passos.length) return;
    tourAtivo = true;
    const acabar = () => { try { localStorage.setItem("comunique-tour", TOUR.versao); } catch (_) {} tourAtivo = false; caixa.remove(); };
    const titulo = el("h3", { id: "tour-titulo" }), texto = el("p", { class: "meta" }), contagem = el("span", { class: "meta" });
    const proximo = el("button", { class: "btn primary small", type: "button" }), pular = el("button", { class: "btn link", type: "button", onclick: acabar }, "Pular");
    const caixa = el("div", { class: "tour-passo", id: "tour-passo", popover: "manual", role: "dialog", "aria-labelledby": "tour-titulo" },
      el("span", { class: "tour-seta", "aria-hidden": "true" }), titulo, texto, el("div", { class: "actions" }, contagem, el("span", { class: "spacer" }), pular, proximo));
    document.body.append(caixa);
    let i = 0;
    const mostrar = () => {
      const [sel, t, x] = passos[i], alvo = document.querySelector(sel);
      if (!alvo) return acabar();
      titulo.textContent = t; texto.textContent = x; contagem.textContent = `${i + 1} de ${passos.length}`;
      proximo.textContent = i < passos.length - 1 ? "Próximo" : "Entendi";
      proximo.onclick = () => { if (++i < passos.length) mostrar(); else acabar(); };
      if (!caixa.matches(":popover-open")) caixa.showPopover();
      const r = alvo.getBoundingClientRect(), w = Math.min(320, innerWidth - 24);
      const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
      Object.assign(caixa.style, { top: `${r.bottom + 12}px`, left: `${left}px`, width: `${w}px` });
      caixa.style.setProperty("--seta-x", `${r.left + r.width / 2 - left}px`);
      proximo.focus();  // o foco vai para dentro do balão (teclado e leitor de tela percebem o passo novo)
    };
    mostrar();
  }

  App.aoEntrar.push(() => { form.hidden = false; }, mostrarNovidades);
  App.novidades = { VERSAO, NOVIDADES, mostrar: () => { try { localStorage.removeItem("comunique-novidades"); } catch (_) {} mostrarNovidades(); } };
})();
