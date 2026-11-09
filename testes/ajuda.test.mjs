// Testes da 009d parte 1 (supabase/009d-ajuda-aviso-turno.sql): pedir ajuda, aviso geral e passagem de turno.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node ajuda.test.mjs
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
  "../supabase/009d-ajuda-aviso-turno.sql"]) await db.query(arquivo(f));

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

let pedido;
await t("pedir ajuda: aparece para todos, com a categoria, e todos recebem o aviso (menos quem pediu)", async () => {
  await falha(rpc(sup, "pedir_ajuda", { p_categoria: "outra" }), "Escolha do que é a ajuda");
  pedido = await rpc(sup, "pedir_ajuda", { p_categoria: "suporte_crisp", p_texto: "Cliente bravo no chat", p_link: "crisp/123" });
  const r = await rapidos(mon);
  igual(r.map((x) => [x.tipo, x.titulo, x.texto, x.expirado, x.meu]), [["ajuda", "Operação – Suporte (Crisp)", "Cliente bravo no chat", false, false]]);
  igual((await rapidos(sup))[0].meu, true);
  igual((await avisosDe(mon, "ajuda")).length, 1);
  igual((await avisosDe(sup, "ajuda")).length, 0, "quem pediu:");
  await falha(rpc(sup, "pedir_ajuda", { p_categoria: "monitoramento" }), "já tem um pedido de ajuda ativo");
});

await t("aceitar: some para os outros, fica para quem pediu e quem ajuda; quem pediu é avisado", async () => {
  await falha(rpc(sup, "aceitar_ajuda", { p_id: pedido.id }), "seu próprio pedido");
  await rpc(mon, "aceitar_ajuda", { p_id: pedido.id });
  await falha(rpc(sup2, "aceitar_ajuda", { p_id: pedido.id }), "já está ajudando");
  igual((await rapidos(sup2)).length, 0, "outros:");
  igual((await rapidos(mon))[0].aceito_por_mim, true);
  igual((await rapidos(sup))[0].aceito_por_nome, "Monitora Teste");
  const nt = await um("select n.texto from notificacoes n join membros m on m.user_id = n.para where m.email = $1 order by n.id desc limit 1", [sup.email]);
  if (!nt.texto.includes("Monitora Teste vai te ajudar")) throw new Error(nt.texto);
  await falha(rpc(sup2, "resolver_aviso_rapido", { p_id: pedido.id }), "Só quem pediu ou quem está ajudando");
  await rpc(mon, "resolver_aviso_rapido", { p_id: pedido.id, p_nota: "Resolvido no chat" });
  igual((await rapidos(sup)).length, 0);
});

await t("ninguém em 10 min: só quem pediu vê; pode pedir de novo ou mandar para os moderadores", async () => {
  const p2 = await rpc(sup, "pedir_ajuda", { p_categoria: "monitoramento" });
  await db.query("update avisos_rapidos set expira_em = now() - interval '1 minute' where id = $1", [p2.id]);
  igual((await rapidos(mon)).length, 0, "os outros não veem mais:");
  igual((await rapidos(sup))[0].expirado, true);
  await falha(rpc(mon, "aceitar_ajuda", { p_id: p2.id }), "expirou");
  await rpc(sup, "renovar_ajuda", { p_id: p2.id });
  igual((await rapidos(mon))[0].expirado, false, "de novo para todos:");
  await db.query("update avisos_rapidos set expira_em = now() - interval '1 minute' where id = $1", [p2.id]);
  const antes = (await avisosDe(admin, "ajuda")).length;
  await rpc(sup, "renovar_ajuda", { p_id: p2.id, p_moderadores: true });
  igual((await avisosDe(admin, "ajuda")).length, antes + 1, "moderador avisado:");
  igual((await rapidos(sup2)).length, 0, "suporte não vê:");
  igual((await rapidos(admin))[0].para_moderadores, true);
  await rpc(admin, "aceitar_ajuda", { p_id: p2.id });
  await rpc(sup, "resolver_aviso_rapido", { p_id: p2.id });
});

await t("cancelar o próprio pedido; ninguém mais cancela", async () => {
  const p3 = await rpc(sup2, "pedir_ajuda", { p_categoria: "suporte_blip" });
  await falha(rpc(mon, "encerrar_aviso_rapido", { p_id: p3.id }), "Só quem criou");
  await rpc(sup2, "encerrar_aviso_rapido", { p_id: p3.id });
  igual((await rapidos(sup2)).length, 0);
});

let aviso;
await t("aviso geral: fica para todos pelo tempo escolhido (até 12 h); quem criou ou moderador encerra", async () => {
  await falha(rpc(sup, "criar_aviso_geral", { p_texto: "x", p_horas: 13 }), "12 horas");
  await falha(rpc(sup, "criar_aviso_geral", { p_texto: " ", p_horas: 1 }), "Escreva o aviso");
  aviso = await rpc(sup, "criar_aviso_geral", { p_texto: "Sistema do QD instável até as 15h", p_horas: 2 });
  const r = await rapidos(sup2);
  igual(r.map((x) => [x.tipo, x.texto]), [["aviso", "Sistema do QD instável até as 15h"]]);
  igual((await avisosDe(sup2, "aviso_geral")).length, 1);
  await falha(rpc(mon, "encerrar_aviso_rapido", { p_id: aviso.id }), "Só quem criou");
  await falha(rpc(sup, "resolver_aviso_rapido", { p_id: aviso.id }), "se encerra");
  await db.query("update avisos_rapidos set expira_em = now() - interval '1 second' where id = $1", [aviso.id]);
  igual((await rapidos(sup2)).length, 0, "vencido some:");
  const a2 = await rpc(sup, "criar_aviso_geral", { p_texto: "Outro aviso", p_horas: 0.5 });
  await rpc(admin, "encerrar_aviso_rapido", { p_id: a2.id });
  igual((await rapidos(sup2)).length, 0, "moderador encerrou:");
});

await t("passagem de turno: panorama, passar, abrir e manter; quem entra lê e o lembrete some", async () => {
  // uma tratativa com a monitoradora e uma atividade aceita por ela
  await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
  const inf = (await um("select id from infracoes where not leve and ativa and horas_1a >= 10 order by id limit 1")).id;
  const b1 = await rpc(sup, "registrar_bloqueio", { p_id_app: "tur00001", p_nome: "Tito Turno", p_cidade: "LAGARTO - SE", p_infracao: inf });
  const b2 = await rpc(sup, "registrar_bloqueio", { p_id_app: "tur00002", p_nome: "Tina Turno", p_cidade: "LAGARTO - SE", p_infracao: inf });
  await rpc(admin, "sugerir_atividade", { p_titulo: "Ligar para a loja X", p_descricao: null, p_para: [], p_prazo: null });
  const at = (await um("select id from atividades where titulo = 'Ligar para a loja X'")).id;
  await rpc(mon, "aceitar_atividade", { p_id: at });
  const pan = await rpc(mon, "panorama_turno");
  igual([pan.tarefas.length, pan.atividades.length], [2, 1]);
  igual((await rpc(mon, "resumo_e_avisos")).resumo.minha_passagem_hoje, false);
  const t1 = pan.tarefas.find((x) => x.titulo.includes("Tito")).id, t2 = pan.tarefas.find((x) => x.titulo.includes("Tina")).id;
  await falha(rpc(mon, "passar_turno", { p_texto: "x", p_itens: JSON.stringify([{ tipo: "tarefa", id: t1, acao: "passar" }]) }), "para quem passar");
  await falha(rpc(mon, "passar_turno", { p_texto: "x", p_itens: JSON.stringify([{ tipo: "tarefa", id: t1, acao: "passar", para: sup2.sub }]) }), "não tem acesso aos bloqueios");
  const p = await rpc(mon, "passar_turno", { p_texto: "Loja X não atende antes das 10h.", p_itens: JSON.stringify([
    { tipo: "tarefa", id: t1, titulo: "Tratativa: Tito", acao: "passar", para: sup.sub },
    { tipo: "tarefa", id: t2, titulo: "Tratativa: Tina", acao: "manter" },
    { tipo: "atividade", id: at, titulo: "Ligar para a loja X", acao: "abrir" }]) });
  igual(p.itens.map((x) => [x.acao, x.para_nome]), [["passar", "Suporte Teste"], ["manter", null], ["abrir", null]]);
  igual((await um("select responsavel_email e from tarefas where id = $1", [t1])).e, sup.email);
  igual((await um("select responsavel_email e from tarefas where id = $1", [t2])).e, mon.email);
  igual((await um("select status from atividades where id = $1", [at])).status, "aberta");
  const tarde = (await um("select extract(hour from now() at time zone 'America/Sao_Paulo') >= 12 x")).x;
  igual((await rpc(mon, "resumo_e_avisos")).resumo.minha_passagem_hoje, tarde, "lembrete (passagem depois do meio-dia):");
  const ps = (await rpc(sup, "resumo_e_avisos")).resumo.passagens;
  igual([ps.length, ps[0].de_nome, ps[0].texto], [1, "Monitora Teste", "Loja X não atende antes das 10h."]);
  igual((await rpc(mon, "resumo_e_avisos")).resumo.passagens, [], "quem passou não vê a própria:");
  await rpc(sup, "ler_passagem", { p_id: p.id });
  igual((await rpc(sup, "resumo_e_avisos")).resumo.passagens, []);
  igual((await rpc(sup2, "resumo_e_avisos")).resumo.passagens.length, 1, "os outros ainda veem:");
  await falha(rpc(sup2, "passar_turno", { p_texto: "", p_itens: JSON.stringify([{ tipo: "tarefa", id: t2, acao: "abrir" }]) }), "não está mais com você");
});

await t("acordos: registrar, vencer no dia, aviso na tela de todos até alguém fazer o ajuste", async () => {
  await falha(rpc(sup, "registrar_acordo", { p_estabelecimento: "", p_cidade: "LAGARTO - SE", p_acordo: "x", p_vence_em: "2099-01-01" }), "estabelecimento");
  await falha(rpc(sup, "registrar_acordo", { p_estabelecimento: "Mercado Bom", p_cidade: "LAGARTO - SE", p_acordo: "", p_vence_em: "2099-01-01" }), "acordado");
  await falha(rpc(sup, "registrar_acordo", { p_estabelecimento: "Mercado Bom", p_cidade: "LAGARTO - SE", p_acordo: "x", p_vence_em: "2000-01-01" }), "já passou");
  const hoje = (await um("select public.hoje_brasilia()::text d")).d;
  const a1 = await rpc(sup, "registrar_acordo", { p_estabelecimento: "Mercado Bom", p_cidade: "lagarto - se", p_acordo: "Taxa de R$ 3 por 30 dias", p_vence_em: hoje });
  const a2 = await rpc(sup, "registrar_acordo", { p_estabelecimento: "Padaria Sol", p_cidade: "ITABAIANA - SE", p_acordo: "Frete grátis até o fim do mês", p_vence_em: "2099-12-31" });
  igual([a1.cidade, a1.situacao, a1.dias, a2.situacao], ["LAGARTO - SE", "vencido", 0, "vigente"]);
  for (const p of [admin, mon, sup2]) igual((await rpc(p, "resumo_e_avisos")).resumo.acordos_vencidos.map((x) => x.estabelecimento), ["Mercado Bom"], p.nome);
  // vencido ontem e ainda sem ajuste: continua aparecendo
  await db.query("update acordos set vence_em = vence_em - 3 where id = $1", [a1.id]);
  igual((await rpc(mon, "resumo_e_avisos")).resumo.acordos_vencidos.length, 1);
  igual((await rpc(mon, "listar_acordos", { p_situacao: "abertos" })).map((x) => [x.estabelecimento, x.situacao]), [["Mercado Bom", "vencido"], ["Padaria Sol", "vigente"]]);
  await falha(rpc(sup2, "excluir_acordo", { p_id: a1.id }), "Só quem registrou");
  await rpc(mon, "ajustar_acordo", { p_id: a1.id, p_nota: "Taxa voltou ao normal" });
  await falha(rpc(admin, "ajustar_acordo", { p_id: a1.id }), "já foi feito por Monitora Teste");
  igual((await rpc(sup2, "resumo_e_avisos")).resumo.acordos_vencidos, []);
  const aj = await rpc(admin, "listar_acordos", { p_situacao: "ajustados" });
  igual(aj.map((x) => [x.estabelecimento, x.ajustado_por_nome, x.nota]), [["Mercado Bom", "Monitora Teste", "Taxa voltou ao normal"]]);
  igual((await db.query("select n.texto from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.link = '#financeiro/acordos'", [sup.email])).rows.length, 1, "quem registrou recebe o aviso:");
  await rpc(admin, "excluir_acordo", { p_id: a2.id });
  igual((await rpc(admin, "listar_acordos", { p_situacao: null })).length, 1);
});

await t("segurança: tabelas fechadas e funções internas não expostas", async () => {
  await db.query("begin"); await db.query("set local role authenticated");
  await falha(db.query("select * from passagens_turno"), "permission denied"); await db.query("rollback");
  await db.query("begin"); await db.query("set local role authenticated");
  await falha(db.query("select * from acordos"), "permission denied"); await db.query("rollback");
  const r = await um(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p
                       where p.proname in ('avisar_equipe', 'nome_categoria_ajuda', 'avisos_rapidos_abertos', 'passagens_para_mim', 'acordos_vencidos', 'acordo_json')`);
  igual(r.x, false);
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
