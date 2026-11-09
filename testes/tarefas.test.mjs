// Testes da 009d parte 2 (supabase/009d2-tarefas-cards.sql): tarefas em cards.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node tarefas.test.mjs
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
  "../supabase/009d2-tarefas-cards.sql", "../supabase/009d2-tarefas-cards.sql"]) await db.query(arquivo(f));

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

await t("tipos de tarefa com prazo padrão e os motivos do contato com entregador", async () => {
  const r = await rpc(sup, "tipos_tarefa");
  igual(r.tipos.length, 10);
  igual(r.tipos.find((x) => x.tipo === "procurar_entregador").prazo_horas, 1);
  igual(r.motivos_contato.length, 5);
  await falha(rpc(sup, "salvar_prazo_tipo_tarefa", { p_tipo: "fazer_contato", p_prazo_horas: 12 }), "");
  await rpc(admin, "salvar_prazo_tipo_tarefa", { p_tipo: "fazer_contato", p_prazo_horas: 12 });
  igual((await rpc(sup, "tipos_tarefa")).tipos.find((x) => x.tipo === "fazer_contato").prazo_horas, 12);
});

await t("campos validados por tipo e título montado", async () => {
  await falha(rpc(sup, "criar_tarefa", { p_tipo: "ativar_entregadores", p_campos: { quantidade: 5 } }), "a cidade");
  await falha(rpc(sup, "criar_tarefa", { p_tipo: "ativar_entregadores", p_campos: { cidade: "LAGARTO - SE", quantidade: "0" } }), "1 a 1000");
  await falha(rpc(sup, "criar_tarefa", { p_tipo: "fazer_contato", p_campos: { contato: "Padaria", cidade: "LAGARTO - SE" } }), "o motivo");
  await falha(rpc(sup, "criar_tarefa", { p_tipo: "contato_entregador", p_campos: { id_app: "abc123", tratativa: false, motivo: "Outro" } }), "motivo do contato");
  await falha(rpc(sup, "criar_tarefa", { p_tipo: "livre", p_titulo: " " }), "Escreva o que precisa");
  await falha(rpc(sup, "criar_tarefa", { p_tipo: "nada" }), "desconhecido");
  const a = await rpc(sup, "criar_tarefa", { p_tipo: "contato_entregador", p_campos: { id_app: "ABC123", tratativa: "false", motivo: "Retorno de itens" } });
  igual([a.titulo, a.campos.id_app, a.campos.tratativa, a.tipo_nome], ["Contato com entregador abc123 · Retorno de itens", "abc123", false, "Contato com entregador"]);
  const p = await rpc(sup, "criar_tarefa", { p_tipo: "pagamento_entregador", p_campos: { id_app: "abc123", valor: "12,5", motivo: "Corrida não paga" } });
  igual([p.titulo, p.campos.valor], ["Pagamento ao entregador abc123 · R$ 12,50", 12.5]);
  const f = await rpc(sup, "criar_tarefa", { p_tipo: "fazer_contato", p_campos: { contato: "Padaria Sol", cidade: "lagarto - se", motivo: "Ativação", telefone: "79 99999-0000" } });
  const h = (await um("select extract(epoch from prazo - criada_em)/3600 h from atividades where id = $1", [f.id])).h;
  igual([f.titulo, f.cidade, Math.round(Number(h))], ["Fazer contato: Padaria Sol · LAGARTO - SE", "LAGARTO - SE", 12], "prazo padrão do tipo:");
  for (const x of [a, p, f]) await rpc(sup, "excluir_atividade", { p_id: x.id });
});

let ativ;
await t("ativar entregadores: pedido para alguém, progresso conta sozinho com os aprovados de quem pegou", async () => {
  ativ = await rpc(admin, "criar_tarefa", { p_tipo: "ativar_entregadores", p_campos: { cidade: "LAGARTO - SE", quantidade: 2 }, p_para: [sup.sub] });
  igual([ativ.titulo, ativ.meta, ativ.progresso, ativ.progresso_automatico, ativ.para_mim], ["Ativar 2 entregador(es) · LAGARTO - SE", 2, 0, true, false]);
  igual((await avisos(sup)).filter((x) => x.includes("pediu para você: Ativar 2")).length, 1);
  await falha(rpc(sup, "avancar_tarefa", { p_id: ativ.id }), "conta sozinho");
  await rpc(sup, "aceitar_atividade", { p_id: ativ.id });
  const ids = [];
  for (const [i, cid] of [["lag0001", "LAGARTO - SE"], ["lag0002", "LAGARTO - SE"], ["ita0001", "ITABAIANA - SE"]])
    ids.push((await rpc(sup, "enviar_cadastro", { p_id_app: i, p_cpf: null, p_cidade: cid, p_nome: "Teste " + i })).id);
  await rpc(mon, "decidir", { p_cadastro: ids[0], p_acao: "aprovar" });
  await rpc(mon, "decidir", { p_cadastro: ids[2], p_acao: "aprovar" });
  igual((await tarefa(sup, ativ.id)).progresso, 1, "só o da cidade:");
  await rpc(mon, "decidir", { p_cadastro: ids[1], p_acao: "aprovar" });
  igual((await tarefa(sup, ativ.id)).progresso, 2);
});

await t("aguardando terceiro pausa o relógio e empurra o prazo", async () => {
  await falha(rpc(mon, "aguardar_terceiro", { p_id: ativ.id, p_motivo: "x" }), "Só quem está");
  await rpc(sup, "aguardar_terceiro", { p_id: ativ.id, p_motivo: "Esperando o parceiro mandar os documentos" });
  await falha(rpc(sup, "aguardar_terceiro", { p_id: ativ.id, p_motivo: "de novo" }), "já está aguardando");
  // finge 2 h de espera
  await db.query("update atividades set aguardando_desde = now() - interval '2 hours', aceita_em = now() - interval '3 hours' where id = $1", [ativ.id]);
  const antes = (await um("select prazo from atividades where id = $1", [ativ.id])).prazo;
  const x = await tarefa(sup, ativ.id);
  igual([x.aguardando_motivo != null, x.atrasada, Math.round(x.seg_execucao / 3600)], [true, false, 1]);
  await rpc(sup, "aguardar_terceiro", { p_id: ativ.id });
  const d = await um("select prazo, pausa_seg, aguardando_desde from atividades where id = $1", [ativ.id]);
  igual([Math.round((d.prazo - antes) / 3600000), Math.round(d.pausa_seg / 3600), d.aguardando_desde], [2, 2, null]);
  igual(Math.round((await tarefa(sup, ativ.id)).seg_execucao / 3600), 1, "execução sem a espera:");
});

await t("checklist: incluir, marcar e remover (quem não tem a ver com a tarefa não mexe)", async () => {
  await rpc(sup, "checklist_tarefa", { p_id: ativ.id, p_acao: "incluir", p_texto: "Ligar para o parceiro" });
  await rpc(admin, "checklist_tarefa", { p_id: ativ.id, p_acao: "incluir", p_texto: "Mandar o PDF" });
  let l = await rpc(sup, "checklist_tarefa", { p_id: ativ.id, p_acao: "marcar", p_indice: 0 });
  igual([l.length, l[0].feito, l[0].por_nome, l[1].feito], [2, true, "Suporte Teste", false]);
  l = await rpc(sup, "checklist_tarefa", { p_id: ativ.id, p_acao: "remover", p_indice: 1 });
  igual(l.map((x) => x.texto), ["Ligar para o parceiro"]);
  await falha(rpc(mon, "checklist_tarefa", { p_id: ativ.id, p_acao: "incluir", p_texto: "x" }), "Só quem criou");
  await falha(rpc(sup, "checklist_tarefa", { p_id: ativ.id, p_acao: "marcar", p_indice: 5 }), "não encontrado");
});

await t("comentários com @menção avisam quem foi mencionado, quem criou e quem está com a tarefa", async () => {
  await falha(rpc(mon, "comentar_tarefa", { p_id: ativ.id, p_texto: " " }), "Escreva");
  await rpc(mon, "comentar_tarefa", { p_id: ativ.id, p_texto: "@Suporte Sem Bloqueio dá uma força aqui?", p_mencoes: [sup2.sub] });
  igual((await avisos(sup2)).filter((x) => x.includes("mencionou você")).length, 1);
  igual((await avisos(sup)).filter((x) => x.startsWith("Monitora Teste comentou")).length, 1);
  igual((await avisos(admin)).filter((x) => x.startsWith("Monitora Teste comentou")).length, 1);
  igual((await avisos(mon)).filter((x) => x.includes("comentou")).length, 0, "quem escreveu:");
  const c = await rpc(sup, "comentarios_da_tarefa", { p_id: ativ.id });
  igual([c.length, c[0].por_nome, c[0].mencoes, (await tarefa(sup, ativ.id)).comentarios], [1, "Monitora Teste", ["Suporte Sem Bloqueio"], 1]);
});

await t("concluir guarda quem concluiu; agradecer liga e desliga (não a si mesmo)", async () => {
  await rpc(sup, "concluir_atividade", { p_id: ativ.id, p_nota: "Os dois aprovados" });
  const x = await tarefa(admin, ativ.id);
  igual([x.status, x.progresso, x.pode_agradecer], ["concluida", 2, true]);
  await falha(rpc(sup, "agradecer_tarefa", { p_id: ativ.id }), "a si mesmo");
  igual(await rpc(admin, "agradecer_tarefa", { p_id: ativ.id }), true);
  igual((await avisos(sup)).filter((x) => x.startsWith("👏 Mateus Lopes agradeceu")).length, 1);
  igual((await tarefa(mon, ativ.id)).agradecimentos, ["Mateus Lopes"]);
  igual(await rpc(admin, "agradecer_tarefa", { p_id: ativ.id }), false);
  igual((await tarefa(mon, ativ.id)).agradecimentos, []);
});

await t("registrar o que já fiz: entra direto como concluída e com progresso", async () => {
  const r = await rpc(sup, "criar_tarefa", { p_tipo: "ativar_parceiro", p_campos: { cidade: "LAGARTO - SE", quantidade: 1 }, p_modo: "registro" });
  igual([r.status, r.aceita_por_nome, r.concluida_por_nome, r.modo, r.prazo], ["concluida", "Suporte Teste", "Suporte Teste", "registro", null]);
  await rpc(sup, "avancar_tarefa", { p_id: r.id });
  igual((await tarefa(sup, r.id)).progresso, 1);
  await falha(rpc(sup, "criar_tarefa", { p_tipo: "livre", p_titulo: "x", p_modo: "outro" }), "Escolha se é um pedido");
});

await t("pegar a próxima: a sugerida para mim primeiro, depois prazo mais perto; pedir para alguém", async () => {
  const geral = await rpc(admin, "criar_tarefa", { p_tipo: "procurar_entregador", p_campos: { cidade: "ITABAIANA - SE" } });
  const minha = await rpc(admin, "criar_tarefa", { p_tipo: "criar_comunicado", p_campos: { cidade: "LAGARTO - SE", motivo: "Chuva" }, p_para: [mon.sub] });
  const p1 = await rpc(mon, "pegar_proxima");
  igual(p1.id, minha.id, "sugerida para mim:");
  igual([p1.status, p1.aceita_por_nome], ["aceita", "Monitora Teste"]);
  const p2 = await rpc(mon, "pegar_proxima");
  igual(p2.id, geral.id);
  igual(await rpc(mon, "pegar_proxima"), null);
  const outra = await rpc(admin, "criar_tarefa", { p_tipo: "livre", p_titulo: "Organizar a planilha" });
  await rpc(mon, "pedir_tarefa_para", { p_id: outra.id, p_para: sup.sub });
  igual((await tarefa(sup, outra.id)).para_mim, true);
  igual((await avisos(sup)).filter((x) => x === "Monitora Teste pediu para você: Organizar a planilha").length, 1);
  for (const x of [geral, minha, outra]) await rpc(admin, "excluir_atividade", { p_id: x.id });
});

await t("verificar tarefas: sem dono na metade do prazo avisa moderadores; com dono e atrasada avisa quem está com ela (uma vez)", async () => {
  const semDono = await rpc(sup, "criar_tarefa", { p_tipo: "pedido_problema", p_campos: { pedido: "98765", cidade: "LAGARTO - SE", problema: "Cliente não recebeu" } });
  const comDono = await rpc(sup, "criar_tarefa", { p_tipo: "pedido_problema", p_campos: { pedido: "11111", cidade: "LAGARTO - SE", problema: "Pedido trocado" } });
  await rpc(mon, "aceitar_atividade", { p_id: comDono.id });
  igual(await rpc(sup, "verificar_tarefas"), 0);
  await db.query("update atividades set criada_em = now() - interval '3 hours', prazo = now() + interval '1 hour' where id = $1", [semDono.id]);
  await db.query("update atividades set prazo = now() - interval '1 minute' where id = $1", [comDono.id]);
  igual(await rpc(sup, "verificar_tarefas"), 2);
  igual(await rpc(sup, "verificar_tarefas"), 0, "segunda vez:");
  igual((await avisos(admin)).filter((x) => x.startsWith("Tarefa sem ninguém, já na metade do prazo: Pedido com problema: 98765")).length, 1);
  igual((await avisos(mon)).filter((x) => x.startsWith("Tarefa atrasada") && x.includes("11111")).length, 1);
  igual((await tarefa(mon, comDono.id)).atrasada, true);
});

await t("sugerir_atividade antiga continua funcionando (vira tarefa livre)", async () => {
  const id = await rpc(sup, "sugerir_atividade", { p_titulo: "Tarefa do jeito antigo", p_para: [] });
  const x = await tarefa(sup, id);
  igual([x.tipo, x.tipo_nome, x.modo, x.checklist], ["livre", "Outra tarefa", "solicitacao", []]);
});

await t("segurança: tabelas fechadas e funções internas não expostas", async () => {
  for (const tb of ["comentarios_tarefa", "agradecimentos", "tipos_tarefa"]) {
    await db.query("begin"); await db.query("set local role authenticated");
    await falha(db.query(`select * from ${tb}`), "permission denied"); await db.query("rollback");
  }
  const r = await um(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p
                       where p.proname in ('validar_campos_tarefa', 'titulo_tarefa', 'progresso_tarefa', 'segundos_execucao', 'pode_mexer_tarefa', 'json_atividade', 'motivos_contato_entregador')`);
  igual(r.x, false);
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
