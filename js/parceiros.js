// Módulo "Parceiros" (009e, completo na 009f): o segundo processo de ativação. Registro direto (quem ativou
// registra), por qualquer papel: estabelecimento, cidade e observação (registrar_parceiro). Cada parceiro ativado
// conta sozinho nas tarefas "Aprovar parceiros" de quem ativou (na cidade) e nas metas pessoais, e aparece nas
// Notícias rápidas da tela inicial.
// Abas: Ativar parceiro (formulário + suas tarefas + seus últimos), Parceiros ativos (lista com busca e cidade;
// parceiro ativado continua ativo, sem desativação) e Por cidade (resumo de cada cidade).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro, janela } = App.u;
  const S = App.S;
  const P = { meus: null, lista: null, tarefas: null, cidades: null, conf: {}, erro: null };

  // aviso depois de aprovar: em quais tarefas a aprovação entrou (também usado na ativação de entregadores)
  App.contouPara = function (tarefas) {
    if (!tarefas?.length) return "";
    return " Contou para: " + tarefas.map((t) => `${t.titulo} (${t.progresso} de ${t.meta}${t.progresso >= t.meta ? " 🎉" : ""})`).join("; ") + ".";
  };

  const form = $("#pa-form"), erro = $("#pa-erro");
  form.addEventListener("input", () => (erro.hidden = true));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const b = $("#pa-enviar"); b.disabled = true;
    try {
      const r = await rpc("registrar_parceiro", { p_estabelecimento: $("#pa-estab").value.trim(), p_cidade: $("#pa-cidade").value.trim(), p_observacao: $("#pa-obs").value.trim() || null });
      form.reset(); $("#pa-estab").focus();
      const te = r.tarefa_entregadores;
      toast(`🎉 Parceiro ativado: ${r.parceiro.estabelecimento}!${App.contouPara(r.tarefas)}` +
        (te ? (te.nova ? ` Nasceu a tarefa “${te.titulo}” para a equipe.` : ` A tarefa de entregadores da cidade subiu para ${te.meta}.`) : ""));
      await App.carregar();
    } catch (e) { erro.textContent = msgErro(e); erro.hidden = false; } finally { b.disabled = false; }
  });
  let busca = null;
  $("#pa-busca").addEventListener("input", () => { clearTimeout(busca); busca = setTimeout(() => App.carregar(), 350); });
  for (const id of ["#pa-filtro-cidade", "#pa-meus"]) $(id).addEventListener("change", () => App.carregar());

  const linha = (p) => el("li", { class: "parceiro" },
    el("div", {}, el("b", { text: p.estabelecimento }), el("span", { class: "meta", text: " · " + p.cidade }),
      p.observacao ? el("div", { class: "meta", text: p.observacao }) : null,
      el("div", { class: "meta", text: `ativado por ${p.meu ? "você" : p.criado_por_nome || "—"} em ${dt(p.criado_em)}` })),
    p.pode_excluir ? (P.conf[p.id]
      ? el("span", {}, el("button", { class: "btn danger small", type: "button", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await rpc("excluir_parceiro", { p_id: p.id }); delete P.conf[p.id]; toast("Registro excluído."); await App.carregar(); } catch (err) { b.disabled = false; toast(msgErro(err)); }
        } }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete P.conf[p.id]; App.render(); } }, "Cancelar"))
      : el("button", { class: "btn quiet small", type: "button", title: "Só para registro feito por engano", onclick: () => { P.conf[p.id] = true; App.render(); } }, "Excluir")) : null);

  function renderNovo() {
    $("#pa-cidades").replaceChildren(...App.u.CIDADES.map((c) => el("option", { value: c })));
    const t = $("#pa-tarefas");
    const minhas = (P.tarefas || []);
    t.replaceChildren(el("h3", { text: "Suas tarefas de aprovar parceiros" }),
      minhas.length ? el("ul", { class: "pa-tarefas" }, minhas.map((a) => {
        const pct = a.meta ? Math.min(100, Math.round((a.progresso / a.meta) * 100)) : 0;
        return el("li", {}, el("b", { text: a.titulo }), el("div", { class: "progresso-tarefa" }, el("div", { class: "barra" }, el("span", { style: `width:${pct}%` })),
          el("span", { class: "meta", text: `${a.progresso} de ${a.meta}${a.progresso >= a.meta ? " · meta atingida 🎉" : ""}` })));
      })) : el("p", { class: "meta" }, "Nenhuma em andamento com você. ", el("a", { href: "#atividades/sugeridas" }, "Criar uma tarefa “Aprovar parceiros”"), " para você ou para alguém: cada parceiro ativado na cidade conta sozinho."),
      el("h3", { text: "Os seus últimos" }),
      !P.meus ? carregandoEl() : P.meus.length ? el("ul", { class: "parceiros-lista" }, P.meus.slice(0, 8).map(linha)) : el("p", { class: "meta", text: "Você ainda não ativou nenhum parceiro." }));
  }
  function renderLista() {
    const box = $("#pa-lista");
    if (P.erro) return box.replaceChildren(el("p", { class: "warn-msg", text: P.erro }));
    const d = P.lista;
    if (!d) return box.replaceChildren(carregandoEl());
    const sel = $("#pa-filtro-cidade"), atual = sel.value;
    sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...d.por_cidade.map((c) => el("option", { value: c.cidade, text: `${c.cidade} (${c.n})` })));
    if (atual && !d.por_cidade.some((c) => c.cidade === atual)) sel.append(el("option", { value: atual, text: atual }));
    sel.value = atual;
    box.replaceChildren(el("p", { class: "meta", text: `${d.total} parceiro(s) ativo(s) · você ativou ${d.meus_30d} nos últimos 30 dias` }),
      d.itens.length ? el("ul", { class: "parceiros-lista" }, d.itens.map(linha)) : vazio("Nenhum parceiro aqui", "Use “Ativar parceiro” para registrar um."));
  }
  function renderCidades() {
    const box = $("#pa-por-cidade");
    if (P.erro) return box.replaceChildren(el("p", { class: "warn-msg", text: P.erro }));
    if (!P.cidades) return box.replaceChildren(carregandoEl());
    if (!P.cidades.length) return box.replaceChildren(vazio("Nenhum parceiro ainda", "Quando alguém ativar um parceiro, a cidade aparece aqui."));
    const ver = (cidade) => { $("#pa-filtro-cidade").replaceChildren(el("option", { value: cidade, text: cidade })); $("#pa-filtro-cidade").value = cidade; location.hash = "#parceiros/lista"; };
    box.replaceChildren(el("div", { class: "pa-cidades" }, P.cidades.map((c) => el("article", { class: "panel pa-cidade" },
      el("div", { class: "inicio-topo" }, el("h3", { style: "margin:0", text: c.cidade }),
        el("button", { class: "btn small", type: "button", onclick: () => ver(c.cidade) }, "Ver parceiros")),
      el("div", { class: "tiles" },
        el("div", { class: "tile good" }, el("div", { class: "v", text: c.ativos }), el("div", { class: "k", text: "ativos" })),
        el("div", { class: "tile" }, el("div", { class: "v", text: c.ultimos_30d }), el("div", { class: "k", text: "ativados nos últimos 30 dias" }))),
      c.ultimo ? el("p", { class: "meta", text: `Último: ${c.ultimo.estabelecimento}, por ${c.ultimo.quem || "—"} em ${dt(c.ultimo.quando)}` }) : null,
      c.quem_mais ? el("p", { class: "meta", text: `Quem mais ativou aqui: ${c.quem_mais.nome || "—"} (${c.quem_mais.n})` }) : null))));
  }

  App.modulo({
    id: "parceiros", nome: "Parceiros",
    abas: [
      { id: "novo", nome: "Ativar parceiro", secao: "v-pa-novo" },
      { id: "lista", nome: "Parceiros ativos", secao: "v-pa-lista" },
      { id: "cidades", nome: "Por cidade", secao: "v-pa-cidades" },
    ],
    padrao: "novo",
    async carregar(aba) {
      try {
        if (aba === "lista") P.lista = await rpc("listar_parceiros", { p_busca: $("#pa-busca").value.trim() || null, p_cidade: $("#pa-filtro-cidade").value || null,
          p_meus: $("#pa-meus").checked });
        else if (aba === "cidades") P.cidades = await rpc("parceiros_por_cidade");
        else {
          const [l, t] = await Promise.all([rpc("listar_parceiros", { p_meus: true, p_limite: 8 }), rpc("listar_atividades")]);
          P.meus = l.itens;
          P.tarefas = t.filter((a) => a.tipo === "ativar_parceiro" && a.status === "aceita" && a.sou_participante && a.modo === "solicitacao");
        }
        P.erro = null;
      } catch (e) { P.erro = msgErro(e); throw e; }
    },
    render: (aba) => (aba === "lista" ? renderLista() : aba === "cidades" ? renderCidades() : renderNovo()),
  });

  // ---------- Notícias rápidas (tela inicial) ----------
  // texto comemorativo escolhido pelo id (o mesmo parceiro sempre com a mesma frase)
  const FRASES = [
    (q, e, c) => `🎉 ${q} ativou ${e} em ${c}! Mais um parceiro com a gente!`,
    (q, e, c) => `🥳 Parceiro novo na área: ${e} (${c}), ativado por ${q}. Mandou bem!`,
    (q, e, c) => `🚀 ${q} trouxe ${e} para o time em ${c}. Bora crescer!`,
    (q, e, c) => `👏 ${e} agora é parceiro em ${c}. Valeu, ${q}!`,
    (q, e, c) => `🌟 ${c} ganhou mais um parceiro: ${e}, graças a ${q}!`,
  ];
  const primeiro = (n) => String(n || "Alguém").split(" ")[0];
  App.noticias = {
    async carregar() { S.noticias = await rpc("noticias_rapidas", { p_limite: 6 }); },
    render() {
      const box = $("#inicio-noticias");
      if (!box) return;
      const l = S.noticias || [];
      box.hidden = !l.length;
      box.replaceChildren(...(l.length ? [el("h2", { class: "rapidos-titulo", text: "📰 Notícias rápidas" }),
        el("ul", { class: "noticias" }, l.map((n) => el("li", { class: "noticia" },
          el("span", { class: "noticia-texto", text: FRASES[n.id % FRASES.length](n.eu ? "Você" : primeiro(n.quem), n.estabelecimento, n.cidade) }),
          el("span", { class: "meta", text: App.u.duracao(n.quando).txt === "0 min" ? "agora" : "há " + App.u.duracao(n.quando).txt }))))] : []));
    },
  };
})();
