// Teste da extensão do Comunique (pasta extensao/): carrega no Chromium e confere o painel lateral,
// o leitor das telas do Quero Log e do Crisp (com páginas falsas, sem dados reais) e os botões que
// abrem o formulário do Comunique já preenchido. Uso: node extensao.test.mjs
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(RAIZ, "extensao");
let falhas = 0;
const ok = (c, msg) => { console.log((c ? "ok     " : "FALHOU ") + msg); if (!c) falhas++; };

const dados = fs.mkdtempSync(path.join(os.tmpdir(), "comunique-ext-"));
const ctx = await chromium.launchPersistentContext(dados, {
  headless: true, executablePath: process.env.CHROMIUM || undefined,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
  const idExt = sw.url().split("/")[2];
  ok(/^[a-p]{32}$/.test(idExt), "a extensão carrega e o service worker sobe: " + idExt);

  // manifesto: permissões só nos sites necessários
  const man = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  ok(!man.host_permissions.some((h) => h.includes("<all_urls>") || h.startsWith("*")), "permissões só para o Supabase e o site do Comunique");
  for (const f of Object.values(man.icons)) ok(fs.existsSync(path.join(EXT, f)), "ícone existe: " + f);

  // painel lateral sem login: pede para entrar
  const painel = await ctx.newPage();
  await painel.goto(`chrome-extension://${idExt}/painel/painel.html`);
  const errosPainel = []; painel.on("pageerror", (e) => errosPainel.push(e.message));
  await painel.waitForSelector("#b-entrar", { state: "visible", timeout: 5000 }).catch(() => {});
  ok(await painel.isVisible("#b-entrar") && !(await painel.isVisible("#v-app")), "painel sem login mostra 'Entrar com Google'" + (errosPainel.length ? ": " + errosPainel.join(" | ") : ""));

  // telas falsas do Quero Log e do Crisp + o site do Comunique (só para ver o endereço aberto)
  await ctx.route("https://admin.querolog.io/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
    <nav><a>Lista</a> / <a>Fulano de Teste</a></nav>
    <table><tr><td>Id</td><td>abc123def456</td></tr><tr><td>Celular</td><td>(00) 0 0000-0000</td></tr>
    <tr><td>CPF</td><td>000.000.000-00</td></tr><tr><td>Franquia</td><td>Serrinha - BA</td></tr></table></body></html>` }));
  await ctx.route("https://app.crisp.chat/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
    <aside><div><span>DT</span><div><b>Beltrano Teste da Silva</b><a>beltrano@exemplo.com</a><span>Recife, PE</span></div><button>Ver Perfil de Beltrano</button></div>
    <h3>Dados personalizados</h3><div><div><span>entregador_id</span><span>fff111eee222</span></div><div><span>cidade</span><span>Patos - PB</span></div></div></aside></body></html>` }));
  await ctx.route("https://comuniqueqd.github.io/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Comunique</title>" }));

  const ql = await ctx.newPage();
  await ql.goto("https://admin.querolog.io/entregadores/abc123def456");
  await ql.waitForTimeout(1500);
  const cartao = await ql.evaluate(() => [...document.documentElement.children].some((n) => n.tagName === "DIV" && n.style.position === "fixed"));
  ok(cartao, "Quero Log: o cartão do Comunique aparece na tela do entregador");
  // o cartão fica num shadow DOM fechado: clica pelo teclado/posição e confere a aba aberta
  const abas = async (trecho) => { await new Promise((r) => setTimeout(r, 1000));
    const t = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.map((x) => x.pendingUrl || x.url)));
    return decodeURIComponent((t.find((x) => x && x.includes(trecho)) || "").replace(/\+/g, " ")); };
  { const box = await ql.evaluate(() => { const c = [...document.documentElement.children].find((n) => n.style.position === "fixed"); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    // 3º botão (Bloquear): linha 2, coluna 1 da grade de botões
    await ql.mouse.click(box.x + 70, box.y + box.h - 52); }
  const u = await abas("#preencher/bloqueio");
  ok(u.startsWith("https://comuniqueqd.github.io/#preencher/bloqueio?") && u.includes("id=abc123def456") && u.includes("nome=Fulano de Teste") && u.includes("cidade=Serrinha - BA"),
    "Quero Log: Bloquear abre o Comunique com ID, nome e cidade: " + u);
  ok(!u.includes("000.000.000") && !u.includes("0000-0000"), "Quero Log: CPF e celular não saem da tela");

  const cr = await ctx.newPage();
  await cr.goto("https://app.crisp.chat/website/x/inbox/");
  await cr.waitForTimeout(1500);
  const box = await cr.evaluate(() => { const c = [...document.documentElement.children].find((n) => n.style?.position === "fixed"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  ok(!!box, "Crisp: o cartão aparece com os dados personalizados");
  if (box) {
    await cr.mouse.click(box.x + 210, box.y + box.h - 52);
    // a aba do Comunique já existe: ela é reaproveitada, então confere o endereço dela
    const alvo = await abas("#preencher/adicional?");
    ok(!!alvo && alvo.includes("id=fff111eee222") && alvo.includes("nome=Beltrano Teste da Silva") && alvo.includes("cidade=Patos - PB"),
      "Crisp: Adicional abre (ou reaproveita) o Comunique com ID, nome e cidade: " + alvo);
  }

  // página sem ID do entregador: nada aparece
  const outra = await ctx.newPage();
  await outra.goto("https://admin.querolog.io/estabelecimentos");
  await outra.waitForTimeout(1200);
  ok(!(await outra.evaluate(() => [...document.documentElement.children].some((n) => n.style?.position === "fixed"))), "fora da tela do entregador o cartão não aparece");
} finally {
  await ctx.close();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
