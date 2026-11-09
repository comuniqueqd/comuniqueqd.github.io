// Módulo "Parceiros" (009e): o segundo processo de ativação. Registro direto (quem ativou registra),
// por qualquer papel: estabelecimento, cidade e observação (registrar_parceiro). Cada parceiro registrado
// conta sozinho nas tarefas "Aprovar parceiros" de quem registrou (na cidade) e nas metas pessoais.
// Abas: Ativar parceiro (formulário + suas tarefas de aprovação + seus últimos) e Parceiros (lista com busca).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  const P = { meus: null, lista: null, tarefas: null, conf: {}, erro: null };

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
      toast(`Parceiro ativado: ${r.parceiro.estabelecimento}.${App.contouPara(r.tarefas)}`);
      await App.carregar();
    } catch (e) { erro.textContent = msgErro(e); erro.hidden = false; } finally { b.disabled = false; }
  });
  let busca = null;
  $("#pa-busca").addEventListener("input", () => { clearTimeout(busca); busca = setTimeout(() => App.carregar(), 350); });
  $("#pa-filtro-cidade").addEventListener("change", () => App.carregar());
  $("#pa-meus").addEventListener("change", () => App.carregar());

  const linha = (p) => el("li", { class: "parceiro" },
    el("div", {}, el("b", { text: p.estabelecimento }), el("span", { class: "meta", text: " · " + p.cidade }),
      p.observacao ? el("div", { class: "meta", text: p.observacao }) : null,
      el("div", { class: "meta", text: `ativado por ${p.meu ? "você" : p.criado_por_nome || "—"} em ${dt(p.criado_em)}` })),
    p.pode_excluir ? (P.conf[p.id]
      ? el("span", {}, el("button", { class: "btn danger small", type: "button", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await rpc("excluir_parceiro", { p_id: p.id }); delete P.conf[p.id]; toast("Parceiro excluído."); await App.carregar(); } catch (err) { b.disabled = false; toast(msgErro(err)); }
        } }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete P.conf[p.id]; App.render(); } }, "Cancelar"))
      : el("button", { class: "btn quiet small", type: "button", onclick: () => { P.conf[p.id] = true; App.render(); } }, "Excluir")) : null);

  function renderNovo() {
    $("#pa-cidades").replaceChildren(...App.u.CIDADES.map((c) => el("option", { value: c })));
    const t = $("#pa-tarefas");
    const minhas = (P.tarefas || []);
    t.replaceChildren(el("h3", { text: "Suas tarefas de aprovar parceiros" }),
      minhas.length ? el("ul", { class: "pa-tarefas" }, minhas.map((a) => {
        const pct = a.meta ? Math.min(100, Math.round((a.progresso / a.meta) * 100)) : 0;
        return el("li", {}, el("b", { text: a.titulo }), el("div", { class: "progresso-tarefa" }, el("div", { class: "barra" }, el("span", { style: `width:${pct}%` })),
          el("span", { class: "meta", text: `${a.progresso} de ${a.meta}${a.progresso >= a.meta ? " · meta atingida 🎉" : ""}` })));
      })) : el("p", { class: "meta" }, "Nenhuma em andamento com você. ", el("a", { href: "#atividades/sugeridas" }, "Criar uma tarefa “Aprovar parceiros”"), " para você ou para alguém: cada parceiro registrado na cidade conta sozinho."),
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
    sel.value = atual;
    box.replaceChildren(el("p", { class: "meta", text: `${d.total} parceiro(s) no total · você ativou ${d.meus_30d} nos últimos 30 dias` }),
      d.itens.length ? el("ul", { class: "parceiros-lista" }, d.itens.map(linha)) : vazio("Nenhum parceiro aqui", "Use “Ativar parceiro” para registrar o primeiro."));
  }

  App.modulo({
    id: "parceiros", nome: "Parceiros",
    abas: [
      { id: "novo", nome: "Ativar parceiro", secao: "v-pa-novo" },
      { id: "lista", nome: "Parceiros", secao: "v-pa-lista" },
    ],
    padrao: "novo",
    async carregar(aba) {
      try {
        if (aba === "lista") P.lista = await rpc("listar_parceiros", { p_busca: $("#pa-busca").value.trim() || null, p_cidade: $("#pa-filtro-cidade").value || null, p_meus: $("#pa-meus").checked });
        else {
          const [l, t] = await Promise.all([rpc("listar_parceiros", { p_meus: true, p_limite: 8 }), rpc("listar_atividades")]);
          P.meus = l.itens;
          P.tarefas = t.filter((a) => a.tipo === "ativar_parceiro" && a.status === "aceita" && a.aceita_por === S.me.id && a.modo === "solicitacao");
        }
        P.erro = null;
      } catch (e) { P.erro = msgErro(e); throw e; }
    },
    render: (aba) => (aba === "lista" ? renderLista() : renderNovo()),
  });
})();
