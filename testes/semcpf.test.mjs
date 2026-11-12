// Testes da 009i (supabase/009i-sem-cpf.sql): os CPFs já gravados são apagados (inclusive dentro de
// textos), o banco recusa CPF novo e o cadastro exige o ID.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node semcpf.test.mjs
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
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql", "../supabase/009h-entregador-pelo-lancamento.sql"]) await db.query(arquivo(f));

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
const cpfEm = async () => {
  // procura CPF (formatado ou "CPF 11 dígitos") em qualquer texto/jsonb das tabelas do app
  const cols = (await db.query(`select c.table_name t, c.column_name c from information_schema.columns c join information_schema.tables x
    on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type in ('text', 'jsonb')`)).rows;
  const achados = [];
  for (const { t, c } of cols) {
    const { rows } = await db.query(`select count(*)::int n from public."${t}" where "${c}"::text ~ '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}' or "${c}"::text ~* 'CPF\\s*:?\\s*\\d{11}'`);
    if (rows[0].n) achados.push(`${t}.${c}: ${rows[0].n}`);
  }
  return achados;
};

// antes da 009i: cadastros com CPF, edição que grava o CPF no histórico, avisos com o CPF no texto
const c1 = await rpc(sup, "enviar_cadastro", { p_id_app: "CPF00001", p_cpf: "529.982.247-25", p_cidade: "LAGARTO - SE", p_nome: "Ana Cpf", p_observacao: "doc 529.982.247-25" });
const c2 = await rpc(sup, "enviar_cadastro", { p_id_app: null, p_cpf: "11144477735", p_cidade: "LAGARTO - SE", p_nome: "Beto Só Cpf" });
await rpc(sup, "completar_cadastro", { p_cadastro: c1.id, p_id_app: "CPF00001", p_cpf: "11144477735".replace("111", "390"), p_nome: "Ana Cpf", p_cidade: "LAGARTO - SE", p_observacao: null, p_motivo: "troca" }).catch(() => {});
await rpc(sup, "completar_cadastro", { p_cadastro: c1.id, p_id_app: "CPF00001", p_cpf: null, p_nome: "Ana Cpf", p_cidade: "LAGARTO - SE", p_observacao: "doc 529.982.247-25", p_motivo: "tirar cpf" });
await db.query("insert into notificacoes (para, texto) select user_id, 'Cadastro novo: CPF 11144477735' from membros limit 1");

await t("antes da 009i existem CPFs gravados (o teste prepara o cenário)", async () => {
  igual((await um("select count(*)::int n from cadastros where cpf is not null")).n > 0, true);
  igual((await cpfEm()).length > 0, true, "textos com CPF");
});

const f = "../supabase/009i-sem-cpf.sql";
await db.query(arquivo(f));
await db.query(arquivo(f)); // rodar de novo não pode quebrar

await t("todos os CPFs somem: dos cadastros e de qualquer texto gravado", async () => {
  igual((await um("select count(*)::int n from cadastros where cpf is not null")).n, 0);
  igual(await cpfEm(), [], "nenhum texto com CPF");
  igual((await um("select observacao from cadastros where id = $1", [c1.id])).observacao, "doc (CPF removido)");
  igual((await um("select count(*)::int n from cadastros where id = $1", [c2.id])).n, 1, "o cadastro só com CPF continua (sem ID)");
});

await t("o banco recusa CPF novo, mesmo direto na tabela", async () => {
  await falha(db.query("update cadastros set cpf = '52998224725' where id = $1", [c1.id]), "cadastros_sem_cpf");
});

await t("cadastro novo exige o ID e ignora o CPF; a mensagem de repetido fala só do ID", async () => {
  await falha(rpc(sup, "enviar_cadastro", { p_id_app: null, p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Sem Id" }), "Preencha o ID do entregador.");
  const r = await rpc(sup, "enviar_cadastro", { p_id_app: "CPF00002", p_cpf: "52998224725", p_cidade: "LAGARTO - SE", p_nome: "Caio Novo" });
  igual((await um("select cpf, id_app from cadastros where id = $1", [r.id])), { cpf: null, id_app: "CPF00002" });
  const rep = await rpc(sup, "enviar_cadastro", { p_id_app: "cpf00002", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Caio Novo" }).catch((e) => ({ erro: e.message }));
  igual(/CPF/.test(JSON.stringify(rep)), false, "sem falar de CPF: " + JSON.stringify(rep));
});

await t("completar cadastro exige o ID; o antigo só com CPF ganha ID e o aviso não fala de CPF", async () => {
  await falha(rpc(mon, "completar_cadastro", { p_cadastro: c2.id, p_id_app: null, p_cpf: null, p_nome: "Beto Só Cpf", p_cidade: "LAGARTO - SE", p_observacao: null, p_motivo: "x" }), "precisa do ID");
  await rpc(mon, "completar_cadastro", { p_cadastro: c2.id, p_id_app: "BETO0001", p_cpf: "11144477735", p_nome: "Beto Só Cpf", p_cidade: "LAGARTO - SE", p_observacao: null, p_motivo: "ID que faltava" });
  igual((await um("select cpf, id_app from cadastros where id = $1", [c2.id])), { cpf: null, id_app: "BETO0001" });
  igual(await cpfEm(), []);
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
