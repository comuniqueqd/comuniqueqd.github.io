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
  ok(fs.readFileSync(path.join(RAIZ, "extensao/icones.js"), "utf8") === fs.readFileSync(path.join(RAIZ, "js/icones.js"), "utf8"), "009u: os ícones da extensão são os mesmos do site (extensao/icones.js = js/icones.js)");

  // painel sem login
  const painel = await ctx.newPage();
  await painel.goto(`chrome-extension://${idExt}/painel/painel.html`);
  await painel.waitForSelector("#b-entrar", { state: "visible", timeout: 5000 }).catch(() => {});
  ok(await painel.isVisible("#b-entrar") && !(await painel.isVisible("#v-app")), "painel sem login mostra 'Entrar com Google'");

  // telas falsas, parecidas com as reais: "Lista" no título, no menu e no caminho "Lista / Nome"
  const telaQL = (id, nome, cidade, barraSolta) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <header><h1>Lista</h1><span>Mateus Lopes</span></header>
    <script>{ const d = document.createElement("div"); d.style.position = "fixed"; d.id = "cartao-velho";
      d.attachShadow({ mode: "open" }).innerHTML = '<div class="c"><div class="t"><span>Comunique</span></div></div>'; document.body.append(d); }</script>
    <aside><ul><li><a>Lista</a></li><li><a>Aprovação</a></li><li><a>Gerenciamento</a></li></ul></aside>
    <main>${barraSolta ? `<div><a>‹</a><a>Lista</a> / <span>${nome}</span></div>` : `<div><a>‹</a><a>Lista</a><span>/</span><span>${nome}</span></div>`}
    <table><tr><td>Id</td><td>${id}</td></tr><tr><td>Celular</td><td>(00) 0 0000-0000</td></tr><tr><td>CPF</td><td>000.000.000-00</td></tr>
    <tr><td>Franquia</td><td>${cidade}</td></tr></table></main></body></html>`;
  await ctx.route("https://admin.querolog.io/**", (r) => {
    const u = r.request().url();
    if (u.includes("/entregadores/novo1234")) return r.fulfill({ contentType: "text/html", body: telaQL("novo1234", "Fulano de Teste", "Lagarto - SE") });
    if (u.includes("/entregadores/outro5678")) return r.fulfill({ contentType: "text/html", body: telaQL("outro5678", "Nome Diferente", "Lagarto - SE", true) });
    return r.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><h1>Estabelecimentos</h1><aside><a>Lista</a><a>Aprovação</a></aside></body></html>" });
  });
  await ctx.route("https://app.crisp.chat/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <aside><div><span>DT</span><div><b>Beltrano Teste da Silva</b><a>beltrano@exemplo.com</a><span>Recife, PE</span></div><button>Ver Perfil de Beltrano</button></div>
    <h3>Dados personalizados</h3><div><div><span>entregador_id</span><span>fff111eee222</span></div><div><span>cidade</span><span>Patos - PB</span></div></div></aside></body></html>` }));
  await ctx.route("https://comuniqueqd.github.io/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Comunique</title>" }));

  // a aba de cada tela: o service worker pergunta a cada aba e fica com a que responde o ID esperado
  const abaDe = (id) => sw.evaluate(async (alvo) => {
    for (const t of await chrome.tabs.query({})) {
      try { const r = await chrome.tabs.sendMessage(t.id, { tipo: "tela" }); if ((r?.entregador?.id || r?.site) === alvo || r?.entregador?.id === alvo) return t.id; } catch (_) {}
    }
    return null;
  }, id);
  const lerAba = (tabId) => sw.evaluate((t) => chrome.tabs.sendMessage(t, { tipo: "tela" }), tabId);

  const ql = await ctx.newPage();
  await ql.goto("https://admin.querolog.io/entregadores/novo1234");
  await ql.waitForTimeout(500);
  ok(!(await ql.evaluate(() => [...document.documentElement.children].some((n) => n.tagName === "DIV" && n.style.position === "fixed"))), "a página não ganha cartão (o cartão está guardado)");
  ok(!(await ql.locator("#cartao-velho").count()), "o cartão da 1.1 que ficou numa aba aberta antes da atualização é tirado");
  const abaQL = await abaDe("novo1234");
  // aba aberta antes da atualização: o leitor é colocado de novo pelo painel/service worker sem duplicar a resposta
  const reinj = await sw.evaluate(async (t) => { await chrome.scripting.executeScript({ target: { tabId: t }, files: ["telas/leitor.js"] }); return (await chrome.tabs.sendMessage(t, { tipo: "tela" }))?.entregador?.id; }, abaQL);
  ok(reinj === "novo1234", "colocar o leitor de novo numa aba aberta funciona (permissão scripting)");
  const lido = await lerAba(abaQL);
  ok(JSON.stringify(lido?.entregador) === JSON.stringify({ id: "novo1234", nome: "Fulano de Teste", cidade: "Lagarto - SE" }),
    "Quero Log: lê ID, nome (o “Lista” do caminho, não o do título nem o do menu) e cidade: " + JSON.stringify(lido?.entregador));
  ok(!JSON.stringify(lido).includes("000.000.000") && !JSON.stringify(lido).includes("0000-0000"), "CPF e celular não saem da tela");
  const ql2 = await ctx.newPage(); await ql2.goto("https://admin.querolog.io/entregadores/outro5678"); await ql2.waitForTimeout(400);
  ok((await lerAba(await abaDe("outro5678")))?.entregador?.nome === "Nome Diferente", "Quero Log: acha o nome também com a barra solta (“Lista / Nome”)");

  const cr = await ctx.newPage(); await cr.goto("https://app.crisp.chat/website/x/inbox/"); await cr.waitForTimeout(400);
  ok(JSON.stringify((await lerAba(await abaDe("fff111eee222")))?.entregador) === JSON.stringify({ id: "fff111eee222", nome: "Beltrano Teste da Silva", cidade: "Patos - PB" }),
    "Crisp: lê ID, nome completo e cidade dos dados personalizados");
  const outra = await ctx.newPage(); await outra.goto("https://admin.querolog.io/estabelecimentos"); await outra.waitForTimeout(400);
  const abaOutra = await abaDe("admin.querolog.io");
  ok((await lerAba(abaOutra))?.entregador === null, "tela sem ID: o leitor responde que não há entregador");

  // painel apontando para a aba do Quero Log (?aba= só nos testes)
  const p = await ctx.newPage();
  const painelDe = async (aba) => { await p.goto(`chrome-extension://${idExt}/painel/painel.html?aba=${aba}`); await p.waitForSelector("#v-app:not([hidden])", { timeout: 5000 }); };
  const abrirForm = async (rot) => { await p.locator(".atalhos button", { hasText: rot }).click(); await p.waitForSelector("#v-form:not([hidden]) form"); };
  const campos = () => p.locator("#caixa-form form").evaluate((f) => [...f.querySelectorAll("label > input")].slice(0, 3).map((i) => i.value));
  const feito = (trecho) => p.locator("#feito", { hasText: trecho }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  const semNull = async () => { const t = await p.locator("main").innerText(); return !/\b(null|undefined|NaN)\b/.test(t) && !/\p{Extended_Pictographic}/u.test(t); };   // 009u: sem emoji também

  // login na extensão (sessão do banco de teste)
  const eu = { sub: randomUUID(), email: "mateuslopesmb@gmail.com" };
  const jwt = ["e30", Buffer.from(JSON.stringify({ ...eu, role: "authenticated" })).toString("base64url"), "x"].join(".");
  await sw.evaluate((t) => chrome.storage.local.set({ sessao: { access_token: t, refresh_token: "r", expira: Date.now() + 36e5 } }), jwt);
  await sw.evaluate(() => globalThis.ComuniqueApi.rpc("entrar"));
  await painelDe(abaQL);
  ok(await p.locator("#tela", { hasText: "Fulano de Teste" }).isVisible(), "o painel mostra quem está na tela aberta");
  ok(await semNull(), "o painel não mostra texto quebrado (null)");

  // Cadastrar entregador
  await abrirForm("Cadastrar entregador");
  await p.locator("#caixa-form button.primario").click();
  ok(await feito("Ficha de Fulano de Teste"), "Cadastrar entregador: cria a ficha pelo painel");

  // Novo bloqueio: lê a página, preenche, escolhe o motivo, vê a prévia e registra
  await abrirForm("Novo bloqueio");
  ok(JSON.stringify(await campos()) === JSON.stringify(["novo1234", "Fulano de Teste", "LAGARTO - SE"]), "Novo bloqueio: abre no painel já com ID, nome e cidade da página");
  const sel = p.locator("#caixa-form select").first();
  ok((await sel.locator("option").count()) > 1, "Novo bloqueio: tem a lista de motivos");
  await sel.selectOption({ index: 1 });
  ok(await p.locator(".previa").waitFor({ timeout: 5000 }).then(() => true).catch(() => false), "Novo bloqueio: mostra a prévia ao escolher o motivo");
  if (await p.locator('#caixa-form input[type=radio][value="sim"]').count()) await p.locator('#caixa-form input[type=radio][value="sim"]').first().check();
  await p.locator("#caixa-form button.primario").click();
  ok(await feito("Bloqueio registrado"), "Novo bloqueio: registra pelo painel e volta com ✓");
  ok(Number((await um("select count(*) n from bloqueios where id_app = 'novo1234'")).n) === 1, "o bloqueio está no banco");
  ok((await p.context().pages()).every((pg) => !pg.url().includes("comuniqueqd.github.io")), "nenhum botão abriu o Comunique");

  // a ficha já existe (o bloqueio cria): Cadastrar avisa e o banco recusa repetir
  await abrirForm("Cadastrar entregador");
  ok(await p.locator("#caixa-form .alerta", { hasText: "já tem ficha" }).isVisible(), "Cadastrar entregador: avisa que o ID já tem ficha");
  await p.locator("#b-voltar").click();

  // Registrar adicional
  await abrirForm("Registrar adicional");
  const [ent, ped, comb] = await p.locator("#caixa-form .g3 input").all();
  await ent.fill("7,50"); await ped.fill("80"); await comb.fill("12");
  ok((await p.locator(".conta-valor").textContent()).includes("R$ 4,50"), "Adicional: mostra a conta");
  await p.locator("#caixa-form button.primario").click();
  ok(await p.locator("#caixa-form .erro", { hasText: "De onde veio" }).isVisible(), "Adicional: pede a origem antes de gravar");
  await p.locator('#caixa-form input[type=radio][value="qd"]').check();
  await p.locator('#caixa-form input[type=radio][value="nao"]').check();
  await p.locator("#caixa-form select").selectOption("Chuva");
  await p.locator("#caixa-form button.primario").click();
  ok(await feito("R$ 4,50"), "Adicional: registra pelo painel");

  // Calculadora de bairro: cidade da página, os dois bairros, só falta o código do pedido
  await db.query(`insert into bairros (cidade, nome, valor, taxa_log, apelidos) values ('LAGARTO - SE', 'CENTRO', 5.49, 0.99, '{}'), ('LAGARTO - SE', 'BREJO', 16.99, 0.99, '{}') on conflict do nothing`);
  await abrirForm("Calculadora de bairro");
  ok(await p.locator("#caixa-form select").first().inputValue() === "LAGARTO - SE", "Calculadora: já vem com a cidade da página");
  const [bi, br] = await p.locator('#caixa-form input[list]').filter({ hasNot: p.locator("xx") }).all().then((l) => l.slice(-2));
  await bi.fill("Centro"); await br.fill("Brejo");
  ok((await p.locator(".previa").textContent()).includes("R$ 11,50"), "Calculadora: mostra o ajuste (16,00 − 4,50)");
  await p.locator('#caixa-form input[aria-label="Código do pedido"]').fill("15-ABC");
  await p.locator("#caixa-form button.primario").click();
  ok(await feito("Ajuste de R$ 11,50"), "Calculadora: registra o ajuste com o ID e o nome da página");
  ok((await um("select pedido from lancamentos_financeiros where tipo = 'ajuste_bairro' and id_app = 'novo1234'"))?.pedido === "15-ABC", "o ajuste está no banco com o código do pedido");

  // Nova ativação e Pedir ajuda
  await abrirForm("Nova ativação");
  await p.locator("#caixa-form button.primario").click();
  ok(await feito("ativação"), "Nova ativação: envia pelo painel");
  await abrirForm("Pedir ajuda");
  await p.locator("#caixa-form textarea").fill("fila grande no Crisp");
  await p.locator("#caixa-form button.primario").click();
  ok(await feito("ajuda"), "Pedir ajuda: envia pelo painel");
  ok(Number((await um("select count(*) n from avisos_rapidos where tipo = 'ajuda'")).n) === 1, "o pedido de ajuda está no banco");
  // o pedido de ajuda de outra pessoa: "Eu ajudo" aceita ali mesmo
  await db.query("update avisos_rapidos set criado_por = gen_random_uuid(), criado_por_nome = 'Ana' where tipo = 'ajuda'");
  await painelDe(abaQL);
  await p.locator("#agora button", { hasText: "Eu ajudo" }).click();
  ok(await feito("aceitou ajudar"), "pedido de ajuda de outra pessoa: “Eu ajudo” aceita pelo painel");
  ok(!!(await um("select aceito_por from avisos_rapidos where tipo = 'ajuda'"))?.aceito_por, "o aceite está no banco");

  // ID com ficha de outro nome: avisa; tela sem ID: avisa e deixa digitar
  await db.query("insert into entregadores (id_app, nome, cidade) values ('outro5678', 'Nome Oficial', 'LAGARTO - SE') on conflict do nothing");
  await painelDe(await abaDe("outro5678"));
  await abrirForm("Novo bloqueio");
  ok(await p.locator("#caixa-form .alerta", { hasText: "Nome Oficial" }).isVisible(), "ID com outro nome no Comunique: o formulário avisa");
  await painelDe(abaOutra);
  ok(await p.locator("#tela", { hasText: "Não encontrei ID" }).isVisible(), "tela sem ID: o painel avisa");
  await abrirForm("Novo bloqueio");
  ok(await p.locator("#caixa-form .alerta", { hasText: "Não encontrei ID" }).isVisible() && (await campos())[0] === "", "tela sem ID: o formulário abre vazio para digitar");
  ok(await semNull(), "formulários sem texto quebrado (null)");
} finally {
  await ctx.close(); await api.fechar(); await db.end();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
