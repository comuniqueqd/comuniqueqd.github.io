// Testes da 009a (regras da política) e da 009b (supabase/009b-ferramentas-financeiro.sql):
// tarifas dos bairros, calculadora/ajuste de bairro, adicionais, pendentes, avisos e resumo.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node financeiro.test.mjs
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
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql",
  // rodar de novo não pode quebrar
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");     // monitoradora, responsável por LAGARTO
const sup = pessoa("eduarda@x.com", "Eduarda");       // suporte
const sup2 = pessoa("lucas@x.com", "Lucas");          // suporte

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
const novos = async (p) => (await db.query("select n.texto, n.categoria, n.motivo, n.link from notificacoes n join membros m on m.user_id = n.para where m.email = $1 and n.id > $2 order by n.id", [p.email, ultimo.id])).rows;
const num = (x) => Number(x);

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", "suporte"]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, sup2]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
// bairros de teste (a lista real entra por SQL privado)
await db.query(`insert into bairros (cidade, nome, valor, taxa_log, apelidos) values
  ('LAGARTO - SE', 'CENTRO', 5.49, 0.99, '{}'), ('LAGARTO - SE', 'BREJO', 16.99, 0.99, '{}'),
  ('LAGARTO - SE', 'ADEMAR DE CARVALHO', 5.49, 0.99, '{ALDEMAR DE CARVALHO}'), ('LAGARTO - SE', 'SÍLVIO ROMERO', 5.49, 0.69, '{}')
  on conflict do nothing`);

await t("009a: as horas seguem a política, com +30% a partir da 3ª", async () => {
  const h = async (nome) => (await db.query(`select array[horas_previstas(i,1), horas_previstas(i,2), horas_previstas(i,3)]::text[] a from infracoes i where nome = $1`, [nome])).rows[0].a;
  igual(await h("Mal Uso Proposital do Aplicativo"), ["1.00", "1.00", "1"]);
  igual(await h("Reabrir Pedido Após Aceite Sem Justificativa Plausível"), ["1.00", "24.00", "31"]);
  igual(await h("Avaria de Produto"), ["24.00", "168.00", "218"]);
  igual(await h("Finalização Falsa de Entrega"), ["168.00", null, null]);
  igual(await h("Fraude Documental"), [null, null, null]);
});

await t("tarifas: todos consultam, com o que o entregador recebe; só o moderador edita", async () => {
  const r = await rpc(sup, "tarifas_bairros");
  igual(r.pode_editar, false);
  const c = r.bairros.find((b) => b.nome === "CENTRO");
  igual([num(c.valor), num(c.taxa_log), num(c.recebe)], [5.49, 0.99, 4.5]);
  igual((await rpc(admin, "tarifas_bairros")).pode_editar, true);
  await falha(rpc(sup, "salvar_bairro", { p_id: null, p_cidade: "LAGARTO - SE", p_nome: "Novo", p_valor: 6, p_taxa_log: 1 }), "não permite");
});

await t("salvar bairro: cria em maiúsculas; recusa nome repetido, apelido de outro e taxa maior que o valor", async () => {
  const b = await rpc(admin, "salvar_bairro", { p_id: null, p_cidade: "LAGARTO - SE", p_nome: "  horta  ", p_valor: 5.99, p_taxa_log: 0.99, p_apelidos: ["hortinha"] });
  igual([b.nome, b.apelidos], ["HORTA", ["HORTINHA"]]);
  await falha(rpc(admin, "salvar_bairro", { p_id: null, p_cidade: "LAGARTO - SE", p_nome: "centro", p_valor: 6, p_taxa_log: 1 }), "Já existe");
  await falha(rpc(admin, "salvar_bairro", { p_id: null, p_cidade: "LAGARTO - SE", p_nome: "Aldemar de Carvalho", p_valor: 6, p_taxa_log: 1 }), "Já existe");
  await falha(rpc(admin, "salvar_bairro", { p_id: null, p_cidade: "LAGARTO - SE", p_nome: "Teste", p_valor: 1, p_taxa_log: 2 }), "negativo");
  const e = await rpc(admin, "salvar_bairro", { p_id: b.id, p_cidade: "LAGARTO - SE", p_nome: "Horta", p_valor: 6.49, p_taxa_log: 0.99, p_apelidos: [] });
  igual([num(e.recebe), e.apelidos], [5.5, []]);
});

let ajuste;
await t("ajuste de bairro: diferença do que o entregador recebe, com os valores gravados", async () => {
  ajuste = await rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "centro", p_real: "BREJO",
    p_id_app: "fin00001", p_nome: "Zé das Entregas", p_origem: "qd" });
  igual([ajuste.tipo, ajuste.bairro_informado, ajuste.bairro_real, num(ajuste.recebe_informado), num(ajuste.recebe_real), num(ajuste.valor), ajuste.lancado, ajuste.meu],
        ["ajuste_bairro", "CENTRO", "BREJO", 4.5, 16, 11.5, false, true]);
  // mudar a tarifa depois não muda o ajuste
  const brejo = (await rpc(admin, "tarifas_bairros")).bairros.find((b) => b.nome === "BREJO");
  await rpc(admin, "salvar_bairro", { p_id: brejo.id, p_cidade: "LAGARTO - SE", p_nome: "BREJO", p_valor: 20.99, p_taxa_log: 0.99 });
  igual(num((await um("select valor from lancamentos_financeiros where id = $1", [ajuste.id])).valor), 11.5);
});

await t("ajuste de bairro: acha pelo apelido; bairro igual ou desconhecido é recusado; negativo vira zero", async () => {
  const r = await rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "Aldemar de Carvalho", p_real: "Sílvio Romero",
    p_id_app: "fin00002", p_nome: "Maria Teste", p_origem: "outros", p_lancado: true });
  igual([r.bairro_informado, num(r.recebe_real), num(r.valor), r.lancado, r.lancado_por_nome], ["ADEMAR DE CARVALHO", 4.8, 0.3, true, "Eduarda"]);
  await falha(rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "centro", p_real: "Centro", p_id_app: "fin00002", p_nome: "M", p_origem: "qd" }), "iguais");
  await falha(rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "Lua", p_real: "Centro", p_id_app: "fin00002", p_nome: "M", p_origem: "qd" }), "não encontrado");
  await falha(rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "Brejo", p_real: "Centro", p_id_app: "fin00002", p_nome: "M", p_origem: null }), "QD ou outros");
  const neg = await rpc(sup, "registrar_ajuste_bairro", { p_cidade: "LAGARTO - SE", p_informado: "Brejo", p_real: "Centro", p_id_app: "fin00002", p_nome: "M", p_origem: "qd", p_lancado: true });
  igual(num(neg.valor), 0);
});

let adic;
await t("adicional: valor = combinado − entrega; o nome vem da ficha quando não é digitado", async () => {
  await rpc(sup, "cadastrar_entregador", { p_id_app: "fic00001", p_nome: "Joana da Ficha", p_cidade: "LAGARTO - SE", p_comentario: null });
  adic = await rpc(sup, "registrar_adicional", { p_cidade: null, p_id_app: "FIC00001", p_nome: null, p_origem: "qd", p_mercado: true,
    p_motivo: "Pedido grande", p_valor_entrega: 6, p_valor_pedido: 180, p_valor_combinado: 15 });
  igual([adic.tipo, adic.nome_entregador, adic.cidade, num(adic.valor), adic.mercado, adic.lancado], ["adicional", "Joana da Ficha", "LAGARTO - SE", 9, true, false]);
  await falha(rpc(sup, "registrar_adicional", { p_cidade: "LAGARTO - SE", p_id_app: "fic00001", p_nome: null, p_origem: "qd", p_mercado: false,
    p_motivo: "Chuva", p_valor_entrega: 10, p_valor_pedido: 50, p_valor_combinado: 10 }), "maior que o valor da entrega");
  await falha(rpc(sup, "registrar_adicional", { p_cidade: "LAGARTO - SE", p_id_app: "fic00001", p_nome: null, p_origem: "qd", p_mercado: null,
    p_motivo: "Chuva", p_valor_entrega: 5, p_valor_pedido: 50, p_valor_combinado: 10 }), "mercado");
  await falha(rpc(sup, "registrar_adicional", { p_cidade: "LAGARTO - SE", p_id_app: "x1", p_nome: "A", p_origem: "qd", p_mercado: false,
    p_motivo: "Chuva", p_valor_entrega: 5, p_valor_pedido: 50, p_valor_combinado: 10 }), "ID do entregador");
});

await t("aviso: a responsável da cidade recebe (categoria financeiro); quem registrou não; dá para silenciar", async () => {
  await marca();
  await rpc(sup2, "registrar_adicional", { p_cidade: "LAGARTO - SE", p_id_app: "fin00003", p_nome: "Pedro Teste", p_origem: "outros", p_mercado: false,
    p_motivo: "Chuva", p_valor_entrega: 5, p_valor_pedido: 40, p_valor_combinado: 8 });
  const m = await novos(mon);
  igual([m.length, m[0]?.categoria, m[0]?.motivo, m[0]?.link], [1, "financeiro", "cidade", "#financeiro/lancamentos"]);
  if (!m[0].texto.includes("R$ 3,00") || !m[0].texto.includes("Lucas")) throw new Error("texto: " + m[0].texto);
  igual((await novos(sup2)).length, 0, "quem registrou:");
  igual((await novos(admin)).length, 1, "moderador:");
  await rpc(mon, "salvar_preferencias", { p_silenciados: ["financeiro"] });
  await marca();
  await rpc(sup2, "registrar_adicional", { p_cidade: "LAGARTO - SE", p_id_app: "fin00003", p_nome: "Pedro Teste", p_origem: "qd", p_mercado: false,
    p_motivo: "Distância", p_valor_entrega: 5, p_valor_pedido: 40, p_valor_combinado: 7, p_lancado: true });
  igual((await novos(mon)).length, 0, "silenciado:");
  await falha(rpc(mon, "salvar_preferencias", { p_silenciados: ["qualquer"] }), "desconhecido");
});

await t("pendentes: cada um vê só os seus não lançados; qualquer pessoa marca como lançado", async () => {
  const p = await rpc(sup, "listar_lancamentos", { p_pendentes: true, p_meus: true });
  igual(p.itens.map((x) => x.id_app).sort(), ["FIC00001", "fin00001"]);
  igual((await rpc(sup, "resumo_e_avisos")).resumo.financeiro_pendentes, 2);
  igual((await rpc(sup2, "resumo_e_avisos")).resumo.financeiro_pendentes, 1);
  const r = await rpc(mon, "marcar_lancado", { p_id: ajuste.id });
  igual([r.lancado, r.lancado_por_nome, r.meu], [true, "Jocimara", false]);
  igual((await rpc(sup, "resumo_e_avisos")).resumo.financeiro_pendentes, 1);
  igual((await rpc(sup, "marcar_lancado", { p_id: ajuste.id, p_lancado: false })).lancado, false, "desfazer:");
  await rpc(sup, "marcar_lancado", { p_id: ajuste.id });
  igual((await rpc(sup2, "listar_lancamentos", {})).itens.length, 6, "lista geral (todos os registros):");
});

await t("resumo financeiro: totais, por cidade, pares de bairros e faixas do pedido", async () => {
  const r = await rpc(sup, "resumo_financeiro", { p_dias: 30 });
  igual([num(r.total), r.n, num(r.ajustes.total), r.ajustes.n, num(r.adicionais.total), r.adicionais.n], [25.8, 6, 11.8, 3, 14, 3]);
  igual(r.por_cidade.map((c) => [c.cidade, num(c.total)]), [["LAGARTO - SE", 25.8]]);
  igual(r.pares_bairros[0].informado, "CENTRO");
  igual(r.faixas_pedido.map((f) => [f.faixa, f.n]), [["Até R$ 50", 2], ["R$ 150 a 300", 1]]);
  igual([r.mercado.sim.n, r.mercado.nao.n, r.pendentes.n], [1, 2, 2]);
});

await t("apagar: só quem registrou ou moderador", async () => {
  await falha(rpc(sup2, "excluir_lancamento", { p_id: adic.id }), "Só quem registrou");
  await rpc(sup, "excluir_lancamento", { p_id: adic.id });
  igual((await um("select count(*)::int c from lancamentos_financeiros where id = $1", [adic.id])).c, 0);
});

await t("segurança: as tabelas não abrem direto e as funções internas não ficam expostas", async () => {
  await db.query("begin"); await db.query("set local role authenticated");
  await falha(db.query("select * from lancamentos_financeiros"), "permission denied"); await db.query("rollback");
  await db.query("begin"); await db.query("set local role authenticated");
  await falha(db.query("select * from bairros"), "permission denied"); await db.query("rollback");
  const r = await um(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p
                       where p.proname in ('achar_bairro', 'json_lancamento', 'validar_entregador_lancamento', 'aviso_lancamento', 'json_bairro')`);
  igual(r.x, false);
  await db.query("begin"); await db.query("set local role anon");
  await falha(db.query("select public.tarifas_bairros()"), "permission denied"); await db.query("rollback");
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
