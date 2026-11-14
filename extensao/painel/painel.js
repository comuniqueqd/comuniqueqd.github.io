// Painel lateral: login, busca de entregador, atalhos, pedidos de ajuda abertos e os avisos.
// Tudo montado com textContent (nunca innerHTML).
const Api = globalThis.ComuniqueApi;
const $ = (s) => document.querySelector(s);
const EMOJI = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*[\u{1F3FB}-\u{1F3FF}]?/gu;
const semEmoji = (t) => String(t).replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/, "");
function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "icone") { if (window.App?.ic) n.append(window.App.ic(v)); continue; }
    if (k === "text") n.textContent = semEmoji(v); else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...filhos.flat().filter((f) => f != null && f !== false).map((f) => (f.nodeType ? f : semEmoji(f))));
  return n;
}
const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const abrir = (hash) => chrome.runtime.sendMessage({ tipo: "abrir", hash });
const erro = (sel, msg) => { const p = $(sel); p.textContent = msg || ""; p.hidden = !msg; };

async function mostrar() {
  const logado = !!(await Api.sessao());
  $("#v-entrar").hidden = logado; $("#v-app").hidden = !logado; $("#v-form").hidden = true; $("#b-sair").hidden = !logado;
  if (logado) { telaAtual(); await atualizar(); }
}

$("#b-entrar").addEventListener("click", async (e) => {
  e.currentTarget.disabled = true; erro("#e-entrar");
  try { await Api.entrar(); await chrome.runtime.sendMessage({ tipo: "conferir" }); await mostrar(); }
  catch (x) { erro("#e-entrar", /canceled|cancelad|closed/i.test(x.message) ? "Login cancelado." : x.message); }
  finally { e.currentTarget.disabled = false; }
});
$("#b-sair").addEventListener("click", async () => { await Api.sair(); await chrome.runtime.sendMessage({ tipo: "conferir" }); await mostrar(); });
// os botões de registrar: leem a página aberta e mostram o formulário aqui mesmo
const TITULOS = { bloqueio: "Novo bloqueio", cadastro: "Nova ativação", adicional: "Registrar adicional", entregador: "Cadastrar entregador",
  calculadora: "Calculadora de bairro", ajuda: "Pedir ajuda" };
// a aba lida é a aba ativa da janela do painel (?aba=<id> só nos testes, onde o painel abre numa aba)
const ABA_TESTE = Number(new URLSearchParams(location.search).get("aba")) || null;
async function lerPagina() {
  let id = null;
  try {
    id = ABA_TESTE ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (id != null) return await chrome.tabs.sendMessage(id, { tipo: "tela" });
  } catch (_) {}
  // a aba foi aberta antes de a extensão ser instalada ou atualizada: o leitor ainda não está nela.
  // Coloca o leitor agora (só funciona no Quero Log e no Crisp) e pergunta de novo
  if (id == null) return null;
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["telas/leitor.js"] });
    return await chrome.tabs.sendMessage(id, { tipo: "tela" });
  } catch (_) { return null; }
}
function mostrarApp() { $("#v-form").hidden = true; $("#v-app").hidden = false; }
let acaoAberta = null;
async function abrirForm(acao) {
  acaoAberta = acao;
  $("#feito").hidden = true;
  $("#b-reler").hidden = acao === "ajuda";
  const r = acao === "ajuda" ? null : await lerPagina();
  const dados = { ...(r?.entregador || {}) };
  // o ID já tem ficha com outro nome? (avisa antes de gravar)
  if (dados.id && acao !== "calculadora") {
    try {
      const b = await Api.rpc("busca_rapida", { p_q: dados.id });
      const f = (b?.entregadores || []).find((x) => String(x.id_app).toLowerCase() === dados.id.toLowerCase());
      if (f && dados.nome && f.nome && norm(f.nome) !== norm(dados.nome)) dados.aviso = `No Comunique este ID está como “${f.nome}”. Confira antes de gravar.`;
      if (f && acao === "entregador") dados.aviso = `Este ID já tem ficha no Comunique (${f.nome || "sem nome"}).`;
    } catch (_) {}
  }
  const form = await globalThis.ComuniqueForms.montar(acao, dados, {
    rpc: (fn, args) => Api.rpc(fn, args), abrir,
    pronto: async (msg) => { mostrarApp(); const p = $("#feito"); p.replaceChildren(window.App.ic("ok"), msg); p.hidden = false; await chrome.runtime.sendMessage({ tipo: "conferir" }); atualizar(); },
  });
  $("#t-form").textContent = TITULOS[acao];
  $("#caixa-form").replaceChildren(form);
  $("#v-app").hidden = true; $("#v-form").hidden = false;
  form.focar();
}
const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
document.querySelectorAll(".atalhos button").forEach((b) => b.addEventListener("click", () => abrirForm(b.dataset.acao)));
$("#b-voltar").addEventListener("click", mostrarApp);
// trocou de entregador na página com o formulário aberto: lê de novo
$("#b-reler").addEventListener("click", () => acaoAberta && abrirForm(acaoAberta));
$("#b-abrir").addEventListener("click", () => abrir("#inicio"));

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
  const r = await lerPagina();   // aba sem o leitor (outro site): não mostra nada
  if (!r) return box.replaceChildren();
  if (!r.entregador) return box.replaceChildren(el("div", { class: "tela vazia", text: "Não encontrei ID de entregador nesta tela." }));
  const e = r.entregador;
  box.replaceChildren(el("div", { class: "tela" }, el("span", { class: "grupo", text: "Nesta tela" }), el("b", { text: e.nome || "Nome não encontrado" }),
    el("span", { class: "sub meta", text: [e.id, e.cidade].filter(Boolean).join(" · ") }),
    el("button", { class: "btn", type: "button", onclick: () => abrir("#ficha/" + encodeURIComponent(e.id)) }, "Ver ficha no Comunique")));
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
    el("b", { icone: "ajuda" }, a.meu ? "Seu pedido de ajuda" : `${a.criado_por_nome || "Alguém"} pediu ajuda`),
    el("span", { text: a.titulo || a.texto || "" }),
    el("span", { class: "sub meta", text: a.aceito_por_nome ? `Com ${a.aceito_por_nome}` : "Ninguém pegou ainda" }),
    // aceitar o pedido aqui mesmo (o seu próprio pedido só aparece, sem botão)
    !a.meu && !a.aceito_por_nome ? el("button", { class: "btn primario", type: "button", onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try { await Api.rpc("aceitar_ajuda", { p_id: a.id }); await atualizar(); const p = $("#feito"); p.replaceChildren(window.App.ic("ok"), "Você aceitou ajudar. Combine com quem pediu."); p.hidden = false; }
      catch (x) { erro("#e-app", x.message); ev.currentTarget.disabled = false; }
    }, icone: "juntos" }, "Eu ajudo") : null)));
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
