// Testes da 008b, parte 1 (supabase/008b-notificacoes.sql): avisos de Registros para moderadores e
// responsável da cidade, pedidos de cidade, tela de Avisos (listar_avisos) e o suporte revisando.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node avisos.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql",
  "../supabase/007-pao-quentinho.sql", "../supabase/008-espionagem.sql", "../supabase/008b-cadastrar-entregador.sql",
  "../supabase/008b-notificacoes.sql", "../supabase/008b-notificacoes.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");         // monitoradora, responsável por LAGARTO
const sup = pessoa("eduarda@x.com", "Eduarda");           // suporte nos dois módulos
const semBq = pessoa("joyce@x.com", "Joyce");             // suporte só na ativação
const modBq = pessoa("lucas@x.com", "Lucas");             // moderador só dos bloqueios

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
// avisos que a pessoa recebeu desde a última marca
const marca = async () => { ultimo.id = (await um("select coalesce(max(id), 0)::int i from notificacoes")).i; };
const novos = async (p) => (await db.query("select n.texto, n.categoria, n.motivo, n.cidade, n.link from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.id > $2 order by n.id", [p.email, ultimo.id])).rows;

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [semBq, "suporte", null], [modBq, "suporte", "moderador"]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, semBq, modBq]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
await rpc(admin, "salvar_cidade", { p_nome: "ITABAIANA - SE", p_responsavel_email: null, p_ativa: true });
const inf = (await um("select id from infracoes where not leve and ativa and horas_1a is not null order by id limit 1")).id;

await t("bloqueio registrado: moderadores e responsável da cidade recebem; quem registrou e quem não tem bloqueios, não", async () => {
  await marca();
  await rpc(sup, "registrar_bloqueio", { p_id_app: "aviso001", p_nome: "Zeferino Teste", p_cidade: "LAGARTO - SE", p_infracao: inf });
  const [a, m, s, j, l] = [await novos(admin), await novos(mon), await novos(sup), await novos(semBq), await novos(modBq)];
  igual([a.length, l.length, s.length, j.length], [1, 1, 0, 0], "admin, moderador dos bloqueios, autor, sem bloqueios:");
  igual([a[0].categoria, a[0].motivo, a[0].link], ["bloqueios", "moderador", "#ficha/aviso001"]);
  if (!a[0].texto.startsWith("Eduarda registrou um bloqueio: Zeferino Teste (aviso001)")) throw new Error(a[0].texto);
  // a responsável já recebe a tratativa (aviso pessoal): um aviso só
  igual(m.length, 1, "responsável:");
});

await t("cidade sem responsável: o aviso vai só para os moderadores", async () => {
  await marca();
  await rpc(sup, "registrar_bloqueio", { p_id_app: "aviso002", p_nome: "Outro Teste", p_cidade: "ITABAIANA - SE", p_infracao: inf });
  igual([(await novos(admin)).length, (await novos(modBq)).length, (await novos(mon)).length], [1, 1, 0]);
});

await t("comentário sobre o entregador avisa o responsável da cidade da ficha", async () => {
  await marca();
  await rpc(sup, "comentar_entregador", { p_id_app: "aviso001", p_texto: "Ligou pedindo para ser liberado." });
  const m = await novos(mon);
  igual([m.length, m[0]?.categoria, m[0]?.motivo, m[0]?.cidade], [1, "comentarios", "cidade", "LAGARTO - SE"]);
  if (!m[0].texto.includes("comentou sobre Zeferino Teste (aviso001): Ligou pedindo")) throw new Error(m[0].texto);
});

let cad;
await t("cadastro enviado na ativação: moderadores recebem; a responsável recebe um aviso só", async () => {
  await marca();
  cad = (await rpc(semBq, "enviar_cadastro", { p_id_app: "cad00077", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Cadastro Teste" })).id;
  const a = await novos(admin), m = await novos(mon);
  igual([a.length, a[0].categoria, a[0].link], [1, "ativacao", "#cadastro/" + cad]);
  igual(m.length, 1, "responsável (já tinha o aviso de cadastro novo):");
  igual((await novos(modBq)).length, 1, "moderador dos bloqueios também recebe a ativação:");
});

await t("decisão: quem enviou recebe o aviso pessoal, sem duplicar com o de Registros", async () => {
  await marca();
  await rpc(admin, "salvar_membro", { p_email: semBq.email, p_nome: semBq.nome, p_papel: "moderador", p_papel_bloqueios: null });
  await rpc(mon, "decidir", { p_cadastro: cad, p_acao: "aprovar" });
  const j = await novos(semBq);
  igual(j.length, 1, "quem enviou (agora moderadora):");
  igual(j[0].categoria, null, "fica o aviso pessoal:");
  await rpc(admin, "salvar_membro", { p_email: semBq.email, p_nome: semBq.nome, p_papel: "suporte", p_papel_bloqueios: null });
});

await t("sem usuário logado (SQL Editor, importação da planilha): ninguém é avisado", async () => {
  await marca();
  await db.query("select importar_bloqueio('imp00009', 'Importado Teste', 'LAGARTO - SE', (select nome from infracoes where id = $1), now() - interval '3 days', 'Planilha')", [inf]);
  igual((await novos(admin)).length, 0);
});

await t("cidades sem responsável: a lista e o pedido", async () => {
  const r = await rpc(sup, "cidades_sem_responsavel");
  igual(r.cidades.some((c) => c.cidade === "ITABAIANA - SE"), true);
  igual(r.cidades.some((c) => c.cidade === "LAGARTO - SE"), false);
  await marca();
  await rpc(sup, "pedir_cidade", { p_cidade: "itabaiana - se" });
  igual((await rpc(sup, "cidades_sem_responsavel")).cidades.find((c) => c.cidade === "ITABAIANA - SE").meu_pedido, true);
  const a = await novos(admin);
  igual([a.length, a[0].categoria, a[0].link], [1, "cidades", "#atividades/pendencias"]);
  igual((await novos(modBq)).length, 1, "moderador dos bloqueios também é avisado:");
  igual((await novos(mon)).length, 0, "monitoradora não:");
});

await t("pedido repetido, cidade com responsável e cidade fora da lista são recusados", async () => {
  await falha(rpc(sup, "pedir_cidade", { p_cidade: "ITABAIANA - SE" }), "já pediu");
  await falha(rpc(sup, "pedir_cidade", { p_cidade: "LAGARTO - SE" }), "já tem responsável");
  await falha(rpc(sup, "pedir_cidade", { p_cidade: "ATLANTIDA - XX" }), "cidade da lista");
});

await t("só moderador vê e decide os pedidos; recusar exige motivo", async () => {
  const pedidos = (await rpc(admin, "resumo_e_avisos")).resumo.pedidos_cidade;
  igual(pedidos.map((p) => [p.cidade, p.nome, p.papel_bloqueios]), [["ITABAIANA - SE", "Eduarda", "suporte"]]);
  igual((await rpc(mon, "resumo_e_avisos")).resumo.pedidos_cidade, null);
  await falha(rpc(mon, "decidir_pedido_cidade", { p_id: pedidos[0].id, p_aprovar: true }), "Só moderadores");
  await falha(rpc(admin, "decidir_pedido_cidade", { p_id: pedidos[0].id, p_aprovar: false }), "motivo da recusa");
});

await t("moderador dos bloqueios aprova: a pessoa vira responsável, é avisada e os outros pedidos da cidade fecham", async () => {
  await rpc(mon, "pedir_cidade", { p_cidade: "ITABAIANA - SE" });
  const [p1, p2] = (await rpc(admin, "resumo_e_avisos")).resumo.pedidos_cidade;
  await marca();
  await rpc(modBq, "decidir_pedido_cidade", { p_id: p1.id, p_aprovar: true });
  igual((await um("select responsavel_email e from cidades where nome = 'ITABAIANA - SE'")).e, sup.email);
  const s = await novos(sup);
  if (s.length !== 1 || !s[0].texto.includes("agora você é responsável por ITABAIANA - SE")) throw new Error(JSON.stringify(s));
  igual((await um("select status, nota from pedidos_cidade where id = $1", [p2.id])), { status: "recusado", nota: "Outra pessoa foi aprovada para esta cidade." });
  await falha(rpc(admin, "decidir_pedido_cidade", { p_id: p1.id, p_aprovar: true }), "já foi respondido");
  igual((await rpc(admin, "resumo_e_avisos")).resumo.pedidos_cidade, []);
});

await t("depois de aprovada, a nova responsável recebe os avisos da cidade", async () => {
  await marca();
  await rpc(mon, "comentar_entregador", { p_id_app: "aviso002", p_texto: "Entregador conhecido da cidade." });
  const s = await novos(sup);
  igual([s.length, s[0]?.motivo], [1, "cidade"]);
});

await t("recusa com motivo avisa quem pediu; quem pediu pode cancelar o próprio pedido", async () => {
  await rpc(admin, "salvar_cidade", { p_nome: "ESTANCIA - SE", p_responsavel_email: null, p_ativa: true });
  const id1 = await rpc(mon, "pedir_cidade", { p_cidade: "ESTANCIA - SE" });
  await marca();
  await rpc(admin, "decidir_pedido_cidade", { p_id: id1, p_aprovar: false, p_nota: "Já vamos colocar alguém fixo." });
  const m = await novos(mon);
  if (m.length !== 1 || !m[0].texto.includes("recusado por Mateus Lopes: Já vamos colocar alguém fixo.")) throw new Error(JSON.stringify(m));
  const id2 = await rpc(mon, "pedir_cidade", { p_cidade: "ESTANCIA - SE" });
  await falha(rpc(sup, "cancelar_pedido_cidade", { p_id: id2 }), "não encontrado");
  await rpc(mon, "cancelar_pedido_cidade", { p_id: id2 });
  igual((await um("select status from pedidos_cidade where id = $1", [id2])).status, "recusado");
  igual((await rpc(mon, "cidades_sem_responsavel")).meus.length, 3, "ITABAIANA (fechado) + 2 de ESTANCIA:");
});

await t("cidade de operador sem responsável dos operadores: o pedido aprovado vale", async () => {
  await db.query("update cidades set gestao = 'operador', responsavel_email = null where nome = 'ESTANCIA - SE'");
  await db.query("update parametros_equipe set responsavel_operadores_email = null where true");
  const id = await rpc(mon, "pedir_cidade", { p_cidade: "ESTANCIA - SE" });
  await rpc(admin, "decidir_pedido_cidade", { p_id: id, p_aprovar: true });
  igual((await um("select public.responsavel_cidade_email('ESTANCIA - SE') e")).e, mon.email);
});

await t("tela de Avisos: filtros, busca, só não lidos e páginas", async () => {
  const tudo = await rpc(admin, "listar_avisos", {});
  if (tudo.itens.length < 5) throw new Error("poucos avisos: " + tudo.itens.length);
  const bq = await rpc(admin, "listar_avisos", { p_filtro: "bloqueios" });
  igual(bq.itens.every((x) => x.categoria === "bloqueios"), true);
  igual((await rpc(admin, "listar_avisos", { p_busca: "aviso002" })).itens.every((x) => x.texto.includes("aviso002")), true);
  igual((await rpc(admin, "listar_avisos", { p_cidade: "ITABAIANA - SE" })).itens.every((x) => x.cidade === "ITABAIANA - SE"), true);
  igual(tudo.cidades.includes("LAGARTO - SE"), true);
  const p1 = await rpc(admin, "listar_avisos", { p_limite: 2 });
  igual([p1.itens.length, p1.mais], [2, true]);
  const p2 = await rpc(admin, "listar_avisos", { p_limite: 2, p_antes: p1.itens[1].id });
  igual(p2.itens[0].id < p1.itens[1].id, true);
  await rpc(admin, "marcar_notificacoes_lidas");
  igual([(await rpc(admin, "listar_avisos", { p_nao_lidos: true })).itens.length, tudo.nao_lidas > 0], [0, true]);
  const pessoais = await rpc(sup, "listar_avisos", { p_filtro: "pessoal" });
  igual(pessoais.itens.every((x) => x.categoria === null), true);
});

await t("o sino traz os 20 mais recentes, com a categoria", async () => {
  const s = (await rpc(admin, "resumo_e_avisos")).notif;
  igual([s.itens.length <= 20, "categoria" in s.itens[0]], [true, true]);
});

await t("o suporte também revisa: corrige um registro 'revisar' e confere um cadastro", async () => {
  await db.query("select importar_bloqueio('rev00009', 'Nome Errado', 'LAGARTO - SE', (select nome from infracoes where id = $1), now() - interval '90 days', 'Planilha', 'ID usado com 2 nomes', '24')", [inf]);
  const b = (await um("select id from bloqueios where id_app = 'rev00009'")).id;
  await falha(rpc(sup, "corrigir_bloqueio", { p_bloqueio: b, p_id_app: "rev00009", p_nome: "Nome Certo", p_cidade: "LAGARTO - SE" }), "motivo");
  await rpc(sup, "corrigir_bloqueio", { p_bloqueio: b, p_id_app: "rev00009", p_nome: "Nome Certo", p_cidade: "LAGARTO - SE", p_motivo: "Documento conferido" });
  igual(await um("select nome_entregador, revisar from bloqueios where id = $1", [b]), { nome_entregador: "Nome Certo", revisar: null });
  const c = (await rpc(sup, "enviar_cadastro", { p_id_app: "aviso001", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Outro Nome" })).id;
  await rpc(sup, "marcar_cadastro_revisado", { p_cadastro: c });
  igual((await um("select revisado from cadastros where id = $1", [c])).revisado, true);
  const outro = (await um("select id from bloqueios where id_app = 'aviso001'")).id;
  await rpc(sup, "corrigir_bloqueio", { p_bloqueio: outro, p_id_app: "aviso001", p_nome: "Zeferino Teste", p_cidade: "LAGARTO - SE", p_motivo: "x" }).catch((e) => { if (!/Nada foi alterado/.test(e.message)) throw e; });
  const deOutro = (await um("select id from bloqueios where id_app = 'imp00009'")).id;
  await falha(rpc(sup, "corrigir_bloqueio", { p_bloqueio: deOutro, p_id_app: "imp00009", p_nome: "Outro", p_cidade: "LAGARTO - SE", p_motivo: "x" }), "só os registros marcados");
  await falha(rpc(semBq, "corrigir_bloqueio", { p_bloqueio: b, p_id_app: "rev00009", p_nome: "X", p_cidade: "LAGARTO - SE", p_motivo: "x" }));
});

await t("internas não ficam expostas; anon não chama nada novo", async () => {
  const r = await um(`select has_function_privilege('authenticated', 'public.avisar_registro(text,text,text,text,text,boolean)', 'execute') a,
    has_function_privilege('authenticated', 'public.notificar(uuid,text,text)', 'execute') b,
    has_function_privilege('anon', 'public.listar_avisos(text,text,text,boolean,bigint,integer)', 'execute') c,
    has_function_privilege('authenticated', 'public.pedir_cidade(text)', 'execute') d`);
  igual([r.a, r.b, r.c, r.d], [false, false, false, true]);
});

console.log(`\n${n - falhas}/${n} testes passaram`);
await db.end();
process.exit(falhas ? 1 : 0);
