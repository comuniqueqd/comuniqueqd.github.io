// Testes da 008d (supabase/008d-avisos-parte2.sql): seguir cidade, "de olho nele", preferências,
// leves agrupadas, previsão vencida, resumo do dia e a lista de revisar para o suporte.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node avisos2.test.mjs
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
  "../supabase/008b-notificacoes.sql", "../supabase/008c-analises.sql", "../supabase/008d-avisos-parte2.sql",
  "../supabase/008d-avisos-parte2.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");     // monitoradora, responsável por LAGARTO
const sup = pessoa("eduarda@x.com", "Eduarda");       // suporte nos dois módulos
const sup2 = pessoa("lucas@x.com", "Lucas");          // suporte nos dois módulos, sem cidade
const semBq = pessoa("joyce@x.com", "Joyce");         // suporte só na ativação

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
const marca = async () => { ultimo.id = (await um("select coalesce(max(id), 0)::int i from notificacoes")).i; };
const novos = async (p) => (await db.query("select n.texto, n.categoria, n.motivo, n.cidade, n.chave, n.contagem from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.id > $2 order by n.id", [p.email, ultimo.id])).rows;

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", "suporte"], [semBq, "suporte", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, sup2, semBq]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
await rpc(admin, "salvar_cidade", { p_nome: "ITABAIANA - SE", p_responsavel_email: null, p_ativa: true });
const inf = (await um("select id from infracoes where not leve and ativa and horas_1a >= 10 order by id limit 1")).id;
const infCurta = (await um("select id from infracoes where not leve and ativa and horas_1a < 10 order by id limit 1")).id;
const leve = (await um("select id from infracoes where leve and ativa order by id limit 1")).id;

await t("seguir cidade: quem segue recebe os avisos dela, com o motivo", async () => {
  const r = await rpc(sup2, "seguir", { p_tipo: "cidade", p_alvo: "lagarto - se" });
  igual(r.seguindo.map((s) => [s.tipo, s.alvo]), [["cidade", "LAGARTO - SE"]]);
  await marca();
  await rpc(sup, "registrar_bloqueio", { p_id_app: "olho0001", p_nome: "Zeferino Teste", p_cidade: "LAGARTO - SE", p_infracao: infCurta });
  const s2 = await novos(sup2);
  igual([s2.length, s2[0]?.motivo, s2[0]?.categoria], [1, "seguindo", "bloqueios"]);
  igual((await novos(mon))[0]?.motivo, "cidade", "a responsável continua com o motivo cidade:");
});

await t("de olho nele: recebe tudo do entregador, de qualquer cidade, mesmo com o tipo silenciado", async () => {
  await rpc(sup2, "seguir", { p_tipo: "entregador", p_alvo: "OLHO0001" });
  await rpc(sup2, "salvar_preferencias", { p_silenciados: ["comentarios", "bloqueios"] });
  await marca();
  await rpc(mon, "comentar_entregador", { p_id_app: "olho0001", p_texto: "Entregador conversou com a equipe." });
  const s2 = await novos(sup2);
  igual([s2.length, s2[0]?.motivo], [1, "de_olho"]);
  await marca();
  await rpc(sup, "registrar_bloqueio", { p_id_app: "outro001", p_nome: "Outro Teste", p_cidade: "LAGARTO - SE", p_infracao: infCurta });
  igual((await novos(sup2)).length, 0, "silenciou bloqueios da cidade que segue:");
});

await t("preferências: o moderador silencia bloqueios e não recebe; o aviso pessoal nunca é silenciado", async () => {
  await rpc(admin, "salvar_preferencias", { p_silenciados: ["bloqueios"] });
  await marca();
  await rpc(sup, "registrar_bloqueio", { p_id_app: "outro002", p_nome: "Mais Um", p_cidade: "ITABAIANA - SE", p_infracao: infCurta });
  igual((await novos(admin)).length, 0);
  await rpc(semBq, "salvar_preferencias", { p_silenciados: ["ativacao"] });
  const c = (await rpc(semBq, "enviar_cadastro", { p_id_app: "cad00099", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Cadastro Teste" })).id;
  await marca();
  await rpc(mon, "decidir", { p_cadastro: c, p_acao: "aprovar" });
  const j = await novos(semBq);
  igual([j.length, j[0]?.categoria], [1, null], "a decisão do próprio cadastro chega:");
  await falha(rpc(sup, "salvar_preferencias", { p_silenciados: ["tudo"] }), "desconhecido");
  await rpc(admin, "salvar_preferencias", { p_silenciados: [] });
});

await t("leves agrupadas: um aviso por cidade e dia, que vai somando e volta para o topo como não lido", async () => {
  await marca();
  for (const id of ["leve0001", "leve0002", "leve0003"]) {
    await db.query("insert into entregadores (id_app, nome, cidade) values ($1, $2, 'LAGARTO - SE') on conflict do nothing", [id, "Leve " + id]);
    await rpc(sup, "registrar_infracao_leve", { p_id_app: id, p_infracao: leve });
  }
  const a = await novos(admin);
  igual(a.length, 1, "um aviso só para o moderador:");
  igual([a[0].categoria, a[0].contagem], ["leves", 3]);
  if (!a[0].texto.startsWith("3 infrações leves novas em LAGARTO - SE hoje")) throw new Error(a[0].texto);
  igual((await um("select count(*)::int n from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.chave like 'leves:LAGARTO - SE:%'", [admin.email])).n, 1);
});

await t("leves de quem está de olho chegam uma por uma; silenciar 'leves' tira só o agrupado", async () => {
  await rpc(sup2, "salvar_preferencias", { p_silenciados: ["leves"] });
  await rpc(sup2, "seguir", { p_tipo: "entregador", p_alvo: "leve0001" });
  await marca();
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "leve0001", p_infracao: (await um("select id from infracoes where leve and ativa order by id desc limit 1")).id });
  const s2 = await novos(sup2);
  igual([s2.length, s2[0]?.motivo, s2[0]?.chave], [1, "de_olho", null]);
  await marca();
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "leve0002", p_infracao: leve }).catch(() => {});
  igual((await novos(sup2)).length, 0, "leve de quem não está de olho, com leves silenciadas:");
});

await t("seguir: validações e deixar de seguir", async () => {
  await falha(rpc(sup, "seguir", { p_tipo: "cidade", p_alvo: "ATLANTIDA - XX" }), "cidade da lista");
  await falha(rpc(sup, "seguir", { p_tipo: "entregador", p_alvo: "naoexiste" }), "não tem registros");
  await falha(rpc(semBq, "seguir", { p_tipo: "entregador", p_alvo: "olho0001" }));
  await falha(rpc(sup, "seguir", { p_tipo: "outro", p_alvo: "x" }), "Tipo inválido");
  const r = await rpc(sup2, "seguir", { p_tipo: "cidade", p_alvo: "LAGARTO - SE", p_seguir: false });
  igual(r.seguindo.some((s) => s.tipo === "cidade"), false);
  igual(r.seguindo.find((s) => s.alvo === "olho0001")?.nome, "Zeferino Teste");
});

await t("cada pessoa só vê o que ela mesma segue e as próprias preferências", async () => {
  await db.query("begin"); await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: sup.sub, email: sup.email, role: "authenticated" })]);
  const r = (await db.query("select (select count(*) from seguindo)::int s, (select count(*) from preferencias_aviso)::int p")).rows[0];
  await db.query("commit");
  igual([r.s, r.p], [0, 0]);
});

await t("previsão vencida: quem deu a previsão é avisado uma vez; os outros não", async () => {
  await rpc(sup, "registrar_bloqueio", { p_id_app: "prev0001", p_nome: "Previsto Teste", p_cidade: "LAGARTO - SE", p_infracao: inf });
  const tarefa = (await um("select t.id from tarefas t join bloqueios b on b.id = t.bloqueio_id where b.id_app = 'prev0001'")).id;
  await rpc(mon, "definir_previsao", { p_tipo: "tarefa", p_id: tarefa, p_previsao: new Date(Date.now() - 60000).toISOString() });
  igual((await um("select previsao_por = (select user_id from membros where email = $1) ok from tarefas where id = $2", [mon.email, tarefa])).ok, true);
  igual(await rpc(sup, "verificar_previsoes"), 0, "outra pessoa:");
  await marca();
  igual(await rpc(mon, "verificar_previsoes"), 1);
  const m = await novos(mon);
  if (m.length !== 1 || !m[0].texto.includes("Passou a previsão que você deu para a tratativa de Previsto Teste")) throw new Error(JSON.stringify(m));
  igual(await rpc(mon, "verificar_previsoes"), 0, "não repete:");
  await rpc(mon, "definir_previsao", { p_tipo: "tarefa", p_id: tarefa, p_previsao: new Date(Date.now() - 30000).toISOString() });
  igual(await rpc(mon, "verificar_previsoes"), 1, "previsão nova vence de novo:");
});

await t("previsão vencida de cadastro, e cadastro já decidido não avisa", async () => {
  const c = (await rpc(sup, "enviar_cadastro", { p_id_app: "cad00100", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Previsto Cadastro" })).id;
  await rpc(mon, "definir_previsao", { p_tipo: "cadastro", p_id: c, p_previsao: new Date(Date.now() - 60000).toISOString() });
  await marca();
  igual(await rpc(mon, "verificar_previsoes"), 1);
  if (!(await novos(mon))[0].texto.includes("Previsto Cadastro")) throw new Error("texto");
  const c2 = (await rpc(sup, "enviar_cadastro", { p_id_app: "cad00101", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Decidido Antes" })).id;
  await rpc(mon, "definir_previsao", { p_tipo: "cadastro", p_id: c2, p_previsao: new Date(Date.now() - 60000).toISOString() });
  await rpc(mon, "decidir", { p_cadastro: c2, p_acao: "aprovar" });
  igual(await rpc(mon, "verificar_previsoes"), 0);
});

await t("resumo do dia: totais de hoje, com os blocos de bloqueios só para quem tem o módulo", async () => {
  const r = await rpc(sup, "resumo_do_dia");
  if (r.cadastros < 3 || r.bloqueios < 4 || r.leves < 3) throw new Error(JSON.stringify(r));
  if (!(r.voce > 0)) throw new Error("voce");
  const j = await rpc(semBq, "resumo_do_dia");
  igual([j.bloqueios, j.leves, j.tratativas], [null, null, null]);
});

await t("revisar registros da planilha: o suporte recebe a lista inteira; sem bloqueios, não", async () => {
  await db.query("select importar_bloqueio('rev00010', 'Nome Errado', 'LAGARTO - SE', (select nome from infracoes where id = $1), now() - interval '90 days', 'Planilha', 'ID usado com 2 nomes', '24')", [inf]);
  const l = await rpc(sup, "bloqueios_para_revisar");
  igual(l.some((b) => b.id_app === "rev00010" && b.revisar), true);
  await falha(rpc(semBq, "bloqueios_para_revisar"));
});

await t("internas não ficam expostas; anon não chama nada novo", async () => {
  const r = await um(`select has_function_privilege('authenticated', 'public.avisar_registro(text,text,text,text,text,boolean,boolean)', 'execute') a,
    has_function_privilege('anon', 'public.seguir(text,text,boolean)', 'execute') b,
    has_function_privilege('authenticated', 'public.seguir(text,text,boolean)', 'execute') c,
    has_function_privilege('anon', 'public.resumo_do_dia()', 'execute') d`);
  igual([r.a, r.b, r.c, r.d], [false, false, true, false]);
});

console.log(`\n${n - falhas}/${n} testes passaram`);
await db.end();
process.exit(falhas ? 1 : 0);
