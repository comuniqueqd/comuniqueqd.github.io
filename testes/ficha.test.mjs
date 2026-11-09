// Testes da 009h (supabase/009h-entregador-pelo-lancamento.sql): todo registro com o ID do entregador
// cria a ficha dele (lançamentos financeiros e cadastros da ativação) e os registros antigos ganham a ficha.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node ficha.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("set client_min_messages = warning");
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql",
  "../supabase/007-pao-quentinho.sql", "../supabase/008-espionagem.sql", "../supabase/008b-cadastrar-entregador.sql",
  "../supabase/008b-notificacoes.sql", "../supabase/008c-analises.sql", "../supabase/008d-avisos-parte2.sql",
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");     // monitoradora, responsável por LAGARTO
const sup = pessoa("eduarda@x.com", "Eduarda");       // suporte
const sup2 = pessoa("lucas@x.com", "Lucas");          // suporte

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
const ultimo = { id: 0 };
const marca = async () => { ultimo.id = (await um("select coalesce(max(id), 0)::int i from notificacoes")).i; };
const novos = async (p) => (await db.query("select n.texto, n.categoria, n.motivo, n.link from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.id > $2 order by n.id", [p.email, ultimo.id])).rows;
const num = (x) => Number(x);

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", "suporte"]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, sup2]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
const adicional = (quem, id, nome, cidade = "LAGARTO - SE") => rpc(quem, "registrar_adicional", { p_cidade: cidade, p_id_app: id, p_nome: nome,
  p_origem: "qd", p_mercado: false, p_motivo: "Chuva", p_valor_entrega: 5, p_valor_pedido: 50, p_valor_combinado: 10 });
const ficha = async (id) => um("select nome, cidade, criado_por_nome from entregadores where id_app = $1", [id]);

// antes da 009h: um lançamento com nome, outro sem nome do mesmo ID, e um cadastro pendente, nenhum com ficha
await adicional(sup, "ANT00001", "Rita Antiga");
await adicional(sup, "ant00001", null);
await adicional(sup, "ANT00002", null);
await rpc(sup, "enviar_cadastro", { p_id_app: "CAD00001", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Caio Pendente" });

const f009h = "../supabase/009h-entregador-pelo-lancamento.sql";
await db.query(arquivo(f009h));
await db.query(arquivo(f009h)); // rodar de novo não pode quebrar

await t("registros antigos: lançamento com nome e cadastro pendente ganham a ficha; lançamento sem nome recebe o nome", async () => {
  igual(await ficha("ant00001"), { nome: "Rita Antiga", cidade: "LAGARTO - SE", criado_por_nome: "Eduarda" });
  igual(await ficha("cad00001"), { nome: "Caio Pendente", cidade: "LAGARTO - SE", criado_por_nome: "Eduarda" });
  igual(await ficha("ant00002"), undefined, "sem nome em lugar nenhum não cria");
  igual((await um("select count(*)::int n from lancamentos_financeiros where lower(id_app) = 'ant00001' and nome_entregador is null")).n, 0);
  igual((await um("select count(*)::int n from comentarios_entregador where id_app = 'ant00001' and tipo = 'alteracao'")).n, 1, "anotação da criação");
});

await t("adicional com nome cria a ficha; o próximo só com o ID já sai com nome e cidade", async () => {
  await marca();
  await adicional(sup, "NOV00001", "  joão   novo ");
  igual(await ficha("nov00001"), { nome: "joão novo", cidade: "LAGARTO - SE", criado_por_nome: "Eduarda" });
  const ns = await novos(mon);
  igual(ns.length, 1); igual(ns[0].categoria, "financeiro", "o aviso que fica é o do lançamento");
  const l = await adicional(sup2, "nov00001", null, null);
  igual([l.nome_entregador, l.cidade], ["joão novo", "LAGARTO - SE"]);
  igual((await um("select count(*)::int n from entregadores where id_app = 'nov00001'")).n, 1);
});

await t("sem ficha, o nome vem do último lançamento do mesmo ID; ficha existente não é sobrescrita", async () => {
  await db.query("delete from entregadores where id_app = 'nov00001'");
  const l = await adicional(sup, "NOV00001", null);
  igual(l.nome_entregador, "joão novo");
  await adicional(sup, "NOV00001", "Outro Nome");
  igual((await ficha("nov00001")).nome, "joão novo");
});

await t("ajuste de bairro também cria a ficha", async () => {
  await db.query(`insert into bairros (cidade, nome, valor, taxa_log, apelidos) values
    ('LAGARTO - SE', 'CENTRO', 5.49, 0.99, '{}'), ('LAGARTO - SE', 'BREJO', 16.99, 0.99, '{}') on conflict do nothing`);
  await rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "CENTRO", p_real: "BREJO", p_id_app: "AJU00001", p_nome: "Ana Ajuste", p_origem: "qd" });
  igual((await ficha("aju00001")).nome, "Ana Ajuste");
});

await t("cadastro novo na ativação com ID e nome cria a ficha (sem esperar a aprovação)", async () => {
  await rpc(sup, "enviar_cadastro", { p_id_app: "CAD00002", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Bia Nova" });
  igual((await ficha("cad00002")).nome, "Bia Nova");
  await rpc(sup, "enviar_cadastro", { p_id_app: "CAD00003", p_cpf: null, p_cidade: "LAGARTO - SE" });
  igual(await ficha("cad00003"), undefined, "sem nome não cria");
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
