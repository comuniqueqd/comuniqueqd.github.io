// Avisos (008b, parte 1): a tira do sino (os avisos recentes sem sair da tela), a tela de Avisos com
// busca e filtros (listar_avisos) e as cidades sem responsável, com o pedido para ser a responsável.
// Os pedidos esperando resposta aparecem nas Pendências dos moderadores (js/atividades.js).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro, janela } = App.u;
  const S = App.S;
  const V = { lista: null, mais: false, cidades: [], carregandoMais: false, semResp: null, marcando: false };
  const FILTROS = [["", "Todos os avisos"], ["pessoal", "Para você (tarefas, decisões, casos)"], ["ativacao", "Ativação"],
    ["bloqueios", "Bloqueios"], ["comentarios", "Comentários e fichas"], ["cidades", "Pedidos de cidade"]];
  const ROTULO = { ativacao: "ATIVAÇÃO", bloqueios: "BLOQUEIOS", comentarios: "FICHA", cidades: "CIDADE" };
  const porque = (x) => x.motivo === "cidade" ? `você é responsável por ${x.cidade}` : x.motivo === "moderador" ? "você é moderador" : null;

  function marcarLidos() {
    if (!S.notif?.nao_lidas || V.marcando) return;
    V.marcando = true;
    rpc("marcar_notificacoes_lidas").then(() => { S.notif = { ...S.notif, nao_lidas: 0 }; App.render(); })
      .catch((e) => toast(msgErro(e))).finally(() => (V.marcando = false));
  }
  const etiqueta = (x) => el("span", { class: "tag", text: ROTULO[x.categoria] || "PARA VOCÊ" });
  function linhaAviso(x, aoAbrir) {
    return el("li", { class: "aviso" + (x.lida ? "" : " novo") },
      el("a", { href: x.link || "#atividades/avisos", onclick: aoAbrir },
        el("div", { class: "aviso-topo" }, etiqueta(x), el("span", { class: "meta", text: dt(x.criada_em) })),
        el("div", { class: "aviso-texto", text: x.texto }),
        porque(x) ? el("div", { class: "meta", text: "Você recebeu porque " + porque(x) + "." }) : null));
  }

  // ---------- tira do sino ----------
  const tira = el("div", { class: "tira-avisos", id: "tira-avisos", hidden: true, role: "dialog", "aria-label": "Avisos recentes" });
  document.body.append(tira);
  function fecharTira() { tira.hidden = true; $("#b-avisos").setAttribute("aria-expanded", "false"); }
  function abrirTira() {
    const n = S.notif, itens = n?.itens || [];
    const b = $("#b-avisos").getBoundingClientRect();
    tira.style.top = `${b.bottom + scrollY + 6}px`;
    tira.style.right = `${Math.max(8, document.documentElement.clientWidth - b.right)}px`;
    tira.replaceChildren(
      el("div", { class: "tira-topo" }, el("b", { text: n?.nao_lidas ? `${n.nao_lidas} aviso(s) novo(s)` : "Avisos recentes" }),
        el("button", { class: "btn link", type: "button", onclick: fecharTira, "aria-label": "Fechar" }, "✕")),
      itens.length ? el("ul", { class: "lista-avisos" }, itens.slice(0, 12).map((x) => linhaAviso(x, () => fecharTira())))
        : el("p", { class: "meta", style: "padding:12px", text: "Nenhum aviso ainda." }),
      el("div", { class: "tira-pe" }, el("a", { class: "btn small", href: "#atividades/avisos", onclick: fecharTira }, "Ver todos os avisos")));
    tira.hidden = false;
    $("#b-avisos").setAttribute("aria-expanded", "true");
    marcarLidos();
  }
  $("#b-avisos").addEventListener("click", (e) => { e.stopPropagation(); tira.hidden ? abrirTira() : fecharTira(); });
  document.addEventListener("click", (e) => { if (!tira.hidden && !tira.contains(e.target)) fecharTira(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tira.hidden) fecharTira(); });
  addEventListener("hashchange", fecharTira);

  // ---------- tela de Avisos ----------
  const filtros = () => ({ p_busca: $("#av-q").value.trim() || null, p_filtro: $("#av-filtro").value || null,
    p_cidade: $("#av-cidade").value || null, p_nao_lidos: $("#av-nao-lidos").checked });
  async function carregar() {
    const [r, sr] = await Promise.all([rpc("listar_avisos", filtros()), rpc("cidades_sem_responsavel")]);
    V.lista = r.itens; V.mais = r.mais; V.cidades = r.cidades; V.semResp = sr;
  }
  async function maisAvisos(btn) {
    btn.disabled = true;
    try {
      const r = await rpc("listar_avisos", { ...filtros(), p_antes: V.lista[V.lista.length - 1].id });
      V.lista = V.lista.concat(r.itens); V.mais = r.mais;
      render();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  let espera = null;
  const refiltrar = () => { clearTimeout(espera); espera = setTimeout(async () => { try { await carregar(); render(); } catch (e) { toast(msgErro(e)); } }, 300); };
  $("#av-filtro").replaceChildren(...FILTROS.map(([v, t]) => el("option", { value: v, text: t })));
  for (const id of ["#av-filtro", "#av-cidade", "#av-nao-lidos"]) $(id).addEventListener("change", refiltrar);
  $("#av-q").addEventListener("input", refiltrar);

  function render() {
    const sel = $("#av-cidade"), atual = sel.value;
    const ops = ["", ...V.cidades].join("|");
    if (sel.dataset.ops !== ops) {
      sel.dataset.ops = ops;
      sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...V.cidades.map((c) => el("option", { value: c, text: c })));
      sel.value = atual;
    }
    const box = $("#at-avisos");
    if (!V.lista) box.replaceChildren(carregandoEl());
    else if (!V.lista.length) box.replaceChildren(vazio("Nenhum aviso", filtros().p_busca || filtros().p_filtro || filtros().p_cidade || filtros().p_nao_lidos
      ? "Nada com esses filtros. Tente outra palavra ou limpe os filtros." : "Quando algo acontecer nas suas cidades, ou para você, o aviso aparece aqui."));
    else box.replaceChildren(...[el("ul", { class: "lista-avisos pagina" }, V.lista.map((x) => linhaAviso(x))),
      V.mais ? el("div", { class: "actions" }, el("button", { class: "btn", type: "button", onclick: (e) => maisAvisos(e.currentTarget) }, "Carregar mais avisos")) : null].filter(Boolean));
    renderCidades();
    marcarLidos();
  }

  // ---------- cidades sem responsável ----------
  function renderCidades() {
    const box = $("#av-cidades"), d = V.semResp;
    if (!d) return box.replaceChildren();
    const meus = (d.meus || []).slice(0, 5);
    box.replaceChildren(el("details", { class: "panel", open: box.dataset.aberto === "1" ? true : null, ontoggle: (e) => (box.dataset.aberto = e.target.open ? "1" : "") },
      el("summary", {}, el("b", { text: d.cidades.length ? `Cidades sem responsável (${d.cidades.length})` : "Todas as cidades têm responsável" }),
        d.cidades.length ? el("span", { class: "meta", text: " · quer acompanhar uma? Peça para ser a responsável" }) : null),
      el("p", { class: "meta", text: "Os avisos destas cidades vão só para os moderadores. Quer acompanhar uma delas? Peça para ser a responsável: um moderador aprova, e você passa a receber tudo o que acontece lá." }),
      d.cidades.length ? el("ul", { class: "cidades-livres" }, d.cidades.map((c) => el("li", {},
        el("span", {}, c.cidade, c.pedidos ? el("span", { class: "meta", text: ` · ${c.pedidos} pedido(s) esperando` }) : null),
        c.meu_pedido ? el("span", { class: "tag", text: "Você já pediu" })
          : el("button", { class: "btn link", type: "button", onclick: (e) => pedir(c.cidade, e.currentTarget) }, "Pedir para ser responsável")))) : null,
      meus.length ? el("div", {}, el("h4", { style: "margin:12px 0 6px", text: "Seus pedidos" }),
        el("ul", { class: "meus-pedidos" }, meus.map((p) => el("li", {},
          `${p.cidade} · ${p.status === "pendente" ? "esperando resposta" : p.status === "aprovado" ? "aprovado" : "recusado"}`,
          p.decidido_por_nome && p.status !== "pendente" ? ` por ${p.decidido_por_nome}` : "", p.nota ? ` · ${p.nota}` : "",
          p.status === "pendente" ? el("button", { class: "btn link", type: "button", onclick: (e) => cancelar(p.id, e.currentTarget) }, "Cancelar pedido") : null)))) : null));
  }
  async function pedir(cidade, btn) {
    btn.disabled = true;
    try { await rpc("pedir_cidade", { p_cidade: cidade }); toast("Pedido enviado. Um moderador vai aprovar ou recusar."); await carregar(); render(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function cancelar(id, btn) {
    btn.disabled = true;
    try { await rpc("cancelar_pedido_cidade", { p_id: id }); toast("Pedido cancelado."); await carregar(); render(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }

  // ---------- pedidos para o moderador (cartões nas Pendências) ----------
  function decidir(p, aprovar, btn) {
    if (aprovar) {
      btn.disabled = true;
      return rpc("decidir_pedido_cidade", { p_id: p.id, p_aprovar: true })
        .then(() => { toast(`${p.nome} agora é responsável por ${p.cidade}.`); App.carregar(); })
        .catch((e) => { btn.disabled = false; toast(msgErro(e)); });
    }
    const nota = el("textarea", { rows: "2", maxlength: "300", placeholder: "Ex.: a cidade vai ficar com outra pessoa." });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = janela("Recusar pedido de cidade",
      el("p", { style: "margin:0", text: `${p.nome} pediu para ser responsável por ${p.cidade}.` }),
      el("label", {}, "Motivo (a pessoa recebe)", nota), erro,
      el("div", { class: "actions" },
        el("button", { class: "btn reject", type: "button", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; erro.hidden = true;
          try { await rpc("decidir_pedido_cidade", { p_id: p.id, p_aprovar: false, p_nota: nota.value.trim() || null }); d.close(); toast("Pedido recusado."); App.carregar(); }
          catch (err) { b.disabled = false; erro.textContent = msgErro(err); erro.hidden = false; }
        } }, "Recusar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    nota.focus();
  }
  function cartoesPedidos(item) {
    return (S.resumo?.pedidos_cidade || []).map((p) => item({ modulo: "CIDADE", titulo: `${p.nome} pediu para ser responsável por ${p.cidade}`,
      detalhe: `Pedido feito há ${App.u.duracao(p.criado_em).txt}. Aprovado, a pessoa passa a receber todos os avisos da cidade` +
        (["moderador", "monitorador"].includes(p.papel_bloqueios) ? " e as tratativas." : ". As tratativas continuam com os moderadores (para recebê-las, a pessoa precisa ser monitorador ou moderador dos bloqueios)."),
      acoes: [el("button", { class: "btn approve small", type: "button", onclick: (e) => decidir(p, true, e.currentTarget) }, "Aprovar"),
        el("button", { class: "btn link", type: "button", onclick: (e) => decidir(p, false, e.currentTarget) }, "Recusar…")] }));
  }

  App.avisos = { carregar, render, cartoesPedidos, abrirTira, fecharTira };
})();
