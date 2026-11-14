// Testes da 009s (supabase/009s-sem-cpf.sql): o Comunique não guarda mais CPF. Os já guardados são apagados
// (inclusive dentro de textos), CPF novo não é gravado, o ID passa a ser obrigatório e as mensagens não citam CPF.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node semcpf.test.mjs
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
  "../supabase/009p-bairros-parecidos.sql"];
for (const f of M) await db.query(arquivo(f));

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

// antes da 009s: dados com CPF, do jeito que estão no Supabase hoje
await rpc(admin, "entrar");
await db.query("insert into cidades (nome) values ('LAGARTO - SE') on conflict do nothing");
const comId = await rpc(admin, "enviar_cadastro", { p_id_app: "cpf00001", p_cpf: "52998224725", p_cidade: "LAGARTO - SE", p_nome: "Com Id" });
const soCpf = await rpc(admin, "enviar_cadastro", { p_id_app: null, p_cpf: "11144477735", p_cidade: "LAGARTO - SE", p_nome: "So Cpf" });
await db.query("insert into notificacoes (para, texto) select user_id, 'Cadastro CPF 111.444.777-35 e CPF: 52998224725, telefone 79999998888' from membros where user_id is not null limit 1");
await db.query("update eventos set detalhe = 'CPF: 529.982.247-25 → (vazio)' where cadastro_id = $1", [comId.id]);
igual(Number((await um("select count(*) c from cadastros where cpf is not null")).c), 2, "semente");

// a 009s, duas vezes (pode rodar de novo)
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009s-sem-cpf.sql"));

await t("os CPFs guardados foram apagados (cadastros)", async () => {
  igual(Number((await um("select count(*) c from cadastros where cpf is not null")).c), 0);
  igual(await um("select nome, id_app from cadastros where id = $1", [soCpf.id]), { nome: "So Cpf", id_app: null }, "o cadastro só com CPF continua, sem os dois");
});
await t("CPF escrito em textos vira [CPF removido]; telefone fica", async () => {
  igual((await um("select texto from notificacoes where texto like 'Cadastro CPF%'")).texto,
    "Cadastro CPF [CPF removido] e CPF: [CPF removido], telefone 79999998888");
  igual((await um("select detalhe from eventos where cadastro_id = $1 and detalhe is not null", [comId.id])).detalhe, "CPF: [CPF removido] → (vazio)");
});
await t("cadastro novo com CPF: o CPF é descartado", async () => {
  const r = await rpc(admin, "enviar_cadastro", { p_id_app: "cpf00002", p_cpf: "52998224725", p_cidade: "LAGARTO - SE", p_nome: "Novo" });
  igual((await um("select cpf from cadastros where id = $1", [r.id])).cpf, null);
});
await t("cadastro novo sem ID é recusado, com mensagem sem CPF", async () => {
  await falha(rpc(admin, "enviar_cadastro", { p_id_app: null, p_cpf: "52998224725", p_cidade: "LAGARTO - SE", p_nome: "Sem Id" }), "Preencha o ID do entregador");
  const e = await falha(rpc(admin, "enviar_cadastro", { p_id_app: null, p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Sem nada" }));
  igual(/CPF/.test(e.message), false, "mensagem: " + e.message);
});
await t("ID repetido: a resposta não cita CPF", async () => {
  const r = await rpc(admin, "enviar_cadastro", { p_id_app: "cpf00001", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Repetido" }).catch((e) => ({ erro: e.message }));
  igual(/CPF/.test(JSON.stringify(r)), false, "resposta: " + JSON.stringify(r));
  igual(/já está cadastrado/.test(JSON.stringify(r)), true, "resposta: " + JSON.stringify(r));
});
await t("completar o cadastro com CPF não grava o CPF; o antigo sem ID ainda pode ser decidido", async () => {
  await rpc(admin, "completar_cadastro", { p_cadastro: comId.id, p_id_app: "cpf00001", p_cpf: "52998224725", p_nome: "Com Id", p_cidade: "LAGARTO - SE", p_observacao: null, p_motivo: null });
  igual((await um("select cpf from cadastros where id = $1", [comId.id])).cpf, null);
  await rpc(admin, "decidir", { p_cadastro: soCpf.id, p_acao: "encerrar", p_motivo: "Outro", p_detalhe: "teste sem ID" });
  igual((await um("select status from cadastros where id = $1", [soCpf.id])).status, "encerrado");
});
await t("ver o cadastro não traz CPF", async () => {
  const r = await rpc(admin, "ver_cadastro", { p_cadastro: comId.id });
  igual(r.cpf ?? null, null);
});

console.log(`\n${n - falhas}/${n} ok`);
await db.end();
process.exit(falhas ? 1 : 0);
