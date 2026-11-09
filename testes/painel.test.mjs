// Testes da 009d parte 3 (supabase/009d3-painel-metas-recorrentes.sql): painel, metas, placar, recorrentes e revisão de qualidade.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node painel.test.mjs
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
  "../supabase/009d3-painel-metas-recorrentes.sql", "../supabase/009d3-painel-metas-recorrentes.sql"]) await db.query(arquivo(f));

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
// mais um moderador (não é o administrador final)
const mod2 = pessoa("mod2@x.com", "Moderadora Dois");
await rpc(admin, "salvar_membro", { p_email: mod2.email, p_nome: mod2.nome, p_papel: "moderador", p_papel_bloqueios: "moderador" });
await rpc(mod2, "entrar");

let t1, t2, t3;
await t("painel: o agora, o período e as pessoas (moderador vê todos; os outros, só a própria linha)", async () => {
  t1 = await rpc(admin, "criar_tarefa", { p_tipo: "pedido_problema", p_campos: { pedido: "1", cidade: "LAGARTO - SE", problema: "x" } });
  t2 = await rpc(admin, "criar_tarefa", { p_tipo: "criar_comunicado", p_campos: { cidade: "LAGARTO - SE", motivo: "Chuva" }, p_para: [sup.sub] });
  t3 = await rpc(sup, "criar_tarefa", { p_tipo: "fazer_contato", p_campos: { contato: "Padaria", cidade: "ITABAIANA - SE", motivo: "Ativação" }, p_modo: "registro" });
  await rpc(sup, "aceitar_atividade", { p_id: t2.id });
  await rpc(sup, "concluir_atividade", { p_id: t2.id });
  await rpc(mon, "aceitar_atividade", { p_id: t1.id });
  await db.query("update atividades set prazo = now() - interval '1 minute' where id = $1", [t1.id]);
  const p = await rpc(mod2, "painel_tarefas", { p_dias: 30 });
  igual([p.equipe, p.agora.em_andamento, p.agora.atrasadas, p.periodo.concluidas, p.periodo.registros, p.periodo.no_prazo], [true, 1, 1, 2, 1, 100]);
  igual(p.pessoas.length, 5);
  const s = p.pessoas.find((x) => x.nome === "Suporte Teste");
  igual([s.concluidas, s.registros, s.no_prazo], [2, 1, 100]);
  igual(p.por_cidade.find((x) => x.cidade === "LAGARTO - SE").abertas, 1);
  igual(p.por_tipo.map((x) => x.tipo).sort(), ["criar_comunicado", "fazer_contato", "pedido_problema"]);
  const q = await rpc(sup, "painel_tarefas", { p_dias: 30 });
  igual([q.equipe, q.pessoas.map((x) => x.nome), q.agora.atrasadas], [false, ["Suporte Teste"], 1]);
  igual(q.pessoas[0].eu, true);
});

await t("metas pessoais: cada um vê e mexe só nas suas; progresso pelas concluídas no dia/semana", async () => {
  await falha(rpc(sup, "salvar_meta", { p_tipo: "nada", p_quantidade: 1, p_periodo: "dia" }), "desconhecido");
  await falha(rpc(sup, "salvar_meta", { p_tipo: null, p_quantidade: 0, p_periodo: "dia" }), "1 a 500");
  await falha(rpc(sup, "salvar_meta", { p_tipo: null, p_quantidade: 3, p_periodo: "mes" }), "por dia ou por semana");
  let m = await rpc(sup, "salvar_meta", { p_tipo: null, p_quantidade: 5, p_periodo: "dia" });
  m = await rpc(sup, "salvar_meta", { p_tipo: "fazer_contato", p_quantidade: 3, p_periodo: "semana" });
  igual(m.map((x) => [x.tipo_nome, x.quantidade, x.feitas]), [["Qualquer tarefa", 5, 2], ["Fazer contato", 3, 1]]);
  igual(await rpc(mon, "minhas_metas"), []);
  igual((await rpc(mon, "excluir_meta", { p_id: m[0].id })).length, 0);
  igual((await rpc(sup, "minhas_metas")).length, 2, "o outro não apaga:");
  igual((await rpc(sup, "excluir_meta", { p_id: m[0].id })).length, 1);
});

await t("placar: só o administrador final", async () => {
  await falha(rpc(mod2, "placar_equipe", { p_dias: 30 }), "só do administrador");
  await falha(rpc(mon, "placar_equipe", { p_dias: 30 }), "");
  const p = await rpc(admin, "placar_equipe", { p_dias: 30 });
  igual(p[0].nome, "Suporte Teste");
  igual([p[0].concluidas, p[0].registros, p[0].pontos], [1, 1, 3 + 1 + 1]);
});

await t("recorrentes: validação, não gera na hora, gera quando passa o horário (uma vez), com checklist e aviso", async () => {
  await falha(rpc(sup, "salvar_recorrente", { p_id: null, p_tipo: "criar_comunicado", p_campos: { cidade: "LAGARTO - SE" }, p_titulo: null, p_descricao: null, p_para: [], p_checklist: [], p_frequencia: "diaria", p_dia_semana: null, p_dia_mes: null, p_hora: 8 }), "o motivo");
  await falha(rpc(sup, "salvar_recorrente", { p_id: null, p_tipo: "livre", p_campos: {}, p_titulo: "x", p_descricao: null, p_para: [], p_checklist: [], p_frequencia: "semanal", p_dia_semana: null, p_dia_mes: null, p_hora: 8 }), "dia da semana");
  const r = await rpc(sup, "salvar_recorrente", { p_id: null, p_tipo: "livre", p_campos: {}, p_titulo: "Conferir as tratativas do dia", p_descricao: null, p_para: [mon.sub],
    p_checklist: ["Abrir a tela de tratativas", " ", "Avisar no grupo"], p_frequencia: "diaria", p_dia_semana: null, p_dia_mes: null, p_hora: 0 });
  igual([r.titulo_exemplo, r.checklist, r.para_nomes, r.pode_mexer], ["Conferir as tratativas do dia", ["Abrir a tela de tratativas", "Avisar no grupo"], ["Monitora Teste"], true]);
  igual(await rpc(mon, "gerar_recorrentes"), 0, "na hora:");
  await db.query("update tarefas_recorrentes set ultima_em = ultima_em - interval '1 day' where id = $1", [r.id]);
  igual(await rpc(mon, "gerar_recorrentes"), 1);
  igual(await rpc(mon, "gerar_recorrentes"), 0, "de novo:");
  const nova = (await rpc(mon, "listar_atividades")).find((x) => x.titulo === "Conferir as tratativas do dia");
  igual([nova.para_mim, nova.recorrente, nova.checklist.map((x) => x.texto)], [true, true, ["Abrir a tela de tratativas", "Avisar no grupo"]]);
  igual((await avisos(mon)).filter((x) => x === "Tarefa recorrente para você: Conferir as tratativas do dia").length, 1);
  await falha(rpc(mon, "excluir_recorrente", { p_id: r.id }), "Só quem criou");
  const m = await rpc(sup, "salvar_recorrente", { p_id: r.id, p_tipo: "livre", p_campos: {}, p_titulo: "Conferir as tratativas", p_descricao: null, p_para: [],
    p_checklist: [], p_frequencia: "mensal", p_dia_semana: null, p_dia_mes: 31, p_hora: 9, p_ativa: false });
  igual([m.frequencia, m.dia_mes, m.ativa, m.dia_semana], ["mensal", 31, false, null]);
  const u = await um("select ultimo_horario_recorrente(r) <= now() a, ultimo_horario_recorrente(r) > now() - interval '32 days' b from tarefas_recorrentes r where id = $1", [r.id]);
  igual([u.a, u.b], [true, true]);
  // semanal: o horário calculado cai no dia da semana pedido, às 9h de Brasília
  const w = await um(`select extract(dow from x at time zone 'America/Sao_Paulo') d, extract(hour from x at time zone 'America/Sao_Paulo') h
                        from (select ultimo_horario_recorrente(row(1, 'livre', '{}', null, null, '{}', '{}', 'semanal', 3, null, 9, true, gen_random_uuid(), null, now(), null)::tarefas_recorrentes) x) z`);
  igual([Number(w.d), Number(w.h)], [3, 9]);
  igual((await rpc(sup, "listar_recorrentes")).length, 1);
  await rpc(admin, "excluir_recorrente", { p_id: r.id });
  igual((await rpc(sup, "listar_recorrentes")).length, 0);
});

await t("revisão de qualidade: amostra e revisão só de moderadores; quem fez recebe o retorno e vê a revisão", async () => {
  await falha(rpc(sup, "amostra_revisao", { p_qtd: 5 }), "dos moderadores");
  const a = await rpc(mod2, "amostra_revisao", { p_qtd: 10 });
  igual(a.map((x) => x.id).sort(), [t2.id, t3.id].sort());
  await falha(rpc(mod2, "revisar_qualidade", { p_id: t2.id, p_resultado: "ajustar" }), "o que precisa ajustar");
  await falha(rpc(mod2, "revisar_qualidade", { p_id: t1.id, p_resultado: "ok" }), "concluídas");
  await rpc(mod2, "revisar_qualidade", { p_id: t2.id, p_resultado: "ajustar", p_comentario: "Faltou o print do comunicado" });
  igual((await avisos(sup)).filter((x) => x.startsWith("✏️ Moderadora Dois revisou")).length, 1);
  igual((await tarefa(sup, t2.id)).revisao.resultado, "ajustar");
  igual((await tarefa(mon, t2.id)).revisao, null, "outra pessoa:");
  igual((await rpc(mod2, "amostra_revisao", { p_qtd: 10 })).map((x) => x.id), [t3.id]);
  const p = await rpc(admin, "placar_equipe", { p_dias: 30 });
  igual(p.find((x) => x.nome === "Suporte Teste").revisoes_ajustar, 1);
});

await t("segurança: tabelas fechadas e funções internas não expostas", async () => {
  for (const tb of ["metas", "tarefas_recorrentes", "revisoes_qualidade"]) {
    await db.query("begin"); await db.query("set local role authenticated");
    await falha(db.query(`select * from ${tb}`), "permission denied"); await db.query("rollback");
  }
  const r = await um(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p
                       where p.proname in ('no_prazo', 'ultimo_horario_recorrente', 'recorrente_json', 'json_atividade')`);
  igual(r.x, false);
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
