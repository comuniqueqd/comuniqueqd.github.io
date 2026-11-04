// Testes da migração 008 (supabase/008-espionagem.sql): casos suspeitos de uso por terceiros, checklist,
// veredito, lupa do detetive e placar do detetive.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node espiao.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql",
  "../supabase/007-pao-quentinho.sql", "../supabase/008-espionagem.sql", "../supabase/008-espionagem.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");
const sup = pessoa("eduarda@x.com", "Eduarda");
const sup2 = pessoa("joyce@x.com", "Joyce");
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
let n = 0, falhas = 0;
async function t(nome, fn) { n++; try { await fn(); console.log("ok    ", nome); } catch (e) { falhas++; console.log("FALHOU", nome, "→", e.message); } }
const igual = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
async function falha(p, trecho) {
  try { await p; } catch (e) { if (trecho && !e.message.includes(trecho)) throw new Error(`erro diferente: "${e.message}"`); return e; }
  throw new Error("deveria ter falhado");
}
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const avisos = async (p) => (await db.query("select texto, link from notificacoes n join membros m on m.user_id = n.para where m.email = $1 order by n.id", [p.email])).rows;
const casos = async (p, st) => (await rpc(p, "listar_casos", st ? { p_status: st } : {})).casos;

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, sup2, estranho]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
const infr = (await um("select id from infracoes where not leve and horas_1a is not null order by id limit 1")).id;
const CPF1 = "52998224725", CPF2 = "11144477735", CPF3 = "39053344705";

let original;
await t("cadastro normal: devolve o id e nenhum caso", async () => {
  const r = await rpc(sup, "enviar_cadastro", { p_id_app: "orig0001", p_cpf: CPF1, p_cidade: "LAGARTO - SE", p_nome: "Ana Souza" });
  original = r.id;
  igual([typeof r.id, r.caso], ["string", null]);
});

await t("mesmo CPF e mesmos dados: só a recusa de sempre, sem caso", async () => {
  await falha(rpc(sup2, "enviar_cadastro", { p_id_app: "orig0001", p_cpf: CPF1, p_cidade: "LAGARTO - SE", p_nome: "ana  souza" }), "já está cadastrado");
  await falha(rpc(sup2, "enviar_cadastro", { p_id_app: null, p_cpf: CPF1, p_cidade: "LAGARTO - SE" }), "já está cadastrado");
  igual((await um("select count(*)::int n from casos")).n, 0);
});

let caso1;
await t("mesmo CPF com outro nome e outro ID: a tentativa vira caso e a equipe toda é avisada", async () => {
  const antes = (await avisos(mon)).length;
  const r = await rpc(sup2, "enviar_cadastro", { p_id_app: "outr0002", p_cpf: "529.982.247-25", p_cidade: "LAGARTO - SE", p_nome: "Carlos Lima" });
  igual([r.id, r.nivel, r.erro.startsWith("Este CPF já está cadastrado")], [null, "atencao", true]);
  caso1 = r.caso;
  const k = await um("select * from casos where id = $1", [caso1]);
  igual([k.tipo, k.cadastro_id, k.cpf, k.id_app, k.nome, k.criado_por_nome], ["cpf_repetido", original, CPF1, "outr0002", "Carlos Lima", "Joyce"]);
  igual((await um("select count(*)::int n from cadastros where cpf = $1", [CPF1])).n, 1, "não cria outro cadastro");
  const a = await avisos(mon);
  igual(a.length, antes + 1);
  if (!a.at(-1).texto.startsWith("🕵️ Caso suspeito aberto por Joyce")) throw new Error(a.at(-1).texto);
  igual((await avisos(sup2)).filter((x) => x.texto.includes("Caso suspeito")).length, 0, "quem abriu não recebe");
  // repetir a mesma tentativa não abre outro caso
  igual((await rpc(sup2, "enviar_cadastro", { p_id_app: "outr0002", p_cpf: CPF1, p_cidade: "LAGARTO - SE", p_nome: "Carlos Lima" })).caso, caso1);
  igual((await um("select count(*)::int n from casos")).n, 1);
});

await t("selo do caso no cadastro original e na lista", async () => {
  const l = (await rpc(sup, "listar_cadastros", { p_escopo: "meus" })).find((x) => x.id === original);
  igual(l.caso_aberto, true);
  igual((await rpc(sup, "ver_cadastro", { p_cadastro: original })).casos.length, 1);
  igual((await rpc(sup, "casos_abertos_de", { p_id_app: "ORIG0001" })).length, 1);
});

await t("pedir verificação: vai para o responsável da cidade; ele vê o caso como seu", async () => {
  await rpc(sup2, "assumir_caso", { p_caso: caso1, p_acao: "pedir" });
  const a = await avisos(mon);
  if (!a.at(-1).texto.startsWith("🕵️ Joyce pediu que você verifique")) throw new Error(a.at(-1).texto);
  const k = (await casos(mon)).find((x) => x.id === caso1);
  igual([k.para_mim, k.responsavel_nome, k.pode_veredito], [true, "Jocimara", true]);
  igual((await casos(sup)).find((x) => x.id === caso1).para_mim, false);
  igual((await rpc(mon, "resumo_e_avisos")).resumo.casos_para_mim, 1);
  igual((await rpc(sup, "resumo_e_avisos")).resumo.casos_abertos, 1);
});

await t("sem responsável na cidade, o pedido vai para os moderadores", async () => {
  await rpc(sup, "enviar_cadastro", { p_id_app: "rec00001", p_cpf: CPF2, p_cidade: "RECIFE - PE", p_nome: "Bruno Alves" });
  const r = await rpc(sup2, "enviar_cadastro", { p_id_app: "rec00002", p_cpf: CPF2, p_cidade: "RECIFE - PE", p_nome: "Bruno Alves" });
  await rpc(sup2, "assumir_caso", { p_caso: r.caso, p_acao: "pedir" });
  igual((await casos(admin)).find((x) => x.id === r.caso).para_mim, true);
  igual((await casos(mon)).find((x) => x.id === r.caso).para_mim, false);
  if (!(await avisos(admin)).at(-1).texto.includes("pediu que você verifique")) throw new Error("admin sem aviso");
});

await t("eu verifico, checklist e comentários (qualquer pessoa da equipe)", async () => {
  await rpc(sup, "assumir_caso", { p_caso: caso1, p_acao: "eu" });
  const k = (await casos(sup)).find((x) => x.id === caso1);
  igual([k.investigador_nome, k.para_mim], ["Eduarda", true]);
  await rpc(sup, "marcar_checklist_caso", { p_caso: caso1, p_item: "Liguei para o entregador", p_feito: true });
  await falha(rpc(sup, "marcar_checklist_caso", { p_caso: caso1, p_item: "Inventado", p_feito: true }), "não encontrado");
  await rpc(sup, "comentar_caso", { p_caso: caso1, p_texto: "Ela disse que emprestou o CPF para o primo" });
  const k2 = (await casos(sup)).find((x) => x.id === caso1);
  igual(Object.keys(k2.checklist), ["Liguei para o entregador"]);
  igual(k2.comentarios.map((x) => x.texto), ["Pediu verificação para Jocimara.", "Assumiu a verificação.", "Ela disse que emprestou o CPF para o primo"]);
  await rpc(sup, "marcar_checklist_caso", { p_caso: caso1, p_item: "Liguei para o entregador", p_feito: false });
  igual((await casos(sup)).find((x) => x.id === caso1).checklist, {});
  await falha(rpc(estranho, "comentar_caso", { p_caso: caso1, p_texto: "oi" }));
});

await t("veredito: só monitorador/moderador, com nota; confirmado anota na ficha e avisa", async () => {
  await falha(rpc(sup, "veredito_caso", { p_caso: caso1, p_veredito: "confirmado", p_nota: "x" }));
  await falha(rpc(mon, "veredito_caso", { p_caso: caso1, p_veredito: "confirmado", p_nota: " " }), "Escreva");
  await rpc(mon, "veredito_caso", { p_caso: caso1, p_veredito: "confirmado", p_nota: "Primo usando o CPF" });
  const k = (await casos(mon, "encerrados")).find((x) => x.id === caso1);
  igual([k.status, k.veredito_por_nome, k.para_mim, k.pode_veredito], ["confirmado", "Jocimara", false, false]);
  const c = await um("select texto from comentarios_entregador where id_app = 'orig0001' order by id desc limit 1");
  if (!c.texto.startsWith("🕵️ Caso suspeito confirmado")) throw new Error(c.texto);
  if (!(await avisos(sup)).at(-1).texto.startsWith("🕵️ Caso CONFIRMADO por Jocimara")) throw new Error("investigadora sem aviso");
  await falha(rpc(mon, "veredito_caso", { p_caso: caso1, p_veredito: "descartado", p_nota: "x" }), "já foi encerrado");
  await falha(rpc(sup, "assumir_caso", { p_caso: caso1, p_acao: "eu" }), "já foi encerrado");
  igual((await rpc(sup, "listar_cadastros", { p_escopo: "meus" })).find((x) => x.id === original).caso_aberto, false);
});

await t("encerrado tentando voltar: mesmo CPF (forte) e mesmo nome com outro ID e CPF (forte, o cadastro é criado)", async () => {
  const id = (await rpc(sup, "enviar_cadastro", { p_id_app: "enc00001", p_cpf: CPF3, p_cidade: "LAGARTO - SE", p_nome: "José Sá" })).id;
  const motivo = (await um("select texto from motivos where tipo = 'encerramento' order by ordem limit 1")).texto;
  await rpc(mon, "decidir", { p_cadastro: id, p_acao: "encerrar", p_motivo: motivo, p_detalhe: "fraude" });
  const r1 = await rpc(sup2, "enviar_cadastro", { p_id_app: "enc00002", p_cpf: CPF3, p_cidade: "LAGARTO - SE", p_nome: "José Sá" });
  igual([r1.id, r1.nivel], [null, "forte"]);
  igual((await um("select tipo from casos where id = $1", [r1.caso])).tipo, "encerrado_voltando");
  const r2 = await rpc(sup2, "enviar_cadastro", { p_id_app: "enc00003", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "jose  sa" });
  igual([typeof r2.id, r2.nivel], ["string", "forte"]);
  const k = await um("select tipo, cadastro_id, novo_cadastro_id from casos where id = $1", [r2.caso]);
  igual([k.tipo, k.cadastro_id, k.novo_cadastro_id], ["encerrado_voltando", id, r2.id]);
  igual((await rpc(mon, "listar_cadastros", { p_escopo: "pendentes" })).find((x) => x.id === r2.id).caso_aberto, true);
  const l = await casos(sup);
  igual(l[0].nivel, "forte", "sinais fortes primeiro");
});

await t("nome de entregador com parceria encerrada nos bloqueios, com outro ID", async () => {
  const furto = (await um("select id from infracoes where horas_1a is null limit 1")).id;
  await rpc(mon, "registrar_bloqueio", { p_id_app: "blq00001", p_nome: "Pedro Encerrado", p_cidade: "LAGARTO - SE", p_infracao: furto });
  const r = await rpc(sup, "enviar_cadastro", { p_id_app: "blq00002", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Pedro Encerrado" });
  igual(r.nivel, "forte");
  if (!(await um("select detalhe from casos where id = $1", [r.caso])).detalhe.includes("PARCERIA ENCERRADA")) throw new Error("detalhe");
});

await t("troca de nome ou ID num cadastro aprovado abre caso; completar o que faltava não", async () => {
  const id = (await rpc(sup, "enviar_cadastro", { p_id_app: "apr00001", p_cpf: null, p_cidade: "LAGARTO - SE" })).id;
  await rpc(mon, "decidir", { p_cadastro: id, p_acao: "aprovar" });
  const r1 = await rpc(sup, "completar_cadastro", { p_cadastro: id, p_id_app: "apr00001", p_cpf: null, p_nome: "Lia Prado", p_cidade: "LAGARTO - SE" });
  igual(r1.caso, null, "só completou o nome");
  const r2 = await rpc(sup, "completar_cadastro", { p_cadastro: id, p_id_app: "apr00009", p_cpf: null, p_nome: "Lia Prado", p_cidade: "LAGARTO - SE" });
  const k = await um("select tipo, nivel, detalhe from casos where id = $1", [r2.caso]);
  igual([k.tipo, k.nivel, k.detalhe], ["troca_aprovado", "atencao", "Cadastro APROVADO teve os dados trocados: Lia Prado (ID apr00001) → Lia Prado (ID apr00009)."]);
  const r3 = await rpc(sup, "completar_cadastro", { p_cadastro: id, p_id_app: "apr00009", p_cpf: null, p_nome: "Lia Prado", p_cidade: "LAGARTO - SE", p_observacao: "obs" });
  igual(r3.caso, null, "mudar só a observação não conta");
});

await t("checklist editável só por moderador", async () => {
  await falha(rpc(mon, "salvar_checklist_casos", { p_itens: ["A"] }));
  await rpc(admin, "salvar_checklist_casos", { p_itens: ["Pedi foto do documento", "Conferi a conta de pagamento"] });
  igual((await rpc(sup, "listar_casos")).checklist, ["Pedi foto do documento", "Conferi a conta de pagamento"]);
  await falha(rpc(admin, "salvar_checklist_casos", { p_itens: [] }), "pelo menos um");
});

await t("lupa do detetive: casos, comentários (só com bloqueios) e os seus avisos", async () => {
  await rpc(mon, "comentar_entregador", { p_id_app: "blq00001", p_texto: "Usa moto emprestada do irmão" });
  const r = await rpc(mon, "busca_rapida", { p_q: "emprestada" });
  igual(r.comentarios.map((x) => x.id_app), ["blq00001"]);
  igual((await rpc(sup2, "busca_rapida", { p_q: "emprestada" })).comentarios, [], "sem módulo de bloqueios");
  igual((await rpc(mon, "busca_rapida", { p_q: "Carlos Lima" })).casos.length, 1);
  if (!(await rpc(mon, "busca_rapida", { p_q: "pediu que você" })).avisos.length) throw new Error("avisos");
});

await t("placar do detetive", async () => {
  const p = await rpc(sup2, "placar_detetive", { p_dias: 30 });
  igual(p.confirmados, 1);
  const j = p.pessoas.find((x) => x.nome === "Jocimara");
  igual([j.resolvidos, j.confirmados], [1, 1]);
  igual(p.pessoas.find((x) => x.nome === "Eduarda").comentarios, 2);
  await falha(rpc(estranho, "placar_detetive", {}));
});

await t("internas não ficam expostas; nenhum update sem where", async () => {
  for (const f of ["sinais_cadastro(text,text,text,uuid)", "abrir_caso(text,text,uuid,uuid,text,text,text,text,text)", "json_caso(public.casos)"])
    igual((await um(`select has_function_privilege('authenticated', 'public.${f}', 'execute') ok`)).ok, false, f);
  await falha(db.query("set role authenticated; insert into casos (tipo, nivel, detalhe) values ('cpf_repetido', 'forte', 'x')"), "permission");
  await db.query("reset role");
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
