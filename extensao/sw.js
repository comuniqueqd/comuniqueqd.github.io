// Trabalho em segundo plano: número de avisos no ícone, notificações (avisos novos e pedidos de ajuda),
// o menu "Ver no Comunique" ao selecionar um ID e a abertura do painel lateral pelo ícone.
// O service worker dorme sozinho: o que precisa durar fica em chrome.storage.
importScripts("config.js", "api.js");
const C = globalThis.COMUNIQUE, Api = globalThis.ComuniqueApi;

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ver-id", title: "Ver “%s” no Comunique", contexts: ["selection"] });
  });
  await chrome.alarms.create("conferir", { periodInMinutes: 1 });
  await leitorNasAbasAbertas();
  await conferir();
});
// ao instalar ou atualizar, as abas do Quero Log e do Crisp que já estavam abertas ficam sem o leitor novo
// (e com o cartão da 1.1, se havia): coloca o leitor nelas, sem precisar recarregar a página
async function leitorNasAbasAbertas() {
  try {
    for (const t of await chrome.tabs.query({ url: ["https://admin.querolog.io/*", "https://app.crisp.chat/*"] }))
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["telas/leitor.js"] }).catch(() => {});
  } catch (_) {}
}
chrome.runtime.onStartup.addListener(async () => { await chrome.alarms.create("conferir", { periodInMinutes: 1 }); await conferir(); });
// o ícone abre o painel lateral
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.alarms.onAlarm.addListener(async (a) => { if (a.name === "conferir") await conferir(); });

// abre o Comunique numa aba (reaproveita a que já estiver aberta)
async function abrir(hash = "#inicio") {
  const url = C.SITE + hash;
  const [aba] = await chrome.tabs.query({ url: C.SITE + "*" });
  if (aba) { await chrome.tabs.update(aba.id, { url, active: true }); await chrome.windows.update(aba.windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "ver-id") return;
  const id = String(info.selectionText || "").trim().replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  if (id.length < 4) {
    await avisar("so-id", "Comunique", "Selecione só o ID do entregador (letras e números) e tente de novo.");
    return;
  }
  await abrir("#ficha/" + encodeURIComponent(id));
});

async function avisar(id, titulo, texto, link) {
  if (link) { const { links = {} } = await chrome.storage.session.get("links"); links[id] = link; await chrome.storage.session.set({ links }); }
  await chrome.notifications.create(id, { type: "basic", iconUrl: "icones/icone-128.png", title: titulo, message: texto, priority: 1 });
}
chrome.notifications.onClicked.addListener(async (id) => {
  const { links = {} } = await chrome.storage.session.get("links");
  await abrir(links[id] || "#avisos/para-mim");
  await chrome.notifications.clear(id);
});

// a cada minuto: número no ícone + notificação do que chegou de novo
async function conferir() {
  if (!(await Api.sessao())) { await chrome.action.setBadgeText({ text: "" }); return; }
  let r;
  try { r = await Api.rpc("resumo_e_avisos"); }
  catch (e) {
    await chrome.action.setBadgeText({ text: e.semSessao ? "" : "!" });
    await chrome.action.setTitle({ title: "Comunique: " + e.message });
    return;
  }
  const n = r?.notif?.nao_lidas || 0;
  await chrome.action.setBadgeBackgroundColor({ color: "#E8A33D" });
  await chrome.action.setBadgeTextColor?.({ color: "#14352B" });
  await chrome.action.setBadgeText({ text: n ? (n > 99 ? "99+" : String(n)) : "" });
  await chrome.action.setTitle({ title: n ? `Comunique: ${n} aviso(s) novo(s)` : "Comunique" });
  await chrome.storage.session.set({ ultimo: r, ultimoEm: Date.now() });

  const { vistos } = await chrome.storage.local.get("vistos");
  const itens = r?.notif?.itens || [];
  const ajudas = (r?.resumo?.avisos_rapidos || []).filter((a) => a.tipo === "ajuda" && !a.meu && !a.aceito_por_nome && !a.expirado);
  const maior = itens.reduce((m, x) => Math.max(m, x.id), 0);
  if (vistos) {
    // avisos novos (até 3 por vez) e pedidos de ajuda que ainda não foram mostrados
    for (const x of itens.filter((x) => !x.lida && x.id > vistos.notif).slice(0, 3).reverse())
      await avisar("n" + x.id, "Comunique", x.texto, x.link);
    for (const a of ajudas.filter((a) => !vistos.ajudas.includes(a.id)))
      await avisar("a" + a.id, "🆘 Pedido de ajuda", `${a.criado_por_nome || "Alguém da equipe"}: ${a.titulo || a.texto || "precisa de ajuda agora"}`, "#inicio");
  }
  // na primeira vez só guarda o que já existia (não notifica o passado)
  await chrome.storage.local.set({ vistos: { notif: Math.max(maior, vistos?.notif || 0), ajudas: ajudas.map((a) => a.id) } });
}

// 1.1: o cartão das telas grava pelo service worker, e só estas funções (as mesmas que o site usa)
const PERMITIDAS = new Set(["regras_bloqueio", "previa_bloqueio", "registrar_bloqueio_agravante", "registrar_adicional",
  "cadastrar_entregador", "enviar_cadastro", "busca_rapida"]);
async function regras() {
  const { regras: r, regrasEm = 0 } = await chrome.storage.session.get(["regras", "regrasEm"]);
  if (r && Date.now() - regrasEm < 300000) return r;
  const novo = await Api.rpc("regras_bloqueio");
  await chrome.storage.session.set({ regras: novo, regrasEm: Date.now() });
  return novo;
}

// mensagens do painel lateral e do cartão das telas
chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  (async () => {
    if (msg?.tipo === "conferir") { await conferir(); return responder({ ok: true }); }
    if (msg?.tipo === "abrir") { await abrir(msg.hash); return responder({ ok: true }); }
    if (msg?.tipo === "logado") return responder({ ok: true, logado: !!(await Api.sessao()) });
    if (msg?.tipo === "rpc") {
      if (!PERMITIDAS.has(msg.fn)) return responder({ ok: false, erro: "Função não permitida pela extensão." });
      const dados = msg.fn === "regras_bloqueio" ? await regras() : await Api.rpc(msg.fn, msg.args || {});
      if (msg.fn !== "regras_bloqueio" && msg.fn !== "previa_bloqueio" && msg.fn !== "busca_rapida") conferir().catch(() => {});
      return responder({ ok: true, dados });
    }
    responder({ ok: false, erro: "Mensagem desconhecida." });
  })().catch((e) => responder({ ok: false, erro: e.message, semSessao: !!e.semSessao }));
  return true;
});
