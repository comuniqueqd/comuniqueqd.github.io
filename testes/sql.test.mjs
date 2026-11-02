// Testes do banco (supabase/schema.sql) num Postgres local.
// Cada chamada roda como o Supabase rodaria: papel "authenticated" + JWT da pessoa em request.jwt.claims.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node sql.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query(readFileSync(new URL("./supabase-local.sql", import.meta.url), "utf8"));
await db.query(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mod2 = pessoa("moderadora@x.com", "Moderadora Dois");
const monitor = pessoa("monitor@x.com", "Monitor Um");
const sup1 = pessoa("suporte1@x.com", "Suporte Um");
const sup2 = pessoa("suporte2@x.com", "Suporte Dois");
const estranho = pessoa("estranho@x.com", "Pessoa Estranha");

// chama public.<fn>(args nomeados) como a pessoa (ou anônimo se quem = null)
async function rpc(quem, fn, args = {}) {
  const nomes = Object.keys(args);
  const sql = `select public.${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
  await db.query("begin");
  try {
    await db.query(`set local role ${quem ? "authenticated" : "anon"}`);
    if (quem) await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: quem.sub, email: quem.email, role: "authenticated", user_metadata: { full_name: quem.nome } })]);
    const { rows } = await db.query(sql, Object.values(args));
    await db.query("commit");
    return rows[0].r;
  } catch (e) { await db.query("rollback"); throw e; }
}
async function sqlComo(quem, sql, params = []) {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: quem.sub, email: quem.email })]);
    const { rows } = await db.query(sql, params);
    await db.query("commit");
    return rows;
  } catch (e) { await db.query("rollback"); throw e; }
}

let n = 0, falhas = 0;
async function t(nome, fn) {
  n++;
  try { await fn(); console.log("ok    ", nome); }
  catch (e) { falhas++; console.log("FALHOU", nome, "→", e.message); }
}
const igual = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
async function falha(p, trecho) {
  try { await p; } catch (e) { if (trecho && !e.message.includes(trecho)) throw new Error(`erro diferente: "${e.message}"`); return e; }
  throw new Error("deveria ter falhado");
}

// ---------- acesso e equipe ----------
await t("admin final entra como moderador", async () => {
  const r = await rpc(admin, "entrar");
  igual([r.membro, r.papel, r.admin_final], [true, "moderador", true]);
});
await t("anônimo não chama funções", () => falha(rpc(null, "listar_motivos"), "permission denied"));
await t("estranho entra sem acesso e pede acesso", async () => {
  igual((await rpc(estranho, "entrar")).membro, false);
  await rpc(estranho, "pedir_acesso");
  igual((await rpc(estranho, "entrar")).pedido, true);
});
await t("estranho não envia cadastro", () => falha(rpc(estranho, "enviar_cadastro", { p_id_app: "abcd1234", p_cpf: null, p_cidade: "LAGARTO - SE" }), "não tem acesso"));
await t("moderador vê o pedido de acesso", async () => {
  const eq = await rpc(admin, "listar_equipe");
  igual(eq.pedidos.map((p) => [p.email, p.nome]), [["estranho@x.com", "Pessoa Estranha"]]);
});
await t("moderador libera a equipe com papéis", async () => {
  await rpc(admin, "salvar_membro", { p_email: "Moderadora@X.com ", p_nome: "Moderadora Dois", p_papel: "moderador" });
  await rpc(admin, "salvar_membro", { p_email: monitor.email, p_nome: "Monitor Um", p_papel: "monitorador" });
  await rpc(admin, "salvar_membro", { p_email: sup1.email, p_nome: "Suporte Um", p_papel: "suporte" });
  await rpc(admin, "salvar_membro", { p_email: sup2.email, p_nome: "Suporte Dois", p_papel: "suporte" });
  await rpc(admin, "salvar_membro", { p_email: estranho.email, p_nome: "Ex Estranho", p_papel: "suporte" });
  for (const p of [mod2, monitor, sup1, sup2, estranho]) await rpc(p, "entrar");
  igual((await rpc(mod2, "entrar")).papel, "moderador");
  igual((await rpc(admin, "listar_equipe")).pedidos.length, 0, "pedido some ao liberar:");
});
await t("monitorador não gerencia equipe", () => falha(rpc(monitor, "listar_equipe"), "não permite"));
await t("suporte não libera ninguém", () => falha(rpc(sup1, "salvar_membro", { p_email: "a@b.com", p_nome: "A", p_papel: "moderador" }), "não permite"));
await t("outro moderador não altera o admin final", () => falha(rpc(mod2, "salvar_membro", { p_email: admin.email, p_nome: "X", p_papel: "suporte" }), "administrador final"));
await t("outro moderador não remove o admin final", () => falha(rpc(mod2, "remover_membro", { p_email: admin.email }), "administrador final"));
await t("moderador não remove a si mesmo", () => falha(rpc(mod2, "remover_membro", { p_email: mod2.email }), "próprio acesso"));
await t("moderador remove e recoloca alguém", async () => {
  await rpc(mod2, "remover_membro", { p_email: estranho.email });
  igual((await rpc(estranho, "entrar")).membro, false);
  await rpc(mod2, "salvar_membro", { p_email: estranho.email, p_nome: "Ex Estranho", p_papel: "suporte" });
  igual((await rpc(estranho, "entrar")).papel, "suporte");
});
await t("leitura direta da tabela membros: suporte só vê a si", async () => {
  igual((await sqlComo(sup1, "select email from public.membros")).map((r) => r.email), [sup1.email]);
});

// ---------- envio ----------
let c1, c2, c3, c4;
await t("suporte envia cadastros (normaliza CPF, ID e cidade)", async () => {
  c1 = await rpc(sup1, "enviar_cadastro", { p_id_app: "697a33d1077b", p_cpf: "529.982.247-25", p_cidade: "  lagarto  -  se ", p_observacao: "  ok " });
  c2 = await rpc(sup1, "enviar_cadastro", { p_id_app: "abc12345", p_cpf: null, p_cidade: "RECIFE - PE" });
  c3 = await rpc(sup2, "enviar_cadastro", { p_id_app: null, p_cpf: "11144477735", p_cidade: "ITABAIANA - SE" });
  c4 = await rpc(sup2, "enviar_cadastro", { p_id_app: "zzz99881", p_cpf: null, p_cidade: "RECIFE - PE" });
  const [r] = await db.query("select cpf, cidade, observacao from cadastros where id = $1", [c1]).then((x) => x.rows);
  igual([r.cpf, r.cidade, r.observacao], ["52998224725", "LAGARTO - SE", "ok"]);
});
await t("CPF repetido é bloqueado, mesmo para outra pessoa", async () => {
  const e = await falha(rpc(sup2, "enviar_cadastro", { p_id_app: null, p_cpf: "52998224725", p_cidade: "LAGARTO - SE" }), "Este CPF já está cadastrado");
  if (!e.message.includes("Aguardando análise")) throw new Error(e.message);
});
await t("ID repetido é bloqueado (maiúsculas não importam)", () => falha(rpc(sup2, "enviar_cadastro", { p_id_app: "ABC12345", p_cpf: null, p_cidade: "RECIFE - PE" }), "Este ID já está cadastrado"));
await t("CPF inválido é recusado", () => falha(rpc(sup1, "enviar_cadastro", { p_id_app: null, p_cpf: "123.456.789-00", p_cidade: "RECIFE - PE" }), "CPF inválido"));
await t("sem ID e sem CPF é recusado", () => falha(rpc(sup1, "enviar_cadastro", { p_id_app: "", p_cpf: "", p_cidade: "RECIFE - PE" }), "Preencha o ID"));
await t("cidade fora do formato é recusada", () => falha(rpc(sup1, "enviar_cadastro", { p_id_app: "qqq11111", p_cpf: null, p_cidade: "Recife" }), "CIDADE - UF"));
await t("ninguém grava direto na tabela", () => falha(sqlComo(admin, "insert into public.cadastros (cidade, id_app, enviado_por) values ('X - SE','abcd1234', gen_random_uuid())"), "permission denied"));

// ---------- leitura ----------
await t("suporte vê só os próprios pendentes", async () => {
  igual((await rpc(sup1, "listar_cadastros", { p_escopo: "pendentes" })).map((c) => c.id).sort(), [c1, c2].sort());
  igual((await rpc(sup2, "listar_cadastros", { p_escopo: "todos" })).length, 2, "escopo todos para suporte:");
});
await t("monitorador vê todos os pendentes, com nome de quem enviou", async () => {
  const l = await rpc(monitor, "listar_cadastros", { p_escopo: "pendentes" });
  igual(l.length, 4);
  igual(l.find((c) => c.id === c3).enviado_por_nome, "Suporte Dois");
});
await t("leitura direta: suporte não enxerga cadastros dos outros", async () => {
  igual((await sqlComo(sup1, "select count(*)::int n from public.cadastros"))[0].n, 2);
  igual((await sqlComo(sup1, "select count(*)::int n from public.vw_cadastros"))[0].n, 2);
  igual((await sqlComo(monitor, "select count(*)::int n from public.vw_cadastros"))[0].n, 4);
});

// ---------- decisões ----------
await t("suporte não aprova", () => falha(rpc(sup1, "decidir", { p_cadastro: c1, p_acao: "aprovar" }), "não permite"));
await t("reprovar exige motivo da lista", async () => {
  await falha(rpc(monitor, "decidir", { p_cadastro: c1, p_acao: "reprovar" }), "Escolha o motivo");
  await falha(rpc(monitor, "decidir", { p_cadastro: c1, p_acao: "reprovar", p_motivo: "CPF com restrição" }), "Escolha o motivo");
  await falha(rpc(monitor, "decidir", { p_cadastro: c1, p_acao: "reprovar", p_motivo: "Outro" }), "Descreva");
});
await t("monitorador reprova → aguardando novo contato", async () => {
  await rpc(monitor, "decidir", { p_cadastro: c1, p_acao: "reprovar", p_motivo: "Fotos sem camisa", p_detalhe: "foto 2" });
  const c = (await rpc(sup1, "listar_cadastros", { p_escopo: "pendentes" })).find((x) => x.id === c1);
  igual([c.status, c.motivo, c.detalhe, c.decidido_por_nome, c.reprovacoes], ["aguardando_contato", "Fotos sem camisa", "foto 2", "Monitor Um", 1]);
});
await t("aguardando contato não pode ser reprovado de novo", () => falha(rpc(monitor, "decidir", { p_cadastro: c1, p_acao: "reprovar", p_motivo: "Outro", p_detalhe: "x" }), "Não é possível reprovar"));
await t("aguardando contato pode ser aprovado", async () => {
  await rpc(monitor, "decidir", { p_cadastro: c1, p_acao: "aprovar" });
  igual((await rpc(sup1, "listar_cadastros", { p_escopo: "pendentes" })).map((c) => c.id), [c2], "sai dos pendentes:");
});
await t("aprovado não pode ser encerrado", () => falha(rpc(admin, "decidir", { p_cadastro: c1, p_acao: "encerrar", p_motivo: "Outro", p_detalhe: "x" }), "Não é possível encerrar"));
await t("encerrar direto da análise, com motivo de encerramento", async () => {
  await falha(rpc(mod2, "decidir", { p_cadastro: c3, p_acao: "encerrar", p_motivo: "Fotos sem camisa" }), "Escolha o motivo");
  await rpc(mod2, "decidir", { p_cadastro: c3, p_acao: "encerrar", p_motivo: "CPF com restrição" });
  const c = (await rpc(admin, "listar_cadastros", { p_escopo: "todos" })).find((x) => x.id === c3);
  igual([c.status, c.motivo], ["encerrado", "CPF com restrição"]);
});

// ---------- desfazer / excluir ----------
await t("monitorador não desfaz nem exclui", async () => {
  await falha(rpc(monitor, "desfazer", { p_cadastro: c1 }), "não permite");
  await falha(rpc(monitor, "excluir_cadastro", { p_cadastro: c1 }), "não permite");
});
await t("moderador desfaz a aprovação e a reprovação volta a valer", async () => {
  await rpc(mod2, "desfazer", { p_cadastro: c1 });
  const c = (await rpc(admin, "listar_cadastros", { p_escopo: "pendentes" })).find((x) => x.id === c1);
  igual([c.status, c.motivo, c.decidido_por_nome, c.pode_desfazer], ["aguardando_contato", "Fotos sem camisa", "Monitor Um", false]);
});
await t("não desfaz duas vezes seguidas", () => falha(rpc(admin, "desfazer", { p_cadastro: c1 }), "Não há decisão"));
await t("histórico de eventos completo", async () => {
  igual((await rpc(sup1, "eventos_do_cadastro", { p_cadastro: c1 })).map((e) => e.tipo), ["enviado", "reprovado", "aprovado", "desfeito"]);
});
await t("aprova de novo depois de desfeito", () => rpc(monitor, "decidir", { p_cadastro: c1, p_acao: "aprovar" }));
await t("moderador exclui cadastro (e o histórico junto)", async () => {
  await rpc(admin, "excluir_cadastro", { p_cadastro: c4 });
  igual((await db.query("select count(*)::int n from eventos where cadastro_id = $1", [c4])).rows[0].n, 0);
});

// ---------- métricas ----------
await t("métricas da operação para o suporte (só números)", async () => {
  const m = await rpc(sup1, "metricas", {});
  igual([m.resumo.total, m.resumo.aguardando_analise, m.resumo.aguardando_contato, m.resumo.aprovados_hoje], [3, 1, 0, 1]);
  igual(m.por_dia.length, 14);
  igual(m.por_dia[13].aprovados, 1, "aprovação desfeita não conta:");
  igual(m.por_dia[13].enviados, 3);
  igual(m.motivos_reprovacao.map((x) => [x.motivo, x.qtd]), [["Fotos sem camisa", 1]]);
  igual(m.motivos_encerramento.map((x) => [x.motivo, x.qtd]), [["CPF com restrição", 1]]);
  igual(m.resumo.aprovacao_1a_analise, 0, "c1 foi reprovado e c3 encerrado na 1ª análise:");
  if (JSON.stringify(m).includes("52998224725")) throw new Error("métricas vazaram CPF");
});
await t("filtro por pessoa: só o que tem relação com ela", async () => {
  const s2 = await rpc(sup1, "metricas", { p_pessoas: `{${sup2.sub}}` });
  igual([s2.resumo.total, s2.por_pessoa.map((p) => p.nome)], [1, ["Suporte Dois"]]);
  const mon = await rpc(monitor, "metricas", { p_pessoas: `{${monitor.sub}}` });
  igual([mon.resumo.total, mon.por_pessoa[0].aprovou, mon.por_pessoa[0].reprovou], [1, 1, 1]);
  const dois = await rpc(admin, "metricas", { p_pessoas: `{${sup2.sub},${monitor.sub}}` });
  igual(dois.resumo.total, 2);
  const cid = Object.fromEntries((await rpc(admin, "metricas", {})).por_cidade.map((c) => [c.cidade, c]));
  igual([cid["LAGARTO - SE"].aprovados, cid["LAGARTO - SE"].reprovacoes, cid["ITABAIANA - SE"].encerrados], [1, 1, 1]);
});
await t("lista de pessoas e motivos para todos", async () => {
  igual((await rpc(sup1, "pessoas")).length, 6);
  const mo = await rpc(sup1, "listar_motivos");
  igual([mo.reprovacao.includes("Documentação bancária com dados insuficientes"), mo.encerramento[0]], [true, "CPF com restrição"]);
});

await db.end();
console.log(`\n${n - falhas}/${n} passaram`);
process.exit(falhas ? 1 : 0);
