// Módulo "Entregadores" (008b, ajuste urgente): cadastrar o entregador sem ativação e sem bloqueio.
// Cria a ficha (ID, nome, cidade e um comentário opcional) com cadastrar_entregador() e mostra
// as fichas criadas por esta tela (entregadores_recentes). Acesso: quem tem o módulo de bloqueios.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  const E = { dados: null, feito: null };
  const render = () => App.render();

  const form = $("#en-form"), erro = $("#en-erro");
  const mostrarErro = (txt, ...extra) => { erro.replaceChildren(txt, ...extra); erro.hidden = false; };
  $("#en-id").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "")));
  form.addEventListener("input", () => { erro.hidden = true; if (E.feito) { E.feito = null; renderFeito(); } });
  form.addEventListener("reset", () => { erro.hidden = true; E.feito = null; setTimeout(() => { renderFeito(); $("#en-id").focus(); }); });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const id = $("#en-id").value.trim(), nome = $("#en-nome").value.trim();
    if (id.length < 4) return mostrarErro("Digite o ID do entregador (pelo menos 4 letras ou números).");
    if (!nome) return mostrarErro("Preencha o nome do entregador.");
    const btn = $("#en-enviar");
    btn.disabled = true;
    try {
      const r = await rpc("cadastrar_entregador", { p_id_app: id, p_nome: nome, p_cidade: $("#en-cidade").value || null, p_comentario: $("#en-comentario").value.trim() || null });
      form.reset();
      E.feito = r;
      toast(r.bloqueios_completados ? `Entregador cadastrado. Nome e cidade completados em ${r.bloqueios_completados} bloqueio(s).` : "Entregador cadastrado.");
      await carregar(); render();
    } catch (err) {
      const msg = msgErro(err);
      if (/já tem cadastro/.test(msg)) mostrarErro(msg + " ", el("button", { class: "btn link", type: "button", onclick: () => App.abrirFicha(id) }, "Abrir a ficha"));
      else mostrarErro(msg);
    } finally { btn.disabled = false; }
  });

  async function carregar() { E.dados = await rpc("entregadores_recentes", { p_limite: 30 }); }

  function renderFeito() {
    const box = $("#en-feito"), r = E.feito;
    if (!r) return box.replaceChildren();
    box.replaceChildren(el("div", { class: "previa" },
      el("div", { class: "meta", text: "Entregador cadastrado" }),
      el("div", { class: "grande", text: r.nome }),
      el("div", {}, el("span", { class: "mono", text: r.id_app }), " · ", r.cidade || "sem cidade"),
      r.bloqueios_completados ? el("div", { text: `Nome e cidade completados em ${r.bloqueios_completados} bloqueio(s) que esperavam os dados.` }) : null,
      r.bloqueios_pendentes ? el("div", { text: `Este ID tem ${r.bloqueios_pendentes} bloqueio(s) esperando o monitoramento completar os dados.` }) : null,
      el("div", { class: "actions" }, el("button", { class: "btn small", type: "button", onclick: () => App.abrirFicha(r.id_app) }, "Abrir a ficha"))));
  }

  function renderCadastrar() {
    // cidades: mantém a escolha atual ao redesenhar
    const sel = $("#en-cidade"), atual = sel.value;
    const nomes = E.dados?.cidades || [];
    if (sel.options.length !== nomes.length + 1) {
      sel.replaceChildren(el("option", { value: "", text: "Sem cidade (escolha uma, se souber)" }), ...nomes.map((n) => el("option", { value: n, text: n })));
      sel.value = atual;
    }
    renderFeito();
    const box = $("#en-recentes");
    if (!E.dados) return box.replaceChildren(carregandoEl());
    const lista = E.dados.recentes || [];
    if (!lista.length) return box.replaceChildren(vazio("Ninguém cadastrado por aqui ainda", "Os entregadores cadastrados nesta tela aparecem aqui."));
    box.replaceChildren(el("ul", { class: "recentes-ent" }, lista.map((x) => el("li", {},
      el("button", { class: "link-ficha", type: "button", title: "Abrir a ficha", onclick: () => App.abrirFicha(x.id_app) }, x.nome),
      " ", el("span", { class: "mono meta", text: x.id_app }),
      el("div", { class: "meta", text: `${x.cidade || "Sem cidade"} · por ${x.meu ? "você" : x.criado_por_nome || "—"} em ${dt(x.criado_em)}` })))));
  }

  // abre a tela já com o ID (ex.: a consulta não achou ninguém)
  App.cadastrarEntregador = (id = "") => {
    if (location.hash !== "#entregadores/cadastrar") location.hash = "#entregadores/cadastrar";
    form.reset();
    setTimeout(() => { $("#en-id").value = id; (id ? $("#en-nome") : $("#en-id")).focus(); }, 30);
    scrollTo({ top: 0 });
  };

  App.modulo({
    id: "entregadores", nome: "Entregadores",
    acesso: () => !!S.me?.papel_bloqueios,
    abas: [{ id: "cadastrar", nome: "Cadastrar entregador", secao: "v-en-cadastrar" }],
    carregar,
    render: renderCadastrar,
  });
})();
