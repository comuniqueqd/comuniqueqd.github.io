// Testes da migração 005 (supabase/005-analises-anexos.sql): análises, resumo semanal, aprovados e bloqueios, anexos.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node analises.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/005-analises-anexos.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mod2 = pessoa("mod2@x.com", "Moderadora Dois");
const mon = pessoa("jocimara@x.com", "Jocimara");
const mon2 = pessoa("lucas@x.com", "Lucas");
const sup = pessoa("eduarda@x.com", "Eduarda");
const sup2 = pessoa("joyce@x.com", "Joyce");
const soAtiv = pessoa("ativ@x.com", "Só Ativação");
const estranho = pessoa("estranho@gmail.com", "Fora");

async function rpc(quem, fn, args = {}) {
  const nomes = Object.keys(args);
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: quem.sub, email: quem.email, role: "authenticated" })]);
    const { rows } = await db.query(`select public.${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, Object.values(args));
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
const importar = (id, nome, cidade, infracao, diasAtras, revisar = null) =>
  db.query("select public.importar_bloqueio($1, $2, $3, $4, now() - make_interval(days => $5), 'Planilha', $6)", [id, nome, cidade, infracao, diasAtras, revisar]);

let n = 0, falhas = 0;
async function t(nome, fn) { n++; try { await fn(); console.log("ok    ", nome); } catch (e) { falhas++; console.log("FALHOU", nome, "→", e.message); } }
const igual = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
async function falha(p, trecho) {
  try { await p; } catch (e) { if (trecho && !e.message.includes(trecho)) throw new Error(`erro diferente: "${e.message}"`); return e; }
  throw new Error("deveria ter falhado");
}
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0];

for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", "suporte"], [soAtiv, "monitorador", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [admin, mon, sup, sup2, soAtiv, estranho]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
const INF = Object.fromEntries((await db.query("select nome, id from infracoes")).rows.map((r) => [r.nome, r.id]));
const MAL_USO = INF["Mal Uso Proposital do Aplicativo"], REABRIR = INF["Reabrir Pedido Após Aceite Sem Justificativa Plausível"];
const registrar = (quem, id, inf, cidade = "LAGARTO - SE", nome = "Entregador " + id) =>
  rpc(quem, "registrar_bloqueio", { p_id_app: id, p_nome: nome, p_cidade: cidade, p_infracao: inf });
const mover = (id, dias) => db.query("update bloqueios set inicio = inicio - make_interval(days => $2), fim = fim - make_interval(days => $2) where id = $1", [id, dias]);

// ---------- semana de terça a segunda ----------
await t("semana começa na terça (terça → ela mesma; segunda → terça anterior; domingo → terça anterior)", async () => {
  const r = (await db.query("select inicio_semana('2026-11-03') a, inicio_semana('2026-11-09') b, inicio_semana('2026-11-08') c, inicio_semana('2026-11-10') d")).rows[0];
  igual([r.a, r.b, r.c, r.d].map((d) => d.toISOString().slice(0, 10)), ["2026-11-03", "2026-11-03", "2026-11-03", "2026-11-10"]);
});

// dados: 2 bloqueios desta semana, 1 de três semanas atrás, cadastro aprovado e bloqueado 5 dias depois
const b1 = await registrar(sup, "res00001", MAL_USO);
const b2 = await registrar(sup2, "res00002", REABRIR, "ITABAIANA - SE");
const b3 = await registrar(sup, "res00003", REABRIR);
await mover(b3.id, 21);
await rpc(sup, "enviar_cadastro", { p_id_app: "apr00001", p_cpf: null, p_cidade: "LAGARTO - SE", p_observacao: null });
await rpc(sup, "enviar_cadastro", { p_id_app: "apr00002", p_cpf: null, p_cidade: "LAGARTO - SE", p_observacao: null });
for (const id of ["apr00001", "apr00002"]) {
  const c = await um("select id from cadastros where id_app = $1", [id]);
  await rpc(mon, "decidir", { p_cadastro: c.id, p_acao: "aprovar" });
}
await db.query("update eventos set em = em - interval '40 days' where tipo = 'aprovado'");
const b4 = await registrar(sup, "apr00001", MAL_USO);
await mover(b4.id, 35);   // 5 dias depois da aprovação

await t("resumo da semana atual: em andamento, com os bloqueios desta semana", async () => {
  const r = await rpc(sup, "resumo_semanal", {});
  igual([r.em_andamento, r.bloqueios.registrados, r.bloqueios.entregadores], [true, 2, 2]);
  igual(r.ativacao.enviados, 2);
  igual(r.semanas.length, 26);
  igual(r.semanas[0], r.inicio);
  if (!r.por_pessoa.some((p) => p.nome === "Eduarda" && p.bloqueios === 1 && p.cadastros === 2)) throw new Error(JSON.stringify(r.por_pessoa));
});
await t("resumo de uma semana anterior (por qualquer dia dela)", async () => {
  const dia = (await um("select (inicio at time zone 'America/Sao_Paulo')::date::text d from bloqueios where id = $1", [b3.id])).d;
  const r = await rpc(sup, "resumo_semanal", { p_data: dia });
  igual([r.em_andamento, r.bloqueios.registrados, r.por_infracao[0].infracao], [false, 1, "Reabrir Pedido Após Aceite Sem Justificativa Plausível"]);
});
await t("resumo semanal e análises valem para todos os papéis (inclusive quem só tem a ativação)", async () => {
  await rpc(soAtiv, "resumo_semanal", {});
  await rpc(soAtiv, "analises", { p_dias: 90 });
  await falha(rpc(estranho, "resumo_semanal", {}), "não tem acesso");
  await falha(rpc(estranho, "analises", {}), "não tem acesso");
});

// ---------- análises ----------
await t("da ativação ao bloqueio: aprovado bloqueado em até 30 dias", async () => {
  const a = (await rpc(sup, "analises", { p_dias: null })).ativacao_bloqueio;
  igual([a.aprovados, a.bloqueados], [2, 1]);
  igual([a.meses[0].aprovados, a.meses[0].bloq_30, a.meses[0].maduro_30], [2, 1, 2]);
  if (Math.abs(a.dias_medios - 5) > 0.1) throw new Error("dias_medios " + a.dias_medios);
});
await t("eficácia da punição: só conta bloqueios com 30 dias ou mais; reincidência em até 30 dias", async () => {
  // res00003 (21 dias atrás) não entra; apr00001 (35 dias atrás) entra, sem reincidência
  const e = (await rpc(sup, "analises", { p_dias: null })).eficacia;
  igual(e.map((x) => [x.punicao, x.bloqueios, x.reincidiram_30d]), [["2 dias", 1, 0]]);
  const r2 = await registrar(sup, "apr00001", MAL_USO);
  await mover(r2.id, 20);   // 15 dias depois do anterior
  const e2 = (await rpc(sup, "analises", { p_dias: null })).eficacia;
  igual(e2.map((x) => [x.punicao, x.bloqueios, x.reincidiram_30d, x.pct]), [["2 dias", 1, 1, 100]]);
  const ri = (await rpc(sup, "analises", { p_dias: null })).reincidencia;
  igual([ri.total, ri.faixas[1].qtd], [1, 1]);
});
await t("bloqueados agora por cidade: separa quem veio da ativação", async () => {
  const c = (await rpc(sup, "analises", { p_dias: 90 })).bloqueados_por_cidade;
  const lag = c.find((x) => x.cidade === "LAGARTO - SE");
  igual([lag.agora, lag.da_ativacao, lag.so_bloqueios], [1, 0, 1]);
});
await t("dia × hora e filtro por cidade", async () => {
  const a = await rpc(sup, "analises", { p_dias: 7, p_cidade: "ITABAIANA - SE" });
  igual(a.dia_hora.reduce((s, x) => s + x.qtd, 0), 1);
});
await t("tratativas por responsável", async () => {
  const tr = (await rpc(sup, "analises", { p_dias: 90 })).tratativas_por_responsavel;
  const j = tr.find((x) => x.responsavel === "Jocimara");
  igual([j.total, j.pendentes], [3, 3]);
});
await t("aprovados e bloqueios (histórico da ativação): só monitorador e moderador", async () => {
  const l = await rpc(mon, "aprovados_e_bloqueios");
  const a = l.find((x) => x.id_app === "apr00001"), b = l.find((x) => x.id_app === "apr00002");
  igual([a.bloqueios, Math.round(a.dias_ate_bloqueio), b.bloqueios, b.primeiro_bloqueio], [2, 5, 0, null]);
  await falha(rpc(sup, "aprovados_e_bloqueios"), "não permite");
});

// ---------- anexos ----------
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const b64 = png.toString("base64");
let an1;
await t("suporte anexa no próprio bloqueio; não no de outra pessoa", async () => {
  an1 = await rpc(sup, "anexar", { p_bloqueio: b1.id, p_nome: "print.png", p_tipo: "image/png", p_base64: b64 });
  await falha(rpc(sup, "anexar", { p_bloqueio: b2.id, p_nome: "x.png", p_tipo: "image/png", p_base64: b64 }), "que registrou");
  await rpc(mon, "anexar", { p_bloqueio: b2.id, p_nome: "x.png", p_tipo: "image/png", p_base64: b64 });
});
await t("tipo, tamanho e limite de 3 por bloqueio", async () => {
  await falha(rpc(sup, "anexar", { p_bloqueio: b1.id, p_nome: "a.exe", p_tipo: "application/x-msdownload", p_base64: b64 }), "imagem");
  await falha(rpc(sup, "anexar", { p_bloqueio: b1.id, p_nome: "g.png", p_tipo: "image/png", p_base64: Buffer.alloc(310000).toString("base64") }), "300 KB");
  await rpc(sup, "anexar", { p_bloqueio: b1.id, p_nome: "2.png", p_tipo: "image/png", p_base64: b64 });
  await rpc(sup, "anexar", { p_bloqueio: b1.id, p_nome: "3.pdf", p_tipo: "application/pdf", p_base64: b64 });
  await falha(rpc(sup, "anexar", { p_bloqueio: b1.id, p_nome: "4.png", p_tipo: "image/png", p_base64: b64 }), "no máximo 3");
  igual((await rpc(sup, "listar_bloqueios", { p_escopo: "meus" })).find((b) => b.id === b1.id).anexos, 3);
});
await t("baixar devolve o mesmo arquivo; quem não pode ver não baixa", async () => {
  const d = await rpc(mon, "baixar_anexo", { p_id: an1 });
  igual([d.nome, d.tipo, d.base64], ["print.png", "image/png", b64]);
  await falha(rpc(sup2, "baixar_anexo", { p_id: an1 }), "não encontrado");
  igual(await rpc(sup2, "listar_anexos", { p_bloqueio: b1.id }), []);
  igual((await rpc(sup, "listar_anexos", { p_bloqueio: b1.id })).length, 3);
});
await t("a tabela de anexos não pode ser lida direto (nem pela equipe)", async () => {
  await falha(sqlComo(mon, "select conteudo from anexos limit 1"), "permission denied");
});
await t("excluir anexo: quem anexou ou moderador", async () => {
  await falha(rpc(mon, "excluir_anexo", { p_id: an1 }), "Só quem anexou");
  await rpc(sup, "excluir_anexo", { p_id: an1 });
  const outro = (await rpc(sup, "listar_anexos", { p_bloqueio: b1.id }))[0].id;
  await rpc(admin, "excluir_anexo", { p_id: outro });
  igual((await rpc(sup, "listar_anexos", { p_bloqueio: b1.id })).length, 1);
});
await t("excluir o bloqueio apaga os anexos", async () => {
  await rpc(admin, "excluir_bloqueio", { p_bloqueio: b1.id });
  igual((await um("select count(*)::int n from anexos where bloqueio_id = $1", [b1.id])).n, 0);
});
await t("internas novas fora do alcance do app", async () => {
  for (const fn of ["ativacao_ao_bloqueio(null)", `pode_ver_bloqueio('${b2.id}')`])
    await falha(sqlComo(mon, `select public.${fn}`), "permission denied");
});

await db.end();
console.log(`\n${n - falhas}/${n} passaram`);
process.exit(falhas ? 1 : 0);
