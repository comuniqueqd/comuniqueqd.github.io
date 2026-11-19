// Testes da 009u (supabase/009u-sem-cpf-nos-textos.sql): CPF em texto livre sai na gravação; quem_e para o adicional.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node mesa.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("set client_min_messages = warning");
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const M = ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql",
  "../supabase/007-pao-quentinho.sql", "../supabase/008-espionagem.sql", "../supabase/008b-cadastrar-entregador.sql",
  "../supabase/008b-notificacoes.sql", "../supabase/008c-analises.sql", "../supabase/008d-avisos-parte2.sql",
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql", "../supabase/009c-mensagens-agravante.sql",
  "../supabase/009c2-mensagens-opcoes.sql", "../supabase/009d-ajuda-aviso-turno.sql", "../supabase/009d2-tarefas-cards.sql",
  "../supabase/009d3-painel-metas-recorrentes.sql", "../supabase/009e-parceiros.sql", "../supabase/009f-parceiros-completo.sql",
  "../supabase/009g-tarefas-compartilhadas.sql", "../supabase/009h-entregador-pelo-lancamento.sql",
  "../supabase/009p-bairros-parecidos.sql", "../supabase/009s-sem-cpf.sql"];
for (const f of M) { if (process.env.LOG) console.log(f); await db.query(arquivo(f)); }

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
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


// a 009u, duas vezes (pode rodar de novo)
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009u-sem-cpf-nos-textos.sql"));
await rpc(admin, "entrar");
await db.query("insert into cidades (nome) values ('LAGARTO - SE') on conflict do nothing");
await db.query("update membros set papel_bloqueios = 'moderador' where email = $1", [admin.email]);
await rpc(admin, "cadastrar_entregador", { p_id_app: "mesa0001", p_nome: "Fulano de Tal", p_cidade: "LAGARTO - SE", p_comentario: null });

await t("quando alguém escreve um CPF formatado num comentário, então ele é gravado como [CPF removido]", async () => {
  await rpc(admin, "comentar_entregador", { p_id_app: "mesa0001", p_texto: "Mandou o CPF 529.982.247-25 no chat, telefone 79999998888" });
  const c = await um("select texto from comentarios_entregador where id_app = 'mesa0001' and texto like 'Mandou%'");
  igual(c.texto, "Mandou o CPF [CPF removido] no chat, telefone 79999998888");
});
await t("quando o CPF vem só em números depois da palavra CPF, então também sai (e o telefone fica)", async () => {
  await rpc(admin, "criar_aviso_geral", { p_texto: "cpf: 52998224725 do entregador, ligar 79999998888", p_horas: 1 });
  const a = await um("select texto from avisos_rapidos where tipo = 'aviso' order by criado_em desc limit 1");
  igual(a.texto, "cpf: [CPF removido] do entregador, ligar 79999998888");
});
await t("quando há CPF dentro de um jsonb, então ele sai e o jsonb continua válido", async () => {
  await rpc(admin, "sugerir_atividade", { p_titulo: "Teste do jsonb", p_descricao: null, p_para: null });
  await db.query(`update atividades set campos = '{"obs": "CPF 111.444.777-35", "n": 3}'::jsonb where titulo = 'Teste do jsonb'`);
  const v = await um("select campos as j from atividades where titulo = 'Teste do jsonb'");
  igual(v.j, { n: 3, obs: "CPF [CPF removido]" });
});
await t("quando o ID tem ficha, então quem_e devolve nome e cidade", async () => {
  igual(await rpc(admin, "quem_e", { p_id_app: " MESA0001 " }), { nome: "Fulano de Tal", cidade: "LAGARTO - SE", id_app: "mesa0001", tem_ficha: true });
});
await t("quando o ID não tem ficha, então quem_e não inventa nome", async () => {
  igual(await rpc(admin, "quem_e", { p_id_app: "naoexiste9" }), { nome: null, cidade: null, id_app: "naoexiste9", tem_ficha: false });
  igual(await rpc(admin, "quem_e", { p_id_app: "ab" }), null, "ID curto");
});
await t("quem não é da equipe não usa quem_e", async () => {
  await falha(rpc(pessoa("estranho@x.com", "Estranho"), "quem_e", { p_id_app: "mesa0001" }));
});

console.log(`\n${n - falhas}/${n} ok`);
await db.end();
process.exit(falhas ? 1 : 0);
