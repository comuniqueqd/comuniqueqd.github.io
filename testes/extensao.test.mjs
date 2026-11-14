// Teste da extensão do Comunique (pasta extensao/): carrega no Chromium uma cópia ligada ao banco de teste
// (Postgres + testes/supabase-falso.mjs) e confere o painel lateral, o leitor das telas do Quero Log e do Crisp
// (páginas falsas, sem dados reais), os formulários curtos do cartão (1.1: grava direto, com conferência),
// o aviso de ID com outro nome e o "não encontrei ID de entregador nesta tela".
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node extensao.test.mjs
import { chromium } from "playwright";
import pg from "pg";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { iniciarSupabaseFalso } from "./supabase-falso.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
let falhas = 0;
const ok = (c, msg) => { console.log((c ? "ok     " : "FALHOU ") + msg); if (!c) falhas++; };

// banco: todas as migrações até a 009s
const db = new pg.Client({ connectionString: DB });
await db.connect();
await db.query("set client_min_messages = warning");
for (const f of ["testes/supabase-local.sql", "supabase/schema.sql", "supabase/002-bloqueios.sql", "supabase/003-entregadores.sql",
  "supabase/004-atividades-registros.sql", "supabase/005-analises-anexos.sql", "supabase/006-equipe-previsao-atencao.sql",
  "supabase/007-pao-quentinho.sql", "supabase/008-espionagem.sql", "supabase/008b-cadastrar-entregador.sql", "supabase/008b-notificacoes.sql",
  "supabase/008c-analises.sql", "supabase/008d-avisos-parte2.sql", "supabase/009b-ferramentas-financeiro.sql", "supabase/009c-mensagens-agravante.sql",
  "supabase/009c2-mensagens-opcoes.sql", "supabase/009d-ajuda-aviso-turno.sql", "supabase/009d2-tarefas-cards.sql",
  "supabase/009d3-painel-metas-recorrentes.sql", "supabase/009e-parceiros.sql", "supabase/009f-parceiros-completo.sql",
  "supabase/009g-tarefas-compartilhadas.sql", "supabase/009h-entregador-pelo-lancamento.sql", "supabase/009p-bairros-parecidos.sql",
  "supabase/009s-sem-cpf.sql"]) await db.query(fs.readFileSync(path.join(RAIZ, f), "utf8"));
await db.query("insert into cidades (nome) values ('LAGARTO - SE') on conflict do nothing");
await db.query("update cidades set ativa = true where nome = 'LAGARTO - SE'");
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const PORTA = 54331;
const api = await iniciarSupabaseFalso({ porta: PORTA, databaseUrl: DB });

// cópia da extensão apontando para o banco de teste
const EXT = fs.mkdtempSync(path.join(os.tmpdir(), "comunique-ext-src-"));
fs.cpSync(path.join(RAIZ, "extensao"), EXT, { recursive: true, filter: (f) => !f.endsWith(".zip") && !f.includes(`${path.sep}loja`) });
fs.writeFileSync(path.join(EXT, "config.js"), `globalThis.COMUNIQUE = { SUPABASE_URL: "http://127.0.0.1:${PORTA}", SUPABASE_KEY: "chave-de-teste", SITE: "https://comuniqueqd.github.io/" };\n`);
const man = JSON.parse(fs.readFileSync(path.join(RAIZ, "extensao/manifest.json"), "utf8"));
fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify({ ...man, host_permissions: [...man.host_permissions, `http://127.0.0.1:${PORTA}/*`] }));

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "comunique-ext-")), {
  headless: true, executablePath: process.env.CHROMIUM || undefined,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
  const idExt = sw.url().split("/")[2];
  ok(/^[a-p]{32}$/.test(idExt), "a extensão carrega e o service worker sobe");

  // manifesto de verdade: permissões só nos sites necessários, ícones existem
  ok(!man.host_permissions.some((h) => h.includes("<all_urls>") || h.startsWith("*")), "permissões só para o Supabase e o site do Comunique");
  ok(Object.values(man.icons).every((f) => fs.existsSync(path.join(RAIZ, "extensao", f))), "os ícones do manifesto existem");
  ok(man.description.length <= 132, "descrição do manifesto cabe em 132 caracteres");

  // painel sem login
  const painel = await ctx.newPage();
  await painel.goto(`chrome-extension://${idExt}/painel/painel.html`);
  await painel.waitForSelector("#b-entrar", { state: "visible", timeout: 5000 }).catch(() => {});
  ok(await painel.isVisible("#b-entrar") && !(await painel.isVisible("#v-app")), "painel sem login mostra 'Entrar com Google'");

  // telas falsas + o site (só para ver o endereço aberto)
  const telaQL = (id, nome, cidade) => `<!doctype html><html><head><meta charset="utf-8"></head><body><nav><a>Lista</a> / <a>${nome}</a></nav>
    <table><tr><td>Id</td><td>${id}</td></tr><tr><td>Celular</td><td>(00) 0 0000-0000</td></tr><tr><td>CPF</td><td>000.000.000-00</td></tr>
    <tr><td>Franquia</td><td>${cidade}</td></tr></table></body></html>`;
  await ctx.route("https://admin.querolog.io/**", (r) => {
    const u = r.request().url();
    if (u.includes("/entregadores/novo1234")) return r.fulfill({ contentType: "text/html", body: telaQL("novo1234", "Fulano de Teste", "Lagarto - SE") });
    if (u.includes("/entregadores/outro5678")) return r.fulfill({ contentType: "text/html", body: telaQL("outro5678", "Nome Diferente", "Lagarto - SE") });
    return r.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><h1>Estabelecimentos</h1></body></html>" });
  });
  await ctx.route("https://app.crisp.chat/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <aside><div><span>DT</span><div><b>Beltrano Teste da Silva</b><a>beltrano@exemplo.com</a><span>Recife, PE</span></div><button>Ver Perfil de Beltrano</button></div>
    <h3>Dados personalizados</h3><div><div><span>entregador_id</span><span>fff111eee222</span></div><div><span>cidade</span><span>Patos - PB</span></div></div></aside></body></html>` }));
  await ctx.route("https://comuniqueqd.github.io/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Comunique</title>" }));
  const abas = async (trecho) => { await new Promise((r) => setTimeout(r, 1000));
    const t = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.map((x) => x.pendingUrl || x.url)));
    return decodeURIComponent((t.find((x) => x && x.includes(trecho)) || "").replace(/\+/g, " ")); };

  // sem login: o cartão aparece, avisa para entrar e "Abrir no Comunique" leva ID, nome e cidade
  const ql = await ctx.newPage();
  await ql.goto("https://admin.querolog.io/entregadores/novo1234");
  const cartao = ql.locator(".c");
  ok(await cartao.waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "Quero Log: o cartão aparece na tela do entregador");
  ok(await ql.locator(".alerta", { hasText: "Entre na extensão" }).isVisible().catch(() => false), "sem login, o cartão avisa para entrar na extensão");
  ok(!/\b(null|undefined|NaN)\b/.test(await cartao.textContent()), "o cartão não mostra texto quebrado (null)");
  await ql.locator("button.a", { hasText: "Bloquear" }).click();
  await ql.locator("button.l", { hasText: "Abrir no Comunique" }).click();
  const u = await abas("#preencher/bloqueio");
  ok(u.includes("id=novo1234") && u.includes("nome=Fulano de Teste") && u.includes("cidade=LAGARTO - SE") && !u.includes("000.000.000") && !u.includes("0000-0000"),
    "Abrir no Comunique leva só ID, nome e cidade: " + u);

  // login na extensão (sessão do banco de teste)
  const eu = { sub: randomUUID(), email: "mateuslopesmb@gmail.com" };
  const jwt = ["e30", Buffer.from(JSON.stringify({ ...eu, role: "authenticated" })).toString("base64url"), "x"].join(".");
  await sw.evaluate((t) => chrome.storage.local.set({ sessao: { access_token: t, refresh_token: "r", expira: Date.now() + 36e5 } }), jwt);
  await sw.evaluate(() => globalThis.ComuniqueApi.rpc("entrar"));
  await painel.reload();
  ok(await painel.waitForSelector("#v-app:not([hidden])", { timeout: 5000 }).then(() => true).catch(() => false), "logado, o painel mostra busca, atalhos e avisos");

  // 1.1: Cadastrar grava a ficha direto, depois de conferir
  await ql.reload();
  await ql.locator("button.a", { hasText: "Cadastrar" }).click();
  ok(await ql.locator("form input").first().inputValue() === "novo1234", "o formulário vem com o ID da tela");
  await ql.locator("button.p", { hasText: "Salvar ficha" }).click();
  ok(await ql.locator(".ok", { hasText: "Ficha criada" }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "Cadastrar: grava a ficha pelo cartão");
  const ficha = await um("select nome, cidade from entregadores where id_app = 'novo1234'");
  ok(ficha?.nome === "Fulano de Teste" && ficha?.cidade === "LAGARTO - SE", "a ficha tem o nome e a cidade da tela: " + JSON.stringify(ficha));

  // 1.1: Bloquear com prévia
  await ql.locator("button.a", { hasText: "Bloquear" }).click();
  const sel = ql.locator("form select").first();
  await sel.waitFor();
  const opcoes = await sel.locator("option").allTextContents();
  await sel.selectOption({ index: 1 });
  ok(await ql.locator(".previa").waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "Bloquear: mostra a prévia antes de gravar (" + opcoes[1] + ")");
  const prev = await ql.locator(".previa").textContent();
  if (await ql.locator('input[name="cx-sol"]').count()) await ql.locator('input[name="cx-sol"][value="sim"]').check();
  await ql.locator("button.p", { hasText: "Registrar bloqueio" }).click();
  ok(await ql.locator(".ok").waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "Bloquear: grava pelo cartão (" + prev + ")");
  ok(Number((await um("select count(*) n from bloqueios where id_app = 'novo1234'")).n) === 1, "o bloqueio está no banco");

  // 1.1: Adicional
  await ql.locator("button.a", { hasText: "Adicional" }).click();
  const [ent, ped, comb] = await ql.locator("form .g3 input").all();
  await ent.fill("7,50"); await ped.fill("80"); await comb.fill("12");
  ok((await ql.locator("form .m", { hasText: "Adicional:" }).textContent()).includes("R$ 4,50"), "Adicional: mostra a conta (combinado − entrega)");
  await ql.locator("button.p", { hasText: "Registrar adicional" }).click();
  ok(await ql.locator(".erro", { hasText: "De onde veio" }).isVisible(), "Adicional: pede a origem antes de gravar");
  await ql.locator('input[name="cx-origem"][value="qd"]').check();
  await ql.locator('input[name="cx-mercado"][value="nao"]').check();
  await ql.locator("form select").selectOption("Chuva");
  await ql.locator("button.p", { hasText: "Registrar adicional" }).click();
  ok(await ql.locator(".ok", { hasText: "R$ 4,50" }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "Adicional: grava pelo cartão");
  ok(Number((await um("select valor from lancamentos_financeiros where id_app = 'novo1234' and tipo = 'adicional'"))?.valor) === 4.5, "o adicional está no banco");

  // 1.1: Nova ativação
  await ql.locator("button.a", { hasText: "Nova ativação" }).click();
  await ql.locator("button.p", { hasText: "Enviar para ativação" }).click();
  ok(await ql.locator(".ok", { hasText: "ativação" }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "Nova ativação: envia o cadastro pelo cartão");
  ok((await um("select status::text s from cadastros where lower(id_app) = 'novo1234'"))?.s === "aguardando_analise", "o cadastro está aguardando análise");

  // aviso: ID já tem ficha com outro nome
  await db.query("insert into entregadores (id_app, nome, cidade) values ('outro5678', 'Nome Oficial', 'LAGARTO - SE') on conflict do nothing");
  await ql.goto("https://admin.querolog.io/entregadores/outro5678");
  ok(await ql.locator(".alerta", { hasText: "Nome Oficial" }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "ID com outro nome no Comunique: o cartão avisa");
  ok(await ql.locator("button.a", { hasText: "Já tem ficha" }).isDisabled(), "quem já tem ficha não oferece Cadastrar de novo");
  ok(!/\b(null|undefined|NaN)\b/.test(await ql.locator(".c").textContent()), "logado, o cartão também sem texto quebrado");

  // Crisp: lê ID, nome e cidade dos dados personalizados
  const cr = await ctx.newPage();
  await cr.goto("https://app.crisp.chat/website/x/inbox/");
  ok(await cr.locator(".c .d b", { hasText: "Beltrano Teste da Silva" }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false)
    && (await cr.locator(".c .d .m").textContent()).includes("fff111eee222 · Patos - PB"), "Crisp: o cartão mostra ID, nome completo e cidade");

  // tela sem ID: sem cartão, e o leitor responde "nada" para o painel
  const outra = await ctx.newPage();
  await outra.goto("https://admin.querolog.io/estabelecimentos");
  await outra.waitForTimeout(1200);
  ok(!(await outra.locator(".c").count()), "fora da tela do entregador o cartão não aparece");
  await outra.bringToFront();
  const resp = await sw.evaluate(async () => { const [a] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return chrome.tabs.sendMessage(a.id, { tipo: "tela" }); });
  ok(resp && resp.entregador === null, "o leitor diz ao painel que não há ID de entregador nesta tela");
} finally {
  await ctx.close(); await api.fechar(); await db.end();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
