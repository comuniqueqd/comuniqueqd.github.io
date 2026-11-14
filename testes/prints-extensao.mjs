// Gera as imagens da loja (extensao/loja/) com dados fictícios: 2 prints 1280×800 e o bloco 440×280.
import { chromium } from "playwright";
import path from "node:path"; import os from "node:os"; import fs from "node:fs"; import { fileURLToPath } from "node:url";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), EXT = path.join(RAIZ, "extensao"), OUT = path.join(EXT, "loja");
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "ce-")), { headless: true, executablePath: process.env.CHROMIUM || undefined,
  viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const simbolo = fs.readFileSync(path.join(EXT, "icones/simbolo.svg"), "utf8");
// 2) painel lateral logado, com avisos fictícios
const RESP = {
  busca_rapida: { entregadores: [], cadastros: [] },
  regras_bloqueio: { cidades: [{ nome: "LAGARTO - SE", ativa: true }], infracoes: [{ id: 1, nome: "Atraso na Coleta Sem Justificativa", ativa: true, leve: false },
    { id: 2, nome: "Mal Uso Proposital do Aplicativo", ativa: true, leve: false }] },
  previa_bloqueio: { ocorrencia: 1, horas: 24 },
  resumo_e_avisos: { resumo: { avisos_rapidos: [{ id: 1, tipo: "ajuda", criado_por_nome: "Ana", titulo: "Monitoramento: pedido atrasado em Lagarto", aceito_por_nome: null, expirado: false }] },
    notif: { nao_lidas: 2, itens: [
      { id: 3, texto: "Seu cadastro de João Exemplo foi aprovado.", link: "#ativacao/historico", criada_em: new Date().toISOString(), lida: false },
      { id: 2, texto: "Nova tratativa para você em LAGARTO - SE.", link: "#bloqueios/tratativas", criada_em: new Date(Date.now() - 36e5).toISOString(), lida: false },
      { id: 1, texto: "Adicional de R$ 8,00 registrado em ITABAIANA - SE.", link: "#financeiro/lancamentos", criada_em: new Date(Date.now() - 2 * 36e5).toISOString(), lida: true }] } },
};
await ctx.route("https://nhgmkbfaqonojhaggwui.supabase.co/**", (r) => {
  const fn = r.request().url().split("/rpc/")[1]?.split("?")[0];
  r.fulfill({ contentType: "application/json", body: JSON.stringify(RESP[fn] ?? {}) });
});
await sw.evaluate(() => chrome.storage.local.set({ sessao: { access_token: "x", refresh_token: "y", expira: Date.now() + 36e5 } }));
// 1) tela do painel (fictícia) com o cartão do Comunique
await ctx.route("https://admin.querolog.io/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#333;background:#f6f6f8}header{background:#fff;padding:18px 32px;border-bottom:1px solid #e5e5ea;font-weight:700}
  main{padding:24px 32px;max-width:760px}nav{color:#777;margin-bottom:16px}nav b{color:#222}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
  td{padding:10px 16px;border-bottom:1px solid #eee}td:last-child{text-align:right}</style></head><body><header>Painel de entregadores</header><main>
  <nav><a>Lista</a> / <b>Maria Exemplo</b></nav><table><tr><td>Id</td><td>exemplo123abc</td></tr><tr><td>Status</td><td>Online</td></tr>
  <tr><td>Franquia</td><td>Lagarto - SE</td></tr><tr><td>Veículo</td><td>Moto</td></tr></table></main></body></html>` }));
const p1 = await ctx.newPage(); await p1.setViewportSize({ width: 880, height: 800 });
await p1.goto("https://admin.querolog.io/entregadores/exemplo123abc"); await p1.waitForTimeout(800);
const telaPng = (await p1.screenshot()).toString("base64");
const aba = await sw.evaluate(async () => { for (const t of await chrome.tabs.query({})) { try { const r = await chrome.tabs.sendMessage(t.id, { tipo: "tela" }); if (r?.entregador) return t.id; } catch (_) {} } return null; });
const pf = await ctx.newPage(); await pf.setViewportSize({ width: 400, height: 800 });
await pf.goto(`chrome-extension://${id}/painel/painel.html?aba=${aba}`); await pf.waitForSelector("#v-app:not([hidden])");
await pf.locator(".atalhos button", { hasText: "Novo bloqueio" }).click(); await pf.waitForSelector("#caixa-form form select");
await pf.locator("#caixa-form select").first().selectOption("1"); await pf.waitForSelector(".previa:not([hidden])"); await pf.waitForTimeout(300);
const formPng = (await pf.screenshot()).toString("base64");
const p1b = await ctx.newPage(); await p1b.setViewportSize({ width: 1280, height: 800 });
await p1b.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;display:grid;grid-template-columns:880px 400px;height:800px;background:#fff">
  <img src="data:image/png;base64,${telaPng}" style="width:880px;height:800px" alt=""><img src="data:image/png;base64,${formPng}" style="width:400px;height:800px;border-left:1px solid #E5DED1" alt=""></body></html>`);
await p1b.waitForTimeout(300);
await p1b.screenshot({ path: path.join(OUT, "print-1-bloqueio-no-painel.png") });
const pp = await ctx.newPage(); await pp.setViewportSize({ width: 400, height: 800 });
await pp.goto(`chrome-extension://${id}/painel/painel.html`); await pp.waitForSelector("#v-app:not([hidden]) .item"); await pp.waitForTimeout(500);
const painelPng = (await pp.screenshot()).toString("base64");
const p2 = await ctx.newPage(); await p2.setViewportSize({ width: 1280, height: 800 });
await p2.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#FAF7F1;display:grid;grid-template-columns:1fr 400px;height:800px;font:16px system-ui">
  <div style="display:grid;place-items:center;color:#14352B"><div style="text-align:center;max-width:560px">${simbolo.replace("<svg ", '<svg width="96" height="96" ')}
  <h1 style="font:800 44px system-ui;margin:16px 0 8px">Comunique ao lado</h1><p style="font-size:20px;color:#4B5B54">Avisos, pedidos de ajuda, busca de entregadores e atalhos, sem sair da tela em que você está.</p></div></div>
  <img src="data:image/png;base64,${painelPng}" style="border-left:1px solid #E5DED1;width:400px;height:800px" alt=""></body></html>`);
await p2.waitForTimeout(300);
await p2.screenshot({ path: path.join(OUT, "print-2-painel-lateral.png") });
// 3) bloco promocional 440×280
const p3 = await ctx.newPage(); await p3.setViewportSize({ width: 440, height: 280 });
await p3.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:440px;height:280px;background:#14352B;display:flex;align-items:center;gap:20px;padding:0 36px;box-sizing:border-box;font-family:system-ui">
  ${simbolo.replace("<svg ", '<svg width="96" height="96" ')}<div><div style="font:800 40px system-ui;color:#F4EFE6;letter-spacing:-1px">Comunique</div>
  <div style="color:#E8A33D;font:600 16px system-ui;margin-top:4px">A operação a um clique</div></div></body></html>`);
await p3.screenshot({ path: path.join(OUT, "bloco-promocional-440x280.png") });
await ctx.close();
console.log("ok");
