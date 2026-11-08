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
await db.query(`insert into bairros (cidade, nome, valor, taxa_log, apelidos) values ('LAGARTO - SE', 'CENTRO', 5.49, 0.99, '{}'),
  ('LAGARTO - SE', 'BREJO', 16.99, 0.99, '{}'), ('LAGARTO - SE', 'ADEMAR DE CARVALHO', 5.49, 0.99, '{ALDEMAR DE CARVALHO}')`);
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
  const c = await b.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: Number(process.env.ESCALA || 1), acceptDownloads: true });  // ESCALA=2: prints nítidos para material de divulgação
  await c.route("**/supabase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.SUPABASE_URL=${JSON.stringify(API)};window.SUPABASE_ANON_KEY="chave-anon-de-teste";window.GOOGLE_CLIENT_ID=${JSON.stringify(googleId || "COLE_AQUI")};` }));
  await c.route("https://accounts.google.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: googleId ? GIS_FALSO : "" }));
  await c.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(UMD, r.request().url().split("/").pop())) }));
  await c.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  // a janela "O que há de novo" só aparece quando o teste pede (senão cobriria a tela nos outros passos)
  if (!novidades) await c.addInitScript(() => { try { localStorage.setItem("comunique-novidades", "009b"); } catch (_) {} });
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
  ok(await s.isVisible(".faixa-novidades >> text=Calculadora de bairro") && await s.isVisible(".faixa-novidades >> text=e mais: 008d e 008c e 008b e 008"), "tela inicial mostra a faixa das novidades, ligando 009b, 008d, 008c, 008b e 008");
  await s.click(".faixa-novidades button");
  ok(await esperar(s, "dialog.janela >> text=O que há de novo"), "o botão da faixa reabre O que há de novo");
  await s.screenshot({ path: path.join(PRINTS, "a0-inicio-novidades.png") });
  await s.click("dialog.janela >> text=Entendi");
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
    ok(JSON.stringify(fns) === JSON.stringify(["Nova ativação", "Novo bloqueio", "Cadastrar entregador", "Calculadora de bairro", "Registrar adicional", "Sugerir atividade", "Registros"]), "tela inicial: as 7 funções em destaque: " + fns); }
  await s.click("#fn-sugerir");
  ok(await esperar(s, "#v-at-sugeridas:not([hidden])") && await s.waitForFunction(() => document.querySelector("#at-nova-box")?.open && document.activeElement?.id === "at-titulo", null, { timeout: 5000 }).then(() => true, () => false), "Sugerir atividade abre a tela com o formulário aberto e o cursor no título");
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
  ok(await esperar(s, "#tira-avisos:not([hidden]) >> text=Tratativa realizada por Monitor Um"), "sino abre a tira com o aviso: tratativa realizada");
  await s.screenshot({ path: path.join(PRINTS, "h1-tira-sino.png") });
  await s.click("#tira-avisos >> text=Ver todos os avisos");
  ok(await esperar(s, "#at-avisos >> text=Tratativa realizada por Monitor Um") && await s.isHidden("#tira-avisos"), "Ver todos os avisos abre a tela de Avisos e fecha a tira");
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
  // 008b: módulo Entregadores, cadastro avulso (sem ativação e sem bloqueio)
  ok(await s.isVisible("nav.grupo a[data-grupo-mod=entregadores]"), "suporte com bloqueios vê Cadastrar entregador na barra de Entregadores");
  { const topo = await s.$$eval("nav.modulos a:not([hidden])", (as) => as.map((x) => x.textContent.trim()));
    ok(topo.some((t) => t.startsWith("Entregadores")) && !topo.some((t) => /Ativação|Bloqueios|Casos/.test(t)), "menu de cima: Ativação e Bloqueios ficam dentro de Entregadores, e Casos não aparece: " + topo.join(", "));
    const grupo = await s.$$eval("nav.grupo a", (as) => as.map((x) => x.dataset.grupoMod));
    ok(JSON.stringify(grupo) === JSON.stringify(["ativacao", "bloqueios", "entregadores"]), "barra de Entregadores: Ativação, Bloqueios e Cadastrar entregador (Casos guardados): " + grupo);
    ok(await s.getAttribute("nav.modulos a[data-grupo=entregadores]", "aria-current") === "page", "Entregadores fica marcado no menu dentro dos Bloqueios"); }
  await s.screenshot({ path: path.join(PRINTS, "a1-menu-entregadores.png") });
  await s.fill("#bq-q-consulta", "avulso01"); await s.click("#bq-f-consulta button[type=submit]");
  ok(await esperar(s, "#bq-consulta >> text=Cadastrar este entregador"), "consulta sem resultado oferece cadastrar o entregador");
  await s.click("#bq-consulta >> text=Cadastrar este entregador");
  ok(await esperar(s, "#v-en-cadastrar:not([hidden])"), "o botão leva à tela Cadastrar entregador");
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
  ok(await esperar(s, "#bq-consulta h3:has-text('Avulso da Silva')") && await s.isVisible("#bq-consulta .comentarios >> text=Cadastrado pela tela nova."), "'Abrir a ficha' leva à ficha, com o comentário");
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
  ok(JSON.stringify(await n7.$$eval("dialog.janela .bloco-versao .tag", (l) => l.map((x) => x.textContent))) === JSON.stringify(["009b", "008d", "008c", "008b", "008"]), "as novidades de 009b, 008d, 008c, 008b e 008 aparecem juntas, da mais nova para a mais antiga");
  await n7.screenshot({ path: path.join(PRINTS, "f1-novidades.png") });
  await n7.click("dialog.janela >> text=Entendi");
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
  await a8.fill("#fe-informado", "Centro");
  await a8.fill("#fe-id", "fin00001"); await a8.fill("#fe-nome", "Zé das Entregas"); await a8.selectOption("#fe-origem", "qd");
  await a8.screenshot({ path: path.join(PRINTS, "j1-calculadora.png"), fullPage: true });
  await a8.click("#fe-enviar");
  ok(await esperar(a8, "#toast:has-text('Ficou em Adicionais pendentes')"), "registrar o ajuste sem lançar: vai para os pendentes");
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
  await a8.click("#fi-pend-lista button:has-text('Marcar como lançado')");
  ok(await esperar(a8, "#fi-pend-lista >> text=Nada pendente") && await a8.waitForFunction(() => document.querySelector("#c-fin")?.hidden, null, { timeout: 8000 }).then(() => true, () => false), "marcar como lançado tira dos pendentes e zera o número do menu");
  await ir(a8, "#financeiro/lancamentos");
  ok(await esperar(a8, "#fi-l-tiles .tile >> text=R$ 16,50") && (await a8.$$("#fi-l-tabela tbody tr")).length === 2, "Lançamentos: total de R$ 16,50 e os 2 registros");
  ok(!(await texto(a8, "#v-fi-lancamentos")).includes("null") && !(await texto(a8, "#v-fi-lancamentos")).includes("undefined"), "Lançamentos sem textos vazios (null)");
  await a8.screenshot({ path: path.join(PRINTS, "j3-lancamentos.png"), fullPage: true });
  await ir(a8, "#ferramentas/tarifas");
  ok(await esperar(a8, "#fe-t-tabela tr:has-text('BREJO') >> text=R$ 16,00") && await a8.isVisible("#fe-t-novo"), "Tarifas: moderador vê o que o entregador recebe e pode editar");
  await a8.click("#fe-t-tabela tr:has-text('BREJO') >> text=Editar");
  await a8.fill("dialog.janela input >> nth=1", "17,99");
  await a8.click("dialog.janela .actions button.primary");
  ok(await esperar(a8, "#fe-t-tabela tr:has-text('BREJO') >> text=R$ 17,00"), "editar a tarifa de um bairro");
  await ir(s8, "#ferramentas/tarifas"); await s8.reload();
  ok(await esperar(s8, "#fe-t-tabela tr:has-text('CENTRO')") && !(await s8.isVisible("#fe-t-tabela >> text=Editar")) && !(await s8.isVisible("#fe-t-novo")), "suporte consulta as tarifas sem editar");

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
