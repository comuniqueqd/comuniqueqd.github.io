// Testes da 009p (supabase/009p-bairros-parecidos.sql): bairro novo com nome parecido com outro da mesma cidade
// vira apelido dele (mesmo valor); parecido mas duvidoso pergunta antes; números diferentes nunca juntam.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node bairros.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("set client_min_messages = warning");
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const M = ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql",
  "../supabase/007-pao-quentinho.sql", "../supabase/008-espionagem.sql", "../supabase/008b-cadastrar-entregador.sql",
  "../supabase/008b-notificacoes.sql", "../supabase/008c-analises.sql", "../supabase/008d-avisos-parte2.sql",
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql", "../supabase/009c-mensagens-agravante.sql",
  "../supabase/009c2-mensagens-opcoes.sql", "../supabase/009d-ajuda-aviso-turno.sql", "../supabase/009d2-tarefas-cards.sql",
  "../supabase/009d3-painel-metas-recorrentes.sql", "../supabase/009e-parceiros.sql", "../supabase/009f-parceiros-completo.sql",
  "../supabase/009g-tarefas-compartilhadas.sql", "../supabase/009h-entregador-pelo-lancamento.sql",
  "../supabase/009p-bairros-parecidos.sql", "../supabase/009p-bairros-parecidos.sql"];  // a 009p duas vezes: pode rodar de novo
for (const f of M) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const sup = pessoa("eduarda@x.com", "Eduarda");
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
const grau = async (a, b) => (await db.query("select public.grau_bairro($1, $2) g", [a, b])).rows[0].g;
const bairro = async (nome) => (await db.query("select * from bairros where cidade = 'LAGARTO - SE' and nome = $1", [nome])).rows[0];
const novo = (nome, valor = 9, extra = {}) => rpc(admin, "salvar_bairro", { p_id: null, p_cidade: "LAGARTO - SE", p_nome: nome, p_valor: valor, p_taxa_log: 1, ...extra });

await rpc(admin, "entrar");
await rpc(admin, "salvar_membro", { p_email: sup.email, p_nome: sup.nome, p_papel: "suporte", p_papel_bloqueios: "suporte" });
await rpc(sup, "entrar");
await db.query("insert into cidades (nome) values ('LAGARTO - SE') on conflict do nothing");
await db.query(`insert into bairros (cidade, nome, valor, taxa_log, apelidos) values
  ('LAGARTO - SE', 'CENTRO', 5.49, 0.99, '{}'), ('LAGARTO - SE', 'ADEMAR', 7.49, 0.99, '{}'), ('LAGARTO - SE', 'ITAPERINHA', 8.99, 0.99, '{}'),
  ('LAGARTO - SE', 'VÁRZEA', 6.49, 0.99, '{}'), ('LAGARTO - SE', 'CONJUNTO 1', 6.99, 0.99, '{}'), ('LAGARTO - SE', 'JARDIM I', 6.99, 0.99, '{}'),
  ('LAGARTO - SE', 'PARQUE REGENTE PIRINEL', 9.99, 0.99, '{}'), ('LAGARTO - SE', 'TERESÓPOLIS', 7.99, 0.99, '{}')
  on conflict do nothing`);

await t("grau: acento/maiúscula/espaço = igual; uma letra = quase; números diferentes nunca", async () => {
  igual(await grau("Várzea", "VARZEA"), "igual");
  igual(await grau("Aldemar", "ADEMAR"), "quase");
  igual(await grau("Taperinha", "ITAPERINHA"), "quase");
  igual(await grau("Terezópolis", "TERESÓPOLIS"), "quase");
  igual(await grau("Conjunto 2", "CONJUNTO 1"), null);
  igual(await grau("Jardim II", "JARDIM I"), null);
  igual(await grau("Pirinel", "PARQUE REGENTE PIRINEL"), "parecido");
  igual(await grau("Linha Verde", "RESIDENCIAL LINHA VERDE"), "parecido");
  igual(await grau("Zona Rural", "ÁREA RURAL DE ALAGOINHAS"), null);
  igual(await grau("Brejo", "Centro"), null);
});
await t("bairro novo quase igual (Aldemar) vira apelido do ADEMAR, com o valor dele", async () => {
  const r = await novo("Aldemar", 20);
  igual([r.juntado_com, r.grau, Number(r.valor)], ["ADEMAR", "quase", 7.49]);
  igual((await bairro("ADEMAR")).apelidos, ["ALDEMAR"]);
  igual(await bairro("ALDEMAR"), undefined, "não criou outro bairro");
});
await t("só acento diferente (Varzea) junta sozinho", async () => {
  const r = await novo("varzea");
  igual([r.juntado_com, r.grau], ["VÁRZEA", "igual"]);
});
await t("parecido mas duvidoso (Pirinel) pergunta antes, sem salvar nada", async () => {
  const r = await novo("Pirinel", 11);
  igual([r.precisa_confirmar, r.parecido.nome, r.parecido.grau], [true, "PARQUE REGENTE PIRINEL", "parecido"]);
  igual(await bairro("PIRINEL"), undefined);
});
await t("“é o mesmo” junta ao escolhido; “é outro” cria e o par não volta para a lista", async () => {
  const p = (await bairro("PARQUE REGENTE PIRINEL")).id;
  const r = await novo("Pirinel", 11, { p_decisao: "juntar", p_juntar_com: p });
  igual([r.juntado_com, Number(r.valor)], ["PARQUE REGENTE PIRINEL", 9.99]);
  const s = await novo("Residencial Teresopolis Sul", 12);
  igual(s.precisa_confirmar, true, "pergunta (TERESÓPOLIS)");
  const c = await novo("Residencial Teresopolis Sul", 12, { p_decisao: "separado", p_juntar_com: s.parecido.id });
  igual([c.nome, Number(c.valor)], ["RESIDENCIAL TERESOPOLIS SUL", 12]);
  const pares = await rpc(admin, "bairros_parecidos", { p_cidade: "LAGARTO - SE" });
  igual(pares.some((x) => [x.a.nome, x.b.nome].includes("RESIDENCIAL TERESOPOLIS SUL")), false, "par marcado como diferente some da lista");
});
await t("números diferentes viram bairros separados (Conjunto 2 cria um novo)", async () => {
  const r = await novo("Conjunto 2", 7.5);
  igual([r.juntado_com, r.precisa_confirmar, r.nome], [undefined, undefined, "CONJUNTO 2"]);
});
await t("lista de parecidos já cadastrados e juntar dois deles (fica o valor do escolhido)", async () => {
  await db.query("insert into bairros (cidade, nome, valor, taxa_log) values ('LAGARTO - SE', 'CENTRU', 4.00, 0.99)");
  const pares = await rpc(sup, "bairros_parecidos", { p_cidade: "LAGARTO - SE" });
  const par = pares.find((x) => [x.a.nome, x.b.nome].sort().join() === "CENTRO,CENTRU");
  igual(par?.grau, "quase");
  await falha(rpc(sup, "juntar_bairros", { p_manter: par.a.id, p_juntar: par.b.id }));
  const centro = par.a.nome === "CENTRO" ? par.a : par.b, errado = par.a.nome === "CENTRO" ? par.b : par.a;
  const r = await rpc(admin, "juntar_bairros", { p_manter: centro.id, p_juntar: errado.id });
  igual([r.nome, Number(r.valor), r.apelidos.includes("CENTRU")], ["CENTRO", 5.49, true]);
  igual((await bairro("CENTRU")).ativo, false);
});
await t("o ajuste de bairro aceita o nome com erro pequeno (Taperinha → ITAPERINHA)", async () => {
  const r = await rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "centro", p_real: "Taperinha",
    p_id_app: "taper001", p_nome: "Teste Taperinha", p_origem: "qd" });
  igual([r.bairro_real, Number(r.valor)], ["ITAPERINHA", 3.5]);   // (8,99 − 0,99) − (5,49 − 0,99)
});
await t("suporte não cadastra bairro", async () => {
  await falha(rpc(sup, "salvar_bairro", { p_id: null, p_cidade: "LAGARTO - SE", p_nome: "Novo", p_valor: 6, p_taxa_log: 1 }));
});

console.log(`\n${n - falhas}/${n} ok`);
await db.end();
process.exit(falhas ? 1 : 0);
