// Testes da migração 006 (supabase/006-equipe-previsao-atencao.sql): regras de equipe, prazo editável, previsão, entregadores de atenção.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node equipe.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql", "../supabase/006-equipe-previsao-atencao.sql"]) await db.query(arquivo(f));

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

const lucas = pessoa("lucas@x.com", "Lucas Bismarque");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [lucas, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", "suporte"], [soAtiv, "monitorador", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [admin, mon, lucas, sup, sup2, soAtiv, estranho]) await rpc(p, "entrar");
const INF = Object.fromEntries((await db.query("select nome, id from infracoes")).rows.map((r) => [r.nome, r.id]));
const MAL_USO = INF["Mal Uso Proposital do Aplicativo"], REABRIR = INF["Reabrir Pedido Após Aceite Sem Justificativa Plausível"], AVARIA = INF["Avaria de Produto"];
const LEVE = INF["Reabertura de Pedido (aviso)"];
const registrar = (quem, id, inf, cidade = "LAGARTO - SE", nome = "Entregador " + id) =>
  rpc(quem, "registrar_bloqueio", { p_id_app: id, p_nome: nome, p_cidade: cidade, p_infracao: inf });
const avisosDe = async (p, trecho) => (await um("select count(*)::int n from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.texto like $2", [p.email, "%" + trecho + "%"])).n;

// ---------- regras de equipe ----------
let kleber;
await t("todos veem as Regras de equipe; só moderador edita e recebe a lista de membros", async () => {
  const r = await rpc(sup, "regras_equipe");
  igual([r.pode_editar, r.membros, r.cidades.length >= 30], [false, null, true]);
  igual((await rpc(soAtiv, "regras_equipe")).pode_editar, false);
  const a = await rpc(admin, "regras_equipe");
  igual([a.pode_editar, a.membros.length], [true, 6]);
  await falha(rpc(mon, "salvar_operador", { p_id: null, p_nome: "Kleber", p_contato: "75 0000-0000" }), "não permite");
  await falha(rpc(estranho, "regras_equipe"), "não tem acesso");
});
await t("operador logístico cadastrado uma vez e usado em várias cidades", async () => {
  kleber = await rpc(admin, "salvar_operador", { p_id: null, p_nome: "Kleber", p_contato: "75 0000-0001" });
  await rpc(admin, "salvar_responsavel_operadores", { p_email: lucas.email });
  for (const c of ["SERRINHA - BA", "ITABERABA - BA"])
    await rpc(admin, "salvar_cidade_equipe", { p_nome: c, p_gestao: "operador", p_responsavel_email: null, p_operador_id: kleber,
      p_tarifa_inicial: 8, p_tarifa_tipo: "bairro", p_adicional_km: null, p_ativa: true });
  const r = await rpc(sup, "regras_equipe");
  const s = r.cidades.find((c) => c.nome === "SERRINHA - BA");
  igual([s.gestao, s.operador_nome, s.responsavel_nome, s.recebe_tratativas, Number(s.tarifa_inicial), s.tarifa_tipo], ["operador", "Kleber", "Lucas Bismarque", true, 8, "bairro"]);
  igual(r.operadores.find((o) => o.id === kleber).cidades, 2);
  await falha(rpc(admin, "salvar_operador", { p_id: null, p_nome: "Kleber", p_contato: null }), "Já existe");
});
await t("cidade da Quero Delivery tem o próprio responsável; telefone vem do membro", async () => {
  await rpc(admin, "salvar_telefone", { p_email: mon.email, p_telefone: "79 99999-0000" });
  await rpc(admin, "salvar_cidade_equipe", { p_nome: "lagarto - se", p_gestao: "quero", p_responsavel_email: mon.email, p_operador_id: kleber,
    p_tarifa_inicial: 5.49, p_tarifa_tipo: "km", p_adicional_km: 0.99, p_ativa: true });
  const l = (await rpc(sup, "regras_equipe")).cidades.find((c) => c.nome === "LAGARTO - SE");
  igual([l.responsavel_nome, l.responsavel_telefone, l.operador_id, Number(l.adicional_km)], ["Jocimara", "79 99999-0000", null, 0.99]);
  await falha(rpc(admin, "salvar_cidade_equipe", { p_nome: "Lagarto", p_gestao: "quero", p_responsavel_email: null, p_operador_id: null, p_tarifa_inicial: null, p_tarifa_tipo: null, p_adicional_km: null, p_ativa: true }), "CIDADE - UF");
});
await t("tratativa de cidade de operador vai para o responsável dos operadores; trocar ele leva as pendentes", async () => {
  const b = await registrar(sup, "ope00001", MAL_USO, "SERRINHA - BA");
  igual((await um("select responsavel_email from tarefas where bloqueio_id = $1", [b.id])).responsavel_email, lucas.email);
  await rpc(admin, "salvar_responsavel_operadores", { p_email: mon.email });
  igual((await um("select responsavel_email from tarefas where bloqueio_id = $1", [b.id])).responsavel_email, mon.email);
  // responsável do suporte: tratativas vão para os moderadores
  await rpc(admin, "salvar_responsavel_operadores", { p_email: sup.email });
  igual((await um("select responsavel_email from tarefas where bloqueio_id = $1", [b.id])).responsavel_email, null);
  igual((await rpc(sup, "regras_equipe")).cidades.find((c) => c.nome === "SERRINHA - BA").recebe_tratativas, false);
  await rpc(admin, "salvar_responsavel_operadores", { p_email: lucas.email });
  igual((await um("select responsavel_email from tarefas where bloqueio_id = $1", [b.id])).responsavel_email, lucas.email);
});
await t("mudar a gestão da cidade muda o responsável", async () => {
  await rpc(admin, "salvar_cidade_equipe", { p_nome: "ITABERABA - BA", p_gestao: "quero", p_responsavel_email: mon.email, p_operador_id: null, p_tarifa_inicial: null, p_tarifa_tipo: null, p_adicional_km: null, p_ativa: true });
  igual((await rpc(sup, "regras_equipe")).cidades.find((c) => c.nome === "ITABERABA - BA").responsavel_nome, "Jocimara");
});
await t("responsável recebe aviso de cadastro novo da cidade (mas não do que ele mesmo enviou)", async () => {
  await rpc(sup, "enviar_cadastro", { p_id_app: "cad00001", p_cpf: null, p_cidade: "SERRINHA - BA", p_observacao: null });
  igual(await avisosDe(lucas, "Cadastro novo em SERRINHA - BA"), 1);
  await rpc(lucas, "enviar_cadastro", { p_id_app: "cad00002", p_cpf: null, p_cidade: "SERRINHA - BA", p_observacao: null });
  igual(await avisosDe(lucas, "Cadastro novo em SERRINHA - BA"), 1);
  await rpc(sup, "enviar_cadastro", { p_id_app: "cad00003", p_cpf: null, p_cidade: "CIDADE NOVA - XX", p_observacao: null });
});
await t("tratativa atrasada avisa moderadores e o responsável da cidade", async () => {
  const b = await registrar(sup, "atr00001", MAL_USO, "SERRINHA - BA");
  await db.query("update tarefas set criada_em = now() - interval '40 hours' where bloqueio_id = $1", [b.id]);
  await rpc(sup, "verificar_atrasos");
  igual([await avisosDe(lucas, "Tratativa atrasada"), await avisosDe(admin, "Tratativa atrasada"), await avisosDe(mon, "Tratativa atrasada")], [1, 1, 0]);
});
await t("aba Regras dos bloqueios mostra o responsável efetivo e não desfaz o da equipe", async () => {
  const r = await rpc(mon, "regras_bloqueio");
  igual(r.cidades.find((c) => c.nome === "SERRINHA - BA").responsavel_nome, "Lucas Bismarque");
  await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: null, p_ativa: true });
  igual((await rpc(mon, "regras_bloqueio")).cidades.find((c) => c.nome === "LAGARTO - SE").responsavel_nome, "Jocimara");
});

// ---------- prazo editável ----------
await t("moderador muda o prazo da tratativa; vale na hora", async () => {
  await falha(rpc(mon, "salvar_prazo_tratativa", { p_horas: 24 }), "não permite");
  await falha(rpc(admin, "salvar_prazo_tratativa", { p_horas: 0 }), "1 a 720");
  const b = await registrar(sup, "pra00001", MAL_USO, "LAGARTO - SE");
  await db.query("update tarefas set criada_em = now() - interval '30 hours' where bloqueio_id = $1", [b.id]);
  const at = async () => (await rpc(mon, "listar_tarefas", { p_status: "pendente" })).find((x) => x.bloqueio.id === b.id);
  igual([(await at()).atrasada, (await at()).prazo_horas], [false, 32]);
  await rpc(admin, "salvar_prazo_tratativa", { p_horas: 24 });
  igual([(await at()).atrasada, (await at()).prazo_horas], [true, 24]);
  igual((await rpc(sup, "regras_bloqueio")).prazo_tratativa_horas, 24);
  igual((await rpc(sup, "resumo_inicio")).prazo_tratativa_horas, 24);
  await rpc(admin, "salvar_prazo_tratativa", { p_horas: 32 });
});

// ---------- previsão ----------
const daqui = (h) => new Date(Date.now() + h * 3600000).toISOString();
await t("previsão no cadastro: monitorador/moderador da ativação; some quando o cadastro é decidido", async () => {
  const c = await um("select id from cadastros where id_app = 'cad00001'");
  await falha(rpc(sup, "definir_previsao", { p_tipo: "cadastro", p_id: c.id, p_previsao: daqui(2) }), "não permite");
  await falha(rpc(mon, "definir_previsao", { p_tipo: "cadastro", p_id: c.id, p_previsao: "2000-01-01T00:00:00Z" }), "futuro");
  await rpc(mon, "definir_previsao", { p_tipo: "cadastro", p_id: c.id, p_previsao: daqui(2) });
  const l = (await rpc(sup, "listar_cadastros", { p_escopo: "meus" })).find((x) => x.id === c.id);
  igual([!!l.previsao, l.previsao_por_nome], [true, "Jocimara"]);
  await rpc(mon, "decidir", { p_cadastro: c.id, p_acao: "aprovar" });
  igual((await um("select previsao from cadastros where id = $1", [c.id])).previsao, null);
  await falha(rpc(mon, "definir_previsao", { p_tipo: "cadastro", p_id: c.id, p_previsao: daqui(2) }), "já foi decidido");
});
await t("previsão na tratativa: quem está com ela ou moderador", async () => {
  const b = (await rpc(sup, "listar_bloqueios", { p_escopo: "meus" })).find((x) => x.id_app === "ope00001");
  await falha(rpc(mon, "definir_previsao", { p_tipo: "tarefa", p_id: b.tarefa.id, p_previsao: daqui(3) }), "Só quem está");
  await falha(rpc(sup, "definir_previsao", { p_tipo: "tarefa", p_id: b.tarefa.id, p_previsao: daqui(3) }), "Só quem está");
  await rpc(lucas, "definir_previsao", { p_tipo: "tarefa", p_id: b.tarefa.id, p_previsao: daqui(3) });
  const t2 = (await rpc(sup, "listar_bloqueios", { p_escopo: "meus" })).find((x) => x.id_app === "ope00001").tarefa;
  igual([!!t2.previsao, t2.previsao_por_nome], [true, "Lucas Bismarque"]);
  await rpc(admin, "definir_previsao", { p_tipo: "tarefa", p_id: b.tarefa.id, p_previsao: null });
  igual((await rpc(sup, "listar_bloqueios", { p_escopo: "meus" })).find((x) => x.id_app === "ope00001").tarefa.previsao, null);
});
await t("previsão na atividade: quem aceitou", async () => {
  const a = await rpc(sup, "sugerir_atividade", { p_titulo: "Ligar para o restaurante" });
  await falha(rpc(sup, "definir_previsao", { p_tipo: "atividade", p_id: a, p_previsao: daqui(1) }), "quem aceitou");
  await rpc(sup2, "aceitar_atividade", { p_id: a });
  await falha(rpc(sup, "definir_previsao", { p_tipo: "atividade", p_id: a, p_previsao: daqui(1) }), "Só quem aceitou");
  await rpc(sup2, "definir_previsao", { p_tipo: "atividade", p_id: a, p_previsao: daqui(1) });
  const x = (await rpc(sup, "listar_atividades")).find((y) => y.id === a);
  igual([!!x.previsao, x.previsao_por_nome, x.pode_prever], [true, "Joyce", false]);
  await falha(rpc(sup, "definir_previsao", { p_tipo: "outra", p_id: a, p_previsao: null }), "Tipo inválido");
});

// ---------- entregadores de atenção ----------
await t("atenção: reincidente, vários tipos, a uma leve do limite, aprovado há pouco e bloqueado", async () => {
  await registrar(sup, "rei00001", REABRIR, "LAGARTO - SE", "Reincidente");
  await db.query("update bloqueios set inicio = inicio - interval '20 days', fim = fim - interval '20 days' where id_app = 'rei00001'");
  await registrar(sup, "rei00001", AVARIA, "LAGARTO - SE", "Reincidente");
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "lev00001", p_infracao: LEVE });
  await db.query("update bloqueios set inicio = inicio - interval '1 hour' where id_app = 'lev00001'");
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "lev00001", p_infracao: LEVE });
  await registrar(sup, "cad00001", REABRIR, "SERRINHA - BA", "Aprovado Recente");
  const l = await rpc(sup, "entregadores_atencao");
  const por = (id) => l.find((x) => x.id_app === id);
  const r = por("rei00001");
  if (!r || !r.motivos.some((m) => m.startsWith("reincidente: 2")) || !r.motivos.some((m) => m.startsWith("2 tipos"))) throw new Error(JSON.stringify(r));
  igual(por("lev00001").motivos, ["a uma infração leve do limite (2 de 3)"]);
  igual(por("cad00001").motivos, ["aprovado há pouco e já bloqueado"]);
  igual(por("pra00001"), undefined, "um bloqueio só não é atenção:");
  igual((await rpc(sup, "resumo_inicio")).bloqueios.atencao, l.length);
  await falha(rpc(soAtiv, "entregadores_atencao"), "módulo de bloqueios");
});
await t("encerrado não entra na lista de atenção", async () => {
  await registrar(sup, "fur00001", INF["Furto ou Extravio: Desvio de Produtos ou Valores"], "LAGARTO - SE", "Encerrado");
  await registrar(sup, "fur00001", REABRIR, "LAGARTO - SE", "Encerrado");
  igual((await rpc(sup, "entregadores_atencao")).some((x) => x.id_app === "fur00001"), false);
});
await t("internas novas fora do alcance do app", async () => {
  for (const fn of ["responsavel_cidade_email('LAGARTO - SE')", "reatribuir_tarefas(array['LAGARTO - SE'])"])
    await falha(sqlComo(mon, `select public.${fn}`), "permission denied");
});

await db.end();
console.log(`\n${n - falhas}/${n} passaram`);
process.exit(falhas ? 1 : 0);
