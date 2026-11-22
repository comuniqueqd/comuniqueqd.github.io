// Testes da 009z6 (supabase/009z6-pedidos-fora-do-limite.sql): pedidos vindos do Tableau, sinais (chegada na loja,
// acima de 45 min, finalização tardia), causa, rota com vários pedidos, decidir (restrição ou descarte), juntar à
// restrição do dia, reabrir, guarda de 20 dias e quem pode o quê. Carrega TODAS as migrações (o banco de hoje).
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node pedidos.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { carregarBanco, liberarParaTestes } from "./carregar-banco.mjs";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
await carregarBanco(url);
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("set client_min_messages = warning");
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z6-pedidos-fora-do-limite.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z7-guarda-7-dias.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z8-pedidos-limpeza-por-semana.sql", import.meta.url), "utf8"));
await liberarParaTestes(db);

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const mod = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("monitor.ped@x.com", "Monitor Pedidos");
const sup = pessoa("suporte.ped@x.com", "Suporte Pedidos");
const fora = pessoa("fora.ped@x.com", "Sem Restrições");
async function rpc(quem, fn, args = {}) {
  const nomes = Object.keys(args);
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: quem.sub, email: quem.email, role: "authenticated" })]);
    const { rows } = await db.query(`select public.${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`,
      Object.values(args).map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v)));
    await db.query("commit");
    return rows[0].r;
  } catch (e) { await db.query("rollback"); throw e; }
}
let n = 0, falhas = 0;
async function t(nome, fn) { n++; try { await fn(); console.log("ok    ", nome); } catch (e) { falhas++; console.log("FALHOU", nome, "→", e.message); } }
const igual = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
const verdade = (c, msg) => { if (!c) throw new Error(msg); };
const erro = async (p, trecho) => { try { await p; } catch (e) { if (!e.message.includes(trecho)) throw new Error("erro diferente: " + e.message); return; } throw new Error("devia falhar: " + trecho); };
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0];

await rpc(mod, "entrar");
await db.query("update membros set papel_bloqueios = 'moderador' where email = $1", [mod.email]);
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [fora, "suporte", null]]) {
  await db.query("insert into membros (email, nome, papel, papel_bloqueios) values ($1, $2, $3, $4) on conflict do nothing", [p.email, p.nome, pa, pb]);
  await rpc(p, "entrar");
}
await db.query("insert into cidades (nome) values ('LAGARTO - SE') on conflict do nothing");

// um dia de Lagarto (horário de Brasília, -03:00), há 2 dias, tempos em minutos a partir do chamado
const dia = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 2, 'YYYY-MM-DD') d")).d;
const h = (min) => { const b = new Date(`${dia}T12:00:00-03:00`); return new Date(b.getTime() + min * 60000).toISOString(); };
const ped = (id, e, m) => ({ entrega_id: id, codigo: id.slice(-6).toUpperCase(), cidade: "LAGARTO - SE", loja: m.loja || "Loja Teste",
  chamado_em: h(m.c ?? 0), aceite_em: m.a == null ? null : h(m.a), chegou_em: m.l == null ? null : h(m.l), saiu_em: m.s == null ? null : h(m.s),
  entregue_em: m.e == null ? null : h(m.e), finalizado_em: m.f == null ? null : h(m.f),
  entregador_nome: e.nome, entregador_id: e.id ?? null, entregador_situacao: e.sit || (e.id ? "ok" : "sem_id"), entregador_opcoes: e.opcoes || [] });
const ana = { nome: "Ana Entregadora", id: "ana0001" }, bia = { nome: "Bia Entregadora", id: "bia0002" }, cai = { nome: "Caio Rota", id: "cai0003" };
const dup = { nome: "Duda Igual", id: null, sit: "escolher", opcoes: [{ id: "dud0004", cidade: "LAGARTO" }, { id: "dud0005", cidade: "LAGARTO" }] };
const itens = [
  { ...ped("pedido000001", ana, { a: 1, l: 20, s: 22, e: 30, f: 31 }), distancia_m: 1506 },          // chegou na loja 19 min após aceitar → atenção
  ped("pedido000002", bia, { a: 2, l: 8, s: 10, e: 50, f: 51, loja: "Outra Loja" }),  // 50 min no total, entrega 48 min sozinho → entregador
  ped("pedido000003", cai, { a: 1, l: 5, s: 6, e: 46, f: 47 }),            // rota com o 4 (saíram juntos) → causa rota
  ped("pedido000004", cai, { a: 1, l: 5, s: 8, e: 20, f: 21 }),            // dentro do limite (só serve para a rota)
  ped("pedido000005", ana, { c: 60, a: 75, l: 80, s: 82, e: 107, f: 108 }),         // 47 min, demorou para aceitar → causa aceite (info)
  ped("pedido000006", bia, { c: 120, a: 121, l: 125, s: 126, e: 140, f: 165 }),            // finalizou 25 min depois de entregar → finalização tardia
  ped("pedido000007", dup, { a: 1, l: 18, s: 20, e: 28, f: 29 }),          // chegada > 15, ID a escolher
  ped("pedido000008", ana, { a: 1, l: 5, s: 6, e: 15, f: 16 }),            // normal, sem sinal
];

await t("Só o moderador das restrições envia os pedidos; quem não tem o módulo nem vê", async () => {
  await erro(rpc(mon, "importar_pedidos", { p_itens: itens }), "");
  await erro(rpc(sup, "importar_pedidos", { p_itens: itens }), "");
  await erro(rpc(fora, "listar_pedidos", {}), "módulo");
  const r = await rpc(mod, "importar_pedidos", { p_itens: itens });
  igual(r.gravados, 8, "gravados");
});

await t("Ao fechar a importação: sinais, causa e rota calculados como na regra", async () => {
  const r = await rpc(mod, "fechar_importacao_pedidos", { p_de: h(-60), p_ate: h(600) });
  igual([r.pedidos, r.com_sinal, r.atencao, r.chegada, r.total, r.finalizacao, r.sem_id], [8, 6, 3, 2, 3, 1, 1], "resumo");
  const p = Object.fromEntries((await db.query("select entrega_id, causa, atencao, rota_n, sinal_chegada, sinal_total, sinal_finalizacao, tem_sinal from pedidos_log")).rows.map((x) => [x.entrega_id, x]));
  igual([p.pedido000001.sinal_chegada, p.pedido000001.atencao], [true, true], "1: chegada");
  igual([p.pedido000002.causa, p.pedido000002.atencao], ["entregador", true], "2: entregador");
  igual([p.pedido000003.causa, p.pedido000003.rota_n, p.pedido000003.atencao], ["rota", 2, false], "3: rota");
  igual([p.pedido000005.causa, p.pedido000005.atencao], ["aceite", false], "5: aceite");
  igual([p.pedido000006.sinal_finalizacao, p.pedido000006.sinal_total, p.pedido000006.atencao], [true, false, false], "6: finalização");
  igual(p.pedido000008.tem_sinal, false, "8: normal");
});

await t("Números do topo, filtro 'a demora não foi do entregador', sugestão e distância", async () => {
  const r = await rpc(sup, "listar_pedidos", {});
  igual(r.numeros, { loja: 2, total: 3, chegada: 2, pedidos: 8, esperando: 5, confirmados: 0, descartados: 0 }, "números");
  const l = await rpc(sup, "listar_pedidos", { p_tipo: "loja" });
  igual(l.itens.map((i) => i.entrega_id).sort(), ["pedido000003", "pedido000005"], "rota e aceite");
  const ana = r.itens.find((i) => i.entrega_id === "pedido000001");
  igual([ana.sugestao.ocorrencia, ana.sugestao.janela_dias, ana.sugestao.infracao], [1, 60, "Atraso na Coleta ou na Entrega Sem Justificativa"], "sugestão");
  igual(r.itens.find((i) => i.entrega_id === "pedido000007").sugestao, null, "sem ID, sem sugestão");
  igual(Number((await um("select pedidos from pedidos_dia where cidade = 'LAGARTO - SE'")).pedidos), 8, "pedidos do dia");
});

await t("Reenviar os mesmos pedidos não duplica", async () => {
  await rpc(mod, "importar_pedidos", { p_itens: itens });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: h(-60), p_ate: h(600) });
  igual(Number((await um("select count(*) c from pedidos_log")).c), 8);
});

await t("A lista traz só os pedidos com sinal, os que precisam de atenção primeiro, com as contagens por tipo e situação", async () => {
  const r = await rpc(sup, "listar_pedidos", {});
  igual(r.total, 6, "total");
  igual(r.itens.slice(0, 3).every((i) => i.atencao), true, "atenção primeiro");
  igual([r.tipos.todos, r.tipos.atrasos, r.tipos.atencao, r.tipos.chegada, r.tipos.total, r.tipos.finalizacao], [6, 5, 3, 2, 3, 1], "tipos");
  igual((await rpc(sup, "listar_pedidos", { p_tipo: "atrasos" })).total, 5, "atrasos = chegada ou 45 min");
  igual(r.situacoes, { todos: 6, a_decidir: 6, restricao: 0, descartado: 0 }, "situações");
  igual(r.cidades, ["LAGARTO - SE"], "cidades");
  igual(r.regras.infracao, "Atraso na Coleta ou na Entrega Sem Justificativa", "infração");
  verdade(!("importado_por" in r.itens[0]) && !("decidido_por" in r.itens[0]), "não expõe uuid de quem importou/decidiu");
  const so = await rpc(sup, "listar_pedidos", { p_tipo: "chegada" });
  igual(so.itens.map((i) => i.entrega_id).sort(), ["pedido000001", "pedido000007"], "filtro chegada");
  igual((await rpc(sup, "listar_pedidos", { p_loja: "Outra Loja" })).total, 1, "filtro loja");
  igual((await rpc(sup, "listar_pedidos", { p_busca: "bia0002" })).total, 2, "busca por ID");
  igual((await rpc(sup, "listar_pedidos", { p_de: dia, p_ate: dia })).total, 6, "período");
});

let bloq;
await t("Confirmar restrição: registra a restrição de atraso com o pedido no comentário e marca o pedido", async () => {
  const prep = await rpc(sup, "preparar_restricao_pedido", { p_entrega_id: "pedido000001", p_id_app: "ana0001" });
  igual(prep.infracao.nome, "Atraso na Coleta ou na Entrega Sem Justificativa");
  igual(prep.previa.ocorrencia, 1, "1ª ocorrência");
  igual(prep.juntar, null, "nada para juntar");
  const r = await rpc(sup, "pedido_virar_restricao", { p_entrega_id: "pedido000001", p_id_app: "ana0001", p_nome: "Ana Entregadora",
    p_cidade: "LAGARTO - SE", p_comentario: "Pedido 000001: chegou na loja 19 min depois de aceitar." });
  bloq = r.id;
  const b = await um("select id_app, infracao_id, registrado_por_nome from bloqueios where id = $1", [bloq]);
  igual([b.id_app, b.registrado_por_nome], ["ana0001", "Suporte Pedidos"]);
  const p = await um("select decisao, bloqueio_id, decidido_por_nome from pedidos_log where entrega_id = 'pedido000001'");
  igual([p.decisao, p.bloqueio_id, p.decidido_por_nome], ["restricao", bloq, "Suporte Pedidos"]);
  const c = await um("select texto from comentarios_entregador where bloqueio_id = $1 and tipo = 'comentario'", [bloq]);
  verdade(c && c.texto.includes("19 min"), "comentário com o pedido");
});

await t("Quem chega depois vê que já foi decidido, e por quem", async () => {
  await erro(rpc(mon, "pedido_virar_restricao", { p_entrega_id: "pedido000001", p_id_app: "ana0001", p_nome: "Ana Entregadora", p_cidade: "LAGARTO - SE" }), "já foi decidido por Suporte Pedidos");
  await erro(rpc(mon, "descartar_pedido", { p_entrega_id: "pedido000001", p_motivo: "loja" }), "já foi decidido");
});

await t("Outro pedido do mesmo entregador no mesmo dia: a prévia oferece juntar, e juntar não cria outra restrição", async () => {
  const prep = await rpc(mon, "preparar_restricao_pedido", { p_entrega_id: "pedido000005", p_id_app: "ana0001" });
  igual([prep.juntar.id, prep.juntar.pedidos], [bloq, 1], "juntar");
  // registrar outra logo em seguida esbarra na trava de 10 min do registro
  await erro(rpc(mon, "pedido_virar_restricao", { p_entrega_id: "pedido000005", p_id_app: "ana0001", p_nome: "Ana Entregadora", p_cidade: "LAGARTO - SE" }), "há poucos minutos");
  const r = await rpc(mon, "pedido_virar_restricao", { p_entrega_id: "pedido000005", p_id_app: "ana0001", p_nome: "Ana Entregadora",
    p_cidade: "LAGARTO - SE", p_comentario: "Pedido 000005 juntado.", p_juntar: true });
  igual([r.id, r.juntado], [bloq, true]);
  igual(Number((await um("select count(*) c from bloqueios where id_app = 'ana0001'")).c), 1, "uma restrição só");
  igual(Number((await um("select count(*) c from pedidos_log where bloqueio_id = $1", [bloq])).c), 2, "dois pedidos nela");
});

await t("Pedido informativo também pode virar restrição; ID escolhido pela pessoa fica gravado", async () => {
  const r = await rpc(mon, "pedido_virar_restricao", { p_entrega_id: "pedido000007", p_id_app: "dud0005", p_nome: "Duda Igual", p_cidade: "LAGARTO - SE" });
  const p = await um("select entregador_id, entregador_situacao from pedidos_log where entrega_id = 'pedido000007'");
  igual([p.entregador_id, p.entregador_situacao], ["dud0005", "ok"]);
  verdade(r.id, "restrição criada");
});

await t("Descartar pede o motivo (e o texto em 'Outro') e guarda quem decidiu", async () => {
  await erro(rpc(sup, "descartar_pedido", { p_entrega_id: "pedido000003", p_motivo: "nada" }), "Escolha o motivo");
  await erro(rpc(sup, "descartar_pedido", { p_entrega_id: "pedido000003", p_motivo: "outro" }), "Escreva o motivo");
  await rpc(sup, "descartar_pedido", { p_entrega_id: "pedido000003", p_motivo: "rota" });
  const p = await um("select decisao, motivo, decidido_por_nome from pedidos_log where entrega_id = 'pedido000003'");
  igual([p.decisao, p.motivo, p.decidido_por_nome], ["descartado", "Rota com vários pedidos", "Suporte Pedidos"]);
  const r = await rpc(sup, "listar_pedidos", { p_situacao: "descartado" });
  igual(r.itens.map((i) => i.entrega_id), ["pedido000003"]);
  igual(r.situacoes, { todos: 6, a_decidir: 2, restricao: 3, descartado: 1 }, "situações");
});

await t("Reenviar o arquivo não desfaz uma decisão", async () => {
  await rpc(mod, "importar_pedidos", { p_itens: itens });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: h(-60), p_ate: h(600) });
  const p = await um("select decisao, entregador_id from pedidos_log where entrega_id = 'pedido000007'");
  igual([p.decisao, p.entregador_id], ["restricao", "dud0005"]);
});

await t("Só o moderador reabre uma decisão", async () => {
  await erro(rpc(mon, "reabrir_pedido", { p_entrega_id: "pedido000003" }), "");
  const lista = await rpc(mod, "listar_pedidos", { p_situacao: "descartado" });
  igual(lista.itens[0].pode_reabrir, true, "moderador vê o botão");
  igual((await rpc(mon, "listar_pedidos", { p_situacao: "descartado" })).itens[0].pode_reabrir, false, "monitorador não");
  await rpc(mod, "reabrir_pedido", { p_entrega_id: "pedido000003" });
  igual((await um("select decisao from pedidos_log where entrega_id = 'pedido000003'")).decisao, null);
});

await t("Pedidos sem sinal são apagados depois de 7 dias (009z7); os com sinal ficam", async () => {
  igual(Number((await um("select guardar_dias from parametros_pedidos")).guardar_dias), 7, "guarda");
  const velho = (min) => new Date(Date.now() - 9 * 86400000 + min * 60000).toISOString();
  await rpc(mod, "importar_pedidos", { p_itens: [
    { entrega_id: "velho0000001", cidade: "LAGARTO - SE", chamado_em: velho(0), aceite_em: velho(1), chegou_em: velho(5), saiu_em: velho(6), entregue_em: velho(15), finalizado_em: velho(16), entregador_nome: "Ana Entregadora" },
    { entrega_id: "velho0000002", cidade: "LAGARTO - SE", chamado_em: velho(0), aceite_em: velho(1), chegou_em: velho(25), saiu_em: velho(26), entregue_em: velho(35), finalizado_em: velho(36), entregador_nome: "Bia Entregadora" }] });
  const r = await rpc(mod, "fechar_importacao_pedidos", { p_de: velho(-60), p_ate: velho(600) });
  igual(r.apagados, 1, "apagou o normal");
  igual((await db.query("select entrega_id from pedidos_log where entrega_id like 'velho%'")).rows.map((x) => x.entrega_id), ["velho0000002"]);
});

await t("009z8: envio de várias semanas antigas fechado uma semana por vez não apaga as semanas ainda não calculadas", async () => {
  const em = (dias, min) => new Date(Date.now() - dias * 86400000 + min * 60000).toISOString();
  // semana A (40 dias atrás) e semana B (30 dias atrás): um pedido com atraso e um normal em cada
  const p = (id, dias, chegada) => ({ entrega_id: id, cidade: "LAGARTO - SE", entregador_nome: "Semana Teste " + id.slice(-1),
    chamado_em: em(dias, 0), aceite_em: em(dias, 1), chegou_em: em(dias, 1 + chegada), saiu_em: em(dias, 2 + chegada),
    entregue_em: em(dias, 10 + chegada), finalizado_em: em(dias, 11 + chegada) });
  await rpc(mod, "importar_pedidos", { p_itens: [p("semanaA00001", 40, 20), p("semanaA00002", 40, 3), p("semanaB00003", 30, 20), p("semanaB00004", 30, 3)] });
  // como o site faz: 1ª semana, depois a 2ª
  await rpc(mod, "fechar_importacao_pedidos", { p_de: em(43, 0), p_ate: em(36, 0) });
  igual((await db.query("select entrega_id from pedidos_log where entrega_id like 'semana%' order by 1")).rows.map((x) => x.entrega_id),
    ["semanaA00001", "semanaB00003", "semanaB00004"], "depois da 1ª semana: o normal da semana A sai, a semana B fica inteira");
  await rpc(mod, "fechar_importacao_pedidos", { p_de: em(36, 0), p_ate: em(29, 0) });
  igual((await db.query("select entrega_id from pedidos_log where entrega_id like 'semana%' order by 1")).rows.map((x) => x.entrega_id),
    ["semanaA00001", "semanaB00003"], "depois da 2ª: ficam os dois com atraso");
});

await t("Não guarda CPF escrito no motivo", async () => {
  await rpc(sup, "descartar_pedido", { p_entrega_id: "pedido000002", p_motivo: "outro", p_texto: "cliente CPF 123.456.789-09 ausente" });
  verdade(!(await um("select motivo from pedidos_log where entrega_id = 'pedido000002'")).motivo.includes("123.456"), "CPF ficou");
});

await t("Funções internas não são chamáveis pela API", async () => {
  for (const f of ["classificar_pedidos", "json_pedido", "minutos_entre"]) {
    const r = await um(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) pode from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1`, [f]);
    igual(r.pode, false, f);
  }
});

await db.end();
console.log(`\n${n - falhas}/${n} testes passaram`);
process.exit(falhas ? 1 : 0);
