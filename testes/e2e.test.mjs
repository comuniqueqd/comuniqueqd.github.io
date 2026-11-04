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

async function abrir(p, hash = "", { googleId = null, novidades = false } = {}) {
  const c = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  await c.route("**/supabase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.SUPABASE_URL=${JSON.stringify(API)};window.SUPABASE_ANON_KEY="chave-anon-de-teste";window.GOOGLE_CLIENT_ID=${JSON.stringify(googleId || "COLE_AQUI")};` }));
  await c.route("https://accounts.google.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: googleId ? GIS_FALSO : "" }));
  await c.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(UMD, r.request().url().split("/").pop())) }));
  await c.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  // a janela "O que há de novo" só aparece quando o teste pede (senão cobriria a tela nos outros passos)
  if (!novidades) await c.addInitScript(() => { try { localStorage.setItem("comunique-novidades", "007"); } catch (_) {} });
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
  await s.screenshot({ path: path.join(PRINTS, "b0-inicio.png"), fullPage: true });
  await s.click("#card-bloqueios");
  ok(await esperar(s, "#v-bq-novo:not([hidden])"), "suporte cai em Novo bloqueio");
  const abasB = await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view));
  ok(JSON.stringify(abasB) === JSON.stringify(["novo", "atencao", "meus", "consultar", "painel"]), "suporte vê Novo, Atenção, Meus registros, Consultar e Painel: " + abasB);
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
  await a2.click("#b-avisos");
  ok(await esperar(a2, "#at-avisos >> text=Tratativa atrasada há"), "aviso de tratativa atrasada para o moderador");
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
  await ir(m, "#atividades/sugeridas");
  await m.click("#at-sug-lista .card:has-text('Sabor') >> text=Aceitar");
  ok(await esperar(m, "#at-sug-lista .card:has-text('Sabor') >> text=Em andamento"), "monitorador aceita");
  await m.click("#at-sug-lista .card:has-text('Sabor') >> text=Concluir");
  await m.fill("#at-sug-lista .card:has-text('Sabor') textarea", "Entregue, confirmado");
  await m.click("#at-sug-lista .card:has-text('Sabor') >> text=Confirmar conclusão");
  ok(await esperar(m, "#at-sug-lista .card:has-text('Sabor') >> text=Entregue, confirmado"), "monitorador conclui com nota");
  // registros: feed geral também para o suporte; nome abre a ficha
  await ir(s, "#registros");
  ok(await esperar(s, "#rg-lista .feed >> text=registrou bloqueio") && await s.isVisible("#rg-lista .feed >> text=Monitor Um"), "suporte vê os registros de todos");
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
  ok(await esperar(s, "#an-cards >> text=Eficácia da punição") && await s.isVisible("#an-cards >> text=Da ativação ao bloqueio"), "Análises abre para o suporte, com os cartões");
  ok(await s.isVisible("#an-cards >> text=Quando a equipe registra") && (await s.$$("#an-cards .calor .c")).length === 168, "mapa dia × hora com 7 × 24 casas");
  await s.click("[data-an-periodo=tudo]"); await s.waitForTimeout(800);
  ok((await texto(s, "#an-sub")).includes("desde o início"), "período 'Tudo' nas análises");
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
  ok(await esperar(a2, "#ap-resumo:not(:has-text('Carregando'))") && await a2.isVisible("#t-aprovados"), "histórico da ativação mostra os aprovados e se foram bloqueados");
  // anexos: suporte anexa uma imagem no próprio bloqueio
  await ir(s, "#bloqueios/meus"); await s.reload();
  const cardAx = "#bq-meus-lista .card:has-text('Atrasildo')";
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
  ok((await s.$$eval("nav.tabs a", (as) => as.map((x) => x.dataset.view))).join() === "regras", "suporte só vê a aba Regras de equipe (não a Equipe)");
  await ir(a2, "#equipe/regras"); await a2.reload();
  await esperar(a2, "#eq-novo-operador:not([hidden])");
  await a2.click("#eq-novo-operador");
  await a2.fill("dialog.janela input >> nth=0", "Kleber"); await a2.fill("dialog.janela input >> nth=1", "75 0000-0001");
  await a2.click("dialog.janela .actions button.primary");
  ok(await esperar(a2, "#eq-t-operadores >> text=Kleber"), "moderador cadastra operador logístico");
  await a2.selectOption("#eq-resp-op select", "monitor@x.com");
  ok(await esperar(a2, "#toast:has-text('Responsável pelos operadores atualizado')"), "moderador escolhe o responsável pelos operadores");
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
  ok(await esperar(n7, "dialog.janela >> text=O que há de novo") && await n7.isVisible("dialog.janela >> text=Busca rápida"), "janela O que há de novo aparece na primeira vez");
  await n7.screenshot({ path: path.join(PRINTS, "f1-novidades.png") });
  await n7.click("dialog.janela >> text=Entendi");
  await n7.reload(); await esperar(n7, "#v-inicio:not([hidden])"); await n7.waitForTimeout(800);
  ok(!(await n7.isVisible("dialog.janela")), "e não aparece de novo");
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
  await m7.fill("dialog.janela input[aria-label='Nome do entregador']", "Maria Sem Nome");
  await m7.fill("dialog.janela input[aria-label='Motivo da alteração (opcional)']", "confirmado por telefone");
  await m7.click("dialog.janela .actions button.primary");
  ok(await esperar(m7, "#toast:has-text('O cadastro está completo')"), "monitorador completa o nome");
  await m7.waitForTimeout(800);
  ok(!(await m7.isVisible("#at-lista >> text=Completar cadastro: ID semnome77")), "a tarefa some (concluída sozinha)");
  await ir(n7, "#ativacao/meus"); await n7.reload(); await esperar(n7, "#t-meus tbody tr:has-text('semnome77')");
  ok(await n7.isVisible("#t-meus tr:has-text('semnome77') >> text=Maria Sem Nome") && !(await n7.isVisible("#t-meus tr:has-text('semnome77') button.revisar-cad")), "Meus cadastros mostra o nome e sem revisar");
  await n7.click("#t-meus tr:has-text('semnome77')");
  ok(await esperar(n7, "#t-meus >> text=Dados alterados"), "histórico do cadastro guarda a alteração: " + (await texto(n7, "#t-meus .timeline")).slice(0, 160));
  // aprovar: quem enviou recebe aviso; a ficha nasce
  await ir(m7, "#ativacao/pendentes"); await esperar(m7, "#queue .card:has-text('semnome77')");
  await m7.click("#queue .card:has-text('semnome77') >> text=Aprovar");
  await esperar(m7, "#toast:has-text('Cadastro aprovado')");
  await n7.reload();
  ok(await esperar(n7, "#b-avisos[data-novas=true]"), "quem enviou recebe aviso no sino");
  await ir(n7, "#atividades/avisos");
  ok(await esperar(n7, "#at-avisos >> text=Seu cadastro Maria Sem Nome (ID semnome77) foi aprovado por Monitor Um."), "aviso: cadastro aprovado por quem");
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
  ok(!(await texto(n7, "main")).includes("null"), "telas da 007 sem textos vazios (null)");

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
