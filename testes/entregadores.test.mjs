// Testes da migração 003 (supabase/003-entregadores.sql) num Postgres local:
// cadastro do entregador, comentários, correção de bloqueios, contagem de leves e segurança.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node entregadores.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");
const sup = pessoa("eduarda@x.com", "Eduarda");
const sup2 = pessoa("joyce@x.com", "Joyce");
const estranho = pessoa("estranho@gmail.com", "Fora da equipe");

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

// dados de antes da 003 (como já estão no Supabase): importação com alerta e um registro pelo app
for (const [p, papel] of [[mon, "monitorador"], [sup, "suporte"], [sup2, "suporte"]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: "suporte", p_papel_bloqueios: papel });
for (const p of [admin, mon, sup, sup2, estranho]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
await importar("aaaa1111bbbb2222cccc3333", "Pessoa Um", "ITABAIANA - SE", "Reabrir Pedido Após Aceite Sem Justificativa Plausível", 90, "ID igual ao exemplo do formulário antigo");
await importar("aaaa1111bbbb2222cccc3333", "Pessoa Dois", "ITABAIANA - SE", "Reabrir Pedido Após Aceite Sem Justificativa Plausível", 80, "ID usado com 2 nomes");
await importar("dddd4444eeee5555ffff6666", "Pessoa Dois", null, "Mal Uso Proposital do Aplicativo", 70, "sem cidade na planilha");
const INF = Object.fromEntries((await db.query("select nome, id from infracoes")).rows.map((r) => [r.nome, r.id]));
const REABRIR = INF["Reabrir Pedido Após Aceite Sem Justificativa Plausível"], MAL_USO = INF["Mal Uso Proposital do Aplicativo"];
const LEVE = INF["Reabertura de Pedido (aviso)"];
const antigo = await rpc(sup, "registrar_bloqueio", { p_id_app: "Abc12345", p_nome: "Fulano Antigo", p_cidade: "LAGARTO - SE", p_infracao: MAL_USO, p_observacao: null });
// leves que geraram bloqueio antes da 003
await rpc(admin, "salvar_parametros_leves", { p_limite: 2, p_janela_dias: 50 });
await rpc(sup, "registrar_infracao_leve", { p_id_app: "Abc12345", p_infracao: LEVE });
await db.query("update bloqueios set inicio = inicio - interval '1 hour' where lower(id_app) = 'abc12345' and leve");
const gerouAntes = await rpc(sup, "registrar_infracao_leve", { p_id_app: "Abc12345", p_infracao: LEVE });

// ---------- migração ----------
await t("003 roda sobre os dados existentes e pode rodar de novo", async () => {
  await db.query(arquivo("../supabase/003-entregadores.sql"));
  await db.query(arquivo("../supabase/003-entregadores.sql"));
});
await t("cadastro do entregador nasce dos bloqueios (o mais recente de cada ID, ID em minúsculas)", async () => {
  const r = (await db.query("select id_app, nome, cidade from entregadores order by id_app")).rows;
  igual(r.map((x) => [x.id_app, x.nome, x.cidade]), [
    ["aaaa1111bbbb2222cccc3333", "Pessoa Dois", "ITABAIANA - SE"],
    ["abc12345", "Fulano Antigo", "LAGARTO - SE"],
    ["dddd4444eeee5555ffff6666", "Pessoa Dois", null]]);
});
await t("leves que já tinham gerado bloqueio ficam marcadas", async () =>
  igual((await um("select atingiu_limite from bloqueios where id = $1", [gerouAntes.id])).atingiu_limite, true));

// ---------- correção ----------
const [b1, b2, b3] = (await db.query("select id from bloqueios where importado order by inicio")).rows.map((r) => r.id);
await t("suporte não corrige bloqueio", () =>
  falha(rpc(sup, "corrigir_bloqueio", { p_bloqueio: b1, p_id_app: "aaaa1111", p_nome: "X", p_cidade: "ITABAIANA - SE", p_motivo: "x" }), "não permite"));
await t("correção sem motivo é recusada", () =>
  falha(rpc(mon, "corrigir_bloqueio", { p_bloqueio: b1, p_id_app: "6a1b2c3d4e5f", p_nome: "Pessoa Um", p_cidade: "ITABAIANA - SE", p_motivo: " " }), "motivo"));
await t("monitorador corrige o ID: alerta resolvido, punição e ocorrência mantidas, histórico e comentário gravados", async () => {
  const antes = await um("select horas::float8 h, ocorrencia from bloqueios where id = $1", [b1]);
  const r = await rpc(mon, "corrigir_bloqueio", { p_bloqueio: b1, p_id_app: "6a1b2c3d4e5f", p_nome: "Pessoa Um", p_cidade: "ITABAIANA - SE", p_motivo: "ID conferido no app" });
  igual([r.id_app, r.revisar, r.corrigido, r.horas, r.ocorrencia], ["6a1b2c3d4e5f", null, true, antes.h, antes.ocorrencia]);
  const ev = await um("select tipo, por_nome, detalhe from eventos_bloqueio where bloqueio_id = $1 and tipo = 'corrigido'", [b1]);
  igual(ev.por_nome, "Jocimara");
  if (!ev.detalhe.includes("ID: aaaa1111bbbb2222cccc3333 → 6a1b2c3d4e5f") || !ev.detalhe.includes("alerta resolvido") || !ev.detalhe.includes("ID conferido")) throw new Error(ev.detalhe);
  igual((await um("select nome from entregadores where id_app = '6a1b2c3d4e5f'")).nome, "Pessoa Um", "novo ID ganha cadastro:");
  const c = (await db.query("select id_app, tipo from comentarios_entregador order by id_app")).rows;
  igual(c.map((x) => [x.id_app, x.tipo]), [["6a1b2c3d4e5f", "alteracao"], ["aaaa1111bbbb2222cccc3333", "alteracao"]]);
});
await t("sem alterar nada, só marca como revisado (sem motivo obrigatório)", async () => {
  const r = await rpc(mon, "corrigir_bloqueio", { p_bloqueio: b2, p_id_app: "aaaa1111bbbb2222cccc3333", p_nome: "Pessoa Dois", p_cidade: "ITABAIANA - SE" });
  igual([r.revisar, r.corrigido], [null, false]);
  igual((await um("select tipo from eventos_bloqueio where bloqueio_id = $1 order by id desc limit 1", [b2])).tipo, "revisado");
  await falha(rpc(mon, "corrigir_bloqueio", { p_bloqueio: b2, p_id_app: "aaaa1111bbbb2222cccc3333", p_nome: "Pessoa Dois", p_cidade: "ITABAIANA - SE" }), "Nada foi alterado");
});
await t("registro importado sem cidade: correção pode manter sem cidade ou escolher uma da lista", async () => {
  await falha(rpc(admin, "corrigir_bloqueio", { p_bloqueio: b3, p_id_app: "dddd4444eeee5555ffff6666", p_nome: "Pessoa Dois", p_cidade: "INVENTADA - XX", p_motivo: "x" }), "cidade da lista");
  const r = await rpc(admin, "corrigir_bloqueio", { p_bloqueio: b3, p_id_app: "dddd4444eeee5555ffff6666", p_nome: "Pessoa Dois", p_cidade: "lagarto - se", p_motivo: "cidade confirmada" });
  igual(r.cidade, "LAGARTO - SE");
  await falha(rpc(admin, "corrigir_bloqueio", { p_bloqueio: b3, p_id_app: "dddd4444eeee5555ffff6666", p_nome: "Pessoa Dois", p_cidade: "", p_motivo: "x" }), "Escolha a cidade");
});
await t("mudar a cidade leva a tratativa pendente para o novo responsável", async () => {
  const r = await rpc(sup, "registrar_bloqueio", { p_id_app: "trat0001", p_nome: "Tratado", p_cidade: "ITABAIANA - SE", p_infracao: MAL_USO });
  igual((await um("select responsavel_email from tarefas where bloqueio_id = $1", [r.id])).responsavel_email, null);
  await rpc(mon, "corrigir_bloqueio", { p_bloqueio: r.id, p_id_app: "trat0001", p_nome: "Tratado", p_cidade: "LAGARTO - SE", p_motivo: "cidade errada" });
  igual((await um("select responsavel_email from tarefas where bloqueio_id = $1", [r.id])).responsavel_email, mon.email);
});

// ---------- comentários no registro ----------
await t("novo bloqueio com comentário vai para o cadastro do entregador", async () => {
  const r = await rpc(sup, "registrar_bloqueio", { p_id_app: "NOVO0001", p_nome: "Novato", p_cidade: "LAGARTO - SE", p_infracao: REABRIR, p_observacao: "pedido 123", p_comentario: "Costuma pegar pedidos longe." });
  const c = await um("select id_app, tipo, texto, bloqueio_id, por_nome from comentarios_entregador where bloqueio_id = $1", [r.id]);
  igual([c.id_app, c.tipo, c.texto, c.por_nome], ["novo0001", "comentario", "Costuma pegar pedidos longe.", "Eduarda"]);
  igual((await um("select nome from entregadores where id_app = 'novo0001'")).nome, "Novato");
});
await t("chamada antiga (sem comentário) continua funcionando", async () => {
  await rpc(sup, "registrar_bloqueio", { p_id_app: "novo0002", p_nome: "Sem Comentario", p_cidade: "LAGARTO - SE", p_infracao: REABRIR, p_observacao: null });
  igual((await um("select count(*)::int n from comentarios_entregador where id_app = 'novo0002'")).n, 0);
});
await t("infração leve também aceita comentário; prévia mostra os comentários", async () => {
  await rpc(sup2, "registrar_infracao_leve", { p_id_app: "novo0001", p_infracao: LEVE, p_comentario: "Avisado pelo WhatsApp." });
  const p = await rpc(sup, "previa_bloqueio", { p_id_app: "NOVO0001", p_infracao: REABRIR });
  igual(p.comentarios.map((c) => c.texto), ["Avisado pelo WhatsApp.", "Costuma pegar pedidos longe."]);
  igual([p.nome_conhecido, p.cidade_conhecida], ["Novato", "LAGARTO - SE"]);
});

// ---------- cadastro do entregador ----------
await t("consulta agrupa por ID com cadastro, nomes usados e comentários", async () => {
  const r = await rpc(sup, "consultar_entregador", { p_busca: "pessoa dois" });
  igual(r.entregadores.map((e) => e.id_app).sort(), ["aaaa1111bbbb2222cccc3333", "dddd4444eeee5555ffff6666"]);
  const e = r.entregadores.find((x) => x.id_app === "aaaa1111bbbb2222cccc3333");
  igual([e.nome, e.bloqueios, e.comentarios.length], ["Pessoa Dois", 1, 1]);
  igual(r.bloqueios.length, 2);
});
await t("suporte comenta; não altera o cadastro", async () => {
  await rpc(sup, "comentar_entregador", { p_id_app: "ABC12345", p_texto: "Ligou pedindo para ser liberado." });
  await falha(rpc(sup, "salvar_entregador", { p_id_app: "abc12345", p_nome: "Outro", p_cidade: "LAGARTO - SE" }), "não permite");
  await falha(rpc(sup, "comentar_entregador", { p_id_app: "naoexiste1", p_texto: "oi" }), "não tem registros");
  await falha(rpc(sup, "comentar_entregador", { p_id_app: "abc12345", p_texto: "  " }), "Escreva");
});
await t("alterar o cadastro sem aplicar aos bloqueios: próximos registros usam o novo nome", async () => {
  await rpc(mon, "salvar_entregador", { p_id_app: "ABC12345", p_nome: "Fulano de Tal", p_cidade: "LAGARTO - SE" });
  igual((await um("select nome, atualizado_por_nome from entregadores where id_app = 'abc12345'")), { nome: "Fulano de Tal", atualizado_por_nome: "Jocimara" });
  igual((await um("select count(*)::int n from bloqueios where lower(id_app) = 'abc12345' and nome_entregador = 'Fulano de Tal'")).n, 0);
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "abc12345", p_infracao: REABRIR })).nome_conhecido, "Fulano de Tal");
  await falha(rpc(mon, "salvar_entregador", { p_id_app: "abc12345", p_nome: "Fulano de Tal", p_cidade: "LAGARTO - SE" }), "Nada foi alterado");
});
await t("aplicar aos bloqueios troca o nome em todos os registros do ID e grava o histórico", async () => {
  const r = await rpc(admin, "salvar_entregador", { p_id_app: "abc12345", p_nome: "Fulano de Tal", p_cidade: "LAGARTO - SE", p_aplicar: true, p_motivo: "nome completo" });
  const total = (await um("select count(*)::int n from bloqueios where lower(id_app) = 'abc12345'")).n;
  igual(r.bloqueios_alterados, total);
  igual((await um("select count(*)::int n from bloqueios where lower(id_app) = 'abc12345' and nome_entregador <> 'Fulano de Tal'")).n, 0);
  igual((await um("select count(*)::int n from eventos_bloqueio e join bloqueios b on b.id = e.bloqueio_id where lower(b.id_app) = 'abc12345' and e.tipo = 'corrigido'")).n, total);
  const c = await rpc(sup, "consultar_entregador", { p_busca: "abc12345" });
  const tipos = c.entregadores[0].comentarios.map((x) => x.tipo);
  igual(tipos, ["alteracao", "alteracao", "comentario"]);
});
await t("comentário: apaga quem escreveu ou moderador; alteração não se apaga", async () => {
  const id = await rpc(sup, "comentar_entregador", { p_id_app: "abc12345", p_texto: "comentário errado" });
  await falha(rpc(sup2, "excluir_comentario", { p_id: id }), "Só quem escreveu");
  await falha(rpc(mon, "excluir_comentario", { p_id: id }), "Só quem escreveu");
  await rpc(sup, "excluir_comentario", { p_id: id });
  const id2 = await rpc(sup2, "comentar_entregador", { p_id_app: "abc12345", p_texto: "outro" });
  await rpc(admin, "excluir_comentario", { p_id: id2 });
  const alt = await um("select id from comentarios_entregador where tipo = 'alteracao' limit 1");
  await falha(rpc(admin, "excluir_comentario", { p_id: alt.id }), "não encontrado");
});

// ---------- leves: apagar o bloqueio gerado não faz a contagem voltar ----------
await t("apagar o bloqueio gerado por leves não gera outro na próxima leve", async () => {
  await rpc(admin, "salvar_parametros_leves", { p_limite: 3, p_janela_dias: 50 });
  await rpc(sup, "registrar_infracao_leve", { p_id_app: "lev00001", p_infracao: LEVE });
  for (const h of [3, 2]) { await db.query("update bloqueios set inicio = inicio - make_interval(hours => $1) where lower(id_app) = 'lev00001' and leve and inicio > now() - interval '30 minutes'", [h]); await rpc(sup, "registrar_infracao_leve", { p_id_app: "lev00001", p_infracao: LEVE }); }
  const terceira = (await db.query("select id, gerou_bloqueio from bloqueios where lower(id_app) = 'lev00001' and leve order by inicio desc limit 1")).rows[0];
  if (!terceira.gerou_bloqueio) throw new Error("a 3ª leve deveria ter gerado bloqueio");
  await rpc(admin, "excluir_bloqueio", { p_bloqueio: terceira.gerou_bloqueio });
  await db.query("update bloqueios set inicio = inicio - interval '1 hour' where lower(id_app) = 'lev00001' and leve");
  const r = await rpc(sup, "registrar_infracao_leve", { p_id_app: "lev00001", p_infracao: LEVE });
  igual([r.leves, r.gerado], [1, null]);
});

// ---------- segurança ----------
await t("quem está fora da equipe não chama as funções auxiliares", async () => {
  for (const [fn, args] of [["dados_conhecidos", "'abc12345'"], ["responsavel_da_cidade", "'LAGARTO - SE'"], ["nome_por_email", "'jocimara@x.com'"],
    ["leves_acumuladas", "'abc12345', now()"], ["calcular_ocorrencia", "'abc12345', 1::smallint, now()"], ["comentarios_de", "'abc12345', 5"],
    ["anotar_entregador", "'abc12345', 'comentario', 'x', null"]])
    await falha(sqlComo(estranho, `select public.${fn}(${args})`), "permission denied");
  igual((await sqlComo(estranho, "select public.nome_de($1) n", [mon.sub]))[0].n, null);
  igual((await sqlComo(estranho, "select public.json_bloqueio(b) j from (select (null::bloqueios).*) b"))[0].j, null);
});
await t("fora da equipe não lê entregadores, comentários nem parâmetros", async () => {
  for (const tab of ["entregadores", "comentarios_entregador", "parametros_bloqueio", "bloqueios"])
    igual((await sqlComo(estranho, `select count(*)::int n from public.${tab}`))[0].n, 0, tab + ":");
  await falha(rpc(estranho, "consultar_entregador", { p_busca: "abc12345" }), "não tem acesso");
  await falha(rpc(estranho, "comentar_entregador", { p_id_app: "abc12345", p_texto: "oi" }), "não tem acesso");
});
await t("equipe continua lendo pelo app (nomes, tratativas, histórico)", async () => {
  const l = await rpc(mon, "listar_bloqueios", { p_escopo: "todos" });
  if (!l.length || l.some((b) => b === null)) throw new Error("lista vazia ou com nulos");
  const t1 = await rpc(admin, "listar_tarefas", { p_status: "pendente" });
  if (!t1.some((x) => x.responsavel_nome === "Jocimara")) throw new Error("nome do responsável sumiu");
  igual((await sqlComo(sup, "select count(*)::int n from public.entregadores"))[0].n > 0, true);
  const ev = await rpc(sup, "eventos_do_bloqueio", { p_bloqueio: antigo.id });
  igual(ev.map((e) => e.tipo), ["registrado", "corrigido"]);
  igual(await rpc(sup2, "eventos_do_bloqueio", { p_bloqueio: antigo.id }), [], "suporte só vê o histórico dos próprios:");
});
await t("no SQL Editor (sem usuário logado) as views continuam com nomes", async () => {
  const r = await um("select count(*)::int n from vw_cadastros");
  igual(typeof r.n, "number");
  await um("select tratativa_responsavel from vw_bloqueios limit 1");
});

await db.end();
console.log(`\n${n - falhas}/${n} passaram`);
process.exit(falhas ? 1 : 0);
