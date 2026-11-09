// Testes da 009e (supabase/009e-parceiros.sql): parceiros e as tarefas/metas de aprovação que contam sozinhas.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node parceiros.test.mjs
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
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql", "../supabase/009c-mensagens-agravante.sql",
  "../supabase/009c2-mensagens-opcoes.sql", "../supabase/009d-ajuda-aviso-turno.sql",
  "../supabase/009d2-tarefas-cards.sql",
  "../supabase/009d3-painel-metas-recorrentes.sql",
  "../supabase/009e-parceiros.sql", "../supabase/009e-parceiros.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("mon2@x.com", "Monitora Teste");
const sup = pessoa("sup2a@x.com", "Suporte Teste");
const sup2 = pessoa("sup3@x.com", "Suporte Sem Bloqueio");
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
const rapidos = async (p) => (await rpc(p, "resumo_e_avisos")).resumo.avisos_rapidos;
const avisosDe = async (p, cat) => (await db.query("select n.texto from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.categoria = $2 order by n.id", [p.email, cat])).rows;

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, sup2]) await rpc(p, "entrar");


const avisos = async (p) => (await db.query("select n.texto from notificacoes n join membros m on m.user_id = n.para where m.email = $1 order by n.id", [p.email])).rows.map((x) => x.texto);
const tarefa = async (p, id) => (await rpc(p, "listar_atividades")).find((x) => x.id === id);

await t("parceiros: registro direto por qualquer papel, sem repetir na mesma cidade, com aviso", async () => {
  await falha(rpc(sup, "registrar_parceiro", { p_estabelecimento: " ", p_cidade: "LAGARTO - SE" }), "nome do estabelecimento");
  await falha(rpc(sup, "registrar_parceiro", { p_estabelecimento: "Padaria Sol", p_cidade: "Lagarto" }), "CIDADE - UF");
  const r = await rpc(sup2, "registrar_parceiro", { p_estabelecimento: "Padaria Sol", p_cidade: "lagarto - se", p_observacao: "Abre às 6h" });
  igual([r.parceiro.estabelecimento, r.parceiro.cidade, r.parceiro.meu, r.tarefas], ["Padaria Sol", "LAGARTO - SE", true, []]);
  await falha(rpc(mon, "registrar_parceiro", { p_estabelecimento: "padaria sol ", p_cidade: "LAGARTO - SE" }), "já está registrado");
  await rpc(mon, "registrar_parceiro", { p_estabelecimento: "Padaria Sol", p_cidade: "ITABAIANA - SE" });
  igual((await avisos(admin)).filter((x) => x.includes("ativou o parceiro Padaria Sol")).length, 2);
  const l = await rpc(sup, "listar_parceiros", { p_busca: "padaria" });
  igual([l.total, l.itens.length, l.por_cidade.length], [2, 2, 2]);
  igual((await rpc(mon, "listar_parceiros", { p_meus: true })).itens.map((x) => x.cidade), ["ITABAIANA - SE"]);
  await falha(rpc(sup, "excluir_parceiro", { p_id: r.parceiro.id }), "Só quem registrou");
});

let tp, te;
await t("Aprovar parceiros: conta sozinho os registrados por quem pegou, na cidade, depois de pegar", async () => {
  tp = await rpc(admin, "criar_tarefa", { p_tipo: "ativar_parceiro", p_campos: { cidade: "LAGARTO - SE", quantidade: 2 }, p_para: [sup.sub] });
  igual([tp.titulo, tp.tipo_nome, tp.progresso_automatico], ["Aprovar 2 parceiro(s) · LAGARTO - SE", "Aprovar parceiros", true]);
  await rpc(sup, "registrar_parceiro", { p_estabelecimento: "Antes de pegar", p_cidade: "LAGARTO - SE" });
  await rpc(sup, "aceitar_atividade", { p_id: tp.id });
  await falha(rpc(sup, "avancar_tarefa", { p_id: tp.id }), "conta sozinho");
  const r = await rpc(sup, "registrar_parceiro", { p_estabelecimento: "Mercado Bom", p_cidade: "LAGARTO - SE" });
  igual(r.tarefas.map((x) => [x.titulo, x.progresso, x.meta]), [["Aprovar 2 parceiro(s) · LAGARTO - SE", 1, 2]]);
  await rpc(sup, "registrar_parceiro", { p_estabelecimento: "Farmácia Vida", p_cidade: "ITABAIANA - SE" });
  await rpc(mon, "registrar_parceiro", { p_estabelecimento: "De outra pessoa", p_cidade: "LAGARTO - SE" });
  igual((await tarefa(sup, tp.id)).progresso, 1, "outra cidade e outra pessoa não contam:");
  await rpc(sup, "concluir_atividade", { p_id: tp.id, p_nota: "Fechei com 1" });
  await rpc(sup, "registrar_parceiro", { p_estabelecimento: "Depois de concluir", p_cidade: "LAGARTO - SE" });
  igual((await tarefa(sup, tp.id)).progresso, 1, "concluída à mão, para de contar:");
});

await t("Aprovar entregadores: conta as aprovações feitas por quem pegou (não o que enviou); desfazer tira", async () => {
  te = await rpc(sup, "criar_tarefa", { p_tipo: "ativar_entregadores", p_campos: { cidade: "LAGARTO - SE", quantidade: 3 }, p_para: [mon.sub] });
  const te2 = await rpc(sup, "criar_tarefa", { p_tipo: "ativar_entregadores", p_campos: { cidade: "LAGARTO - SE", quantidade: 1 }, p_para: [mon.sub] });
  igual(te.titulo, "Aprovar 3 entregador(es) · LAGARTO - SE");
  await rpc(mon, "aceitar_atividade", { p_id: te.id }); await rpc(mon, "aceitar_atividade", { p_id: te2.id });
  const ids = [];
  for (const [i, cid] of [["lag1001", "LAGARTO - SE"], ["lag1002", "LAGARTO - SE"], ["ita1001", "ITABAIANA - SE"], ["lag1003", "LAGARTO - SE"]])
    ids.push((await rpc(sup, "enviar_cadastro", { p_id_app: i, p_cpf: null, p_cidade: cid, p_nome: "Teste " + i })).id);
  await rpc(mon, "decidir", { p_cadastro: ids[0], p_acao: "aprovar" });
  await rpc(mon, "decidir", { p_cadastro: ids[1], p_acao: "aprovar" });
  await rpc(mon, "decidir", { p_cadastro: ids[2], p_acao: "aprovar" });
  await rpc(admin, "decidir", { p_cadastro: ids[3], p_acao: "aprovar" });
  igual([(await tarefa(mon, te.id)).progresso, (await tarefa(mon, te2.id)).progresso], [2, 2], "as duas tarefas no nome dela contam:");
  igual((await rpc(mon, "tarefas_que_contam", { p_tipo: "ativar_entregadores", p_cidade: "LAGARTO - SE" })).length, 2);
  await rpc(admin, "desfazer", { p_cadastro: ids[1] });
  igual((await tarefa(mon, te.id)).progresso, 1, "desfeita:");
});

await t("registrar o que já fiz de aprovação conta a quantidade informada", async () => {
  const r = await rpc(sup, "criar_tarefa", { p_tipo: "ativar_parceiro", p_campos: { cidade: "LAGARTO - SE", quantidade: 4 }, p_modo: "registro" });
  igual([r.progresso, r.meta, r.progresso_automatico], [4, 4, false]);
});

await t("metas de aprovação contam as aprovações direto", async () => {
  const m = await rpc(sup, "salvar_meta", { p_tipo: "ativar_parceiro", p_quantidade: 10, p_periodo: "semana" });
  igual([m[0].conta, m[0].feitas], ["aprovacoes", 4]);
  const n = await rpc(mon, "salvar_meta", { p_tipo: "ativar_entregadores", p_quantidade: 5, p_periodo: "dia" });
  igual(n[0].feitas, 2, "aprovou 3, uma foi desfeita:");
});

await t("segurança: tabela fechada e funções internas não expostas", async () => {
  await db.query("begin"); await db.query("set local role authenticated");
  await falha(db.query("select * from parceiros"), "permission denied"); await db.query("rollback");
  const r = await um(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p
                       where p.proname in ('aprovacoes_de', 'parceiro_json', 'progresso_tarefa', 'titulo_tarefa', 'json_atividade')`);
  igual(r.x, false);
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
