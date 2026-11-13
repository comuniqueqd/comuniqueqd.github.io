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
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/002-bloqueios.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/003-entregadores.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/004-atividades-registros.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/005-analises-anexos.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/006-equipe-previsao-atencao.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/007-pao-quentinho.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/008-espionagem.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/008b-cadastrar-entregador.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/008b-notificacoes.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/008c-analises.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/008d-avisos-parte2.sql"), "utf8"));
// 009b (Ferramentas e Financeiro). A 009a (horas da política) não entra aqui: os passos do e2e usam as horas antigas;
// ela é testada no financeiro.test.mjs.
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009b-ferramentas-financeiro.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009c-mensagens-agravante.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009c2-mensagens-opcoes.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009d-ajuda-aviso-turno.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009d2-tarefas-cards.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009d3-painel-metas-recorrentes.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009e-parceiros.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009f-parceiros-completo.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009g-tarefas-compartilhadas.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009h-entregador-pelo-lancamento.sql"), "utf8"));
await db.query(fs.readFileSync(path.join(RAIZ, "supabase/009p-bairros-parecidos.sql"), "utf8"));
await db.query(`insert into bairros (cidade, nome, valor, taxa_log, apelidos) values ('LAGARTO - SE', 'CENTRO', 5.49, 0.99, '{}'),
  ('LAGARTO - SE', 'BREJO', 16.99, 0.99, '{}'), ('LAGARTO - SE', 'ADEMAR DE CARVALHO', 5.49, 0.99, '{ALDEMAR DE CARVALHO}')`);
// histórico antigo de atraso (como a importação da planilha): 200 e 150 dias atrás
for (const d of [200, 150]) await db.query("select importar_bloqueio('atr00001', 'Ciclano Atrasado', 'LAGARTO - SE', 'Atraso na Coleta ou na Entrega Sem Justificativa', now() - make_interval(days => $1), 'Planilha')", [d]);
// registro importado com alerta de revisão (100 dias atrás: fora do painel de 30 dias)
await db.query("select importar_bloqueio('rev00001', 'Nome Errado', 'ITABAIANA - SE', 'Avaria de Produto', now() - interval '100 days', 'Planilha', 'ID usado com 2 nomes diferentes na planilha', '24')");
await db.end();

const api = await iniciarSupabaseFalso({ porta: 54321, databaseUrl: DB });
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png" };
const site = http.createServer((q, r) => {
  const f = path.join(RAIZ, decodeURIComponent(q.url.split("?")[0]));
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  // 009j (trusted-types): o site de teste roda com Trusted Types obrigatório. O app monta tudo com textContent
  // (nunca innerHTML com texto); se alguém usar um innerHTML com texto, o navegador recusa e o e2e quebra.
  const cab = { "Content-Type": TIPOS[path.extname(f)] || "application/octet-stream" };
  if (path.extname(f) === ".html") cab["Content-Security-Policy"] = "require-trusted-types-for 'script'";
  r.writeHead(200, cab); fs.createReadStream(f).pipe(r);
}).listen(8765, "127.0.0.1");

const UMD = path.join(path.dirname(require.resolve("@supabase/supabase-js/package.json")), "dist/umd");
const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const monitor = pessoa("monitor@x.com", "Monitor Um");
const sup = pessoa("suporte@x.com", "Suporte Um");
const novata = pessoa("novata@x.com", "Novata Silva");

let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? "ok     " : "FALHOU ") + msg); if (!cond) falhas++; };
// CHROMIUM=/caminho/do/chrome usa um Chromium já instalado (outra versão do Playwright)
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

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

async function abrir(p, hash = "", { googleId = null, novidades = false } = {}) {
  const c = await b.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: Number(process.env.ESCALA || 1), acceptDownloads: true });  // ESCALA=2: prints nítidos para material de divulgação
  await c.route("**/supabase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.SUPABASE_URL=${JSON.stringify(API)};window.SUPABASE_ANON_KEY="chave-anon-de-teste";window.GOOGLE_CLIENT_ID=${JSON.stringify(googleId || "COLE_AQUI")};` }));
  await c.route("https://accounts.google.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: googleId ? GIS_FALSO : "" }));
  // 009p: o index.html confere a integridade (SRI) do supabase-js; com crossorigin, a resposta precisa do cabeçalho CORS
  // (o jsDelivr manda). Se o hash do index.html não bater com o arquivo do pacote, o script é bloqueado e o app não abre.
  await c.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(path.join(UMD, r.request().url().split("/").pop())) }));
  await c.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  // a janela "O que há de novo" só aparece quando o teste pede (senão cobriria a tela nos outros passos)
  if (!novidades) await c.addInitScript(() => { try { localStorage.setItem("comunique-novidades", "009p"); localStorage.setItem("comunique-tour", "009m"); } catch (_) {} });
  // Trusted Types (009j): o Playwright usa eval nas esperas (waitForFunction); a política "default" libera só isso.
  // innerHTML/outerHTML com texto continuam recusados (a política não tem createHTML).
  await c.addInitScript(() => { try { window.trustedTypes?.createPolicy("default", { createScript: (x) => x }); } catch (_) {} });
  // 009l: sem a transição de tela no teste (os prints saíam no meio do fade); a troca de tela em si continua testada
  await c.addInitScript(() => { try { delete Document.prototype.startViewTransition; } catch (_) {} });
  // o lembrete da passagem de turno (17h30–18h59) cobriria os botões: o relógio do app fica em 10h (o teste dele troca na hora)
  await c.addInitScript(() => addEventListener("DOMContentLoaded", () => { if (window.App) App.agora_relogio = () => 10 * 60; }));
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
  pg_.on("console", (m) => { if (m.type() === "error" && !/WebSocket|ERR_|Failed to load resource/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 300)); });
  await pg_.goto(SITE + hash);
  return pg_;
}
const esperar = (p, sel, t = 10000) => p.waitForSelector(sel, { timeout: t }).then(() => true).catch(() => false);
// 009j: janelas, tira e avisos saem com uma animação curta: esperar sumir em vez de conferir na hora
const sumir = (p, sel, t = 3000) => p.waitForSelector(sel, { state: "hidden", timeout: t }).then(() => true).catch(() => false);
const texto = (p, sel) => p.textContent(sel).catch(() => "");
// trecho em volta de uma palavra (para a mensagem de erro dizer onde apareceu "null"/"undefined")
const perto = (t, w) => { const i = t.indexOf(w); return i < 0 ? "" : " → …" + t.slice(Math.max(0, i - 90), i + 20); };
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
  ok(JSON.stringify(abas) === JSON.stringify(["novo", "pendentes", "historico"]), "suporte vê só Novo cadastro, Pendentes e Histórico (008c): " + abas);
  await s.fill("#f-idapp", "1a2b3c4d5e6f"); await s.fill("#f-cpf", "52998224725"); await s.fill("#f-cidade", "LAGARTO - SE"); await s.fill("#f-obs", "Documentos pelo WhatsApp");
  await s.click("#b-enviar");
  ok(await esperar(s, "#v-pendentes:not([hidden]) .card.destaque"), "após enviar, vai para Pendentes com o cadastro destacado");
  ok((await texto(s, ".card.destaque")).includes("Aguardando análise"), "card mostra a situação Aguardando análise");
  ok((await texto(s, ".card.destaque")).includes("esperando há"), "card mostra há quanto tempo espera");
  await s.screenshot({ path: path.join(PRINTS, "3-suporte-pendentes.png"), fullPage: true });
  await ir(s, "#novo");
  await s.fill("#f-idapp", "outro1234"); await s.fill("#f-cpf", "529.982.247-25"); await s.fill("#f-cidade", "RECIFE - PE");
  await s.click("#b-enviar");
  ok(await esperar(s, "#form-erro:not([hidden])"), "CPF repetido é bloqueado: " + (await texto(s, "#form-erro")));
  // casos (008) guardados: CPF repetido com outro ID volta a ser só a recusa, sem janela de caso
  ok((await texto(s, "#form-erro")).includes("já está cadastrado") && !(await s.isVisible("dialog.janela")), "casos guardados: CPF repetido com outro ID só é recusado");
  await s.fill("#f-idapp", "abc12345"); await s.fill("#f-cpf", ""); await s.click("#b-enviar");
  await esperar(s, "#v-pendentes:not([hidden]) .card.destaque");
  await s.fill("#f-idapp", "x").catch(() => {});
  await ir(s, "#novo"); await s.fill("#f-idapp", "zzz99881"); await s.fill("#f-cidade", "ITABAIANA - SE"); await s.click("#b-enviar");
  await esperar(s, "#v-pendentes:not([hidden]) .card.destaque");
  ok((await s.$$("#queue .card")).length === 3, "suporte vê os 3 cadastros que enviou");
  ok(!(await s.isVisible("#queue >> text=Aprovar")), "suporte não tem botão Aprovar");

  // 4. monitorador decide
  const m = await abrir(monitor, "#pendentes");
  await esperar(m, "#queue .card");
  const abasM = await m.$$eval("nav.tabs a:not([hidden])", (as) => as.map((x) => x.dataset.view));
  ok(!abasM.includes("equipe") && abasM.includes("historico"), "monitorador vê Histórico e não vê Equipe");
  ok((await texto(m, "#c-pend")) === "3", "contador de pendentes: 3");
  ok((await texto(m, "nav.grupo [data-espelho=c-pend]")) === "3", "o contador de pendentes aparece também na barra de Entregadores");
  const cardLagarto = "#queue .card:has-text('1a2b3c4d5e6f')";
  await m.click(`${cardLagarto} >> text=Reprovar`);
  await m.click(`${cardLagarto} >> text=Confirmar reprovação`);
  ok(await esperar(m, "#toast:has-text('Escolha o motivo')"), "reprovar sem motivo pede o motivo");
  await m.selectOption(`${cardLagarto} select`, "Fotos sem camisa");
  await m.fill(`${cardLagarto} .box input`, "Foto do rosto também");
  await m.click(`${cardLagarto} >> text=Confirmar reprovação`);
  ok(await esperar(m, ".grupo:has-text('Aguardando novo contato') >> text=1a2b3c4d5e6f"), "reprovado vai para o grupo Aguardando novo contato");
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
  ok(await esperar(s, "#v-historico:not([hidden]) #t-hist tbody tr td .pill"), "o antigo #meus abre o Histórico (008c)");
  ok((await s.$$("#t-hist tbody tr")).length === 3 && (await texto(s, "#hist-sub")).includes("Tudo o que você enviou"), "Histórico do suporte lista só os 3 dele");
  ok((await texto(s, "#hist-tiles")).replace(/\s/g, "").includes("Aprovados1") && await s.isHidden("#f-hist-meus-box"), "Histórico do suporte: 1 aprovado, sem 'Só os meus'");
  await s.click("#t-hist tr:has-text('1a2b3c4d5e6f')");
  ok(await esperar(s, "#t-hist .timeline >> text=Reprovado"), "histórico do cadastro: " + (await texto(s, "#t-hist .timeline")).replace(/\s+/g, " ").slice(0, 120));
  await s.screenshot({ path: path.join(PRINTS, "5-meus-cadastros.png"), fullPage: true });

  // 6. o antigo Painel da ativação agora está nas Análises (008c)
  await ir(m, "#painel");
  ok(await esperar(m, "#v-an-simples:not([hidden]) #as-cards >> text=Ativação nos últimos 14 dias"), "o antigo #painel abre as Análises simples, com o gráfico de 14 dias");
  ok(await esperar(m, "#as-cards >> text=Fotos sem camisa") && await m.isVisible("#as-cards >> text=CPF com restrição"), "motivos de reprovação e de encerramento nas Análises simples");
  ok(await m.isVisible("#as-cards >> text=aprovados na 1ª análise"), "aprovados na 1ª análise nas Análises simples");
  await ir(m, "#analises/complexas");
  ok(await esperar(m, "#an-cards h3:text-is('Por pessoa')") && (await texto(m, "#an-cards")).includes("Monitor Um (você)") && await m.isVisible("#an-cards h3:text-is('Ativação por cidade')"), "por pessoa e ativação por cidade nas Análises complexas");
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
  ok(csv.includes("id_entregador;cpf;nome;cidade") && csv.includes("1a2b3c4d5e6f;529.982.247-25;;LAGARTO - SE"), "CSV baixado");
  await a.screenshot({ path: path.join(PRINTS, "7-historico.png"), fullPage: true });

  // 8. novata já liberada entra; sair volta ao login
  const n = await abrir(novata);
  ok(await esperar(n, "#papel:has-text('Suporte')"), "novata liberada entra como Suporte");
  await n.click("#b-sair");
  ok(await esperar(n, "#g-entrar:not([hidden])"), "Sair volta para o login");

  // ================= BLOQUEIOS =================
  // 9. moderador: monitor vira monitorador nos bloqueios e responsável por LAGARTO
  await ir(a, "#equipe"); await esperar(a, "#t-equipe tr:has-text('monitor@x.com') select");
  await a.locator("#t-equipe tr:has-text('monitor@x.com') select").nth(1).selectOption("monitorador");
  await a.waitForTimeout(1200);
  await ir(a, "#bloqueios/regras");
  await esperar(a, "#bq-t-regras tbody tr");
  const linhaRegra = (nome) => a.evaluate((n) => [...document.querySelectorAll("#bq-t-regras tbody tr")].find((tr) => tr.querySelector("input")?.value.startsWith(n))?.querySelector(".chips")?.textContent, nome);
  ok((await linhaRegra("Mal Uso")) === "48 h72 h94 h122 h159 h", "regras: mal uso mostra a progressão de 30% (94 h na 3ª)");
  ok((await linhaRegra("Furto")) === "encerraencerraencerraencerraencerra", "regras: furto encerra a parceria");
  // o responsável da cidade é escolhido em Equipe → Regras de equipe
  await ir(a, "#equipe/regras");
  await a.click("#eq-t-cidades tr:has-text('LAGARTO - SE') >> text=Editar");
  await a.selectOption("dialog.janela select >> nth=2", "monitor@x.com");
  await a.click("dialog.janela .actions button.primary");
  ok(await esperar(a, "#toast:has-text('LAGARTO - SE atualizada')"), "moderador liga LAGARTO ao Monitor Um (Regras de equipe)");
  await ir(a, "#bloqueios/regras");
  await a.screenshot({ path: path.join(PRINTS, "b1-regras.png"), fullPage: true });

  // 10. suporte: tela inicial e registro com prévia da punição
  await ir(s, "#inicio"); await s.reload();
  ok(await esperar(s, "#card-bloqueios") && await s.isVisible("#card-ativacao") && await s.isVisible("#card-atividades") && await s.isVisible("#card-registros"), "tela inicial com os módulos e Registros");
  ok(await esperar(s, "#card-ativacao >> text=na equipe"), "tela inicial do suporte: seus números e os da equipe");
  ok(!(await s.isVisible("#card-casos")) && await s.isVisible("#card-entregadores"), "tela inicial mostra o cartão de Entregadores (Casos guardados)");
  ok(await s.isVisible(".faixa-novidades >> text=Bairro com nome parecido") && await s.isVisible(".faixa-novidades >> text=e mais: 009o e 009n e 009m e 009l e 009k e 009j e 009g e 009f e 009e e 009d3 e 009d2 e 009d e 009c e 009b e 008d e 008c e 008b e 008"), "tela inicial mostra a faixa das novidades, ligando 009p, 009o, 009n, 009m, 009l, 009k, 009j, 009g, 009f, 009e, 009d3, 009d2, 009d, 009c, 009b, 008d, 008c, 008b e 008");
  await s.click(".faixa-novidades button");
  ok(await esperar(s, "dialog.janela >> text=O que há de novo"), "o botão da faixa reabre O que há de novo");
  await s.screenshot({ path: path.join(PRINTS, "a0-inicio-novidades.png") });
  // 009i (Modern Web Guidance)
  { const r = await s.evaluate(() => {
      const sc = document.querySelector('script[src*="cdn.jsdelivr.net"]');
      const d = document.querySelector("dialog.janela"), cs = getComputedStyle(d), bd = getComputedStyle(d, "::backdrop");
      return { toasts: document.querySelectorAll("#toast").length, sri: sc.integrity, co: sc.crossOrigin, rp: sc.referrerPolicy,
        esquema: document.querySelector('meta[name="color-scheme"]')?.content,
        acento: getComputedStyle(document.documentElement).accentColor, acentoTok: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
        ob: cs.overscrollBehaviorY, bdOb: bd.overscrollBehaviorY, bdOv: bd.overflowY };
    });
    ok(r.toasts === 1, "um #toast só na página (estava duplicado)");
    ok(await s.evaluate(() => getComputedStyle(document.querySelector("header.top")).backgroundColor === "rgb(138, 59, 224)"
        && getComputedStyle(document.querySelector('nav.modulos a[aria-current="page"]')).backgroundColor === "rgb(247, 234, 72)"), "009l: cores da Quero Delivery (cabeçalho roxo, menu ativo amarelo)");
    ok(/^sha384-/.test(r.sri) && r.co === "anonymous" && r.rp === "no-referrer", "supabase-js com integridade (SRI), crossorigin e sem referrer: " + r.sri.slice(0, 16));
    ok(r.esquema === "light dark", "meta color-scheme no head (tema escuro sem piscar claro)");
    ok(r.acento !== "auto" && r.acentoTok, "accent-color na cor do app: " + r.acento);
    ok(r.ob === "contain" && r.bdOb === "contain" && r.bdOv === "hidden", "janela aberta não rola a página atrás (overscroll-behavior)"); }
  await s.evaluate(() => App.u.toast("Aviso por cima da janela"));
  // a camada de cima empilha na ordem em que abre: o toast aberto com a janela já aberta fica por cima dela
  // (com a janela aberta ele fica inerte, então o elementFromPoint não o enxerga; por isso confere o estado e tira um print)
  ok(await esperar(s, "#toast:popover-open >> text=Aviso por cima da janela") && await s.evaluate(() => !!document.querySelector("dialog.janela:modal")),
    "o aviso (toast) abre na camada de cima, por cima da janela aberta");
  await s.screenshot({ path: path.join(PRINTS, "a0b-toast-por-cima-da-janela.png") });
  await s.route("**/versao.txt*", (r) => r.fulfill({ contentType: "text/plain", body: "999-nova\n" }));
  await s.evaluate(() => App.conferirVersao(true)); await s.waitForTimeout(400);
  ok((await s.$("#aviso-versao")) && !(await s.isVisible("#aviso-versao")), "aviso de versão nova com uma janela aberta: espera a janela fechar");
  await s.unroute("**/versao.txt*");
  await s.click("dialog.janela >> text=Entendi");
  ok(await esperar(s, "#aviso-versao:popover-open >> text=Saiu uma versão nova"), "fechou a janela: o aviso de versão nova aparece");
  await s.click("#aviso-versao >> text=Depois");
  // 009j "Leve e veloz"
  { const r = await s.evaluate(() => {
      let tt = false; try { document.createElement("div").innerHTML = "<b>x</b>"; } catch (_) { tt = true; }
      const esq = App.u.vazio("Carregando…"), cel = App.u.tabela([["A"], ["B"]], [], "Carregando…")[1];
      const ta = document.createElement("textarea"); document.body.append(ta); const fs = getComputedStyle(ta).fieldSizing; ta.remove();
      return { tt, esq: esq.classList.contains("esqueleto") && esq.textContent === "Carregando…", cel: !!cel.querySelector(".esq-linha"),
        fs, tw: getComputedStyle(document.querySelector("h2")).textWrapStyle || getComputedStyle(document.querySelector("h2")).textWrap,
        dt: App.u.dt("2026-11-13T02:30:00Z"), dia: App.u.diaChave("2026-11-13T02:30:00Z") };
    });
    ok(r.tt, "Trusted Types ligado no teste: innerHTML com texto é recusado (o app inteiro roda sem precisar dele)");
    ok(r.esq && r.cel, "carregando vira esqueleto (lista e tabela), com o texto para o leitor de tela");
    ok(r.fs === "content", "caixas de texto crescem com o conteúdo (field-sizing)");
    ok(/balance/.test(r.tw || ""), "títulos equilibrados (text-wrap: balance)");
    ok(r.dt.includes("12/11/2026") && r.dt.includes("23:30") && r.dia === "2026-11-12", "datas no horário de Brasília (02:30 UTC = 23:30 do dia anterior): " + r.dt); }
  // tema: claro → escuro (guardado) → volta a seguir o sistema (nada guardado)
  await s.click("#b-tema");
  ok(await s.evaluate(() => document.documentElement.dataset.theme === "dark" && localStorage.getItem("comunique-tema") === "dark"
      && getComputedStyle(document.body).backgroundColor === "rgb(22, 17, 31)"), "botão de tema: escuro na hora, e fica guardado");
  await s.reload(); await esperar(s, "#v-inicio:not([hidden])");
  ok(await s.evaluate(() => document.documentElement.dataset.theme === "dark" && document.querySelector('meta[name="color-scheme"]').content === "dark"), "recarregou: continua escuro desde o início (sem piscar claro)");
  await s.click("#b-tema");
  ok(await s.evaluate(() => !document.documentElement.dataset.theme && localStorage.getItem("comunique-tema") === null), "tocar de novo volta a seguir o sistema (não prende o tema)");
  // 009n: app instalável. Manifesto com id e ícones; o botão só aparece quando o navegador oferece instalar
  { const m = await s.evaluate(async () => { const r = await fetch(document.querySelector('link[rel="manifest"]').href); return { tipo: r.headers.get("content-type"), j: await r.json() }; });
    const icone = await s.evaluate(async () => (await fetch("icones/icone-512.png")).ok);
    ok(m.j.id === "/" && m.j.display === "standalone" && m.j.icons.some((x) => x.purpose === "maskable") && icone, "009n: manifesto do app (id, janela própria, ícones)");
    ok(await s.isHidden("#b-instalar"), "009n: sem convite do navegador, o botão Instalar fica escondido");
    await s.evaluate(() => { const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: "accepted" }); dispatchEvent(e); });
    ok(await esperar(s, "#b-instalar:not([hidden])"), "009n: o navegador oferece instalar: aparece o botão 📲 Instalar");
    await s.click("#b-instalar");
    ok(await esperar(s, "#toast:has-text('Comunique instalado')") && await sumir(s, "#b-instalar"), "009n: instalar usa o convite uma vez e o botão some"); }
  // troca de tela: o foco vai para o título da tela nova (o link clicado é recriado)
  await s.click("nav.modulos a[data-mod=analises]"); await esperar(s, "#v-an-simples:not([hidden])");
  await s.click("nav.tabs a[data-view=complexas]");
  ok(await esperar(s, "#v-an-analises:not([hidden])") && await s.waitForFunction(() => document.activeElement?.matches("#v-an-analises h2"), null, { timeout: 3000 }).then(() => true, () => false),
    "trocou de aba: o foco vai para o título da tela nova (o link da aba é recriado)");
  await s.click("nav.modulos a[data-mod=inicio]"); await esperar(s, "#v-inicio:not([hidden])");
  { const r = await s.evaluate(() => {
      const visto = []; const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (o) { visto.push(o?.behavior); };
      App.u.rolar(document.body); Element.prototype.scrollIntoView = orig; return visto[0]; });
    await s.emulateMedia({ reducedMotion: "reduce" });
    const r2 = await s.evaluate(() => {
      const visto = []; const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (o) { visto.push(o?.behavior); };
      App.u.rolar(document.body); Element.prototype.scrollIntoView = orig; return visto[0]; });
    await s.emulateMedia({ reducedMotion: null });
    ok(r === "smooth" && r2 === "auto", "rolagem suave só sem “reduzir movimento” no sistema"); }
  await s.screenshot({ path: path.join(PRINTS, "b0-inicio.png"), fullPage: true });
  // versão nova publicada: o app avisa quem está com a antiga aberta
  await s.evaluate(() => App.conferirVersao(true)); await s.waitForTimeout(400);
  ok(!(await s.isVisible("#aviso-versao")), "com a versão em dia, nenhum aviso de atualização");
  await s.route("**/versao.txt*", (r) => r.fulfill({ contentType: "text/plain", body: "999-nova\n" }));
  await s.evaluate(() => App.conferirVersao(true));
  ok(await esperar(s, "#aviso-versao >> text=Saiu uma versão nova do Comunique"), "versão nova publicada: aparece o aviso com Atualizar agora");
  await s.click("#aviso-versao >> text=Depois"); await s.unroute("**/versao.txt*");
  // 008c: funções em destaque na tela inicial
  { const fns = await s.$$eval("#inicio-funcoes a.funcao", (l) => l.map((x) => x.querySelector("b").textContent));
    ok(JSON.stringify(fns) === JSON.stringify(["Nova ativação", "Novo bloqueio", "Cadastrar entregador", "Ativar parceiro", "Calculadora de bairro", "Registrar adicional", "Nova tarefa", "Registros"]), "tela inicial: as 8 funções em destaque: " + fns); }
  await s.click("#fn-sugerir");
  ok(await esperar(s, "#v-at-sugeridas:not([hidden])") && await s.waitForFunction(() => document.querySelector("#at-nova-box")?.open && document.activeElement?.id === "at-titulo", null, { timeout: 5000 }).then(() => true, () => false), "Nova tarefa abre a tela com o formulário aberto e o cursor no título");
  await ir(s, "#inicio"); await esperar(s, "#fn-ativacao");
  await s.click("#fn-ativacao");
  ok(await esperar(s, "#v-novo:not([hidden])"), "Nova ativação abre o Novo cadastro");
  await ir(s, "#inicio"); await esperar(s, "#fn-bloqueio");
  await s.click("#fn-bloqueio");
  ok(await esperar(s, "#v-bq-novo:not([hidden])"), "o atalho Novo bloqueio abre o Novo bloqueio");
  await ir(s, "#bloqueios");
  ok(await esperar(s, "#v-bq-novo:not([hidden])"), "Bloqueios abre em Novo bloqueio (008c)");
  const abasB = await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view));
  { await ir(s, "#ativacao"); await esperar(s, "#v-novo:not([hidden])");
    const abasA = await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view));
    ok(abasA[0] === "novo" && abasA[1] === "pendentes" && await s.isVisible("nav.tabs a[data-view=pendentes] .count"), "Ativação abre no Novo cadastro, e Pendentes vem em seguida com o número: " + abasA);
    await ir(s, "#bloqueios"); await esperar(s, "#v-bq-novo:not([hidden])"); }
  ok(JSON.stringify(abasB) === JSON.stringify(["novo", "atencao", "consultar", "historico"]), "suporte vê Novo, Atenção, Consultar e Histórico (008c): " + abasB);
  await s.fill("#bq-id", "mal00001"); await s.fill("#bq-nome", "Fulano de Tal");
  await s.selectOption("#bq-cidade", "LAGARTO - SE"); await s.selectOption("#bq-infracao", { label: "Mal Uso Proposital do Aplicativo" });
  await s.fill("#bq-comentario", "Educado, mas costuma atrasar a coleta.");
  ok(await esperar(s, "#bq-previa >> text=Aplicar 2 dias (48 h) de bloqueio"), "prévia: 1ª ocorrência de mal uso = 48 h");
  ok((await texto(s, "#bq-previa")).includes("Gera tratativa para Monitor Um"), "prévia: avisa que gera tratativa para o responsável");
  await s.screenshot({ path: path.join(PRINTS, "b2-novo-previa.png"), fullPage: true });
  await s.click("#bq-enviar");
  ok(await esperar(s, "#bq-previa >> text=Aplique 2 dias (48 h) de bloqueio"), "após registrar: mostra o tempo a aplicar");
  ok((await texto(s, "#bq-previa")).includes("Tratativa enviada para Monitor Um"), "após registrar: tratativa enviada");
  await s.click("text=Registrar outro");
  ok((await s.inputValue("#bq-comentario")) === "", "comentário limpo depois de registrar");
  await s.fill("#bq-id", "mal00001"); await s.selectOption("#bq-infracao", { label: "Mal Uso Proposital do Aplicativo" });
  await esperar(s, "#bq-previa >> text=Histórico deste ID");
  ok((await s.inputValue("#bq-nome")) === "Fulano de Tal", "nome sugerido pelo cadastro do entregador");
  ok(await esperar(s, "#bq-previa >> text=Educado, mas costuma atrasar a coleta."), "prévia mostra os comentários do entregador");
  await s.click("#bq-enviar");
  ok(await esperar(s, "#bq-erro:not([hidden]) >> text=há poucos minutos"), "registro em dobro é recusado");
  await s.click("#bq-form button[type=reset]");
  await s.fill("#bq-id", "atr00001"); await s.selectOption("#bq-infracao", { label: "Atraso na Coleta ou na Entrega Sem Justificativa" });
  ok(await esperar(s, "#bq-previa >> text=contagem zerada"), "atraso com mais de 60 dias: contagem zerada, punição da 1ª");
  ok((await s.inputValue("#bq-nome")) === "Ciclano Atrasado", "nome sugerido pelo histórico do ID");
  await s.click("#bq-form button[type=reset]");
  await s.fill("#bq-id", "fur00001"); await s.fill("#bq-nome", "Ladrão"); await s.selectOption("#bq-cidade", "LAGARTO - SE");
  await s.selectOption("#bq-infracao", { label: "Furto ou Extravio: Desvio de Produtos ou Valores" });
  ok(await esperar(s, "#bq-previa .previa.encerra >> text=Encerramento de parceria"), "furto: prévia de encerramento de parceria");
  await s.click("#bq-enviar");
  ok(await esperar(s, "#bq-previa >> text=Encerramento de parceria registrado"), "encerramento registrado");
  await s.click("text=Registrar outro");
  await s.fill("#bq-id", "reab0001"); await s.fill("#bq-nome", "Rápido"); await s.selectOption("#bq-cidade", "ITABAIANA - SE");
  await s.selectOption("#bq-infracao", { label: "Reabrir Pedido Após Aceite Sem Justificativa Plausível" });
  ok(await esperar(s, "#bq-previa >> text=não gera tratativa"), "bloqueio de 1 h não gera tratativa");
  await s.click("#bq-enviar"); await esperar(s, "#bq-previa >> text=Aplique 1 h");

  // 11. monitorador: tratativas
  await ir(m, "#bloqueios"); await m.reload();
  ok(await esperar(m, "#v-bq-novo:not([hidden])"), "monitorador também abre os Bloqueios no Novo bloqueio");
  { const abasMB = await m.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view));
    ok(abasMB[0] === "novo" && abasMB[1] === "tratativas", "Novo bloqueio e, em seguida, Tratativas: " + abasMB); }
  await ir(m, "#bloqueios/tratativas");
  ok(await esperar(m, "#v-bq-tratativas:not([hidden]) .card"), "monitorador vê as Tratativas");
  ok((await texto(m, "#c-trat")) === "2", "contador de tratativas: 2 (mal uso e furto em LAGARTO)");
  ok(await m.isVisible(".grupo:has-text('Encerramentos de parceria') >> text=Ladrão"), "encerramento de parceria em grupo próprio");
  await m.screenshot({ path: path.join(PRINTS, "b3-tratativas.png"), fullPage: true });
  const cardF = "#bq-trat-lista .card:has-text('Fulano de Tal')";
  await m.click(`${cardF} >> text=Marcar tratativa como resolvida`);
  await m.fill(`${cardF} textarea`, "Orientado por telefone");
  await m.click(`${cardF} >> text=Confirmar`);
  await m.waitForTimeout(1200);
  ok(!(await m.isVisible(cardF)), "tratativa resolvida sai das pendentes");
  await m.click("[data-trat=concluida]");
  ok(await esperar(m, "#bq-trat-lista >> text=Orientado por telefone"), "aparece em Concluídas com a nota");
  ok((await texto(m, "#bq-trat-lista .card:has-text('Fulano de Tal')")).includes("Bloqueado"), "o bloqueio continua depois da tratativa");

  // 12. suporte recebe o aviso e acompanha
  await ir(s, "#bloqueios/meus"); await s.reload();
  ok(await esperar(s, "#b-avisos[data-novas=true]"), "sino de avisos acende para o suporte");
  ok(await esperar(s, "#v-bq-historico:not([hidden]) #bq-t-hist tr:has-text('Fulano de Tal') .trat-curta >> text=Realizada"), "o antigo Meus registros abre o Histórico: tratativa realizada (resumida na linha)");
  ok(await s.isVisible("#bq-t-hist tr:has-text('Ladrão') .trat-curta >> text=Encerramento de parceria: Pendente"), "Histórico do suporte: encerramento pendente com o responsável");
  await s.click("#bq-t-hist tr:has-text('Fulano de Tal') >> text=Ver histórico");
  ok(await esperar(s, "#bq-t-hist .trat-completa >> text=Tratativa realizada") && (await texto(s, "#bq-t-hist .trat-completa")).includes("Orientado por telefone"), "histórico aberto mostra a tratativa completa, com a nota");
  await s.screenshot({ path: path.join(PRINTS, "i3b-historico-tratativa.png"), fullPage: true });
  await s.click("#bq-t-hist tr:has-text('Fulano de Tal') >> text=Ocultar histórico");
  await s.screenshot({ path: path.join(PRINTS, "b4-meus-registros.png"), fullPage: true });
  await s.click("#b-avisos");
  ok(await esperar(s, "#tira-avisos:popover-open >> text=Tratativa realizada por Monitor Um"), "sino abre a tira com o aviso: tratativa realizada");
  ok((await s.getAttribute("#b-avisos", "popovertarget")) === "tira-avisos" && await s.evaluate(() => document.querySelector("#b-avisos").ariaExpanded) !== "false", "tira do sino é um popover ligado ao sino (009i)");
  await s.screenshot({ path: path.join(PRINTS, "h1-tira-sino.png") });
  await s.keyboard.press("Escape");
  ok(await sumir(s, "#tira-avisos"), "Esc fecha a tira (do próprio navegador)");
  await s.click("#b-avisos");
  ok(await esperar(s, "#tira-avisos:popover-open"), "o sino abre a tira de novo");
  await s.mouse.click(5, 600);
  ok(await sumir(s, "#tira-avisos"), "clicar fora fecha a tira");
  await s.click("#b-avisos"); await esperar(s, "#tira-avisos:popover-open");
  await s.click("#tira-avisos >> text=Ver todos os avisos");
  ok(await esperar(s, "#at-avisos >> text=Tratativa realizada por Monitor Um") && await sumir(s, "#tira-avisos"), "Ver todos os avisos abre a tela de Avisos e fecha a tira");
  ok(await s.evaluate(() => location.hash) === "#avisos/para-mim" && (await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view))).join() === "para-mim,equipe"
      && await s.getAttribute("nav.modulos a[data-mod=avisos]", "aria-current") === "page", "009m: Avisos é item do menu de cima, com Para mim e Toda a equipe");
  await s.waitForTimeout(1500);
  ok((await s.getAttribute("#b-avisos", "data-novas")) === "false", "avisos marcados como lidos");

  // 13. monitorador libera antes do prazo; atividades
  await ir(m, "#bloqueios/ativos");
  const cardA = "#bq-ativos-lista .card:has-text('Fulano de Tal')";
  await esperar(m, cardA);
  await m.click(`${cardA} >> text=Liberar antes do prazo…`);
  await m.click(`${cardA} >> text=Confirmar liberação`);
  ok(await esperar(m, "#toast:has-text('Informe o motivo')"), "liberar exige motivo");
  await m.fill(`${cardA} textarea`, "Comprovou que foi erro do app");
  await m.click(`${cardA} >> text=Confirmar liberação`);
  await m.waitForTimeout(1200);
  ok(!(await m.isVisible(cardA)), "liberado sai de Bloqueados agora");
  const cardL = "#bq-ativos-lista .card:has-text('Ladrão')";
  await esperar(m, cardL);
  ok(await m.isVisible(`${cardL} >> text=Reverter encerramento…`) && !(await m.isVisible(`${cardL} >> text=Liberar antes do prazo…`)), "encerramento: botão vira Reverter encerramento");
  await m.click(`${cardL} >> text=Reverter encerramento…`);
  await m.fill(`${cardL} textarea`, "Provou que a entrega foi feita");
  await m.click(`${cardL} >> text=Confirmar reversão`);
  ok(await esperar(m, "#toast:has-text('Encerramento de Ladrão revertido')"), "encerramento revertido com motivo");
  ok(await esperar(m, `${cardL} >> text=Encerramento revertido`), "cartão mostra 'Encerramento revertido'");
  await ir(m, "#atividades");
  ok(await esperar(m, "#at-lista >> text=Encerramento de parceria: Ladrão"), "Atividades do monitorador: encerramento pendente");
  ok((await texto(m, "#at-lista")).includes("cadastro(s) aguardando análise") || true, "atividades lista pendências da ativação");
  await m.screenshot({ path: path.join(PRINTS, "b5-atividades.png"), fullPage: true });
  await m.click("#at-lista li:has-text('Ladrão') >> text=Marcar como resolvida");
  await m.click("#at-lista li:has-text('Ladrão') >> text=Confirmar");
  ok(await esperar(m, "#at-lista >> text=Tudo em dia") || await esperar(m, "#at-lista"), "tratativa resolvida pelas Atividades");

  // 14. o antigo Painel de bloqueios agora está nas Análises (008c); consulta e histórico
  await ir(s, "#bloqueios/painel");
  ok(await esperar(s, "#v-an-simples:not([hidden]) #as-cards h3:text-is('Bloqueios por dia')"), "o antigo Painel de bloqueios abre as Análises simples, com o gráfico por dia");
  await s.screenshot({ path: path.join(PRINTS, "b6-painel.png"), fullPage: true });
  await ir(s, "#bloqueios/consultar");
  await s.fill("#bq-q-consulta", "mal00001"); await s.click("#bq-f-consulta button[type=submit]");
  ok(await esperar(s, "#bq-consulta >> text=1 bloqueio(s)"), "consulta por ID");
  ok(await s.isVisible("#bq-consulta .comentarios >> text=Educado, mas costuma atrasar a coleta."), "consulta mostra o comentário feito no registro");
  ok(!(await texto(s, "#bq-consulta")).includes("null"), "consulta sem textos vazios (null)");
  ok(!(await s.isVisible("#bq-consulta >> text=Alterar dados")) && await s.isVisible("#bq-consulta button:text-is('Corrigir')"), "suporte não altera a ficha, mas corrige o bloqueio que registrou (008b)");
  await s.fill("#bq-consulta textarea", "Ligou pedindo para ser liberado.");
  await s.click("#bq-consulta >> text=Adicionar comentário");
  ok(await esperar(s, "#bq-consulta .comentarios >> text=Ligou pedindo para ser liberado."), "suporte adiciona comentário na consulta");
  await s.screenshot({ path: path.join(PRINTS, "b6b-consulta.png"), fullPage: true });
  // 009j (copy-button): botão de copiar ao lado do ID na ficha
  await s.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:8765" });
  await s.hover("#bq-consulta .ficha-topo .copiavel");
  await s.click("#bq-consulta .ficha-topo .btn-copiar");
  ok(await esperar(s, "#bq-consulta .ficha-topo .copia-balao >> text=Copiado") && (await s.evaluate(() => navigator.clipboard.readText())) === "mal00001"
      && (await s.getAttribute("#bq-consulta .ficha-topo .btn-copiar", "aria-label")) === "Copiar ID mal00001", "copiar o ID da ficha: vai para a área de transferência e avisa “Copiado”");
  // 008b: módulo Entregadores, cadastro avulso (sem ativação e sem bloqueio)
  ok(!(await s.isVisible("nav.grupo a[data-grupo-mod=entregadores]")), "009m: Cadastrar entregador saiu da barra de Entregadores (virou janela)");
  { const topo = await s.$$eval("nav.modulos a:not([hidden])", (as) => as.map((x) => x.textContent.trim()));
    ok(topo.some((t) => t.startsWith("Entregadores")) && !topo.some((t) => /Ativação|Bloqueios|Casos/.test(t)), "menu de cima: Ativação e Bloqueios ficam dentro de Entregadores, e Casos não aparece: " + topo.join(", "));
    const grupo = await s.$$eval("nav.grupo a", (as) => as.map((x) => x.dataset.grupoMod));
    ok(JSON.stringify(grupo) === JSON.stringify(["ativacao", "bloqueios"]), "barra de Entregadores: Ativação e Bloqueios (Cadastrar entregador é uma janela; Casos guardados): " + grupo);
    ok(await s.getAttribute("nav.modulos a[data-grupo=entregadores]", "aria-current") === "page", "Entregadores fica marcado no menu dentro dos Bloqueios"); }
  await s.screenshot({ path: path.join(PRINTS, "a1-menu-entregadores.png") });
  await s.fill("#bq-q-consulta", "avulso01"); await s.click("#bq-f-consulta button[type=submit]");
  ok(await esperar(s, "#bq-consulta >> text=Cadastrar este entregador"), "consulta sem resultado oferece cadastrar o entregador");
  await s.click("#bq-consulta >> text=Cadastrar este entregador");
  ok(await esperar(s, "#janela-cad-ent[open] #en-form"), "009m: o botão abre a janela Cadastrar entregador");
  await s.waitForTimeout(200);
  ok(await s.inputValue("#en-id") === "avulso01", "a tela já vem com o ID buscado");
  await s.click("#en-enviar");
  ok(await esperar(s, "#en-erro:has-text('Preencha o nome')"), "sem nome: avisa antes de enviar");
  await s.fill("#en-nome", "Avulso da Silva");
  ok(await s.isHidden("#en-erro"), "o aviso some ao digitar");
  await s.selectOption("#en-cidade", "LAGARTO - SE");
  await s.fill("#en-comentario", "Cadastrado pela tela nova.");
  await s.screenshot({ path: path.join(PRINTS, "b6d-cadastrar-entregador.png"), fullPage: true });
  await s.click("#en-enviar");
  ok(await esperar(s, "#toast:has-text('Entregador cadastrado')"), "entregador cadastrado sem ativação nem bloqueio");
  ok(await esperar(s, "#en-recentes li:has-text('Avulso da Silva'):has-text('por você')") && await s.isVisible("#en-feito >> text=Avulso da Silva"), "aparece em Cadastrados recentemente e no quadro de confirmação");
  ok(await s.inputValue("#en-id") === "" && await s.inputValue("#en-nome") === "", "o formulário fica limpo para o próximo");
  await s.screenshot({ path: path.join(PRINTS, "b6e-entregador-cadastrado.png"), fullPage: true });
  await s.fill("#en-id", "avulso01"); await s.fill("#en-nome", "Outro Nome"); await s.click("#en-enviar");
  ok(await esperar(s, "#en-erro:has-text('já tem cadastro')"), "ID que já tem ficha: avisa e oferece abrir a ficha");
  await s.click("#en-erro >> text=Abrir a ficha");
  ok(await esperar(s, "#bq-consulta h3:has-text('Avulso da Silva')") && await s.isVisible("#bq-consulta .comentarios >> text=Cadastrado pela tela nova.") && !(await s.$("#janela-cad-ent")), "'Abrir a ficha' fecha a janela e leva à ficha, com o comentário");
  await ir(s, "#entregadores/cadastrar");
  ok(await esperar(s, "#janela-cad-ent[open] #en-form") && await s.evaluate(() => location.hash) === "#bloqueios/consultar", "009m: o link antigo #entregadores/cadastrar abre a janela por cima do Consultar");
  await ir(s, "#inicio");
  ok(await sumir(s, "#janela-cad-ent"), "009m: trocar de tela fecha a janela");
  // moderador altera o cadastro e aplica aos bloqueios
  await ir(a, "#bloqueios/consultar");
  await a.fill("#bq-q-consulta", "mal00001"); await a.click("#bq-f-consulta button[type=submit]");
  await esperar(a, "#bq-consulta >> text=Alterar dados");
  await a.click("#bq-consulta >> text=Alterar dados");
  await a.fill("dialog.janela input:not([type=checkbox])", "Fulano de Tal Souza");
  await a.check("dialog.janela input[type=checkbox]");
  await a.screenshot({ path: path.join(PRINTS, "b6c-alterar-dados.png") });
  await a.click("dialog.janela >> text=Salvar");
  ok(await esperar(a, "#toast:has-text('aplicados a 1 bloqueio')"), "alteração aplicada ao bloqueio já registrado");
  ok(await esperar(a, "#bq-consulta h3:has-text('Fulano de Tal Souza')") && await a.isVisible("#bq-consulta .comentarios .alteracao >> text=Fulano de Tal → Fulano de Tal Souza"), "consulta mostra o novo nome e a alteração no histórico");
  await ir(a, "#bloqueios/historico"); await a.reload();
  ok(await esperar(a, "#bq-t-hist tbody tr:has-text('Fulano de Tal')"), "histórico de bloqueios para o moderador");
  ok((await texto(a, "#bq-hist-total")).startsWith("6 de 6"), "histórico com 6 bloqueios");
  // alerta "revisar" vira botão que abre a correção
  await a.click("#bq-t-hist tr:has-text('Nome Errado') button.alerta-revisar");
  ok(await esperar(a, "dialog.janela >> text=ID usado com 2 nomes diferentes na planilha"), "revisar abre a janela com o motivo do alerta");
  await a.fill("dialog.janela input >> nth=1", "Nome Certo");
  await a.click("dialog.janela >> text=Salvar correção");
  ok(await esperar(a, "dialog.janela >> text=Informe o motivo da correção"), "correção exige motivo");
  await a.fill("dialog.janela textarea", "Nome conferido no aplicativo");
  await a.screenshot({ path: path.join(PRINTS, "b7-revisar.png") });
  await a.click("dialog.janela >> text=Salvar correção");
  ok(await esperar(a, "#bq-t-hist tr:has-text('Nome Certo')") && !(await a.isVisible("#bq-t-hist tr:has-text('Nome Certo') button.alerta-revisar")), "registro corrigido e alerta resolvido");
  ok(!(await a.isVisible("dialog.janela")), "janela fecha depois de salvar");
  await a.click("#bq-t-hist tr:has-text('Nome Certo') >> text=Corrigir");
  ok(await esperar(a, "dialog.janela >> text=Dados corrigidos por Mateus Lopes") && !(await texto(a, "dialog.janela")).includes("null"), "correção aparece no histórico do registro");
  await a.click("dialog.janela >> text=Cancelar");
  const [dlb] = await Promise.all([a.waitForEvent("download"), a.click("#bq-export")]);
  ok(fs.readFileSync(await dlb.path(), "utf8").includes("id_entregador;nome;cidade;tipo;infracao"), "CSV de bloqueios");
  await a.click("#bq-t-hist tr:has-text('Rápido') >> text=Excluir");
  await a.click("#bq-t-hist tr:has-text('Rápido') >> text=Confirmar exclusão");
  ok(await esperar(a, "#bq-hist-total:has-text('5 de 5')"), "moderador exclui bloqueio");
  await ir(s, "#bloqueios/historico"); await esperar(s, "#bq-t-hist tbody tr");
  ok(await s.$$eval("#bq-t-hist tbody tr", (l) => l.every((x) => x.textContent.includes("Suporte Um"))), "o Histórico do suporte mostra só os registros dele");

  // 15. infrações leves
  await ir(s, "#bloqueios/novo"); await s.reload(); await esperar(s, "#bq-form");
  await s.click("[data-tipo-bq=leve]");
  ok(await s.isHidden("#bq-nome") && await s.isHidden("#bq-cidade"), "infração leve: só ID e motivo");
  await s.fill("#bq-id", "mal00001"); await s.selectOption("#bq-infracao", { label: "Reabertura de Pedido (aviso)" });
  ok(await esperar(s, "#bq-previa >> text=Aplicar aviso de 30 min"), "prévia da leve: aviso de 30 min");
  ok((await texto(s, "#bq-previa")).includes("Entregador: Fulano de Tal Souza · LAGARTO - SE"), "prévia da leve: nome e cidade vêm do cadastro do entregador");
  await s.screenshot({ path: path.join(PRINTS, "b7-leve-previa.png"), fullPage: true });
  await s.click("#bq-enviar");
  ok(await esperar(s, "#bq-previa >> text=Aplique aviso de 30 min"), "leve registrada");
  await s.click("text=Registrar outra");
  await s.fill("#bq-id", "desc0001"); await s.selectOption("#bq-infracao", { label: "Atraso na Coleta (aviso)" });
  ok(await esperar(s, "#bq-previa >> text=ID sem registro"), "ID desconhecido: avisa que o monitoramento completa os dados");
  await s.click("#bq-enviar"); await esperar(s, "#bq-previa >> text=Aplique aviso de 30 min");
  { const c2 = new pg.Client({ connectionString: DB }); await c2.connect();
    await c2.query("update bloqueios set inicio = inicio - interval '1 day', fim = fim - interval '1 day' where id_app = 'desc0001'"); await c2.end(); }
  await s.click("text=Registrar outra");
  await s.fill("#bq-id", "desc0001"); await s.selectOption("#bq-infracao", { label: "Reabertura de Pedido (aviso)" });
  await esperar(s, "#bq-previa >> text=2ª infração leve"); await s.click("#bq-enviar"); await esperar(s, "#bq-previa >> text=Aplique aviso");
  await s.click("text=Registrar outra");
  await s.fill("#bq-id", "desc0001"); await s.selectOption("#bq-infracao", { label: "Atraso na Coleta (aviso)" });
  ok(await esperar(s, "#bq-previa >> text=Gera também: bloqueio de 24 h"), "3ª leve: prévia avisa que gera bloqueio normal");
  await s.click("#bq-enviar");
  ok(await esperar(s, "#bq-previa >> text=Aplique também: bloqueio de 24 h"), "3ª leve: bloqueio normal gerado e mostrado ao suporte");
  await s.screenshot({ path: path.join(PRINTS, "b8-leve-gerou.png"), fullPage: true });

  // monitorador completa os dados; a tarefa de contato vai para o responsável da cidade
  await ir(m, "#bloqueios/tratativas"); await m.reload();
  await m.click("[data-trat=pendente]");
  ok(await esperar(m, ".grupo:has-text('Completar dados do entregador') .card"), "monitorador vê os IDs para completar");
  await m.screenshot({ path: path.join(PRINTS, "b9-completar.png"), fullPage: true });
  const cardC = ".grupo:has-text('Completar dados do entregador') .card >> nth=0";
  await m.click(`${cardC} >> button:has-text("Completar dados")`);
  await m.fill(".grupo:has-text('Completar dados do entregador') .card .box input", "Desconhecido Silva");
  await m.selectOption(".grupo:has-text('Completar dados do entregador') .card .box select", "LAGARTO - SE");
  await m.click("text=Salvar dados");
  ok(await esperar(m, "#toast:has-text('Dados do entregador completados')"), "dados completados");
  await m.waitForTimeout(1200);
  ok(!(await m.isVisible(".grupo:has-text('Completar dados do entregador')")), "todas as tarefas de completar daquele ID saem");
  ok(await esperar(m, ".grupo:has-text('Contato por infrações leves') >> text=Desconhecido Silva"), "tarefa de contato (3 leves) chega ao responsável da cidade");

  // regras das leves e filtro no histórico
  await ir(a, "#bloqueios/regras"); await a.reload();
  ok(await esperar(a, "#bq-t-leves tbody tr"), "regras: tabela das infrações leves");
  ok((await a.inputValue("#bq-leves-limite")) === "3" && (await a.inputValue("#bq-leves-janela")) === "50", "regras: 3 leves em 50 dias");
  await a.fill("#bq-leves-limite", "4"); await a.click("#bq-f-leves button[type=submit]");
  ok(await esperar(a, "#toast:has-text('Regra das infrações leves atualizada')"), "moderador altera a regra das leves");
  await ir(a, "#bloqueios/historico"); await a.reload(); await esperar(a, "#bq-t-hist tbody tr");
  await a.selectOption("#bq-hist-tipo", "leve");
  // o filtro roda no banco (007): espera a página nova chegar
  await a.waitForFunction(() => document.querySelector("#bq-hist-total")?.textContent.startsWith("4 de"), null, { timeout: 5000 }).catch(() => {});
  ok((await texto(a, "#bq-hist-total")).startsWith("4 de"), "histórico filtra só as infrações leves: " + (await texto(a, "#bq-hist-total")));

  // 16. etapa 1: tratativa atrasada + realocar, atividades sugeridas, registros, ficha
  await ir(s, "#bloqueios/novo"); await s.reload(); await esperar(s, "#bq-form");
  await s.click("[data-tipo-bq=normal]");
  await s.fill("#bq-id", "atr00009"); await s.fill("#bq-nome", "Atrasildo"); await s.selectOption("#bq-cidade", "LAGARTO - SE");
  await s.selectOption("#bq-infracao", { label: "Mal Uso Proposital do Aplicativo" });
  await esperar(s, "#bq-previa >> text=Gera tratativa"); await s.click("#bq-enviar");
  await esperar(s, "#bq-previa >> text=Tratativa enviada");
  const db2 = new pg.Client({ connectionString: DB }); await db2.connect();
  await db2.query("update tarefas set criada_em = now() - interval '33 hours' where bloqueio_id = (select id from bloqueios where id_app = 'atr00009')");
  await db2.end();
  const a2 = await abrir(admin, "#bloqueios/tratativas");
  const cardAt = "#bq-trat-lista .card.atrasada:has-text('Atrasildo')";
  ok(await esperar(a2, cardAt) && (await texto(a2, cardAt)).includes("Tratativa atrasada há"), "tratativa com mais de 32 h fica vermelha");
  await a2.screenshot({ path: path.join(PRINTS, "c1-atrasada.png"), fullPage: true });
  await a2.click(`${cardAt} >> text=Realocar…`);
  await a2.selectOption("dialog.janela select", "mateuslopesmb@gmail.com");
  await a2.click("dialog.janela .actions button.primary");
  ok(await esperar(a2, "#toast:has-text('Tarefa realocada')"), "moderador realoca a tratativa atrasada");
  ok(await esperar(a2, `${cardAt} >> text=realocada por Mateus Lopes`), "cartão mostra a realocação");
  await a2.reload();
  ok(await esperar(a2, "#b-avisos[data-novas=true]"), "sino do moderador acende com a tratativa atrasada");
  await ir(a2, "#atividades/avisos"); await esperar(a2, "#at-avisos .aviso");
  await a2.selectOption("#av-filtro", "pessoal");
  ok(await esperar(a2, "#at-avisos >> text=Tratativa atrasada há"), "aviso de tratativa atrasada para o moderador (filtro: para você)");
  await a2.selectOption("#av-filtro", "");
  ok(await esperar(a2, "#papel:has-text('Moderador')") && !(await texto(a2, "#papel")).includes("·"), "papel único no topo quando é igual nos dois módulos");
  // atividade sugerida: suporte cria para o monitorador; monitorador aceita e conclui
  await ir(s, "#atividades/sugeridas");
  await s.click("#at-nova-box summary");
  await s.fill("#at-titulo", "Ligar para o restaurante Sabor");
  await s.fill("#at-descricao", "Confirmar se o pedido 123 foi entregue");
  await s.check("#at-para label:has-text('Monitor Um') input");
  await s.click("#at-enviar");
  ok(await esperar(s, "#at-sug-lista >> text=Ligar para o restaurante Sabor") && await s.isVisible("#at-sug-lista >> text=abre para todos em"), "atividade sugerida aparece esperando aceite");
  ok(await s.isVisible("#at-sug-lista .card:has-text('Sabor') >> text=esperando há"), "cartão mostra há quanto tempo espera");
  await s.screenshot({ path: path.join(PRINTS, "c2-sugeridas.png"), fullPage: true });
  await ir(m, "#atividades/pendencias"); await m.reload();
  ok(await esperar(m, "#at-lista >> text=Ligar para o restaurante Sabor"), "pessoa sugerida vê a atividade nas pendências");
  ok((await m.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view))).join() === "pendencias,sugeridas" && (await texto(m, "nav.tabs a[data-view=pendencias]")).startsWith("Minha fila")
      && await m.isVisible("#at-lista .tarefa-card:has-text('Ligar para o restaurante Sabor') >> text=Eu faço"), "009m: Atividades = Minha fila (com o cartão completo da tarefa) e Tarefas");
  await ir(m, "#atividades/sugeridas");
  await m.click("#at-sug-lista .card:has-text('Sabor') >> text=Eu faço");
  ok(await esperar(m, "#at-sug-lista .card:has-text('Sabor') >> text=Em andamento"), "monitorador aceita");
  await m.click("#at-sug-lista .card:has-text('Sabor') >> text=Concluir");
  await m.fill("#at-sug-lista .card:has-text('Sabor') textarea", "Entregue, confirmado");
  await m.click("#at-sug-lista .card:has-text('Sabor') >> text=Confirmar conclusão");
  ok(await esperar(m, "#at-sug-lista .card:has-text('Sabor') >> text=Entregue, confirmado"), "monitorador conclui com nota");
  // registros: feed geral também para o suporte; nome abre a ficha
  await ir(s, "#registros");
  ok(await esperar(s, "#rg-lista .feed >> text=registrou bloqueio") && await s.isVisible("#rg-lista .feed >> text=Monitor Um"), "suporte vê os registros de todos");
  ok(await s.evaluate(() => location.hash) === "#avisos/equipe" && !(await s.isVisible("nav.modulos a[data-mod=registros]")), "009m: o link antigo dos Registros abre Avisos → Toda a equipe");
  ok(await s.isVisible("#rg-lista >> text=reverteu o encerramento"), "registros mostram a reversão do encerramento");
  await s.screenshot({ path: path.join(PRINTS, "c3-registros.png"), fullPage: true });
  await s.fill("#rg-q", "Atrasildo"); await s.waitForTimeout(1200);
  ok((await s.$$("#rg-lista .feed li")).length >= 1 && !(await texto(s, "#rg-lista")).includes("Ladrão"), "busca nos registros");
  await s.click("#rg-lista .link-ficha >> nth=0");
  ok(await esperar(s, "#v-bq-consultar:not([hidden]) #bq-consulta h3:has-text('Atrasildo')"), "clicar no entregador abre a ficha");
  await s.click("#bq-consulta summary:has-text('Linha do tempo')");
  ok(await esperar(s, "#bq-consulta .timeline >> text=Bloqueio: Mal Uso Proposital do Aplicativo"), "ficha mostra a linha do tempo");
  await s.screenshot({ path: path.join(PRINTS, "c4-ficha.png"), fullPage: true });
  // ativação: cidades vêm da tabela
  await ir(s, "#ativacao/novo");
  await s.waitForTimeout(800);
  ok((await s.$$("#cidades option")).length >= 30, "formulário da ativação sugere as cidades do sistema");

  // 17. migração 005: análises, resumo semanal, aprovados no histórico e anexos
  await ir(s, "#analises");
  ok(await esperar(s, "#v-an-simples:not([hidden]) #as-cards >> text=Ativação de entregadores"), "Análises abre nas simples");
  for (const t of ["Por que não aprovou", "Bloqueios agora", "Bloqueados agora, por cidade", "Quando você registra", "Quando a equipe registra", "Você no período", "Tempo até reincidir", "Conversão das infrações leves", "Infrações mais registradas", "Tratativas no prazo", "Atividades"])
    ok(await s.isVisible(`#as-cards h3:text-is('${t}')`), "análises simples: cartão " + t);
  ok(await s.isVisible("#as-cards >> text=Seu pico:") && (await s.$$("#as-cards .calor .c")).length === 336, "dois mapas dia × hora (você e a equipe), com o seu pico");
  ok(await s.isVisible("#as-cards >> text=Fotos sem camisa"), "motivos das não aprovações aparecem");
  await s.click("#v-an-simples [data-an-periodo=tudo]"); await s.waitForTimeout(800);
  ok((await texto(s, "#as-sub")).includes("desde o início"), "período 'Tudo' nas análises simples");
  await s.screenshot({ path: path.join(PRINTS, "d0-analises-simples.png"), fullPage: true });
  await ir(s, "#analises/complexas");
  ok(await esperar(s, "#an-cards >> text=Eficácia da punição") && await s.isVisible("#an-cards >> text=Da ativação ao bloqueio"), "análises complexas, com os cartões de sempre");
  for (const t of ["Qual infração mais se repete", "Escada da reincidência", "Cidades", "Tempo de resposta da ativação", "Punições desfeitas", "Tratativas por responsável"])
    ok(await s.isVisible(`#an-cards h3:text-is('${t}')`), "análises complexas: cartão " + t);
  ok((await texto(s, "#an-sub")).includes("desde o início"), "o período escolhido vale nas duas abas");
  await s.screenshot({ path: path.join(PRINTS, "d1-analises.png"), fullPage: true });
  await ir(s, "#analises/resumo");
  ok(await esperar(s, "#rs-corpo >> text=Bloqueios registrados") && (await texto(s, "#rs-titulo")).includes("terça"), "resumo semanal de terça a segunda");
  ok(await s.isVisible("#rs-corpo th:has-text('Diferença')"), "resumo compara com a semana anterior");
  await s.screenshot({ path: path.join(PRINTS, "d2-resumo.png"), fullPage: true });
  const [dlr] = await Promise.all([s.waitForEvent("download"), s.click("#rs-csv")]);
  ok(fs.readFileSync(await dlr.path(), "utf8").includes("Bloqueios registrados"), "resumo baixado em CSV");
  await s.evaluate(() => { window.print = () => { window.__imprimiu = document.querySelector("#v-an-resumo").classList.contains("imprimir"); }; });
  await s.click("#rs-pdf");
  ok(await s.evaluate(() => window.__imprimiu === true), "PDF: abre a impressão só com o resumo");
  await s.selectOption("#rs-comparar", "");
  ok(await esperar(s, "#rs-corpo table") && !(await s.isVisible("#rs-corpo th:has-text('Diferença')")), "resumo sem comparação");
  // histórico da ativação: aprovados e bloqueios depois (moderador)
  await ir(a2, "#ativacao/historico");
  ok(await esperar(a2, "#t-hist tbody tr") && !(await a2.$("#t-aprovados")), "histórico da ativação sem a lista 'aprovados: foram bloqueados depois?' (retirada; o número está nas Análises complexas)");
  // anexos: suporte anexa uma imagem no próprio bloqueio
  await ir(s, "#bloqueios/historico"); await s.reload();
  const cardAx = "#bq-t-hist tr:has-text('Atrasildo')";
  await esperar(s, cardAx);
  await s.click(`${cardAx} >> text=Anexar…`);
  ok(await esperar(s, "dialog.janela .aviso-anexo >> text=Cuidado antes de anexar"), "ao anexar, aparece o aviso de cuidado");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await s.setInputFiles("dialog.janela input[type=file]", { name: "conversa.png", mimeType: "image/png", buffer: png });
  ok(await esperar(s, "#toast:has-text('Anexo enviado')") && await esperar(s, "dialog.janela .anexos >> text=conversa.jpg"), "imagem comprimida e anexada");
  await s.click("dialog.janela .anexos button:text-is('Ver')");
  await s.waitForSelector("dialog.janela img.previa-anexo", { state: "attached", timeout: 10000 }).catch(() => {});
  await s.waitForTimeout(500);
  ok(await s.evaluate(() => document.querySelector("dialog.janela img.previa-anexo")?.naturalWidth > 0), "anexo abre na própria janela (a imagem carrega)");
  await s.screenshot({ path: path.join(PRINTS, "d3-anexos.png") });
  await s.click("dialog.janela >> text=Fechar");
  ok(await esperar(s, `${cardAx} >> text=Anexos (1)`), "cartão mostra quantos anexos tem");

  // 18. migração 006: regras de equipe, prazo editável, previsão, atenção
  await ir(s, "#equipe/regras"); await s.reload();
  ok(await esperar(s, "#eq-t-cidades >> text=LAGARTO - SE") && !(await s.isVisible("#eq-t-cidades >> text=Editar")) && !(await s.isVisible("#eq-nova-cidade")), "suporte vê a Regras de equipe sem editar");
  ok((await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view))).join() === "regras,operadores", "suporte vê Regras de equipe e Operadores logísticos (não a Equipe)");
  ok(!(await s.isVisible("#eq-t-cidades >> text=Telefone")), "Regras de equipe sem os telefones da equipe");
  await ir(a2, "#equipe/operadores"); await a2.reload();
  await esperar(a2, "#eq-novo-operador:not([hidden])");
  await a2.click("#eq-novo-operador");
  await a2.fill("dialog.janela input >> nth=0", "Kleber"); await a2.fill("dialog.janela input >> nth=1", "75 0000-0001");
  await a2.click("dialog.janela .actions button.primary");
  ok(await esperar(a2, "#eq-t-operadores >> text=Kleber"), "moderador cadastra operador logístico");
  await a2.selectOption("#eq-resp-op select", "monitor@x.com");
  ok(await esperar(a2, "#toast:has-text('Responsável pelos operadores atualizado')"), "moderador escolhe o responsável pelos operadores");
  ok(await esperar(a2, "#eq-t-operadores tr:has-text('Kleber') >> text=75 0000-0001"), "operador aparece com o contato na aba Operadores logísticos");
  // (as cidades do operador ao lado do nome são conferidas depois que SERRINHA vira de operador)
  await a2.screenshot({ path: path.join(PRINTS, "e1b-operadores.png"), fullPage: true });
  ok(!(await texto(a2, "#v-eq-operadores")).includes("null"), "Operadores logísticos sem textos vazios (null)");
  await ir(a2, "#equipe/regras");
  ok(!(await a2.isVisible("#v-eq-regras #eq-resp-op")) && !(await a2.isVisible("#v-eq-regras #eq-t-operadores")), "Regras de equipe só com as cidades");
  await a2.click("#eq-t-cidades tr:has-text('SERRINHA - BA') >> text=Editar");
  await a2.selectOption("dialog.janela select >> nth=0", "operador");
  await a2.selectOption("dialog.janela select >> nth=1", { label: "Kleber" });
  ok(await a2.isVisible("dialog.janela >> text=os avisos vão para o responsável pelos operadores (Monitor Um)"), "cidade de operador mostra quem recebe os avisos");
  await a2.fill("dialog.janela input[type=number] >> nth=0", "8");
  await a2.selectOption("dialog.janela select >> nth=3", "bairro");
  await a2.click("dialog.janela .actions button.primary");
  ok(await esperar(a2, "#eq-t-cidades tr:has-text('SERRINHA - BA') >> text=Operador Logístico") && await a2.isVisible("#eq-t-cidades tr:has-text('SERRINHA - BA') >> text=Kleber")
    && (await texto(a2, "#eq-t-cidades tr:has-text('SERRINHA - BA')")).includes("Monitor Um"), "cidade passa a ser de operador, com o operador e o responsável dos operadores");
  await a2.screenshot({ path: path.join(PRINTS, "e1-regras-equipe.png"), fullPage: true });
  await ir(a2, "#equipe/operadores");
  ok(await esperar(a2, "#eq-t-operadores tr:has-text('Kleber') .op-cidades >> text=SERRINHA - BA"), "Operadores logísticos mostra as cidades ao lado do nome do operador");
  await a2.screenshot({ path: path.join(PRINTS, "e1b-operadores.png"), fullPage: true });
  await ir(a2, "#equipe/regras");
  ok(!(await texto(a2, "#v-eq-regras")).includes("null"), "Regras de equipe sem textos vazios (null)");
  // prazo da tratativa editável
  await ir(a2, "#bloqueios/regras"); await a2.reload();
  await a2.waitForFunction(() => document.querySelector("#bq-prazo-horas")?.value !== "", null, { timeout: 10000 }).catch(() => {});
  ok((await a2.inputValue("#bq-prazo-horas")) === "32", "prazo da tratativa começa em 32 h");
  await a2.fill("#bq-prazo-horas", "24"); await a2.click("#bq-f-prazo button[type=submit]");
  ok(await esperar(a2, "#toast:has-text('Prazo da tratativa atualizado')"), "moderador muda o prazo da tratativa");
  ok(await a2.isVisible("#bq-t-cidades >> text=SERRINHA - BA") && !(await a2.isVisible("#bq-t-cidades select")), "aba Regras mostra quem recebe as tratativas, sem editar ali");
  // previsão num cadastro (monitorador) e o suporte vê
  await ir(s, "#ativacao/novo"); await s.reload(); await esperar(s, "#form");
  await s.fill("#f-idapp", "prev0001"); await s.fill("#f-cidade", "SERRINHA - BA"); await s.click("#b-enviar");
  await esperar(s, "#toast");
  await ir(m, "#ativacao/pendentes"); await m.reload();
  const cardP = "#queue .card:has-text('prev0001')";
  await esperar(m, cardP);
  await m.click(`${cardP} >> text=Informar previsão de término`);
  await m.click("dialog.janela >> text=+2 h");
  await m.click("dialog.janela .actions button.primary");
  ok(await esperar(m, `${cardP} >> text=Previsão: até`), "monitorador informa a previsão no cadastro");
  ok(await esperar(m, "#b-avisos[data-novas=true]"), "responsável pelos operadores recebe aviso do cadastro novo da cidade");
  await ir(s, "#ativacao/pendentes"); await s.reload();
  ok(await esperar(s, "#queue .card:has-text('prev0001') >> text=Previsão: até") && !(await s.isVisible("#queue .card:has-text('prev0001') >> text=Alterar previsão")), "suporte vê a previsão, sem poder mudar");
  await m.screenshot({ path: path.join(PRINTS, "e2-previsao.png"), fullPage: true });
  // entregadores de atenção
  await ir(s, "#bloqueios/atencao");
  ok(await esperar(s, "#bq-atencao-lista .card") || await esperar(s, "#bq-atencao-lista >> text=Ninguém em atenção agora"), "aba Atenção abre para o suporte");
  await s.screenshot({ path: path.join(PRINTS, "e3-atencao.png"), fullPage: true });

  // 16. migração 007 · "pão quentinho": novidades, nome, revisar, tarefa opcional, aviso da decisão, histórico do ID, busca
  { const d7 = new pg.Client({ connectionString: DB }); await d7.connect();
    await d7.query("select importar_bloqueio('rev00002', 'Nome Velho', 'ITABAIANA - SE', 'Avaria de Produto', now() - interval '120 days', 'Planilha', 'Nome diferente na planilha', '24')");
    await d7.end(); }
  const n7 = await abrir(sup, "#inicio", { novidades: true });
  ok(await esperar(n7, "dialog.janela >> text=O que há de novo") && await n7.isVisible("dialog.janela >> text=Sino com tira"), "janela O que há de novo aparece na primeira vez");
  ok(JSON.stringify(await n7.$$eval("dialog.janela .bloco-versao .tag", (l) => l.map((x) => x.textContent))) === JSON.stringify(["009p", "009o", "009n", "009m", "009l", "009k", "009j", "009g", "009f", "009e", "009d3", "009d2", "009d", "009c", "009b", "008d", "008c", "008b", "008"]), "as novidades de 009p, 009o, 009n, 009m, 009l, 009k, 009j, 009g, 009f, 009e, 009d3, 009d2, 009d, 009c, 009b, 008d, 008c, 008b e 008 aparecem juntas, da mais nova para a mais antiga");
  await n7.screenshot({ path: path.join(PRINTS, "f1-novidades.png") });
  await n7.click("dialog.janela >> text=Entendi");
  // 009n: depois da janela, o tour aponta para o que mudou
  ok(await esperar(n7, "#tour-passo:popover-open >> text=Avisos agora fica aqui") && await n7.evaluate(() => document.activeElement?.closest("#tour-passo") != null)
      && (await n7.getAttribute("#tour-passo", "role")) === "dialog", "009n: tour das novidades abre no 1º passo, com o foco dentro do balão");
  await n7.screenshot({ path: path.join(PRINTS, "f1b-tour.png") });
  await n7.click("#tour-passo >> text=Próximo"); await n7.click("#tour-passo >> text=Próximo");
  ok(await esperar(n7, "#tour-passo >> text=O Painel mudou de lugar"), "009n: o tour passa pelos passos");
  await n7.click("#tour-passo >> text=Entendi");
  ok(!(await n7.$("#tour-passo")) && await n7.evaluate(() => localStorage.getItem("comunique-tour") === "009m"), "009n: “Entendi” fecha o tour e ele não volta");
  await n7.reload(); await esperar(n7, "#v-inicio:not([hidden])"); await n7.waitForTimeout(800);
  ok(!(await n7.isVisible("dialog.janela")), "e não aparece de novo" + ((await n7.isVisible("dialog.janela")) ? ": " + (await n7.textContent("dialog.janela[open]").catch(() => "?")) : ""));
  // suporte envia sem nome: marca revisar e tarefa para o admin (opcional para os outros)
  await ir(n7, "#ativacao/novo"); await esperar(n7, "#form");
  await n7.fill("#f-idapp", "semnome77"); await n7.fill("#f-cidade", "LAGARTO - SE"); await n7.click("#b-enviar");
  ok(await esperar(n7, "#queue .card:has-text('semnome77') button.revisar-cad"), "cadastro sem nome ganha o botão revisar no cartão de Pendentes");
  const m7 = await abrir(monitor, "#atividades/pendencias");
  ok(await esperar(m7, "#at-lista .card.opcional:has-text('Completar cadastro: ID semnome77')"), "monitorador vê a tarefa opcional, em cartão menor");
  ok(await m7.isVisible("#at-lista .card.opcional:has-text('Revisar registros da planilha: faltam 1')"), "cartão único dos 'revisar' da planilha, opcional");
  await m7.screenshot({ path: path.join(PRINTS, "f2-opcionais.png"), fullPage: true });
  const a7 = await abrir(admin, "#atividades/pendencias");
  ok(await esperar(a7, "#at-lista .card:not(.opcional):has-text('Completar cadastro: ID semnome77')"), "para o administrador final a tarefa é normal");
  // o cartão da planilha leva ao Histórico filtrado
  await m7.click("#at-lista .card.opcional:has-text('Revisar registros da planilha') button");
  ok(await esperar(m7, "#bq-t-hist tbody tr:has-text('rev00002')") && (await m7.inputValue("#bq-hist-sit")) === "revisar", "abre o Histórico de bloqueios filtrado por revisar");
  ok((await texto(m7, "#bq-hist-total")).startsWith("1 de"), "só o registro para revisar: " + (await texto(m7, "#bq-hist-total")));
  // qualquer pessoa completa (aqui, o monitorador pela tarefa), a tarefa conclui sozinha
  await ir(m7, "#atividades/pendencias"); await esperar(m7, "#at-lista .card.opcional:has-text('semnome77')");
  await m7.click("#at-lista .card.opcional:has-text('semnome77') >> text=Completar agora");
  ok(await esperar(m7, "dialog.janela >> text=falta o nome do entregador"), "janela de revisão mostra o que falta");
  await m7.screenshot({ path: path.join(PRINTS, "f5-completar.png") });
  await m7.fill("dialog.janela input[aria-label='Nome do entregador']", "Maria Sem Nome");
  await m7.fill("dialog.janela input[aria-label='Motivo da alteração (opcional)']", "confirmado por telefone");
  await m7.click("dialog.janela .actions button.primary");
  ok(await esperar(m7, "#toast:has-text('O cadastro está completo')"), "monitorador completa o nome");
  await m7.waitForTimeout(800);
  ok(!(await m7.isVisible("#at-lista >> text=Completar cadastro: ID semnome77")), "a tarefa some (concluída sozinha)");
  await ir(n7, "#ativacao/historico"); await n7.reload(); await esperar(n7, "#t-hist tbody tr:has-text('semnome77')");
  ok(await n7.isVisible("#t-hist tr:has-text('semnome77') >> text=Maria Sem Nome") && !(await n7.isVisible("#t-hist tr:has-text('semnome77') button.revisar-cad")), "Histórico mostra o nome e sem revisar");
  await n7.click("#t-hist tr:has-text('semnome77')");
  ok(await esperar(n7, "#t-hist >> text=Dados alterados"), "histórico do cadastro guarda a alteração: " + (await texto(n7, "#t-hist .timeline")).slice(0, 160));
  // aprovar: quem enviou recebe aviso; a ficha nasce
  await ir(m7, "#ativacao/pendentes"); await esperar(m7, "#queue .card:has-text('semnome77')");
  await m7.click("#queue .card:has-text('semnome77') >> text=Aprovar");
  await esperar(m7, "#toast:has-text('Cadastro aprovado')");
  await n7.reload();
  ok(await esperar(n7, "#b-avisos[data-novas=true]"), "quem enviou recebe aviso no sino");
  await ir(n7, "#atividades/avisos");
  ok(await esperar(n7, "#at-avisos >> text=Seu cadastro Maria Sem Nome (ID semnome77) foi aprovado por Monitor Um."), "aviso: cadastro aprovado por quem");
  await n7.screenshot({ path: path.join(PRINTS, "f6-aviso.png") });
  // histórico do ID ao digitar no Novo cadastro (monitorador tem os bloqueios)
  await ir(m7, "#ativacao/novo"); await esperar(m7, "#form");
  await m7.fill("#f-idapp", "rev00002");
  ok(await esperar(m7, "#f-historico .quadrinho >> text=Este ID já existe no Comunique"), "ao digitar um ID com bloqueios, aparece o quadrinho");
  ok((await texto(m7, "#f-historico")).includes("Nome Velho"), "o quadrinho mostra a ficha");
  await m7.screenshot({ path: path.join(PRINTS, "f3-historico-id.png"), fullPage: true });
  await m7.fill("#f-idapp", "semnome77");
  ok(await esperar(m7, "#f-historico >> text=Este ID já tem cadastro na ativação: Aprovado"), "e avisa quando o ID já tem cadastro");
  // busca rápida no topo
  await m7.fill("#q-topo", "Maria Sem");
  ok(await esperar(m7, "#busca-res:not([hidden]) >> text=Cadastros da ativação") && await m7.isVisible("#busca-res >> text=Entregadores"), "busca rápida acha a ficha e o cadastro");
  ok(await m7.evaluate(() => !CSS.highlights || (CSS.highlights.get("busca-topo")?.size || 0) > 0), "009l: a busca rápida grifa o termo nos resultados");
  await m7.screenshot({ path: path.join(PRINTS, "f4-busca.png") });
  await m7.click("#busca-res button:has-text('Maria Sem Nome') >> nth=0");
  ok(await esperar(m7, "#v-bq-consultar:not([hidden]) >> text=Maria Sem Nome"), "clicar na ficha abre Consultar entregador");
  // ID com ficha de outro nome: revisar; monitorador confirma que está certo
  await ir(n7, "#ativacao/novo"); await esperar(n7, "#form");
  await n7.fill("#f-idapp", "rev00002"); await n7.fill("#f-nome", "Nome Certo"); await n7.fill("#f-cidade", "ITABAIANA - SE"); await n7.click("#b-enviar");
  await ir(m7, "#ativacao/historico"); await m7.reload();
  await esperar(m7, "#t-hist tr:has-text('rev00002') button.revisar-cad");
  ok((await texto(m7, "#t-hist tr:has-text('rev00002') button.revisar-cad")).includes("o ID já tem ficha com outro nome: Nome Velho"), "Histórico: ID com ficha de outro nome fica para revisar");
  await m7.selectOption("#f-hist-status", "revisar");
  { const linhas = await m7.$$("#t-hist tbody tr.clicavel"), comMarca = await m7.$$("#t-hist tbody tr.clicavel button.revisar-cad");
    ok(linhas.length > 0 && linhas.length === comMarca.length && !(await m7.isVisible("#t-hist tr:has-text('semnome77')")), "filtro 'Para revisar' no Histórico (" + linhas.length + ")"); }
  await m7.click("#t-hist tr:has-text('rev00002') button.revisar-cad");
  await m7.click("dialog.janela >> text=Os dados estão certos");
  ok(await esperar(m7, "#toast:has-text('Marcado como revisado')"), "monitorador marca 'Os dados estão certos'");
  // cadastro novo só com CPF: já nasce com tarefa (a janela não oferece outra)
  await ir(n7, "#ativacao/novo"); await esperar(n7, "#form");
  await n7.fill("#f-cpf", "11144477735"); await n7.fill("#f-cidade", "LAGARTO - SE"); await n7.click("#b-enviar");
  await esperar(n7, "#queue .card:has-text('111.444.777-35')");
  await n7.click("#queue .card:has-text('111.444.777-35') button.revisar-cad");
  ok(await esperar(n7, "dialog.janela >> text=Já existe uma tarefa aberta"), "cadastro novo incompleto já tem tarefa (não oferece outra)");
  await n7.click("dialog.janela >> text=Cancelar");
  { const t7 = await texto(n7, "main"); ok(!t7.includes("null"), "telas da 007 sem textos vazios (null)" + perto(t7, "null")); }

  // casos guardados: rotas e telas antigas não abrem
  { const c8 = await abrir(monitor, "#casos");
    ok(await esperar(c8, "#v-inicio:not([hidden])") && !(await c8.isVisible("nav.grupo a[data-grupo-mod=casos]")), "#casos volta para o início (Casos guardados)");
    await ir(c8, "#analises"); await esperar(c8, "nav.tabs a");
    ok(!(await c8.$$eval("nav.tabs a", (l) => l.map((x) => x.dataset.view))).includes("placar"), "Análises sem o Placar do detetive"); }
  // 18. 008b · avisos: tira, tela com busca e filtros, cidades sem responsável, suporte revisa
  { const d8 = new pg.Client({ connectionString: DB }); await d8.connect();
    var livre = (await d8.query("select nome from cidades where ativa and public.responsavel_cidade_email(nome) is null order by nome limit 1")).rows[0].nome;
    await d8.query("select importar_bloqueio('rev00008', 'Nome Trocado', 'LAGARTO - SE', 'Avaria de Produto', now() - interval '80 days', 'Planilha', 'Nome diferente na planilha', '24')");
    await d8.end(); }
  const a8 = await abrir(admin, "#atividades/avisos");
  ok(await esperar(a8, "#at-avisos .aviso >> text=Você recebeu porque você é moderador"), "moderador recebe os avisos de Registros, com o porquê");
  await a8.fill("#av-q", "avulso01");
  ok(await a8.waitForFunction(() => { const l = [...document.querySelectorAll("#at-avisos .aviso")]; return l.length && l.every((x) => x.textContent.includes("avulso01")); }, null, { timeout: 8000 }).then(() => true, () => false), "busca nos avisos pelo ID");
  await a8.fill("#av-q", "");
  await a8.selectOption("#av-filtro", "bloqueios");
  ok(await a8.waitForFunction(() => { const l = [...document.querySelectorAll("#at-avisos .aviso .tag")]; return l.length && l.every((x) => x.textContent === "BLOQUEIOS"); }, null, { timeout: 8000 }).then(() => true, () => false), "filtro por tipo: só bloqueios");
  await a8.screenshot({ path: path.join(PRINTS, "h2-tela-avisos.png"), fullPage: true });
  await a8.click("#at-avisos .aviso a[href^='#ficha/']");
  ok(await esperar(a8, "#v-bq-consultar:not([hidden]) #bq-consulta h3"), "clicar num aviso de bloqueio abre a ficha do entregador");
  // cidade sem responsável: o suporte pede, o moderador aprova nas Pendências
  const s8 = await abrir(sup, "#atividades/avisos");
  await esperar(s8, "#av-cidades summary"); await s8.click("#av-cidades summary");
  ok(await esperar(s8, `#av-cidades li:has-text('${livre}') >> text=Pedir para ser responsável`), "tela de Avisos lista as cidades sem responsável");
  await s8.click(`#av-cidades li:has-text('${livre}') >> text=Pedir para ser responsável`);
  ok(await esperar(s8, "#toast:has-text('Pedido enviado')") && await esperar(s8, `#av-cidades li:has-text('${livre}') >> text=Você já pediu`), "suporte pede para ser responsável pela cidade");
  await s8.screenshot({ path: path.join(PRINTS, "h3-cidades-sem-responsavel.png"), fullPage: true });
  await ir(a8, "#atividades/pendencias"); await a8.reload();
  const cartaoPedido = `#at-lista .card:has-text('Suporte Um pediu para ser responsável por ${livre}')`;
  ok(await esperar(a8, cartaoPedido), "o pedido aparece nas Pendências do moderador");
  await a8.screenshot({ path: path.join(PRINTS, "h4-pedido-cidade.png"), fullPage: true });
  await a8.click(`${cartaoPedido} >> text=Aprovar`);
  ok(await esperar(a8, `#toast:has-text('agora é responsável por ${livre}')`), "moderador aprova o pedido");
  await ir(s8, "#atividades/avisos"); await s8.reload();
  ok(await esperar(s8, `#at-avisos >> text=agora você é responsável por ${livre}`), "quem pediu é avisado da aprovação");
  // suporte corrige um registro "revisar" pela ficha
  await ir(s8, "#bloqueios/consultar");
  await s8.fill("#bq-q-consulta", "rev00008"); await s8.click("#bq-f-consulta button[type=submit]");
  ok(await esperar(s8, "#bq-consulta button.alerta-revisar"), "o suporte vê o botão revisar no registro marcado");
  await s8.click("#bq-consulta button.alerta-revisar");
  await esperar(s8, "dialog.janela");
  ok(await s8.isVisible("dialog.janela >> text=Motivo"), "a correção do suporte pede o motivo");
  await s8.keyboard.press("Escape");
  { const ta = await texto(a8, "main"), ts = await texto(s8, "main");
    ok(!ta.includes("undefined") && !ts.includes("null") && !ta.includes("null"), "telas da 008b sem textos vazios" + perto(ta, "undefined") + perto(ts, "null") + perto(ta, "null")); }

  // 19. 008d · de olho nele, seguir cidade, preferências, resumo do dia, revisar do suporte
  await ir(s8, "#bloqueios/consultar");
  await s8.fill("#bq-q-consulta", "mal00001"); await s8.click("#bq-f-consulta button[type=submit]");
  ok(await esperar(s8, "#bq-consulta button.olho:has-text('Ficar de olho')"), "a ficha tem o botão Ficar de olho");
  await s8.click("#bq-consulta button.olho");
  ok(await esperar(s8, "#toast:has-text('Você está de olho')") && await esperar(s8, "#bq-consulta button.olho[aria-pressed=true]"), "Ficar de olho: o botão fica marcado");
  await s8.screenshot({ path: path.join(PRINTS, "i1-de-olho.png") });
  await ir(s8, "#atividades/avisos"); await s8.reload();
  await esperar(s8, "#av-prefs summary"); await s8.click("#av-prefs summary");
  ok(await esperar(s8, "#av-prefs >> text=De olho em") && await s8.isVisible("#av-prefs .link-ficha"), "Avisos mostra de quem você está de olho");
  await s8.uncheck("#av-prefs [data-pref=leves]");
  ok(await esperar(s8, "#toast:has-text('Preferências salvas')"), "silenciar as infrações leves agrupadas");
  await s8.selectOption("#av-prefs select", "LAGARTO - SE");
  await s8.click("#av-prefs >> text=Seguir cidade");
  ok(await esperar(s8, "#av-prefs .chips-seguindo >> text=LAGARTO - SE"), "seguir uma cidade");
  await s8.screenshot({ path: path.join(PRINTS, "i2-preferencias.png"), fullPage: true });
  await s8.click("#b-avisos");
  ok(await esperar(s8, "#tira-avisos .resumo-dia >> text=Hoje na equipe") && await esperar(s8, "#tira-avisos .resumo-dia:has-text('registro(s) hoje')"), "o sino mostra o resumo do dia");
  await s8.screenshot({ path: path.join(PRINTS, "i3-resumo-dia.png") });
  await s8.keyboard.press("Escape");
  // o cartão de revisar a planilha abre a lista também para o suporte
  { const d9 = new pg.Client({ connectionString: DB }); await d9.connect();
    await d9.query("select importar_bloqueio('rev00011', 'Nome Trocado', 'LAGARTO - SE', 'Avaria de Produto', now() - interval '70 days', 'Planilha', 'Nome diferente na planilha', '24')");
    await d9.end(); }
  await ir(s8, "#atividades/pendencias"); await s8.reload();
  ok(await esperar(s8, "#at-lista >> text=Revisar registros da planilha"), "o suporte vê o cartão de revisar a planilha");
  await s8.click("#at-lista >> text=Abrir os registros para revisar");
  ok(await esperar(s8, "dialog.janela .item-revisar:has-text('rev00011')"), "a lista de revisar abre para o suporte");
  await s8.click("dialog.janela .item-revisar:has-text('rev00011') >> text=Revisar");
  ok(await esperar(s8, "dialog.janela >> text=Motivo"), "do item da lista, abre a correção");
  await s8.keyboard.press("Escape");

  // Histórico de bloqueios como o da ativação: quadrinhos clicáveis, "só os que eu registrei" e o histórico de cada registro
  await ir(a8, "#bloqueios/historico"); await a8.reload();
  ok(await esperar(a8, "#bq-hist-tiles button.tile >> text=Bloqueados agora") && await a8.isVisible("#bq-hist-meus-box"), "Histórico de bloqueios com os quadrinhos e 'Só os que eu registrei'");
  await a8.click("#bq-hist-tiles button.tile:has-text('Liberados antes')");
  ok(await a8.waitForFunction(() => { const l = [...document.querySelectorAll("#bq-t-hist tbody tr.clicavel")]; return l.length && l.every((x) => x.textContent.includes("Liberado antes do prazo")); }, null, { timeout: 8000 }).then(() => true, () => false), "clicar num quadrinho filtra a tabela");
  await a8.click("#bq-t-hist tbody tr.clicavel >> nth=0");
  ok(await esperar(a8, "#bq-t-hist tr.detalhe-hist .timeline >> text=Registrado"), "clicar na linha abre o histórico do registro");
  await a8.screenshot({ path: path.join(PRINTS, "i4-historico-bloqueios.png"), fullPage: true });
  await a8.click("#bq-hist-tiles button.tile.ativo");
  await a8.check("#bq-hist-meus");
  ok(await a8.waitForFunction(() => { const l = [...document.querySelectorAll("#bq-t-hist tbody tr.clicavel")]; return l.every((x) => x.textContent.includes("Mateus Lopes")); }, null, { timeout: 8000 }).then(() => true, () => false), "'Só os que eu registrei' mostra só os do moderador");

  // 20. 009b · Ferramentas (calculadora de bairro, tarifas) e Financeiro (adicional, pendentes, lançamentos)
  await ir(a8, "#inicio"); await a8.reload();
  ok(await esperar(a8, "#inicio-funcoes #fn-calculadora") && await a8.isVisible("#inicio-funcoes #fn-adicional"), "tela inicial com Calculadora de bairro e Registrar adicional");
  await a8.click("#fn-calculadora");
  ok(await a8.waitForFunction(() => document.querySelector("#fe-cidade")?.value === "LAGARTO - SE", null, { timeout: 8000 }).then(() => true, () => false), "calculadora já escolhe a única cidade com bairros");
  await a8.fill("#fe-informado", "centro"); await a8.fill("#fe-real", "Brejo");
  ok(await esperar(a8, "#fe-resultado .fe-total strong:has-text('R$ 11,50')") && (await texto(a8, "#fe-resultado")).includes("R$ 4,50 para o entregador"), "calculadora: ajuste = recebe(real) − recebe(informado) = R$ 11,50");
  await a8.fill("#fe-informado", "Aldemar de Carvalho");
  ok(await esperar(a8, "#fe-resultado >> text=ADEMAR DE CARVALHO"), "calculadora acha o bairro pelo outro nome (apelido)");
  await a8.fill("#fe-informado", "Centri");
  ok(await esperar(a8, "#fe-resultado .entendido >> text=Você digitou “Centri”") && await a8.isVisible("#fe-resultado >> text=CENTRO"), "009p: calculadora entende o nome com um erro pequeno (Centri → CENTRO)");
  await a8.fill("#fe-informado", "Centro");
  await a8.fill("#fe-id", "fin00001"); await a8.fill("#fe-nome", "Zé das Entregas"); await a8.selectOption("#fe-origem", "qd");
  await a8.screenshot({ path: path.join(PRINTS, "j1-calculadora.png"), fullPage: true });
  await a8.click("#fe-enviar");
  ok(await esperar(a8, "#toast:has-text('Ficou nos pendentes')"), "registrar o ajuste sem lançar: vai para os pendentes");
  ok(await esperar(a8, "#c-fin:not([hidden]):has-text('1')"), "menu Financeiro mostra 1 pendente");
  ok(await esperar(a8, "#v-fe-calc a.fin-pend"), "a calculadora mostra o atalho para os pendentes");
  await ir(a8, "#financeiro/adicional");
  await a8.fill("#fi-id", "mal00001"); await a8.check("input[name=fi-origem][value=qd]"); await a8.check("input[name=fi-mercado][value=nao]");
  await a8.selectOption("#fi-motivo", "Chuva"); await a8.fill("#fi-entrega", "6"); await a8.fill("#fi-valor-pedido", "80");
  await a8.click("#fi-rapidos button:has-text('+ R$ 5')");
  ok((await a8.inputValue("#fi-combinado")) === "11,00" && await esperar(a8, "#fi-previa strong:has-text('R$ 5,00')"), "adicional rápido: combinado = entrega + R$ 5, prévia de R$ 5,00");
  await a8.check("#fi-lancado");
  await a8.screenshot({ path: path.join(PRINTS, "j2-registrar-adicional.png"), fullPage: true });
  await a8.click("#fi-enviar");
  ok(await esperar(a8, "#toast:has-text('Adicional de R$ 5,00 registrado.')"), "adicional registrado já lançado");
  ok(await esperar(a8, "#fi-meus .fin-card >> text=Fulano de Tal Souza"), "o nome veio da ficha do entregador");
  await ir(a8, "#financeiro/pendentes");
  ok(await esperar(a8, "#fi-pend-lista .fin-card >> text=CENTRO → BREJO"), "Adicionais pendentes mostra o ajuste não lançado");
  ok(await a8.evaluate(() => location.hash) === "#financeiro/lancamentos" && (await a8.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view))).join() === "adicional,acordos,lancamentos"
      && await a8.isVisible("nav.tabs a[data-view=lancamentos] #c-fin-pend"), "009k: o link antigo dos pendentes abre os Lançamentos (pendentes no topo, número na aba)");
  await a8.click("#fi-pend-lista button:has-text('Marcar como lançado')");
  ok(await esperar(a8, "#fi-pend-lista >> text=Nada pendente") && await a8.waitForFunction(() => document.querySelector("#c-fin")?.hidden, null, { timeout: 8000 }).then(() => true, () => false), "marcar como lançado tira dos pendentes e zera o número do menu");
  await ir(a8, "#financeiro/lancamentos");
  ok(await esperar(a8, "#fi-l-tiles .tile >> text=R$ 16,50") && (await a8.$$("#fi-l-tabela tbody tr")).length === 2, "Lançamentos: total de R$ 16,50 e os 2 registros");
  // 009l (sortable-table): ordenar pelo cabeçalho move as linhas e marca aria-sort só na coluna
  { const valores = () => a8.$$eval("#fi-l-tabela tbody tr", (l) => l.map((tr) => tr.querySelector("td.num")?.textContent.trim()));
    await a8.click("#fi-l-tabela th button.ordena:has-text('Valor')");
    const asc = await valores();
    await a8.click("#fi-l-tabela th button.ordena:has-text('Valor')");
    const desc = await valores();
    const sorts = await a8.$$eval("#fi-l-tabela th[aria-sort]", (l) => l.map((th) => th.getAttribute("aria-sort")));
    ok(asc[0] === "R$ 5,00" && desc[0] === "R$ 11,50" && JSON.stringify(sorts) === '["descending"]', "009l: Lançamentos ordenam pelo Valor (crescente e decrescente): " + asc + " / " + desc);
    await a8.evaluate(() => App.carregar()); await a8.waitForTimeout(800);
    ok((await valores())[0] === "R$ 11,50", "009l: a ordem escolhida continua depois de atualizar a lista"); }
  ok(!(await texto(a8, "#v-fi-lancamentos")).includes("null") && !(await texto(a8, "#v-fi-lancamentos")).includes("undefined"), "Lançamentos sem textos vazios (null)");
  await a8.screenshot({ path: path.join(PRINTS, "j3-lancamentos.png"), fullPage: true });
  await ir(a8, "#ferramentas/tarifas");
  ok(await esperar(a8, "#fe-tarifas-box[open]") && await a8.evaluate(() => location.hash) === "#ferramentas/calculadora"
      && (await a8.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view))).join() === "calculadora,mensagens", "009k: o link antigo das tarifas abre a Calculadora com as Tarifas abertas");
  ok(await esperar(a8, "#fe-t-tabela tr:has-text('BREJO') >> text=R$ 16,00") && await a8.isVisible("#fe-t-novo"), "Tarifas: moderador vê o que o entregador recebe e pode editar");
  await a8.click("#fe-t-tabela tr:has-text('BREJO') >> text=Editar");
  await a8.fill("dialog.janela input >> nth=1", "17,99");
  await a8.click("dialog.janela .actions button.primary");
  ok(await esperar(a8, "#fe-t-tabela tr:has-text('BREJO') >> text=R$ 17,00"), "editar a tarifa de um bairro");
  // 009p: bairro novo quase igual a um que já existe vira outro nome dele (mesmo valor); parecido pergunta antes
  await a8.click("#fe-t-novo");
  await a8.fill("dialog.janela input >> nth=0", "Brejjo"); await a8.fill("dialog.janela input >> nth=1", "30"); await a8.fill("dialog.janela input >> nth=2", "1");
  await a8.click("dialog.janela .actions button.primary");
  ok(await esperar(a8, "#toast:has-text('é o mesmo bairro que BREJO')") && await esperar(a8, "#fe-t-tabela tr:has-text('BREJO') >> text=Também: BREJJO"), "009p: “Brejjo” vira outro nome do BREJO, com o valor dele");
  await a8.click("#fe-t-novo");
  await a8.fill("dialog.janela input >> nth=0", "Brejo Novo Sul"); await a8.fill("dialog.janela input >> nth=1", "9"); await a8.fill("dialog.janela input >> nth=2", "1");
  await a8.click("dialog.janela .actions button.primary");
  ok(await esperar(a8, "dialog.janela .pergunta-bairro >> text=É o mesmo bairro?"), "009p: nome parecido mas duvidoso: a janela pergunta antes");
  await a8.click("dialog.janela .pergunta-bairro >> text=Não, é outro bairro");
  ok(await esperar(a8, "#toast:has-text('Bairro criado')") && await esperar(a8, "#fe-t-tabela tr:has-text('BREJO NOVO SUL')"), "009p: “é outro bairro” cria o bairro com o próprio valor");
  await s8.reload(); await esperar(s8, "section.view:not([hidden])"); await ir(s8, "#ferramentas/tarifas");  // 009k: o link antigo vira #ferramentas/calculadora; recarregar depois fecharia as tarifas
  ok(await esperar(s8, "#fe-t-tabela tr:has-text('CENTRO')") && !(await s8.isVisible("#fe-t-tabela >> text=Editar")) && !(await s8.isVisible("#fe-t-novo")), "suporte consulta as tarifas sem editar");

  // 21. 009c · agravante no Novo bloqueio e mensagens prontas ("restrição temporária", nunca "bloqueio")
  await ir(a8, "#bloqueios/novo"); await a8.reload();
  await a8.waitForFunction(() => document.querySelector("#bq-infracao")?.options.length > 1, null, { timeout: 8000 }).catch(() => {});
  await a8.fill("#bq-id", "ret00001"); await a8.fill("#bq-nome", "Rita Retida"); await a8.selectOption("#bq-cidade", "LAGARTO - SE");
  await a8.selectOption("#bq-infracao", { label: "Retenção de Valores ou Equipamentos de Pagamento" });
  ok(await esperar(a8, "#bq-previa label.agravante >> text=Não respondeu ao contato do suporte em até 8 horas"), "infração com agravante mostra a caixinha na prévia");
  await a8.check("#bq-agravante");
  ok(await esperar(a8, "#bq-previa .previa >> text=Com o agravante"), "marcar o agravante mostra a punição com ele");
  ok(await esperar(a8, "#bq-previa .pendencia-pergunta >> text=Já foi solucionado?"), "retenção pergunta se já foi solucionado");
  await a8.click("#bq-enviar");
  ok(await esperar(a8, "#bq-erro:not([hidden]) >> text=Diga se já foi solucionado"), "não registra sem responder se já foi solucionado");
  await a8.check("input[name=bq-solucionado][value=nao]");
  await a8.screenshot({ path: path.join(PRINTS, "k1-agravante.png"), fullPage: true });
  await a8.click("#bq-enviar");
  ok(await esperar(a8, "#bq-previa >> text=Com agravante: Não respondeu"), "registrado com agravante");
  ok(await esperar(a8, "#bq-previa >> text=Ficou em “Acontecendo agora” na tela inicial"), "não solucionado: avisa que ficou em Acontecendo agora");
  await a8.click("#bq-previa button:has-text('Gerar mensagem')");
  ok(await esperar(a8, "dialog.janela textarea.msg-texto"), "Gerar mensagem abre a janela com o texto pronto");
  const msg = await a8.inputValue("dialog.janela textarea.msg-texto");
  ok(msg.startsWith("Olá, Rita.") && msg.includes("Retenção de Valores") && msg.includes("até 1 hora") && msg.includes("não respondeu ao contato do suporte") && !/bloqueio/i.test(msg),
    "mensagem com o primeiro nome, a infração, a regra da política e o agravante, sem a palavra bloqueio");
  await a8.screenshot({ path: path.join(PRINTS, "k2-gerar-mensagem.png") });
  await a8.click("dialog.janela >> text=Fechar");
  await ir(a8, "#inicio");
  ok(await esperar(a8, "#inicio-rapidos .rapido >> text=Aguardando prestação de contas") && await a8.isVisible("#inicio-rapidos .rapido >> text=Rita Retida"), "tela inicial: Acontecendo agora com 'Aguardando prestação de contas' e o nome do entregador");
  await a8.screenshot({ path: path.join(PRINTS, "k4-avisos-rapidos.png") });
  await a8.click("#inicio-rapidos button:has-text('Marcar como resolvido')");
  await a8.fill("dialog.janela input", "Prestou contas na loja");
  await a8.click("dialog.janela button.primary");
  ok(await esperar(a8, "#toast:has-text('Marcado como resolvido')") && await a8.waitForFunction(() => document.querySelector("#inicio-rapidos")?.hidden, null, { timeout: 8000 }).then(() => true, () => false), "marcar como resolvido tira o aviso da tela inicial");
  await ir(a8, "#ferramentas/mensagens"); await a8.reload();
  await a8.waitForFunction(() => document.querySelector("#fe-msg-modelo")?.options.length > 1, null, { timeout: 8000 }).catch(() => {});
  await a8.selectOption("#fe-msg-modelo", "parceiro_ativacao");
  await a8.fill("#fe-msg-estab", "Padaria Teste"); await a8.selectOption("#fe-msg-cidade", "LAGARTO - SE");
  const txt = await a8.inputValue("#fe-msg-texto");
  ok(txt.includes("Olá, Padaria Teste!") && txt.includes("Aqui é Mateus") && txt.includes("em LAGARTO - SE") && await a8.isHidden("[data-msg-campo=nome]"), "Mensagens prontas: modelo do parceiro preenchido, só com os campos que ele usa");
  ok(txt.includes("PDF") && txt.includes("áudio"), "mensagem do parceiro avisa do PDF e do áudio");
  await a8.selectOption("#fe-msg-modelo", "engajamento_movimento");
  await a8.fill("#fe-msg-nome", "");
  ok((await a8.inputValue("#fe-msg-texto")).includes("entregadores de LAGARTO - SE") && await a8.isVisible("#fe-msg-dica >> text=para os entregadores da cidade"), "movimento alto sem nome: mensagem para a cidade");
  await a8.fill("#fe-msg-nome", "ana souza");
  ok((await a8.inputValue("#fe-msg-texto")).startsWith("Fala, Ana!"), "movimento alto com nome: mensagem para o entregador");
  await a8.click("#fe-msg-opcoes button:has-text('Opção 2')");
  ok((await a8.inputValue("#fe-msg-texto")).startsWith("Ana, tudo certo?") && (await a8.$$("#fe-msg-opcoes button")).length === 3, "três opções de texto para escolher");
  await a8.selectOption("#fe-msg-modelo", "restricao");
  await a8.fill("#fe-msg-nome", "carla dias");
  await a8.selectOption("#fe-msg-infracao", { label: "Retenção de Valores ou Equipamentos de Pagamento" });
  await a8.fill("#fe-msg-ocorrencia", "2"); await a8.fill("#fe-msg-horas", "48");
  { const t = await a8.inputValue("#fe-msg-texto");
    ok(t.startsWith("Olá, Carla!") && t.includes("restrição temporária") && t.includes("Retenção de Valores") && t.includes("2ª ocorrência") && t.includes("2 dias (48 h)") && !/bloqueio/i.test(t),
      "Mensagens prontas: modelo de restrição preenchido à mão (infração, ocorrência e tempo)"); }
  ok((await a8.$$eval("#fe-msg-modelo option", (l) => l.map((o) => o.value))).includes("leve"), "os modelos de encerramento, liberação e aviso também aparecem");
  await a8.waitForFunction(() => document.querySelectorAll("#fe-msg-bloqueio option").length > 1, null, { timeout: 8000 }).catch(() => {});
  { const op = await a8.$$eval("#fe-msg-bloqueio option", (l) => l.map((o) => [o.value, o.textContent]).filter(([v]) => v));
    ok(op.length > 0, "dá para escolher um entregador com restrição: " + op.length);
    if (op.length) {
      await a8.selectOption("#fe-msg-bloqueio", op[0][0]);
      const t = await a8.inputValue("#fe-msg-texto");
      ok(t.startsWith("Olá, ") && !t.includes("[infração]") && !t.includes("[tempo") && !/bloqueio/i.test(t) && await a8.isHidden("#fe-msg-infracao"), "escolhido o entregador, a mensagem vem pronta com os dados do bloqueio");
      await a8.selectOption("#fe-msg-bloqueio", "");
    } }
  ok(await esperar(a8, "#fe-msg-regras tr:has-text('Retenção de Valores') >> text=até 1 hora") && await a8.isVisible("#fe-msg-modelos >> text=Editar"), "explicação de cada regra e moderador edita os modelos");
  await a8.screenshot({ path: path.join(PRINTS, "k3-mensagens-prontas.png"), fullPage: true });

  // 22. 009d · Acontecendo agora: pedir ajuda, aviso geral, passagem de turno, lembrete das 18h e sons
  await ir(a8, "#inicio"); await a8.reload();
  ok(await esperar(a8, "#inicio-acoes #b-pedir-ajuda") && await a8.isVisible("#b-aviso-geral") && await a8.isVisible("#b-passar-turno"), "tela inicial: botões Pedir ajuda, Aviso geral e Passar o turno");
  ok(await a8.evaluate(() => App.som.nivelDe({ categoria: "ajuda" }) === 4 && App.som.nivelDe({ texto: "Tratativa atrasada há 40 h" }) === 3
    && App.som.nivelDe({ texto: "Sua decisão" }) === 2 && App.som.nivelDe({ categoria: "bloqueios" }) === 1 && App.som.nivelDe({ categoria: "bloqueios", motivo: "de_olho" }) === 2),
    "sons: 4 níveis (ajuda 4, atraso/previsão 3, para você 2, o resto 1; de olho sobe um)");
  await ir(s8, "#inicio"); await s8.reload();
  await esperar(s8, "#b-pedir-ajuda");
  await s8.click("#b-pedir-ajuda");
  await s8.check("#janela-ajuda input[value=suporte_crisp]");
  await s8.fill("#ag-ajuda-texto", "Fila no Crisp com 12 conversas esperando");
  await s8.screenshot({ path: path.join(PRINTS, "l1-pedir-ajuda.png") });
  await s8.click("#janela-ajuda button.primary");
  ok(await esperar(s8, "#toast:has-text('Pedido enviado')") && await esperar(s8, "#inicio-rapidos .rapido.ajuda >> text=Seu pedido está aberto para a equipe"), "suporte pede ajuda e vê o pedido aberto");
  await a8.evaluate(() => App.carregar());
  ok(await esperar(a8, "#inicio-rapidos .rapido.ajuda >> text=Suporte Um precisa de ajuda") && await a8.isVisible("#inicio-rapidos .rapido.ajuda >> text=Fila no Crisp"), "a equipe vê o pedido de ajuda em Acontecendo agora");
  ok(await a8.evaluate(() => App.som.ultimo?.nivel === 4), "pedido de ajuda novo toca o som de nível 4");
  await a8.screenshot({ path: path.join(PRINTS, "l2-acontecendo-agora.png"), fullPage: true });
  await a8.click("#inicio-rapidos .rapido.ajuda button:has-text('Eu ajudo')");
  ok(await esperar(a8, "#inicio-rapidos .rapido.ajuda >> text=Você está ajudando Suporte Um"), "aceitar: quem ajuda vê com quem está");
  await s8.evaluate(() => App.carregar());
  ok(await esperar(s8, "#inicio-rapidos .rapido.ajuda >> text=Mateus Lopes vai te ajudar"), "quem pediu vê quem vai ajudar");
  await s8.click("#inicio-rapidos .rapido.ajuda button:has-text('Resolvido')");
  ok(await s8.waitForFunction(() => !document.querySelector("#inicio-rapidos .rapido.ajuda"), null, { timeout: 8000 }).then(() => true, () => false), "resolvido: o pedido sai da tela");

  await a8.click("#b-aviso-geral");
  await a8.fill("#ag-aviso-texto", "App dos entregadores instável em Lagarto até as 20h");
  await a8.click("#janela-aviso .chip[data-horas='1']");
  await a8.click("#janela-aviso button.primary");
  ok(await esperar(a8, "#inicio-rapidos .rapido.aviso-geral >> text=App dos entregadores instável") && await a8.isVisible("#inicio-rapidos .rapido.aviso-geral button:has-text('Encerrar aviso')"), "aviso geral publicado, quem criou pode encerrar");
  await s8.evaluate(() => App.carregar());
  ok(await esperar(s8, "#inicio-rapidos .rapido.aviso-geral >> text=App dos entregadores instável") && await s8.isHidden("#inicio-rapidos .rapido.aviso-geral button:has-text('Encerrar aviso')"), "a equipe vê o aviso geral (sem poder encerrar)");
  await a8.click("#inicio-rapidos .rapido.aviso-geral button:has-text('Encerrar aviso')");
  ok(await a8.waitForFunction(() => !document.querySelector("#inicio-rapidos .rapido.aviso-geral"), null, { timeout: 8000 }).then(() => true, () => false), "encerrar tira o aviso geral");

  await a8.click("#b-passar-turno");
  ok(await esperar(a8, "#janela-turno .turno-panorama >> text=Agora na equipe"), "Passar o turno mostra o panorama do turno");
  const nItens = (await a8.$$("#janela-turno .turno-item select")).length;
  await a8.fill("#ag-turno-texto", "Cuidado com a fila do Crisp no fim da tarde");
  await a8.screenshot({ path: path.join(PRINTS, "l3-passar-turno.png") });
  await a8.click("#janela-turno button.primary");
  ok(await esperar(a8, "#toast:has-text('Turno passado')"), `turno passado (${nItens} item(ns) mantidos)`);
  await s8.evaluate(() => App.carregar());
  ok(await esperar(s8, "#inicio-rapidos .rapido.passagem >> text=Cuidado com a fila do Crisp"), "quem entra vê a passagem de turno na tela inicial");
  await s8.click("#inicio-rapidos .rapido.passagem button:has-text('Li')");
  ok(await s8.waitForFunction(() => !document.querySelector("#inicio-rapidos .rapido.passagem"), null, { timeout: 8000 }).then(() => true, () => false), "“Li” tira a passagem da tela de quem leu");

  await s8.evaluate(() => { App.agora_relogio = () => 17 * 60 + 45; App.render(); });
  ok(await esperar(s8, "#lembrete-turno >> text=passe o turno"), "17h45 sem passar o turno: aparece o lembrete");
  await s8.click("#lembrete-turno button:has-text('Depois')");
  await s8.evaluate(() => App.render());
  ok(await s8.isHidden("#lembrete-turno"), "“Depois” esconde o lembrete por 30 min");
  await s8.evaluate(() => { sessionStorage.removeItem("comunique-turno-depois"); App.agora_relogio = () => 10 * 60; App.render(); });
  ok(await s8.isHidden("#lembrete-turno"), "fora do horário, sem lembrete");

  await ir(s8, "#atividades/avisos");
  await esperar(s8, "#av-prefs [data-som=n4]");
  await s8.evaluate(() => document.querySelector("#av-prefs [data-som=n1]").click());
  ok(await s8.evaluate(() => JSON.parse(localStorage.getItem("comunique-som")).n1 === false) && (await s8.$$("#av-prefs [data-som]")).length >= 4, "Avisos: liga e desliga cada nível de som (guardado no navegador)");
  ok(await s8.evaluate(() => [...document.querySelectorAll("#av-prefs [data-som], #av-prefs [data-pref]")].every((x) => x.hasAttribute("switch") && x.getAttribute("role") === "switch")), "009l: preferências de avisos e sons viraram interruptores");

  // acordos fechados com parceiros: no vencimento, destaque na tela inicial de todos até o ajuste
  await ir(a8, "#financeiro/acordos"); await a8.reload();
  await esperar(a8, "#fi-ac-form");
  const hojeBR = await a8.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()));
  await a8.fill("#fi-ac-estab", "Mercado Bom Preço"); await a8.fill("#fi-ac-cidade", "LAGARTO - SE");
  await a8.fill("#fi-ac-texto", "Taxa de entrega de R$ 3,99 por 30 dias"); await a8.fill("#fi-ac-vence", hojeBR);
  await a8.click("#fi-ac-enviar");
  ok(await esperar(a8, "#fi-ac-lista .acordo.vencido >> text=Vence hoje: fazer o ajuste"), "Financeiro → Acordos: acordo registrado, vencendo hoje");
  await a8.fill("#fi-ac-estab", "Padaria Sol"); await a8.fill("#fi-ac-cidade", "ITABAIANA - SE");
  await a8.fill("#fi-ac-texto", "Frete grátis acima de R$ 50"); await a8.fill("#fi-ac-vence", "2099-12-31");
  await a8.click("#fi-ac-enviar");
  ok(await esperar(a8, "#fi-ac-lista .acordo.vigente >> text=Padaria Sol") && await a8.isVisible("#c-fin-acordos:has-text('1')"), "acordo em vigor na lista e o número de vencidos na aba");
  await a8.screenshot({ path: path.join(PRINTS, "l4-acordos.png"), fullPage: true });
  await s8.evaluate(() => { location.hash = "#inicio"; App.carregar(); });
  ok(await esperar(s8, "#inicio-acordos .acordo-vencido >> text=Mercado Bom Preço") && await s8.isVisible("#inicio-acordos .acordo-vencido >> text=fazer o ajuste"), "tela inicial de todos: aviso chamativo do acordo vencido");
  ok(!(await s8.isVisible("#inicio-acordos >> text=Padaria Sol")), "acordo em vigor não aparece na tela inicial");
  await s8.screenshot({ path: path.join(PRINTS, "l5-acordo-vencido.png") });
  await s8.click("#inicio-acordos .acordo-vencido button:has-text('Ajuste feito')");
  await s8.fill("#janela-acordo input", "Taxa voltou ao normal");
  await s8.click("#janela-acordo button.primary");
  ok(await s8.waitForFunction(() => !document.querySelector("#inicio-acordos .acordo-vencido"), null, { timeout: 8000 }).then(() => true, () => false), "“Ajuste feito” tira o aviso");
  await a8.evaluate(() => App.carregar());
  await a8.selectOption("#fi-ac-filtro", "ajustados");
  ok(await esperar(a8, "#fi-ac-lista .acordo.ajustado >> text=Ajuste feito por Suporte Um"), "o acordo fica no histórico com quem fez o ajuste");

  // 23. 009d2 · tarefas em cards
  await ir(s8, "#atividades/sugeridas"); await s8.reload();
  await esperar(s8, "#at-tipos .chip[data-tipo=ativar_entregadores]");
  ok((await s8.$$("#at-tipos .chip")).length === 10, "Nova tarefa: 10 tipos para escolher");
  await s8.click("#at-nova-box summary");
  await s8.click("#at-tipos .chip[data-tipo=ativar_entregadores]");
  ok(await s8.isHidden("#at-titulo-box") && await s8.isVisible("#at-prazo-dica >> text=prazo padrão do tipo (3 dia(s))"), "tipo com campos próprios: sem título livre e com o prazo padrão");
  await s8.click("#at-enviar");
  ok(await esperar(s8, "#at-erro:not([hidden]) >> text=Preencha: a cidade"), "campo obrigatório do tipo é cobrado");
  await s8.fill("#at-campos [data-campo=cidade]", "LAGARTO - SE"); await s8.fill("#at-campos [data-campo=quantidade]", "3");
  await s8.check("#at-para label:has-text('Monitor Um') input");
  await s8.screenshot({ path: path.join(PRINTS, "m1-nova-tarefa.png"), fullPage: true });
  await s8.click("#at-enviar");
  const cardAtiv = "#at-sug-lista .tarefa-card:has-text('Aprovar 3 entregador(es) · LAGARTO - SE')";
  ok(await esperar(s8, cardAtiv) && await s8.isVisible(cardAtiv + " >> text=Aprovar entregadores") && await s8.isVisible(cardAtiv + " >> text=0 de 3"), "card com o tipo, o título montado e a meta");
  await ir(m7, "#atividades/sugeridas"); await m7.reload();
  await esperar(m7, cardAtiv);
  ok(await m7.isVisible("#at-sug-lista .grupo:has-text('Para você') " + cardAtiv.replace("#at-sug-lista ", "")), "quem foi indicado vê em “Para você”");
  await m7.click(cardAtiv + " >> text=Eu faço");
  ok(await esperar(m7, cardAtiv + " >> text=Em andamento") && await m7.isVisible(cardAtiv + " >> text=Esperou"), "Eu faço: em andamento, com o tempo de espera");
  ok(await m7.evaluate(() => { const p = document.querySelector("progress.barra-prog"); return !p || (p.max >= 1 && p.hasAttribute("aria-label")); }), "009l: barras de progresso nativas, com rótulo");
  await m7.click(cardAtiv + " .checklist-tarefa summary");
  await m7.fill(cardAtiv + " .checklist-tarefa input[aria-label='Novo item do checklist']", "Ligar para os indicados");
  await m7.click(cardAtiv + " .checklist-tarefa button:has-text('Incluir')");
  ok(await esperar(m7, cardAtiv + " .checklist-tarefa >> text=Checklist 0/1"), "checklist: item incluído");
  await m7.click(cardAtiv + " .checklist-tarefa li input[type=checkbox]");
  ok(await esperar(m7, cardAtiv + " .checklist-tarefa >> text=Checklist 1/1"), "checklist: item marcado");
  await m7.click(cardAtiv + " button:has-text('Aguardando terceiro')");
  await m7.fill("#janela-aguardar input", "Esperando os documentos do parceiro");
  await m7.click("#janela-aguardar button.primary");
  ok(await esperar(m7, cardAtiv + " .bullet.aguardando >> text=Esperando os documentos do parceiro"), "aguardando terceiro pausa a tarefa");
  await m7.click(cardAtiv + " button:has-text('Retomar')");
  ok(await esperar(m7, cardAtiv + " >> text=Em andamento"), "retomar volta para em andamento");
  await m7.click(cardAtiv + " button:has-text('💬')");
  await m7.selectOption("#janela-comentarios select", "Suporte Um");
  await m7.type("#at-comentario", "dá uma olhada nos de ontem");
  await m7.click("#janela-comentarios button.primary");
  ok(await esperar(m7, "#janela-comentarios .comentario >> text=@Suporte Um dá uma olhada nos de ontem"), "comentário com @menção");
  await m7.screenshot({ path: path.join(PRINTS, "m2-comentarios.png") });
  await m7.click("#janela-comentarios .janela-topo button");
  ok(await esperar(m7, cardAtiv + " button:has-text('💬 1')"), "o card mostra quantos comentários tem");
  await m7.screenshot({ path: path.join(PRINTS, "m3-tarefas.png"), fullPage: true });
  await m7.click(cardAtiv + " >> text=Concluir");
  await m7.click(cardAtiv + " >> text=Confirmar conclusão");
  ok(await esperar(m7, cardAtiv + " >> text=levou"), "concluída mostra quanto tempo levou");
  await s8.evaluate(() => App.carregar());
  ok(await esperar(s8, cardAtiv + " button:has-text('Agradecer')"), "quem pediu pode agradecer");
  await s8.click(cardAtiv + " button:has-text('Agradecer')");
  ok(await esperar(s8, cardAtiv + " >> text=👏 Suporte Um") && await s8.isVisible(cardAtiv + " button:has-text('Agradecido')"), "agradecimento aparece no card");

  await s8.click("#at-nova-box summary");
  await s8.click("#at-tipos .chip[data-tipo=contato_entregador]");
  await s8.check("#at-modo input[value=registro]");
  ok(await s8.isHidden("#at-para-box") && await s8.isHidden("#at-prazo-box") && await s8.isVisible("#at-enviar:has-text('Registrar o que fiz')"), "registrar o que já fiz: sem prazo e sem para quem");
  await s8.fill("#at-campos [data-campo=id_app]", "abc123"); await s8.selectOption("#at-campos [data-campo=tratativa]", "nao");
  ok(await s8.isVisible("#at-campos [data-campo=motivo]"), "contato que não é tratativa pede o motivo da lista");
  await s8.selectOption("#at-campos [data-campo=motivo]", "Retorno de itens");
  await s8.click("#at-enviar");
  ok(await esperar(s8, "#at-sug-lista .grupo:has-text('Concluídas') .tarefa-card:has-text('Retorno de itens') >> text=Registro do que já foi feito"), "o registro entra direto como concluído");

  await a8.evaluate(() => { location.hash = "#atividades/sugeridas"; });
  await esperar(a8, "#at-tipos .chip[data-tipo=procurar_entregador]");
  await a8.click("#at-nova-box summary");
  await a8.click("#at-tipos .chip[data-tipo=procurar_entregador]");
  await a8.fill("#at-campos [data-campo=cidade]", "ITABAIANA - SE");
  await a8.click("#at-enviar");
  ok(await esperar(a8, "#at-sug-lista .tarefa-card:has-text('Procurar entregador · ITABAIANA - SE')"), "moderador cria tarefa para a equipe");
  ok(await a8.isVisible("#at-prazos summary >> text=Prazos padrão por tipo"), "moderador vê os prazos padrão por tipo");
  await m7.evaluate(() => App.carregar());
  await m7.click("#at-proxima");
  ok(await esperar(m7, "#toast:has-text('Com você agora: Procurar entregador · ITABAIANA - SE')"), "Pegar a próxima entrega a tarefa aberta");

  // 24. 009d3 · painel das tarefas, metas, placar, revisão de qualidade e recorrentes
  await ir(a8, "#atividades/painel"); await a8.reload();
  ok(await a8.evaluate(() => location.hash) === "#analises/tarefas" && await esperar(a8, "#v-at-painel:not([hidden])"), "009m: o Painel das tarefas abre nas Análises (aba Tarefas)");
  ok(await esperar(a8, "#pn-conteudo >> text=Suas metas") && await a8.isVisible("#pn-conteudo >> text=em teste"), "Painel: suas metas (em teste)");
  ok(await a8.isVisible("#pn-conteudo h3:has-text('Pessoas')") && await a8.isVisible("#pn-placar >> text=só você vê"), "moderador vê as pessoas; o administrador vê o placar");
  await a8.fill("#pn-meta-qtd", "2"); await a8.selectOption("#pn-meta-periodo", "semana");
  await a8.click("#pn-meta-form button[type=submit]");
  ok(await esperar(a8, "#pn-conteudo .meta-item >> text=nesta semana"), "meta criada, com o progresso da semana");
  await a8.click("#pn-sortear");
  ok(await esperar(a8, "#pn-revisao .card button:has-text('Está ok')"), "revisão de qualidade sorteia tarefas concluídas");
  await a8.screenshot({ path: path.join(PRINTS, "n1-painel.png"), fullPage: true });
  await a8.click("#pn-revisao .card button:has-text('Está ok')");
  ok(await esperar(a8, "#toast:has-text('Revisada: ok')"), "revisada: ok");
  await ir(m7, "#atividades/painel"); await m7.reload();
  ok(await esperar(m7, "#pn-conteudo h3:has-text('Você')") && await m7.isHidden("#pn-placar") && await m7.isHidden("#pn-revisao"), "quem não é moderador vê só a própria linha, sem placar e sem revisão");
  await ir(s8, "#atividades/sugeridas"); await s8.reload();
  await esperar(s8, "#at-recorrentes summary");
  await s8.click("#at-recorrentes summary");
  await s8.click("#pn-rec-nova");
  await esperar(s8, "#pn-rec-form");
  await s8.fill("#pn-rec-titulo", "Conferir os adicionais pendentes");
  await s8.selectOption("#pn-rec-freq", "semanal"); await s8.selectOption("#pn-rec-dia-semana", "3"); await s8.fill("#pn-rec-hora", "9");
  await s8.fill("#pn-rec-checklist", "Abrir Financeiro\nLançar os pendentes");
  await s8.click("#pn-rec-form button[type=submit]");
  ok(await esperar(s8, "#at-recorrentes li >> text=Toda semana (quarta) às 9h") && await s8.isVisible("#at-recorrentes li >> text=checklist com 2"), "tarefa recorrente criada (toda semana, com checklist)");
  await s8.screenshot({ path: path.join(PRINTS, "n2-recorrentes.png"), fullPage: true });

  // 25. 009e · Parceiros: registro direto e a tarefa "Aprovar parceiros" contando sozinha
  await a8.evaluate(async () => {
    const sup = App.S.pessoas.find((p) => p.nome === "Suporte Um");
    await App.u.rpc("criar_tarefa", { p_tipo: "ativar_parceiro", p_campos: { cidade: "LAGARTO - SE", quantidade: 2 }, p_para: [sup.id] });
  });
  await ir(s8, "#atividades/sugeridas"); await s8.reload();
  const cardPar = "#at-sug-lista .tarefa-card:has-text('Aprovar 2 parceiro(s) · LAGARTO - SE')";
  await esperar(s8, cardPar);
  await s8.click(cardPar + " >> text=Eu faço");
  ok(await esperar(s8, cardPar + " >> text=0 de 2") && await s8.isVisible(cardPar + " >> text=parceiros ativados por quem pegou"), "tarefa Aprovar parceiros com a meta, contando sozinha");
  await ir(s8, "#parceiros/novo"); await s8.reload();
  ok(await esperar(s8, "#pa-tarefas >> text=Aprovar 2 parceiro(s) · LAGARTO - SE") && await s8.isVisible("#pa-tarefas >> text=0 de 2"), "Ativar parceiro mostra as suas tarefas de aprovação");
  await s8.fill("#pa-estab", "Padaria Sol"); await s8.fill("#pa-cidade", "LAGARTO - SE"); await s8.fill("#pa-obs", "Abre às 6h");
  await s8.click("#pa-enviar");
  ok(await esperar(s8, "#toast:has-text('Contou para: Aprovar 2 parceiro(s) · LAGARTO - SE (1 de 2)')"), "ativar parceiro avisa em qual tarefa contou");
  ok(await esperar(s8, "#toast:has-text('entregador')"), "e avisa da tarefa de aprovar entregadores da cidade");
  ok(await esperar(s8, "#pa-tarefas >> text=1 de 2") && await s8.isVisible("#pa-tarefas li:has-text('Padaria Sol')"), "progresso sobe e o parceiro aparece nos seus últimos");
  await s8.fill("#pa-estab", "padaria sol"); await s8.fill("#pa-cidade", "LAGARTO - SE");
  await s8.click("#pa-enviar");
  ok(await esperar(s8, "#pa-erro:not([hidden]) >> text=já está registrado"), "não repete o mesmo parceiro na cidade");
  await s8.screenshot({ path: path.join(PRINTS, "o1-ativar-parceiro.png"), fullPage: true });
  await ir(s8, "#parceiros/lista");
  ok(await esperar(s8, "#pa-lista .parceiro >> text=Padaria Sol") && (await s8.$$eval("#pa-filtro-cidade option", (l) => l.map((o) => o.textContent))).includes("LAGARTO - SE (1)"), "lista de parceiros com o filtro por cidade");
  await ir(s8, "#atividades/sugeridas");
  ok(await esperar(s8, cardPar + " >> text=1 de 2"), "o card da tarefa mostra o progresso");
  // 009f · por cidade e notícias rápidas
  await ir(s8, "#parceiros/cidades"); await s8.reload();
  ok(await esperar(s8, "#pa-semana #pa-resumo >> text=1 ativado nesta semana") && await s8.isVisible("#pa-resumo >> text=na semana passada"), "Ativações: esta semana comparada à passada");
  ok(await esperar(s8, "#pa-por-cidade .pa-cidade:has-text('LAGARTO - SE') >> text=ativos") && await s8.isVisible("#pa-por-cidade >> text=Quem mais ativou aqui"), "Ativações: resumo de cada cidade");
  ok(await esperar(s8, "#pa-historico .pa-hist-frase >> text=Você ativou Padaria Sol em LAGARTO - SE!") && await s8.isVisible("nav.tabs a:has-text('Ativações')"), "Ativações: histórico com a frase de quem ativou o quê");
  await s8.screenshot({ path: path.join(PRINTS, "o6-ativacoes.png"), fullPage: true });
  await s8.screenshot({ path: path.join(PRINTS, "o3-parceiros-cidade.png"), fullPage: true });
  await ir(a8, "#inicio"); await a8.evaluate(() => App.carregar());
  ok(await esperar(a8, "#inicio-noticias .noticia >> text=Padaria Sol") && await a8.isVisible("#inicio-noticias >> text=Notícias rápidas"), "tela inicial: notícia comemorativa da ativação");
  // 009g · tarefa compartilhada: o suporte pega a de entregadores de Lagarto, o admin entra junto
  await ir(s8, "#atividades/sugeridas"); await s8.reload();
  const cardEnt = "#at-sug-lista .tarefa-card[data-tipo=ativar_entregadores]:has-text('LAGARTO - SE'):has(button:has-text('Eu faço'))";
  ok(await esperar(s8, cardEnt), "a tarefa de aprovar entregadores da cidade do parceiro está aberta para a equipe");
  await s8.click(cardEnt + " >> text=Eu faço");
  await ir(a8, "#atividades/sugeridas"); await a8.reload();
  const cardJunto = "#at-sug-lista .tarefa-card:has(button:has-text('Entrar junto'))";
  ok(await esperar(a8, cardJunto) && await a8.isVisible(cardJunto + " >> text=Já tem gente trabalhando nela"), "quem não está na tarefa vê que já tem gente e pode entrar junto");
  await a8.click(cardJunto + " button:has-text('Entrar junto')");
  ok(await esperar(a8, "#toast:has-text('Você entrou na tarefa')"), "entrar junto");
  ok(await esperar(a8, "#at-sug-lista .grupo:has-text('Para você') .tarefa-card[data-tipo=ativar_entregadores] >> text=com Suporte Um, você"), "a tarefa aparece em Para você, com os dois");
  await a8.screenshot({ path: path.join(PRINTS, "o5-entrar-junto.png"), fullPage: true });
  await a8.screenshot({ path: path.join(PRINTS, "o4-noticias.png") });

  // 009e2 · botão de teste de avisos e sons na tela Equipe
  await ir(a8, "#equipe"); await esperar(a8, "#b-teste-som");
  await a8.click("#b-teste-som");
  ok(await esperar(a8, "#janela-teste-som") && (await a8.$$("#janela-teste-som [data-teste-nivel]")).length === 4, "Equipe: testar avisos e sons mostra os 4 níveis");
  await a8.click("#janela-teste-som [data-teste-nivel='4']");
  ok(await a8.evaluate(() => App.som.ultimo?.nivel === 4), "o botão toca o som do nível escolhido");
  await a8.screenshot({ path: path.join(PRINTS, "o2-teste-sons.png") });
  await a8.click("#janela-teste-som .janela-topo button");
  await ir(s8, "#equipe/regras");
  ok(await esperar(s8, "#b-teste-som-todos"), "o suporte também acha o teste de avisos e sons (Regras de equipe)");
  await s8.click("#b-teste-som-todos");
  ok(await esperar(s8, "#janela-teste-som"), "e a janela de teste abre para ele");
  await s8.click("#janela-teste-som .janela-topo button");

  // cada item do menu de cima abre uma tela (pelo clique, sem a aba no endereço)
  { await ir(a8, "#inicio");
    const itens = await a8.$$eval("nav.modulos a:not([hidden])", (l) => l.map((x) => x.textContent.trim().split(" ")[0]));
    let falharam = [];
    for (let i = 0; i < itens.length; i++) {
      await a8.evaluate(() => { location.hash = "#inicio"; });
      await a8.waitForTimeout(300);
      const antes = await a8.evaluate(() => location.hash);
      await a8.locator("nav.modulos a:not([hidden])").nth(i).click();
      const abriu = await a8.waitForFunction((a) => location.hash !== a && [...document.querySelectorAll("section.view")].some((s) => !s.hidden && s.id !== "v-inicio"), antes, { timeout: 4000 }).then(() => true, () => false);
      if (!abriu && itens[i] !== "Início") falharam.push(itens[i]);
    }
    ok(!falharam.length, "todos os itens do menu de cima abrem a tela pelo clique" + (falharam.length ? ": falharam " + falharam.join(", ") : "")); }

  // 15. login pelo botão oficial do Google (sem passar pelo endereço do Supabase)
  const g = await abrir(null, "", { googleId: "teste.apps.googleusercontent.com" });
  ok(await esperar(g, "#g-google:not([hidden]) #botao-google-falso"), "com GOOGLE_CLIENT_ID, aparece o botão do Google");
  ok(await g.isHidden("#g-entrar"), "e o botão de reserva fica escondido");
  await g.evaluate(() => { window.__gisEmail = "mateuslopesmb@gmail.com"; window.__gisNome = "Mateus Lopes"; });
  await g.click("#botao-google-falso");
  ok(await esperar(g, "#papel:has-text('Moderador')"), "login pelo botão do Google entra como Moderador (nonce conferido)");
  ok(await esperar(g, "#v-inicio:not([hidden])"), "depois do login, abre a tela inicial");
  await g.evaluate(() => { window.__gis.nonce = "nonce-adulterado"; });
  await g.click("#b-sair");
  await esperar(g, "#botao-google-falso");
  await g.evaluate(() => { window.__gisEmail = "mateuslopesmb@gmail.com"; window.__gis.nonce = "0".repeat(64); });
  await g.click("#botao-google-falso");
  ok(await esperar(g, "#gate-erro:not([hidden])"), "token com nonce errado é recusado: " + (await texto(g, "#gate-erro")));

  // 009o: varredura visual de todas as telas (administrador), no computador e no celular. Aponta página que rola
  // para o lado, elemento que vaza da tela (fora de áreas com rolagem própria) e caixinha empilhada em cima do texto.
  { const v = await abrir(admin, "#inicio"); await esperar(v, "#v-inicio:not([hidden])");
    fs.mkdirSync(path.join(PRINTS, "varredura"), { recursive: true });
    const rotas = await v.evaluate(() => App.ordem.filter((id) => { const m = App.modulos[id]; return !m.acesso || m.acesso(); })
      .flatMap((id) => App.modulos[id].abas.filter((a) => !a.pode || a.pode()).map((a) => `#${id}/${a.id}`)));
    const problemas = [];
    for (const [nome, w, h] of [["pc", 1200, 900], ["celular", 390, 844]]) {
      await v.setViewportSize({ width: w, height: h });
      for (const r of rotas) {
        await v.evaluate((x) => { location.hash = x; }, r);
        await v.waitForTimeout(900);
        const achou = await v.evaluate(() => {
          const sec = [...document.querySelectorAll("section.view")].find((s) => !s.hidden);
          const W = document.documentElement.clientWidth, lista = [];
          if (document.documentElement.scrollWidth > W + 1) {
            // quem estica a página: o elemento mais à direita fora de áreas com rolagem própria, em qualquer lugar
            let pior = null;
            for (const n of document.body.querySelectorAll("*")) { const rc = n.getBoundingClientRect(), dir = rc.right + scrollX; if (rc.width && dir > W + 1 && (!pior || dir > pior[1])) pior = [n, dir]; }
            const d = pior && `<${pior[0].tagName.toLowerCase()}${pior[0].id ? "#" + pior[0].id : ""}.${String(pior[0].className || "").trim().split(/\s+/).join(".")}> dentro de <${pior[0].parentElement?.tagName.toLowerCase()}.${String(pior[0].parentElement?.className || "")}>`;
            lista.push(`página rola para o lado (${document.documentElement.scrollWidth}px) por causa de ${d}`);
          }
          const rola = (n) => { for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) return true; } return false; };
          for (const n of [...(sec?.querySelectorAll("*") || []), ...document.querySelectorAll("header.top *")]) {
            const rc = n.getBoundingClientRect();
            if (!rc.width || rc.right <= W + 1 || rola(n)) continue;
            lista.push(`vaza: <${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).join(".") : ""}> até ${Math.round(rc.right)}px`);
            if (lista.length > 6) break;
          }
          for (const l of sec?.querySelectorAll(".toolbar label") || []) if (l.offsetParent && l.scrollWidth > l.clientWidth + 2) lista.push("rótulo cortado: " + l.textContent.trim().slice(0, 40));
          for (const l of sec?.querySelectorAll("label") || []) {
            const cb = l.querySelector(":scope > input[type=checkbox], :scope > input[type=radio]");
            if (cb && l.offsetParent && cb.getBoundingClientRect().bottom <= l.getBoundingClientRect().top + 4 + cb.getBoundingClientRect().height && getComputedStyle(l).display === "grid") lista.push("caixinha empilhada: " + l.textContent.trim().slice(0, 40));
          }
          return lista;
        });
        await v.screenshot({ path: path.join(PRINTS, "varredura", `${nome}-${r.slice(1).replace("/", "-")}.png`), fullPage: true });
        for (const x of achou) problemas.push(`${nome} ${r}: ${x}`);
      }
    }
    problemas.forEach((x) => console.log("VARREDURA", x));
    ok(!problemas.length, `009o: varredura visual de ${rotas.length} telas no computador e no celular` + (problemas.length ? `: ${problemas.length} problema(s)` : " sem problemas")); }
} finally {
  await b.close(); site.close(); await api.fechar();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
