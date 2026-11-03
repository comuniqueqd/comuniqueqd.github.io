// Testes da migração 004 (supabase/004-atividades-registros.sql) num Postgres local:
// tratativas atrasadas e realocação, atividades sugeridas, registros, ficha, tela inicial.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node atividades.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/004-atividades-registros.sql"]) await db.query(arquivo(f));

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

for (const [p, pa, pb] of [[mod2, "moderador", "moderador"], [mon, "suporte", "monitorador"], [mon2, "suporte", "monitorador"],
  [sup, "suporte", "suporte"], [sup2, "suporte", "suporte"], [soAtiv, "monitorador", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [admin, mod2, mon, mon2, sup, sup2, soAtiv, estranho]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
const INF = Object.fromEntries((await db.query("select nome, id from infracoes")).rows.map((r) => [r.nome, r.id]));
const MAL_USO = INF["Mal Uso Proposital do Aplicativo"], FURTO = INF["Furto ou Extravio: Desvio de Produtos ou Valores"], REABRIR = INF["Reabrir Pedido Após Aceite Sem Justificativa Plausível"];
const registrar = (quem, id, inf, nome = "Entregador " + id) =>
  rpc(quem, "registrar_bloqueio", { p_id_app: id, p_nome: nome, p_cidade: "LAGARTO - SE", p_infracao: inf });
const atrasar = (bloqueioId, horas) => db.query("update tarefas set criada_em = now() - make_interval(hours => $2) where bloqueio_id = $1", [bloqueioId, horas]);

// ---------- tratativas atrasadas ----------
const b1 = await registrar(sup, "atr00001", MAL_USO, "Atrasado Um");
const b2 = await registrar(sup, "atr00002", MAL_USO, "No Prazo");
await t("tratativa com mais de 32 h fica atrasada; dentro do prazo, não", async () => {
  await atrasar(b1.id, 33);
  const l = await rpc(mon, "listar_tarefas", { p_status: "pendente" });
  const a = l.find((x) => x.bloqueio.id === b1.id), b = l.find((x) => x.bloqueio.id === b2.id);
  igual([a.atrasada, b.atrasada, a.prazo_horas, a.bloqueio.tarefa.atrasada], [true, false, 32, true]);
});
await t("verificar_atrasos avisa os moderadores uma vez só", async () => {
  igual(await rpc(sup, "verificar_atrasos"), 1);
  igual(await rpc(mon, "verificar_atrasos"), 0);
  const n = (await db.query("select m.email, n.texto from notificacoes n join membros m on m.user_id = n.para where n.texto like 'Tratativa atrasada%' order by 1")).rows;
  igual(n.map((x) => x.email), [mod2.email, admin.email].sort());
  if (!n[0].texto.includes("Atrasado Um") || !n[0].texto.includes("Jocimara")) throw new Error(n[0].texto);
  igual(await rpc(estranho, "verificar_atrasos"), 0);
});
await t("tela inicial conta as atrasadas (moderador: todas; monitorador: as suas)", async () => {
  igual((await rpc(admin, "resumo_inicio")).bloqueios.tratativas_atrasadas, 1);
  igual((await rpc(mon, "resumo_inicio")).bloqueios.tratativas_atrasadas, 1);
  igual((await rpc(mon2, "resumo_inicio")).bloqueios.tratativas_atrasadas, 0);
});
await t("só moderador realoca; destino precisa ser monitorador ou moderador", async () => {
  const tar = (await um("select id from tarefas where bloqueio_id = $1", [b1.id])).id;
  await falha(rpc(mon, "realocar_tarefa", { p_tarefa: tar, p_email: mon2.email }), "não permite");
  await falha(rpc(admin, "realocar_tarefa", { p_tarefa: tar, p_email: sup.email }), "monitorador ou moderador");
  await falha(rpc(admin, "realocar_tarefa", { p_tarefa: tar, p_email: mon.email }), "já está com");
  await rpc(admin, "realocar_tarefa", { p_tarefa: tar, p_email: mon2.email });
  const x = await um("select responsavel_email, realocada_por_nome from tarefas where id = $1", [tar]);
  igual([x.responsavel_email, x.realocada_por_nome], [mon2.email, "Mateus Lopes"]);
  igual((await um("select count(*)::int n from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.texto like '%passou para você%'", [mon2.email])).n, 1);
  igual((await um("select detalhe from eventos_bloqueio where bloqueio_id = $1 and tipo = 'realocada'", [b1.id])).detalhe, "de Jocimara para Lucas");
  // o novo responsável conclui; o antigo não vê mais
  igual((await rpc(mon, "listar_tarefas", { p_status: "pendente" })).some((t) => t.bloqueio.id === b1.id), false);
  await rpc(mon2, "concluir_tratativa", { p_tarefa: tar, p_nota: "feito" });
});
await t("trocar o responsável da cidade não desfaz uma realocação manual", async () => {
  const tar = (await um("select id from tarefas where bloqueio_id = $1", [b2.id])).id;
  await rpc(admin, "realocar_tarefa", { p_tarefa: tar, p_email: mod2.email });
  await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon2.email, p_ativa: true });
  igual((await um("select responsavel_email from tarefas where id = $1", [tar])).responsavel_email, mod2.email);
  await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
});

// ---------- reverter encerramento ----------
await t("liberar um encerramento vira 'revertido', com aviso próprio", async () => {
  const r = await registrar(sup, "fur00001", FURTO, "Ladrão");
  await falha(rpc(mon, "liberar_bloqueio", { p_bloqueio: r.id, p_motivo: " " }), "reverter o encerramento");
  await rpc(mon, "liberar_bloqueio", { p_bloqueio: r.id, p_motivo: "Provou que não foi ele" });
  const b = (await rpc(mon, "listar_bloqueios", { p_escopo: "todos" })).find((x) => x.id === r.id);
  igual(b.situacao, "revertido");
  igual((await um("select detalhe from eventos_bloqueio where bloqueio_id = $1 and tipo = 'liberado_antes'", [r.id])).detalhe, "Encerramento revertido: Provou que não foi ele");
  if (!(await um("select texto from notificacoes order by id desc limit 1")).texto.startsWith("O encerramento de parceria de Ladrão")) throw new Error("aviso");
});

// ---------- atividades sugeridas ----------
let a1, a2;
await t("qualquer pessoa sugere atividade; pessoas sugeridas recebem aviso", async () => {
  a1 = await rpc(sup, "sugerir_atividade", { p_titulo: "Ligar para o restaurante X", p_descricao: "Confirmar horário", p_para: [mon.sub, sup2.sub] });
  a2 = await rpc(soAtiv, "sugerir_atividade", { p_titulo: "Atualizar planilha de cidades" });
  const n = (await db.query("select m.email from notificacoes n join membros m on m.user_id = n.para where n.texto like '%sugeriu uma atividade%' order by 1")).rows.map((r) => r.email);
  igual(n, [mon.email, sup2.email]);
  await falha(rpc(sup, "sugerir_atividade", { p_titulo: " " }), "Escreva");
  await falha(rpc(sup, "sugerir_atividade", { p_titulo: "x", p_para: [randomUUID()] }), "não faz parte");
  await falha(rpc(estranho, "sugerir_atividade", { p_titulo: "x" }), "não tem acesso");
});
await t("antes de 10 min só as pessoas sugeridas (e quem criou, e moderadores) veem e aceitam", async () => {
  const ids = async (p) => (await rpc(p, "listar_atividades")).map((a) => a.id);
  igual((await ids(mon)).includes(a1), true);
  igual((await ids(sup)).includes(a1), true);
  igual((await ids(admin)).includes(a1), true);
  igual((await ids(mon2)).includes(a1), false);
  igual((await ids(mon2)).includes(a2), true, "sem sugestão = para todos:");
  await falha(rpc(mon2, "aceitar_atividade", { p_id: a1 }), "10 minutos");
  igual((await rpc(mon, "resumo_inicio")).atividades.para_aceitar, 2);
  igual((await rpc(mon2, "resumo_inicio")).atividades.para_aceitar, 1);
});
await t("depois de 10 min sem aceite, abre para todos", async () => {
  await db.query("update atividades set criada_em = now() - interval '11 minutes' where id = $1", [a1]);
  const l = await rpc(mon2, "listar_atividades");
  igual([l.find((a) => a.id === a1).para_todos, l.find((a) => a.id === a1).pode_aceitar], [true, true]);
});
await t("aceitar: uma pessoa só; quem criou é avisado", async () => {
  await rpc(mon2, "aceitar_atividade", { p_id: a1 });
  await falha(rpc(mon, "aceitar_atividade", { p_id: a1 }), "já foi aceita por Lucas");
  if (!(await um("select texto from notificacoes order by id desc limit 1")).texto.includes("Lucas aceitou")) throw new Error("aviso");
  igual((await rpc(mon2, "resumo_inicio")).atividades.minhas_em_andamento, 1);
});
await t("concluir: quem aceitou ou moderador", async () => {
  await falha(rpc(sup, "concluir_atividade", { p_id: a1 }), "Só quem aceitou");
  await rpc(mon2, "concluir_atividade", { p_id: a1, p_nota: "Confirmado" });
  const a = (await rpc(sup, "listar_atividades")).find((x) => x.id === a1);
  igual([a.status, a.concluida_por_nome, a.nota], ["concluida", "Lucas", "Confirmado"]);
  await rpc(sup2, "aceitar_atividade", { p_id: a2 });
  await rpc(admin, "concluir_atividade", { p_id: a2 });
});
await t("excluir: quem criou ou moderador", async () => {
  const a3 = await rpc(sup, "sugerir_atividade", { p_titulo: "Excluível" });
  await falha(rpc(sup2, "excluir_atividade", { p_id: a3 }), "Só quem criou");
  await rpc(sup, "excluir_atividade", { p_id: a3 });
  const a4 = await rpc(sup, "sugerir_atividade", { p_titulo: "Outra", p_prazo: new Date(Date.now() + 86400000).toISOString() });
  await rpc(mod2, "excluir_atividade", { p_id: a4 });
  await falha(rpc(sup, "sugerir_atividade", { p_titulo: "x", p_prazo: "2000-01-01T00:00:00Z" }), "futuro");
});

// ---------- registros ----------
await t("registros: feed dos dois módulos, também para o suporte", async () => {
  await rpc(sup2, "enviar_cadastro", { p_id_app: "cad00001", p_cpf: "529.982.247-25", p_cidade: "LAGARTO - SE", p_observacao: null });
  const r = await rpc(sup, "listar_registros", {});
  const acoes = r.map((x) => `${x.modulo}:${x.por_nome}:${x.acao}`);
  for (const esperado of ["ativacao:Joyce:enviou o cadastro", "bloqueios:Eduarda:registrou bloqueio", "bloqueios:Jocimara:reverteu o encerramento", "bloqueios:Mateus Lopes:realocou a tratativa", "bloqueios:Lucas:concluiu a tratativa"])
    if (!acoes.includes(esperado)) throw new Error("faltou " + esperado + " em " + acoes.join(" | "));
  igual(r.find((x) => x.modulo === "ativacao").cpf, "52998224725");
  for (let i = 1; i < r.length; i++) if (r[i].em > r[i - 1].em) throw new Error("fora de ordem");
});
await t("registros: filtros, busca por CPF e paginação", async () => {
  igual((await rpc(sup, "listar_registros", { p_modulo: "ativacao" })).every((x) => x.modulo === "ativacao"), true);
  igual((await rpc(sup, "listar_registros", { p_pessoa: "Joyce" })).every((x) => x.por_nome === "Joyce"), true);
  igual((await rpc(sup, "listar_registros", { p_busca: "529.982.247-25" })).length, 1);
  igual((await rpc(sup, "listar_registros", { p_busca: "ladrão" })).length >= 2, true);
  const p1 = await rpc(sup, "listar_registros", { p_limite: 3 });
  const p2 = await rpc(sup, "listar_registros", { p_limite: 3, p_antes: p1[2].em });
  igual(p1.length === 3 && p2.length >= 1 && p2[0].em < p1[2].em, true);
});
await t("registros: quem não tem o módulo de bloqueios só vê a ativação; fora da equipe não vê nada", async () => {
  igual((await rpc(soAtiv, "listar_registros", {})).every((x) => x.modulo === "ativacao"), true);
  await falha(rpc(estranho, "listar_registros", {}), "não tem acesso");
});

// ---------- ficha ----------
await t("ficha: linha do tempo junta ativação e bloqueios; leves contadas à parte", async () => {
  const c0 = await um("select id from cadastros where id_app = 'cad00001'");
  await rpc(admin, "decidir", { p_cadastro: c0.id, p_acao: "aprovar" });
  await registrar(sup, "cad00001", REABRIR, "Cadastrado Agora");
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "cad00001", p_infracao: INF["Reabertura de Pedido (aviso)"] });
  const f = (await rpc(sup, "consultar_entregador", { p_busca: "CAD00001" })).entregadores[0];
  igual([f.bloqueios, f.leves], [1, 1]);
  const textos = f.linha_do_tempo.map((x) => x.texto);
  for (const e of ["Cadastro enviado", "Cadastro aprovado", "Infração leve: Reabertura de Pedido (aviso)"]) if (!textos.includes(e)) throw new Error("faltou " + e + ": " + textos);
  const c = (await rpc(sup, "consultar_entregador", { p_busca: "cad00001" })).cadastros[0];
  igual([c.cpf, c.enviado_por_nome, c.situacao], ["52998224725", "Joyce", "Aprovado"]);
});

// ---------- tela inicial ----------
await t("tela inicial: seus números e os da equipe", async () => {
  await rpc(sup, "enviar_cadastro", { p_id_app: "cad00002", p_cpf: null, p_cidade: "LAGARTO - SE", p_observacao: null });
  await rpc(sup2, "enviar_cadastro", { p_id_app: "cad00003", p_cpf: null, p_cidade: "LAGARTO - SE", p_observacao: null });
  const r = await rpc(sup, "resumo_inicio");
  igual([r.ativacao.meus_aguardando_analise, r.ativacao.equipe_aguardando_analise, r.ativacao.aguardando_analise], [1, 2, 1]);
  igual([r.papel, r.papel_bloqueios], ["suporte", "suporte"]);
  if (!(r.bloqueios.equipe_bloqueados_agora >= r.bloqueios.meus_bloqueados_agora)) throw new Error(JSON.stringify(r.bloqueios));
  igual((await rpc(soAtiv, "resumo_inicio")).bloqueios, null);
});
await t("lista de cidades para a ativação vem da tabela de cidades", async () => {
  const c = await rpc(sup, "listar_cidades");
  igual(c.includes("LAGARTO - SE") && c.length >= 30, true);
});
await t("fora da equipe não lê atividades nem chama as internas novas", async () => {
  igual((await sqlComo(estranho, "select count(*)::int n from atividades"))[0].n, 0);
  for (const fn of ["json_atividade((select a from atividades a limit 1))", "atividade_aberta_para_mim((select a from atividades a limit 1))", "json_tarefa((select t from tarefas t limit 1))"])
    await falha(sqlComo(estranho, `select public.${fn}`), "permission denied");
});

await db.end();
console.log(`\n${n - falhas}/${n} passaram`);
process.exit(falhas ? 1 : 0);
