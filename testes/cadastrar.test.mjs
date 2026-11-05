// Testes do ajuste 008b (supabase/008b-cadastrar-entregador.sql): cadastro avulso do entregador.
// Roda a 008b antes e depois da 008, para garantir que ela não depende da ordem.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node cadastrar.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql",
  "../supabase/007-pao-quentinho.sql", "../supabase/008b-cadastrar-entregador.sql", "../supabase/008-espionagem.sql",
  "../supabase/008b-cadastrar-entregador.sql", "../supabase/008b-cadastrar-entregador.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");
const sup = pessoa("eduarda@x.com", "Eduarda");
const semBq = pessoa("joyce@x.com", "Joyce");

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
let n = 0, falhas = 0;
async function t(nome, fn) { n++; try { await fn(); console.log("ok    ", nome); } catch (e) { falhas++; console.log("FALHOU", nome, "→", e.message); } }
const igual = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
async function falha(p, trecho) {
  try { await p; } catch (e) { if (trecho && !e.message.includes(trecho)) throw new Error(`erro diferente: "${e.message}"`); return e; }
  throw new Error("deveria ter falhado");
}
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const pendentes = async () => (await um("select count(*)::int n from tarefas where tipo = 'completar_dados' and status = 'pendente'")).n;

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [semBq, "suporte", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, semBq]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
const leve = (await um("select id from infracoes where leve and ativa order by id limit 1")).id;

await t("suporte cadastra um entregador novo, sem ativação nem bloqueio", async () => {
  const r = await rpc(sup, "cadastrar_entregador", { p_id_app: " Novo-0001 ", p_nome: "  Zeferino   Teste ", p_cidade: "lagarto - se", p_comentario: "Indicado pelo operador." });
  igual([r.id_app, r.nome, r.cidade, r.bloqueios_completados], ["novo0001", "Zeferino Teste", "LAGARTO - SE", 0]);
  const e = await um("select nome, cidade, criado_por_nome from entregadores where id_app = 'novo0001'");
  igual([e.nome, e.cidade, e.criado_por_nome], ["Zeferino Teste", "LAGARTO - SE", "Eduarda"]);
});

await t("a ficha aparece na consulta, com a anotação da criação e o comentário", async () => {
  const c = await rpc(mon, "consultar_entregador", { p_busca: "novo0001" });
  igual(c.entregadores.length, 1);
  igual(c.entregadores[0].comentarios.map((x) => x.tipo).sort(), ["alteracao", "comentario"]);
});

await t("os próximos registros do ID já vêm com nome e cidade", async () => {
  const r = await rpc(sup, "registrar_infracao_leve", { p_id_app: "NOVO0001", p_infracao: leve });
  const b = await um("select nome_entregador, cidade, dados_pendentes from bloqueios where lower(id_app) = 'novo0001'");
  igual([b.nome_entregador, b.cidade, b.dados_pendentes], ["Zeferino Teste", "LAGARTO - SE", false]);
  if (!r) throw new Error("sem retorno");
});

await t("ID que já tem ficha: recusa e aponta para a ficha", async () => {
  await falha(rpc(mon, "cadastrar_entregador", { p_id_app: "novo0001", p_nome: "Outro Nome" }), "já tem cadastro (Zeferino Teste)");
});

await t("cidade fora da lista, nome vazio e ID curto são recusados", async () => {
  await falha(rpc(sup, "cadastrar_entregador", { p_id_app: "novo0002", p_nome: "Fulano", p_cidade: "ATLANTIDA - XX" }), "cidade da lista");
  await falha(rpc(sup, "cadastrar_entregador", { p_id_app: "novo0002", p_nome: "  " }), "nome do entregador");
  await falha(rpc(sup, "cadastrar_entregador", { p_id_app: "ab", p_nome: "Fulano" }), "ID do entregador inválido");
});

await t("sem cidade também vale", async () => {
  const r = await rpc(sup, "cadastrar_entregador", { p_id_app: "novo0003", p_nome: "Sem Cidade Teste" });
  igual(r.cidade, null);
});

await t("quem não tem o módulo de bloqueios não cadastra", async () => {
  await falha(rpc(semBq, "cadastrar_entregador", { p_id_app: "novo0004", p_nome: "Fulano" }));
  igual((await um("select count(*)::int n from entregadores where id_app = 'novo0004'")).n, 0);
});

await t("monitorador cadastrando um ID com leve sem nome completa o bloqueio e fecha a tarefa", async () => {
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "pend0001", p_infracao: leve });
  igual((await um("select count(*)::int n from bloqueios where id_app = 'pend0001' and dados_pendentes")).n, 1);
  const antes = await pendentes();
  const r = await rpc(mon, "cadastrar_entregador", { p_id_app: "pend0001", p_nome: "Pendente Teste", p_cidade: "LAGARTO - SE" });
  igual([r.bloqueios_completados, r.bloqueios_pendentes], [1, 0]);
  const b = await um("select nome_entregador, cidade, dados_pendentes from bloqueios where id_app = 'pend0001'");
  igual([b.nome_entregador, b.cidade, b.dados_pendentes], ["Pendente Teste", "LAGARTO - SE", false]);
  igual(await pendentes(), antes - 1);
});

await t("suporte cadastrando um ID pendente: a tarefa continua para o monitoramento", async () => {
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "pend0002", p_infracao: leve });
  const antes = await pendentes();
  const r = await rpc(sup, "cadastrar_entregador", { p_id_app: "pend0002", p_nome: "Pendente Dois", p_cidade: "LAGARTO - SE" });
  igual([r.bloqueios_completados, r.bloqueios_pendentes], [0, 1]);
  igual(await pendentes(), antes);
});

await t("entregadores_recentes: cidades ativas e as fichas criadas pela tela, das mais novas", async () => {
  const r = await rpc(mon, "entregadores_recentes", {});
  igual(r.cidades.includes("LAGARTO - SE"), true);
  igual(r.recentes.map((x) => x.id_app), ["pend0002", "pend0001", "novo0003", "novo0001"]);
  igual([r.recentes[0].criado_por_nome, r.recentes[0].meu], ["Eduarda", false]);
  igual((await rpc(sup, "entregadores_recentes", { p_limite: 1 })).recentes.map((x) => [x.id_app, x.meu]), [["pend0002", true]]);
  await falha(rpc(semBq, "entregadores_recentes", {}));
});

await t("só quem está logado executa a função (anon não)", async () => {
  const r = await um("select has_function_privilege('anon', 'public.cadastrar_entregador(text,text,text,text)', 'execute') a, has_function_privilege('authenticated', 'public.cadastrar_entregador(text,text,text,text)', 'execute') b, " +
    "has_function_privilege('anon', 'public.entregadores_recentes(integer)', 'execute') c");
  igual([r.a, r.b, r.c], [false, true, false]);
});

console.log(`\n${n - falhas}/${n} testes passaram`);
await db.end();
process.exit(falhas ? 1 : 0);
