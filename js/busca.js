// Busca rápida no topo (ID, CPF ou nome → ficha do entregador ou cadastro da ativação) e a
// janela "O que há de novo", que aparece uma vez por pessoa a cada versão publicada.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, fmtCPF, rpc, msgErro, janela } = App.u;
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
    if (!linhas.length) linhas.push(el("p", { class: "meta", style: "margin:6px 8px", text: "Nada encontrado." }));
    if (bloq) linhas.push(el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(q)) }, el("span", { class: "meta", text: `Consultar “${q}” na tela Consultar entregador →` })));
    res.replaceChildren(...linhas);
    res.hidden = false;
  }
  campo.addEventListener("input", () => { clearTimeout(tempo); tempo = setTimeout(buscar, 300); });
  campo.addEventListener("focus", () => { if (res.childElementCount && campo.value.trim().length >= 3) res.hidden = false; });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(tempo); ultima = ""; buscar(); });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") { fechar(); campo.blur(); } });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) fechar(); });

  // ---------- o que há de novo ----------
  const VERSAO = "007";
  const NOVIDADES = {
    tema: "Pão quentinho · tudo conectado",
    itens: [
      ["Aviso na hora", "Quem enviou um cadastro recebe um aviso no sino quando ele é aprovado, reprovado, encerrado ou desfeito."],
      ["Nome no cadastro e ficha pronta", "O Novo cadastro tem o nome do entregador. Aprovado com ID e nome, a ficha já nasce. Faltou algo? Ganha a marca “revisar”, e qualquer pessoa da equipe pode completar."],
      ["Busca rápida e histórico do ID", "Use a busca no topo (ID, CPF ou nome). Ao digitar um ID no Novo cadastro, aparece o que o Comunique já sabe dele."],
    ],
  };
  function mostrarNovidades() {
    let visto = null;
    try { visto = localStorage.getItem("comunique-novidades"); } catch (_) {}
    if (visto === VERSAO) return;
    const d = janela("O que há de novo",
      el("p", { class: "meta", style: "margin:0", text: NOVIDADES.tema }),
      el("ol", { class: "novidades" }, NOVIDADES.itens.map(([t, x]) => el("li", {}, el("b", { text: t + ": " }), x))),
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: () => d.close() }, "Entendi")));
    d.addEventListener("close", () => { try { localStorage.setItem("comunique-novidades", VERSAO); } catch (_) {} });
  }

  App.aoEntrar.push(() => { form.hidden = false; }, mostrarNovidades);
  App.novidades = { VERSAO, mostrar: () => { try { localStorage.removeItem("comunique-novidades"); } catch (_) {} mostrarNovidades(); } };
})();
