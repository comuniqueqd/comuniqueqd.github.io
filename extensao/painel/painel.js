// Painel lateral: login, busca de entregador, atalhos, pedidos de ajuda abertos e os avisos.
// Tudo montado com textContent (nunca innerHTML).
const Api = globalThis.ComuniqueApi;
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v; else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...filhos.flat().filter((f) => f != null && f !== false));
  return n;
}
const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const abrir = (hash) => chrome.runtime.sendMessage({ tipo: "abrir", hash });
const erro = (sel, msg) => { const p = $(sel); p.textContent = msg || ""; p.hidden = !msg; };

async function mostrar() {
  const logado = !!(await Api.sessao());
  $("#v-entrar").hidden = logado; $("#v-app").hidden = !logado; $("#b-sair").hidden = !logado;
  if (logado) { telaAtual(); await atualizar(); }
}

$("#b-entrar").addEventListener("click", async (e) => {
  e.currentTarget.disabled = true; erro("#e-entrar");
  try { await Api.entrar(); await chrome.runtime.sendMessage({ tipo: "conferir" }); await mostrar(); }
  catch (x) { erro("#e-entrar", /canceled|cancelad|closed/i.test(x.message) ? "Login cancelado." : x.message); }
  finally { e.currentTarget.disabled = false; }
});
$("#b-sair").addEventListener("click", async () => { await Api.sair(); await chrome.runtime.sendMessage({ tipo: "conferir" }); await mostrar(); });
document.querySelectorAll(".atalhos button").forEach((b) => b.addEventListener("click", () => abrir(b.dataset.hash)));

// busca: ID ou nome (mesma busca do topo do Comunique)
let espera = null, ultima = "";
$("#busca").addEventListener("submit", (e) => { e.preventDefault(); buscar(true); });
$("#q").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(buscar, 400); });
async function buscar(forcar) {
  const q = $("#q").value.trim(), box = $("#resultados");
  if (q === ultima && !forcar) return;
  ultima = q;
  if (q.length < 3) return box.replaceChildren();
  let r;
  try { r = await Api.rpc("busca_rapida", { p_q: q }); } catch (x) { return box.replaceChildren(el("p", { class: "erro", text: x.message })); }
  if (q !== $("#q").value.trim()) return;
  const linhas = [];
  if (r.entregadores?.length) linhas.push(el("p", { class: "grupo", text: "Entregadores" }), ...r.entregadores.map((x) =>
    el("button", { class: "item", type: "button", onclick: () => abrir("#ficha/" + encodeURIComponent(x.id_app)) },
      el("span", { text: x.nome || "(sem nome)" }), el("span", { class: "sub", text: `${x.id_app} · ${x.cidade || "sem cidade"} · ${x.bloqueios} bloqueio(s)` }))));
  if (r.cadastros?.length) linhas.push(el("p", { class: "grupo", text: "Cadastros da ativação" }), ...r.cadastros.map((x) =>
    el("button", { class: "item", type: "button", onclick: () => abrir("#cadastro/" + x.id) },
      el("span", { text: x.nome || (x.id_app ? "ID " + x.id_app : "Sem ID") }), el("span", { class: "sub", text: [x.id_app, x.cidade, x.situacao].filter(Boolean).join(" · ") }))));
  if (!linhas.length) linhas.push(el("p", { class: "meta", text: "Nada encontrado." }),
    /^[A-Za-z0-9]{4,40}$/.test(q) ? el("button", { class: "btn", type: "button", onclick: () => abrir("#preencher/entregador?id=" + encodeURIComponent(q)) }, "Cadastrar este ID") : null);
  box.replaceChildren(...linhas);
}

// 1.1: o que a aba aberta tem (só nas telas do Quero Log e do Crisp, onde o leitor roda)
async function telaAtual() {
  const box = $("#tela");
  let r = null;
  try {
    const [aba] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (aba?.id != null) r = await chrome.tabs.sendMessage(aba.id, { tipo: "tela" });
  } catch (_) { r = null; }   // aba sem o leitor (outro site): não mostra nada
  if (!r) return box.replaceChildren();
  if (!r.entregador) return box.replaceChildren(el("div", { class: "tela vazia", text: "Não encontrei ID de entregador nesta tela." }));
  const e = r.entregador;
  box.replaceChildren(el("div", { class: "tela" }, el("span", { class: "grupo", text: "Nesta tela" }), el("b", { text: e.nome || "Nome não encontrado" }),
    el("span", { class: "sub meta", text: [e.id, e.cidade].filter(Boolean).join(" · ") }),
    el("span", { class: "meta", text: "Use os botões do cartão no canto da página para cadastrar, bloquear ou registrar adicional." }),
    el("button", { class: "btn", type: "button", onclick: () => abrir("#ficha/" + encodeURIComponent(e.id)) }, "🔎 Ver ficha no Comunique")));
}
chrome.tabs.onActivated.addListener(() => telaAtual());
chrome.tabs.onUpdated.addListener((_id, mud) => { if (mud.status === "complete") setTimeout(telaAtual, 800); });

// avisos e pedidos de ajuda (o mesmo resumo que o Comunique usa)
async function atualizar() {
  let r;
  try { r = await Api.rpc("resumo_e_avisos"); erro("#e-app"); }
  catch (x) { if (x.semSessao) return mostrar(); return erro("#e-app", x.message); }
  const ajudas = (r.resumo?.avisos_rapidos || []).filter((a) => a.tipo === "ajuda" && !a.expirado);
  $("#agora").replaceChildren(...ajudas.map((a) => el("div", { class: "agora" },
    el("b", { text: "🆘 " + (a.meu ? "Seu pedido de ajuda" : `${a.criado_por_nome || "Alguém"} pediu ajuda`) }),
    el("span", { text: a.titulo || a.texto || "" }),
    el("span", { class: "sub meta", text: a.aceito_por_nome ? `Com ${a.aceito_por_nome}` : "Ninguém pegou ainda" }),
    el("button", { class: "btn", type: "button", onclick: () => abrir("#inicio") }, "Abrir no Comunique"))));
  const n = r.notif?.nao_lidas || 0, c = $("#c-avisos");
  c.textContent = n; c.hidden = !n; $("#b-lidos").hidden = !n;
  const itens = (r.notif?.itens || []).slice(0, 15);
  $("#avisos").replaceChildren(...(itens.length ? itens.map((x) => el("li", {},
    el("button", { class: "item" + (x.lida ? "" : " novo"), type: "button", onclick: () => abrir(x.link || "#avisos/para-mim") },
      el("span", { text: x.texto }), el("span", { class: "sub", text: quando(x.criada_em) })))) : [el("li", { class: "meta", text: "Tudo em dia por aqui." })]));
}
$("#b-lidos").addEventListener("click", async () => {
  try { await Api.rpc("marcar_notificacoes_lidas"); await chrome.runtime.sendMessage({ tipo: "conferir" }); await atualizar(); }
  catch (x) { erro("#e-app", x.message); }
});

// enquanto o painel estiver aberto: atualiza a cada minuto e quando volta a ficar visível
setInterval(() => { if (!document.hidden && !$("#v-app").hidden) atualizar(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#v-app").hidden) atualizar(); });
mostrar();
