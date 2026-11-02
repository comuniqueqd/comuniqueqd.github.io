// Teste de ponta a ponta: o index.html real no Chromium, falando com o Postgres local
// através do supabase-falso.mjs. O login é simulado colocando a sessão no navegador
// (no lugar do redirecionamento do Google); o resto (telas, funções SQL, permissões) é o código real.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node e2e.test.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { iniciarSupabaseFalso } from "./supabase-falso.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
const DB = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const SITE = "http://127.0.0.1:8765/index.html";
const API = "http://127.0.0.1:54321";
const PRINTS = path.join(AQUI, "prints");
fs.mkdirSync(PRINTS, { recursive: true });

// banco do zero
const db = new pg.Client({ connectionString: DB });
await db.connect();
await db.query(fs.readFileSync(path.join(AQUI, "supabase-local.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/schema.sql"), "utf8"));
await db.end();

const api = await iniciarSupabaseFalso({ porta: 54321, databaseUrl: DB });
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const site = http.createServer((q, r) => {
  const f = path.join(RAIZ, decodeURIComponent(q.url.split("?")[0]));
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": TIPOS[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
}).listen(8765, "127.0.0.1");

const UMD = path.join(path.dirname(require.resolve("@supabase/supabase-js/package.json")), "dist/umd");
const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const monitor = pessoa("monitor@x.com", "Monitor Um");
const sup = pessoa("suporte@x.com", "Suporte Um");
const novata = pessoa("novata@x.com", "Novata Silva");

let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? "ok     " : "FALHOU ") + msg); if (!cond) falhas++; };
const b = await chromium.launch();

// Imita o script do Google (Google Identity Services): o botão gera um token do Google com o nonce recebido.
const GIS_FALSO = `window.google = { accounts: { id: {
  initialize(o) { window.__gis = o; },
  disableAutoSelect() {},
  renderButton(el) {
    const b = document.createElement("button"); b.id = "botao-google-falso"; b.textContent = "Fazer login com o Google";
    b.onclick = () => {
      const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
      const tok = enc({ alg: "RS256" }) + "." + enc({ iss: "https://accounts.google.com", aud: window.__gis.client_id,
        email: window.__gisEmail, email_verified: true, name: window.__gisNome, nonce: window.__gis.nonce, sub: "g1",
        exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";
      window.__gis.callback({ credential: tok });
    };
    el.append(b);
  } } } };`;

async function abrir(p, hash = "", { googleId = null } = {}) {
  const c = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  await c.route("**/supabase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.SUPABASE_URL=${JSON.stringify(API)};window.SUPABASE_ANON_KEY="chave-anon-de-teste";window.GOOGLE_CLIENT_ID=${JSON.stringify(googleId || "COLE_AQUI")};` }));
  await c.route("https://accounts.google.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: googleId ? GIS_FALSO : "" }));
  await c.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(UMD, r.request().url().split("/").pop())) }));
  await c.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  if (p) {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 36000;
    const user = { id: p.sub, email: p.email, aud: "authenticated", role: "authenticated", user_metadata: { full_name: p.nome } };
    const sessao = {
      access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: p.sub, email: p.email, role: "authenticated", aud: "authenticated", exp, user_metadata: { full_name: p.nome } })}.assinatura`,
      token_type: "bearer", expires_in: 36000, expires_at: exp, refresh_token: "r", user,
    };
    // só na primeira carga da aba: depois de "Sair", o recarregamento não pode recolocar a sessão
    await c.addInitScript((s) => { if (!sessionStorage.getItem("injetado")) { localStorage.setItem("sb-127-auth-token", s); sessionStorage.setItem("injetado", "1"); } }, JSON.stringify(sessao));
  }
  const pg_ = await c.newPage();
  pg_.on("pageerror", (e) => { console.log("ERRO NA PÁGINA", e.message); falhas++; });
  await pg_.goto(SITE + hash);
  return pg_;
}
const esperar = (p, sel, t = 10000) => p.waitForSelector(sel, { timeout: t }).then(() => true).catch(() => false);
const texto = (p, sel) => p.textContent(sel).catch(() => "");
const ir = async (p, hash) => { await p.evaluate((h) => (location.hash = h), hash); await p.waitForTimeout(700); };

try {
  // 1. sem login e sem acesso
  let p = await abrir(null);
  ok(await esperar(p, "#g-entrar:not([hidden])"), "sem sessão: mostra Entrar com Google");
  p = await abrir(novata);
  ok(await esperar(p, "#g-pedir:not([hidden])"), "conta sem acesso: mostra Pedir acesso");
  await p.click("#g-pedir");
  ok(await esperar(p, "text=Pedido de acesso enviado"), "pedido de acesso enviado");
  await p.screenshot({ path: path.join(PRINTS, "1-pedido-acesso.png") });

  // 2. moderador (admin final) monta a equipe
  const a = await abrir(admin, "#equipe");
  ok(await esperar(a, "#t-equipe >> text=administrador final"), "admin entra e vê a Equipe com o cadeado de administrador final");
  ok((await texto(a, "#papel")) === "Moderador", "papel no topo: Moderador");
  ok(await esperar(a, "#pedidos-box:not([hidden]) >> text=novata@x.com"), "pedido da novata aparece");
  ok((await texto(a, "#c-pedidos")) === "1", "contador de pedidos na aba Equipe");
  await a.selectOption("#t-pedidos select", "suporte");
  await a.click("#t-pedidos >> text=Liberar");
  await esperar(a, "#t-equipe >> text=novata@x.com");
  for (const [pp, papel] of [[monitor, "monitorador"], [sup, "suporte"]]) {
    await a.fill("#m-email", pp.email); await a.fill("#m-nome", pp.nome); await a.selectOption("#m-papel", papel);
    await a.click("#f-membro button[type=submit]"); await esperar(a, `#t-equipe >> text=${pp.email}`);
  }
  ok((await a.$$("#t-equipe tbody tr")).length === 4, "equipe com 4 pessoas");
  ok(!(await a.isVisible("#t-equipe tr:has-text('mateuslopesmb') >> text=Remover")), "admin final não tem botão Remover");
  await a.screenshot({ path: path.join(PRINTS, "2-equipe.png"), fullPage: true });

  // 3. suporte envia
  const s = await abrir(sup, "#novo");
  await esperar(s, "#v-novo:not([hidden])");
  const abas = await s.$$eval("nav.tabs a:not([hidden])", (as) => as.map((x) => x.dataset.view));
  ok(JSON.stringify(abas) === JSON.stringify(["pendentes", "novo", "meus", "painel"]), "suporte vê só Pendentes, Novo, Meus cadastros e Painel: " + abas);
  await s.fill("#f-idapp", "697a33d1077b"); await s.fill("#f-cpf", "52998224725"); await s.fill("#f-cidade", "LAGARTO - SE"); await s.fill("#f-obs", "Documentos pelo WhatsApp");
  await s.click("#b-enviar");
  ok(await esperar(s, "#v-pendentes:not([hidden]) .card.destaque"), "após enviar, vai para Pendentes com o cadastro destacado");
  ok((await texto(s, ".card.destaque")).includes("Aguardando análise"), "card mostra a situação Aguardando análise");
  ok((await texto(s, ".card.destaque")).includes("esperando há"), "card mostra há quanto tempo espera");
  await s.screenshot({ path: path.join(PRINTS, "3-suporte-pendentes.png"), fullPage: true });
  await ir(s, "#novo");
  await s.fill("#f-idapp", "outro1234"); await s.fill("#f-cpf", "529.982.247-25"); await s.fill("#f-cidade", "RECIFE - PE");
  await s.click("#b-enviar");
  ok(await esperar(s, "#form-erro:not([hidden])"), "CPF repetido é bloqueado: " + (await texto(s, "#form-erro")));
  await s.fill("#f-idapp", "abc12345"); await s.fill("#f-cpf", ""); await s.click("#b-enviar");
  await esperar(s, "#v-pendentes:not([hidden]) .card.destaque");
  await s.fill("#f-idapp", "x").catch(() => {});
  await ir(s, "#novo"); await s.fill("#f-idapp", "zzz99881"); await s.fill("#f-cidade", "ITABAIANA - SE"); await s.click("#b-enviar");
  await esperar(s, "#v-pendentes:not([hidden]) .card.destaque");
  ok((await s.$$("#queue .card")).length === 3, "suporte vê os 3 cadastros que enviou");
  ok(!(await s.isVisible("#queue >> text=Aprovar")), "suporte não tem botão Aprovar");

  // 4. monitorador decide
  const m = await abrir(monitor);
  await esperar(m, "#queue .card");
  const abasM = await m.$$eval("nav.tabs a:not([hidden])", (as) => as.map((x) => x.dataset.view));
  ok(!abasM.includes("equipe") && abasM.includes("historico"), "monitorador vê Histórico e não vê Equipe");
  ok((await texto(m, "#c-pend")) === "3", "contador de pendentes: 3");
  const cardLagarto = "#queue .card:has-text('697a33d1077b')";
  await m.click(`${cardLagarto} >> text=Reprovar`);
  await m.click(`${cardLagarto} >> text=Confirmar reprovação`);
  ok(await esperar(m, "#toast:has-text('Escolha o motivo')"), "reprovar sem motivo pede o motivo");
  await m.selectOption(`${cardLagarto} select`, "Fotos sem camisa");
  await m.fill(`${cardLagarto} .box input`, "Foto do rosto também");
  await m.click(`${cardLagarto} >> text=Confirmar reprovação`);
  ok(await esperar(m, ".grupo:has-text('Aguardando novo contato') >> text=697a33d1077b"), "reprovado vai para o grupo Aguardando novo contato");
  ok((await texto(m, cardLagarto)).includes("Fotos sem camisa — Foto do rosto também"), "card mostra motivo e detalhe");
  ok(!(await m.isVisible(`${cardLagarto} >> text=Reprovar`)) && await m.isVisible(`${cardLagarto} >> text=Aprovar`) && await m.isVisible(`${cardLagarto} >> text=Encerrar…`), "aguardando contato: só Aprovar ou Encerrar");
  const cardZ = "#queue .card:has-text('zzz99881')";
  await m.click(`${cardZ} >> text=Encerrar…`);
  ok((await texto(m, `${cardZ} .box`)).includes("definitivo"), "encerrar avisa que é definitivo");
  await m.selectOption(`${cardZ} select`, "CPF com restrição");
  await m.screenshot({ path: path.join(PRINTS, "4-monitorador-pendentes.png"), fullPage: true });
  await m.click(`${cardZ} >> text=Confirmar encerramento`);
  await m.waitForTimeout(1200);
  ok(!(await m.isVisible(cardZ)), "encerrado sai de Pendentes");
  await m.click("#queue .card:has-text('abc12345') >> text=Aprovar");
  await m.waitForTimeout(1200);
  ok((await m.$$("#queue .card")).length === 1, "aprovado sai de Pendentes (resta 1)");
  await ir(m, "#historico");
  await esperar(m, "#t-hist tbody tr");
  ok(!(await m.isVisible("#t-hist >> text=Desfazer")) && !(await m.isVisible("#t-hist >> text=Excluir")), "monitorador não vê Desfazer nem Excluir");

  // 5. suporte acompanha
  await ir(s, "#pendentes");
  await s.reload(); await esperar(s, "#queue .card");
  ok((await texto(s, "#queue")).includes("Reprovado por Monitor Um"), "suporte vê quem reprovou e o motivo");
  await ir(s, "#meus");
  await esperar(s, "#t-meus tbody tr td .pill");
  ok((await s.$$("#t-meus tbody tr")).length === 3, "Meus cadastros lista os 3");
  ok((await texto(s, "#meus-tiles")).replace(/\s/g, "").includes("Aprovados1"), "Meus cadastros: 1 aprovado");
  await s.click("#t-meus tr:has-text('697a33d1077b')");
  ok(await esperar(s, "#t-meus .timeline >> text=Reprovado"), "histórico do cadastro: " + (await texto(s, "#t-meus .timeline")).replace(/\s+/g, " ").slice(0, 120));
  await s.screenshot({ path: path.join(PRINTS, "5-meus-cadastros.png"), fullPage: true });

  // 6. painel e filtros
  await ir(s, "#painel");
  await esperar(s, "#tiles .tile");
  const tiles = async (pg_) => (await texto(pg_, "#tiles")).replace(/\s+/g, " ");
  ok((await tiles(s)).includes("Cadastros3"), "painel (todos): 3 cadastros");
  await ir(m, "#painel"); await esperar(m, "#tiles .tile");
  await m.click("[data-filtro=eu]"); await m.waitForTimeout(1200);
  ok((await tiles(m)).includes("Cadastros3"), "monitorador 'Só eu': os 3 que ele decidiu");
  ok((await texto(m, "#t-pessoa")).includes("Monitor Um (você)") && !(await texto(m, "#t-pessoa")).includes("Suporte Um"), "tabela por pessoa só com ele");
  await m.click("[data-filtro=escolher]"); await m.waitForTimeout(800);
  await m.check("#pessoas label:has-text('Suporte Um') input"); await m.uncheck("#pessoas label:has-text('Monitor Um') input");
  await m.waitForTimeout(1200);
  ok((await texto(m, "#painel-sub")).includes("Suporte Um"), "escolher pessoas: " + (await texto(m, "#painel-sub")));
  ok((await texto(m, "#motivos-rep")).includes("Fotos sem camisa") && (await texto(m, "#motivos-enc")).includes("CPF com restrição"), "motivos de reprovação e encerramento no painel");
  await m.click("[data-filtro=todos]"); await m.waitForTimeout(1200);
  await m.screenshot({ path: path.join(PRINTS, "6-painel.png"), fullPage: true });

  // 7. moderador desfaz, exclui e exporta
  await ir(a, "#historico"); await a.reload(); await esperar(a, "#t-hist tbody tr");
  await a.click("#t-hist tr:has-text('zzz99881') >> text=Desfazer");
  ok(await esperar(a, "#t-hist tr:has-text('zzz99881') >> text=Aguardando análise"), "moderador desfaz o encerramento");
  await a.click("#t-hist tr:has-text('abc12345') >> text=Excluir");
  await a.click("#t-hist tr:has-text('abc12345') >> text=Confirmar exclusão");
  await a.waitForTimeout(1200);
  ok(!(await a.isVisible("#t-hist >> text=abc12345")), "moderador exclui");
  const [dl] = await Promise.all([a.waitForEvent("download"), a.click("#b-export")]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  ok(csv.includes("id_entregador;cpf;cidade") && csv.includes("697a33d1077b;529.982.247-25;LAGARTO - SE"), "CSV baixado");
  await a.screenshot({ path: path.join(PRINTS, "7-historico.png"), fullPage: true });

  // 8. novata já liberada entra; sair volta ao login
  const n = await abrir(novata);
  ok(await esperar(n, "#papel:has-text('Suporte')"), "novata liberada entra como Suporte");
  await n.click("#b-sair");
  ok(await esperar(n, "#g-entrar:not([hidden])"), "Sair volta para o login");

  // 9. login pelo botão oficial do Google (sem passar pelo endereço do Supabase)
  const g = await abrir(null, "", { googleId: "teste.apps.googleusercontent.com" });
  ok(await esperar(g, "#g-google:not([hidden]) #botao-google-falso"), "com GOOGLE_CLIENT_ID, aparece o botão do Google");
  ok(await g.isHidden("#g-entrar"), "e o botão de reserva fica escondido");
  await g.evaluate(() => { window.__gisEmail = "mateuslopesmb@gmail.com"; window.__gisNome = "Mateus Lopes"; });
  await g.click("#botao-google-falso");
  ok(await esperar(g, "#papel:has-text('Moderador')"), "login pelo botão do Google entra como Moderador (nonce conferido)");
  await g.evaluate(() => { window.__gis.nonce = "nonce-adulterado"; });
  await g.click("#b-sair");
  await esperar(g, "#botao-google-falso");
  await g.evaluate(() => { window.__gisEmail = "mateuslopesmb@gmail.com"; window.__gis.nonce = "0".repeat(64); });
  await g.click("#botao-google-falso");
  ok(await esperar(g, "#gate-erro:not([hidden])"), "token com nonce errado é recusado: " + (await texto(g, "#gate-erro")));
} finally {
  await b.close(); site.close(); await api.fechar();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
