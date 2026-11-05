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
    // lupa do detetive (008): casos, comentários sobre entregadores e os seus avisos
    const corta = (t, n = 90) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    if (r.casos?.length) linhas.push(el("h4", { text: "Casos 🕵️" }), ...r.casos.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => (location.hash = "#casos")) },
        el("span", { text: corta(x.detalhe) }),
        el("span", { class: "meta", text: `${x.nivel === "forte" ? "🔴 forte" : "🟡 atenção"} · ${x.status === "aberto" ? "aberto" : x.status} · ${dt(x.criado_em)}` }))));
    if (r.comentarios?.length) linhas.push(el("h4", { text: "Comentários" }), ...r.comentarios.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(x.id_app)) },
        el("span", { text: corta(x.texto) }),
        el("span", { class: "meta", text: `${x.nome || x.id_app} · ${x.por_nome || "—"} · ${dt(x.em)}` }))));
    if (r.avisos?.length) linhas.push(el("h4", { text: "Seus avisos" }), ...r.avisos.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => (location.hash = x.link || "#atividades/avisos")) },
        el("span", { text: corta(x.texto) }), el("span", { class: "meta", text: dt(x.criada_em) }))));
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
  const VERSAO = "008";
  const NOVIDADES = {
    tema: "🕵️ Espionagem profissional",
    itens: [
      ["Casos suspeitos", "CPF que já existe tentando entrar com outro nome ou ID, entregador encerrado tentando voltar, troca de dados num cadastro aprovado: tudo vira um caso, e a equipe toda fica sabendo. Antes, a tentativa só era recusada e se perdia."],
      ["Investigação com método", "Na tela Casos 🕵️: “Eu verifico” ou “Pedir verificação”, checklist, comentários e o veredito (confirmado ou descartado) do monitorador ou moderador."],
      ["Cadastrar entregador", "Em Bloqueios → Consultar entregador: “+ Cadastrar entregador” cria a ficha com ID, nome e cidade, sem precisar ativar nem bloquear."],
      ["Lupa do detetive e placar", "A busca do topo agora acha também casos, comentários e os seus avisos. E nas Análises tem o Placar do detetive."],
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
