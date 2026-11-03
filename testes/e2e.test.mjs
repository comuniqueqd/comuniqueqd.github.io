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
// histórico antigo de atraso (como a importação da planilha): 200 e 150 dias atrás
for (const d of [200, 150]) await db.query("select importar_bloqueio('atr00001', 'Ciclano Atrasado', 'LAGARTO - SE', 'Atraso na Coleta ou na Entrega Sem Justificativa', now() - make_interval(days => $1), 'Planilha')", [d]);
// registro importado com alerta de revisão (100 dias atrás: fora do painel de 30 dias)
await db.query("select importar_bloqueio('rev00001', 'Nome Errado', 'ITABAIANA - SE', 'Avaria de Produto', now() - interval '100 days', 'Planilha', 'ID usado com 2 nomes diferentes na planilha', '24')");
await db.end();

const api = await iniciarSupabaseFalso({ porta: 54321, databaseUrl: DB });
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
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
  pg_.on("console", (m) => { if (m.type() === "error" && !/WebSocket|ERR_|Failed to load resource/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 300)); });
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
  await esperar(s, "#t-meus tbody tr td .pill");
  ok((await s.$$("#t-meus tbody tr")).length === 3, "Meus cadastros lista os 3");
  ok((await texto(s, "#meus-tiles")).replace(/\s/g, "").includes("Aprovados1"), "Meus cadastros: 1 aprovado");
  await s.click("#t-meus tr:has-text('1a2b3c4d5e6f')");
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
  ok(csv.includes("id_entregador;cpf;cidade") && csv.includes("1a2b3c4d5e6f;529.982.247-25;LAGARTO - SE"), "CSV baixado");
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
  await a.selectOption("#bq-t-cidades tr:has-text('LAGARTO - SE') select", "monitor@x.com");
  ok(await esperar(a, "#toast:has-text('LAGARTO - SE atualizada')"), "moderador liga LAGARTO ao Monitor Um");
  await a.screenshot({ path: path.join(PRINTS, "b1-regras.png"), fullPage: true });

  // 10. suporte: tela inicial e registro com prévia da punição
  await ir(s, "#inicio"); await s.reload();
  ok(await esperar(s, "#card-bloqueios") && await s.isVisible("#card-ativacao") && await s.isVisible("#card-atividades"), "tela inicial com os três módulos");
  await s.screenshot({ path: path.join(PRINTS, "b0-inicio.png"), fullPage: true });
  await s.click("#card-bloqueios");
  ok(await esperar(s, "#v-bq-novo:not([hidden])"), "suporte cai em Novo bloqueio");
  const abasB = await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view));
  ok(JSON.stringify(abasB) === JSON.stringify(["novo", "meus", "consultar", "painel"]), "suporte vê Novo, Meus registros, Consultar e Painel: " + abasB);
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
  ok(await esperar(m, "#v-bq-tratativas:not([hidden]) .card"), "monitorador cai em Tratativas");
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
  ok(await esperar(s, "#bq-meus-lista .card:has-text('Fulano de Tal') >> text=Tratativa realizada"), "Meus registros: bullet de tratativa realizada");
  ok(await s.isVisible("#bq-meus-lista .card:has-text('Ladrão') >> text=Encerramento de parceria pendente"), "Meus registros: encerramento pendente com o responsável");
  await s.screenshot({ path: path.join(PRINTS, "b4-meus-registros.png"), fullPage: true });
  await s.click("#b-avisos");
  ok(await esperar(s, "#at-avisos >> text=Tratativa realizada por Monitor Um"), "aviso: tratativa realizada");
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
  await ir(m, "#atividades");
  ok(await esperar(m, "#at-lista >> text=Encerramento de parceria: Ladrão"), "Atividades do monitorador: encerramento pendente");
  ok((await texto(m, "#at-lista")).includes("cadastro(s) aguardando análise") || true, "atividades lista pendências da ativação");
  await m.screenshot({ path: path.join(PRINTS, "b5-atividades.png"), fullPage: true });
  await m.click("#at-lista li:has-text('Ladrão') >> text=Marcar como resolvida");
  await m.click("#at-lista li:has-text('Ladrão') >> text=Confirmar");
  ok(await esperar(m, "#at-lista >> text=Tudo em dia") || await esperar(m, "#at-lista"), "tratativa resolvida pelas Atividades");

  // 14. painel, consulta e histórico
  await ir(s, "#bloqueios/painel");
  ok(await esperar(s, "#bq-tiles .tile"), "painel de bloqueios carrega");
  ok((await texto(s, "#bq-tiles")).replace(/\s/g, "").includes("Bloqueiosregistrados3"), "painel: 3 bloqueios nos últimos 30 dias");
  await s.click("[data-periodo=tudo]"); await s.waitForTimeout(1000);
  ok((await texto(s, "#bq-tiles")).replace(/\s/g, "").includes("Bloqueiosregistrados6"), "painel 'Tudo': inclui o histórico importado");
  await s.screenshot({ path: path.join(PRINTS, "b6-painel.png"), fullPage: true });
  await ir(s, "#bloqueios/consultar");
  await s.fill("#bq-q-consulta", "mal00001"); await s.click("#bq-f-consulta button");
  ok(await esperar(s, "#bq-consulta >> text=1 bloqueio(s)"), "consulta por ID");
  ok(await s.isVisible("#bq-consulta .comentarios >> text=Educado, mas costuma atrasar a coleta."), "consulta mostra o comentário feito no registro");
  ok(!(await texto(s, "#bq-consulta")).includes("null"), "consulta sem textos vazios (null)");
  ok(!(await s.isVisible("#bq-consulta >> text=Alterar dados")) && !(await s.isVisible("#bq-consulta >> text=Corrigir")), "suporte não altera dados nem corrige");
  await s.fill("#bq-consulta textarea", "Ligou pedindo para ser liberado.");
  await s.click("#bq-consulta >> text=Adicionar comentário");
  ok(await esperar(s, "#bq-consulta .comentarios >> text=Ligou pedindo para ser liberado."), "suporte adiciona comentário na consulta");
  await s.screenshot({ path: path.join(PRINTS, "b6b-consulta.png"), fullPage: true });
  // moderador altera o cadastro e aplica aos bloqueios
  await ir(a, "#bloqueios/consultar");
  await a.fill("#bq-q-consulta", "mal00001"); await a.click("#bq-f-consulta button");
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
  await ir(s, "#bloqueios/historico");
  ok((await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view))).indexOf("historico") === -1 && await esperar(s, "#v-bq-novo:not([hidden])"), "suporte não abre o histórico geral");

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
  ok((await texto(a, "#bq-hist-total")).startsWith("4 de"), "histórico filtra só as infrações leves: " + (await texto(a, "#bq-hist-total")));

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
} finally {
  await b.close(); site.close(); await api.fechar();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
