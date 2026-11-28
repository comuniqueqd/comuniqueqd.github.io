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
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z9-escolher-entregador-pedido.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z10-analises-pedidos.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z11-analises-atraso-30.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z13-rota-e-bairro.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z14-limite-35.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z15-limite-30.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z16-reenvio-que-vale.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z17-mais-entregadores.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z18-monitoramento-novo.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z19-envio-que-cabe.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z20-envio-leve.sql", import.meta.url), "utf8"));
for (let i = 0; i < 2; i++) await db.query(readFileSync(new URL("../supabase/009z21-calculo-em-partes.sql", import.meta.url), "utf8"));
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
  ped("pedido000005", ana, { c: 60, a: 75, l: 80, s: 82, e: 104, f: 105 }),         // 44 min, demorou para aceitar (29 em tela) → causa aceite (info)
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
  await db.query("update parametros_pedidos set guardar_sinal_dias = 365, guardar_resumo_dias = 365 where unico");   // os testes antigos usam datas de meses atrás
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

await t("009z9: nome igual — mostra os entregadores com o nome e grava o escolhido (neste ou em todos os pedidos do nome)", async () => {
  const gemeo = { nome: "Gemeo Igual", id: "gem00001", sit: "conferir", opcoes: [{ id: "gem00001", cidade: "Lagarto" }, { id: "gem00002", cidade: "Itabaiana" }] };
  await rpc(mod, "importar_pedidos", { p_itens: [
    ped("gemeo0000001", gemeo, { c: 400, a: 401, l: 420, s: 421, e: 430, f: 431 }),
    ped("gemeo0000002", gemeo, { c: 500, a: 501, l: 520, s: 521, e: 530, f: 531 })] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: h(380), p_ate: h(560) });
  await db.query("insert into entregadores (id_app, nome, cidade) values ('gem00002', 'Gemeo Igual', 'LAGARTO - SE') on conflict do nothing");
  const o = await rpc(sup, "opcoes_entregador_pedido", { p_entrega_id: "gemeo0000001" });
  igual([o.opcoes.length, o.pedidos_mesmo_nome, o.opcoes[0].id, o.opcoes[0].atual], [2, 2, "gem00001", true], "opções, com o atual primeiro");
  igual([o.opcoes[1].ficha_nome, o.opcoes[1].cidade_tableau], ["Gemeo Igual", "Itabaiana"], "o que se sabe do outro ID");
  await erro(rpc(sup, "escolher_entregador_pedido", { p_entrega_id: "gemeo0000001", p_id_app: "x" }), "Escolha o ID");
  const r = await rpc(sup, "escolher_entregador_pedido", { p_entrega_id: "gemeo0000001", p_id_app: "gem00002", p_todos: true });
  igual(r.pedidos, 2, "os dois pedidos do nome");
  igual((await db.query("select entregador_id, entregador_situacao from pedidos_log where entrega_id like 'gemeo%' order by 1")).rows.map((x) => [x.entregador_id, x.entregador_situacao]),
    [["gem00002", "ok"], ["gem00002", "ok"]], "ID gravado e aviso some");
  await erro(rpc(sup, "escolher_entregador_pedido", { p_entrega_id: "pedido000001", p_id_app: "abcd1234" }), "já foi decidido");
  await erro(rpc(fora, "opcoes_entregador_pedido", { p_entrega_id: "gemeo0000001" }), "módulo");
});

await t("009z10: o resumo guarda o dia inteiro e a análise monta mapa, rota, entregador e causas", async () => {
  const r = await rpc(sup, "analise_pedidos", { p_dias: 60 });
  verdade(!r.vazio && r.totais.pedidos >= 8, "totais: " + JSON.stringify(r.totais));
  const dow = (await um("select extract(dow from (now() at time zone 'America/Sao_Paulo')::date - 2)::int d")).d;
  verdade(r.mapa.some((x) => x.dia === dow && x.hora === 12 && x.pedidos >= 1), "mapa com o dia e a hora dos pedidos");
  verdade(r.rota.em_rota >= 2, "pedidos 3 e 4 saíram juntos");
  const ana = r.entregador.quem.find((x) => x.id === "ana0001");
  verdade(ana && ana.casos >= 1 && ana.restricoes >= 1, "Ana aparece em quem mais repete, com a restrição registrada");
  verdade(r.causas_semana.length >= 1 && r.causas_semana.some((w) => w.entregador >= 1), "causas por semana");
  await erro(rpc(fora, "analise_pedidos", {}), "módulo");
});

await t("009z10: um dia incompleto (pedidos normais já apagados) não estraga o resumo", async () => {
  // as semanas de 40 e 30 dias atrás: 2 pedidos cada; depois da limpeza ficou só o com atraso
  const antes = await um("select sum(pedidos)::int n from pedidos_resumo where dia = (now() at time zone 'America/Sao_Paulo')::date - 30");
  igual(antes.n, 2, "o resumo contou os 2 pedidos do dia");
  await db.query("select resumir_pedidos(now() - interval '45 days', now() - interval '25 days')");
  igual((await um("select sum(pedidos)::int n from pedidos_resumo where dia = (now() at time zone 'America/Sao_Paulo')::date - 30")).n, 2, "refazer com 1 pedido não troca o resumo de 2");
});

await t("009z11: a causa do atraso é a etapa que mais passou do próprio limite", async () => {
  const c = async (...v) => (await um("select causa_atraso($1, $2, $3, $4, $5, $6) c", v)).c;
  igual(await c(5, 20, 2, 25, 20, 2), "loja", "esperou 25 min na loja e saiu em rota: a loja pesou mais (15 além) que a rota (5 além)");
  igual(await c(5, 20, 2, 12, 30, 2), "rota", "rota de 30 min da loja ao cliente pesa mais que 2 min além na loja");
  igual(await c(20, 30, 2, 12, 10, 1), "entregador", "chegou 5 min além do limite");
  igual(await c(10, 30, 8, 8, 12, 2), "outras", "nenhuma etapa passou do limite: soma de pequenas demoras");
  igual(await c(null, null, 25, null, null, 1), "aceite", "25 min para alguém aceitar");
});

await t("009z11: as Análises contam atraso a partir de 30 min e deixam de fora o resumo antigo", async () => {
  const r = await rpc(sup, "analise_pedidos", { p_dias: 60 });
  igual(r.atraso_min, 30, "limite de 30 min");
  const esperado = (await um("select count(*)::int n from pedidos_log where t_total > 30 and (chamado_em at time zone 'America/Sao_Paulo')::date between $1 and $2", [r.de, r.ate])).n;
  verdade(r.totais.atraso >= 1 && r.totais.atraso <= esperado + 2, `atrasos ${r.totais.atraso} (no banco agora: ${esperado})`);
  const soma = r.causas_semana.reduce((a, w) => a + w.entregador + w.loja + w.aceite + w.rota + w.outras, 0);
  igual(soma, r.totais.atraso, "cada atraso entra numa causa só");
  verdade(r.lojas.every((l) => "espera_loja" in l && "atraso" in l), "lojas com atrasos e espera na loja");
  await db.query("update pedidos_resumo set atraso_min = null where dia = $1", [r.ate]);
  const r2 = await rpc(sup, "analise_pedidos", { p_dias: 60 });
  verdade(r2.antigos === true && (r2.vazio || r2.ate < r.ate), "o dia sem as contas novas fica de fora e o aviso de reenviar aparece");
  await db.query("select resumir_pedidos(now() - interval '60 days', now())");
});

await t("009z15: a rota diz quem chegou tarde na loja, separado do total", async () => {
  const d1 = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 1, 'YYYY-MM-DD') d")).d;
  const h1 = (min) => new Date(new Date(`${d1}T17:00:00-03:00`).getTime() + min * 60000).toISOString();
  const rr = (id, m) => ({ entrega_id: id, codigo: id.slice(-6).toUpperCase(), cidade: "LAGARTO - SE", loja: "Loja Chegada", bairro: "CENTRO",
    chamado_em: h1(m.c), aceite_em: h1(m.c + 1), chegou_em: h1(m.ch), saiu_em: h1(30), entregue_em: h1(m.e), finalizado_em: h1(m.e + 1),
    entregador_nome: "Caio Chegada", entregador_id: "caio0015", entregador_situacao: "ok", entregador_opcoes: [] });
  // o 1º foi aceito cedo e ele levou 20 min para chegar na loja (total 26 min); o 2º passou do total (50 min)
  await rpc(mod, "importar_pedidos", { p_itens: [rr("chegped00001", { c: 10, ch: 31, e: 36 }), rr("chegped00002", { c: 0, ch: 10, e: 50 })] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d1}T00:00:00-03:00`, p_ate: `${d1}T23:59:59-03:00` });
  const r = (await um("select rota_pedidos from pedidos_log where entrega_id = 'chegped00002'")).rota_pedidos;
  const um1 = r.find((x) => x.entrega_id === "chegped00001"), dois = r.find((x) => x.entrega_id === "chegped00002");
  verdade(um1.chegada === true && Number(um1.t_chegada) === 20 && Number(um1.t_total) === 26, "o de 26 min aparece como chegou tarde na loja (20 min)");
  verdade(dois.chegada === false, "o que passou só do total não é marcado como chegada tarde");
});

await t("009z13: guarda o bairro em maiúsculas e a rota de quem saiu junto, mesmo depois da limpeza", async () => {
  const d1 = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 1, 'YYYY-MM-DD') d")).d;
  const h1 = (min) => new Date(new Date(`${d1}T15:00:00-03:00`).getTime() + min * 60000).toISOString();
  const rr = (id, m, bairro) => ({ entrega_id: id, codigo: id.slice(-6).toUpperCase(), cidade: "LAGARTO - SE", loja: "Loja Rota", bairro,
    chamado_em: h1(0), aceite_em: h1(1), chegou_em: h1(4), saiu_em: h1(m.s), entregue_em: h1(m.e), finalizado_em: h1(m.e + 1),
    entregador_nome: "Rui Rota", entregador_id: "rui0009", entregador_situacao: "ok", entregador_opcoes: [] });
  await rpc(mod, "importar_pedidos", { p_itens: [rr("rotaped00001", { s: 6, e: 14 }, "  centro   novo "), rr("rotaped00002", { s: 7, e: 22 }, "Brejo"),
    rr("rotaped00003", { s: 8, e: 50 }, "brejo")] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d1}T00:00:00-03:00`, p_ate: `${d1}T23:59:59-03:00` });
  const p3 = await um("select bairro, rota_pedidos from pedidos_log where entrega_id = 'rotaped00003'");
  igual(p3.bairro, "BREJO", "bairro em maiúsculas");
  igual((await um("select bairro from pedidos_log where entrega_id = 'rotaped00001'")).bairro, "CENTRO NOVO", "espaços juntados");
  igual(p3.rota_pedidos.map((x) => x.entrega_id), ["rotaped00001", "rotaped00002", "rotaped00003"], "os três, na ordem da entrega");
  igual(p3.rota_pedidos.map((x) => x.bairro), ["CENTRO NOVO", "BREJO", "BREJO"]);
  igual(p3.rota_pedidos.map((x) => x.chegada), [false, false, false], "009z15: ninguém chegou tarde na loja (3 min depois de aceitar)");
  await db.query("delete from pedidos_log where entrega_id in ('rotaped00001', 'rotaped00002')");
  const j = (await rpc(sup, "listar_pedidos", { p_busca: "rotaped00003" })).itens[0];
  verdade(j && j.bairro === "BREJO" && j.rota_pedidos.length === 3, "o cartão ainda mostra a rota depois que os companheiros saíram do banco");
  const rb = await um("select sum(pedidos)::int n from pedidos_resumo_bairro where dia = $1 and bairro = 'BREJO'", [d1]);
  igual(rb.n, 2, "resumo por bairro");
  const ab = await rpc(sup, "analise_pedidos_bairros", { p_dias: 30 });
  verdade(!ab.vazio && ab.pedidos >= 3 && Array.isArray(ab.bairros), "análise por bairro: " + JSON.stringify(ab).slice(0, 120));
  await erro(rpc(fora, "analise_pedidos_bairros", {}), "módulo");
});

await t("009z13: Sem chamar separa quem parou, quem está chamando menos e o parceiro ativado que ainda não chamou", async () => {
  await db.query("insert into cidades (nome) values ('ESTANCIA - SE') on conflict do nothing");
  const ref = (await um("select (now() at time zone 'America/Sao_Paulo')::date - 1 d")).d;
  const dias = (await db.query("select generate_series($1::date - 40, $1::date, '1 day')::date d", [ref])).rows.map((x) => x.d);
  for (const d of dias) {
    const k = Math.round((new Date(ref) - d) / 86400000);   // dias antes do último
    const linhas = [["Loja Viva", 3]];
    if (k >= 5) linhas.push(["Loja Parada", 2]);              // parou há 5 dias
    linhas.push(["Loja Fraca", k < 7 ? (k % 3 === 0 ? 1 : 0) : 4]);   // caiu de 28 para ~3 por semana
    for (const [loja, q] of linhas) if (q) await db.query("insert into pedidos_resumo (dia, hora, cidade, loja, pedidos, atraso_min) values ($1, 12, 'ESTANCIA - SE', $2, $3, 30)", [d, loja, q]);
  }
  await rpc(mod, "registrar_parceiro", { p_estabelecimento: "Loja Parada", p_cidade: "ESTANCIA - SE" });
  await rpc(mod, "registrar_parceiro", { p_estabelecimento: "Padaria Nova", p_cidade: "ESTANCIA - SE" });
  const s = await rpc(sup, "parceiros_sem_chamar", { p_cidade: "ESTANCIA - SE" });
  igual(s.parou.map((x) => [x.loja, x.dias, x.parceiro]), [["Loja Parada", 5, true]], "parou de chamar");
  igual(s.menos.map((x) => x.loja), ["Loja Fraca"], "chamando menos");
  igual(s.sem_pedido.map((x) => x.estabelecimento), ["Padaria Nova"], "ativado que ainda não chamou");
  verdade(!s.parou.concat(s.menos).some((x) => x.loja === "Loja Viva"), "a loja que chama todo dia não aparece");
});

await t("009z15: o Monitoramento avisa a partir de 30 min; para o entregador, 30 min com o pedido em tela", async () => {
  const rg = await rpc(sup, "regras_pedidos");
  igual([Number(rg.total_min), Number(rg.entrega_min), Number(rg.chegada_min)], [30, 30, 15], "total 30, em tela 30, coleta 15");
  const d2 = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 1, 'YYYY-MM-DD') d")).d;
  const h2 = (min) => new Date(new Date(`${d2}T18:00:00-03:00`).getTime() + min * 60000).toISOString();
  await rpc(mod, "importar_pedidos", { p_itens: [{ entrega_id: "limite35ped1", codigo: "LIM035", cidade: "LAGARTO - SE", loja: "Loja Teste",
    chamado_em: h2(0), aceite_em: h2(1), chegou_em: h2(6), saiu_em: h2(8), entregue_em: h2(40), finalizado_em: h2(41),
    entregador_nome: "Lia Limite", entregador_id: "lia0035", entregador_situacao: "ok", entregador_opcoes: [] }] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d2}T00:00:00-03:00`, p_ate: `${d2}T23:59:59-03:00` });
  const p = await um("select sinal_total, tem_sinal from pedidos_log where entrega_id = 'limite35ped1'");
  igual([p.sinal_total, p.tem_sinal], [true, true], "40 min passa do limite");
  // 33 min do chamado, 32 com o pedido em tela, saindo sozinho: atraso do entregador
  await rpc(mod, "importar_pedidos", { p_itens: [{ entrega_id: "limite30ped1", codigo: "LIM030", cidade: "LAGARTO - SE", loja: "Loja Teste",
    chamado_em: h2(100), aceite_em: h2(101), chegou_em: h2(106), saiu_em: h2(108), entregue_em: h2(133), finalizado_em: h2(134),
    entregador_nome: "Leo Limite", entregador_id: "leo0030", entregador_situacao: "ok", entregador_opcoes: [] }] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d2}T00:00:00-03:00`, p_ate: `${d2}T23:59:59-03:00` });
  const q = await um("select sinal_total, causa from pedidos_log where entrega_id = 'limite30ped1'");
  igual([q.sinal_total, q.causa], [true, "entregador"], "33 min (32 em tela, sozinho) = atraso do entregador");
});

await t("009z16: reenvio do dia inteiro com uns poucos pedidos a menos refaz o resumo; envio parcial não", async () => {
  const d = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 15, 'YYYY-MM-DD') d")).d;
  const hd = (min) => new Date(new Date(`${d}T10:00:00-03:00`).getTime() + min * 60000).toISOString();
  const rv = (i, bairro) => ({ entrega_id: `reenv${String(i).padStart(7, "0")}`, codigo: `RV${i}`, cidade: "LAGARTO - SE", loja: "Loja Reenvio", bairro,
    chamado_em: hd(i * 20), aceite_em: hd(i * 20 + 1), chegou_em: hd(i * 20 + 4), saiu_em: hd(i * 20 + 6), entregue_em: hd(i * 20 + 15), finalizado_em: hd(i * 20 + 16),
    entregador_nome: "Rita Reenvio", entregador_id: "rit0016", entregador_situacao: "ok", entregador_opcoes: [] });
  const fecha = () => rpc(mod, "fechar_importacao_pedidos", { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` });
  const resumo = async () => Number((await um("select coalesce(sum(pedidos), 0) n from pedidos_resumo where dia = $1 and cidade = 'LAGARTO - SE'", [d])).n);
  const bairro = async () => Number((await um("select coalesce(sum(pedidos), 0) n from pedidos_resumo_bairro where dia = $1 and cidade = 'LAGARTO - SE'", [d])).n);
  await rpc(mod, "importar_pedidos", { p_itens: Array.from({ length: 10 }, (_, i) => rv(i, null)) });
  await fecha();
  igual([await resumo(), await bairro()], [10, 0], "1º envio: 10 pedidos, sem bairro");
  await db.query("update pedidos_log set importado_em = now() - interval '1 day' where entrega_id like 'reenv%'");
  // reenvio do dia inteiro, agora com o bairro, mas o Tableau trouxe 9
  await rpc(mod, "importar_pedidos", { p_itens: Array.from({ length: 9 }, (_, i) => rv(i, "Centro")) });
  await fecha();
  igual([await resumo(), await bairro()], [9, 9], "reenvio com 9 de 10 refaz o dia, com o bairro");
  await db.query("update pedidos_log set importado_em = now() - interval '1 day' where entrega_id like 'reenv%'");
  // envio parcial (3 pedidos) não estraga o resumo
  await rpc(mod, "importar_pedidos", { p_itens: Array.from({ length: 3 }, (_, i) => rv(i, "Brejo")) });
  await fecha();
  igual(await resumo(), 9, "envio parcial não troca o resumo");
});

await t("009z18: cancelados entram com a etapa e um resumo próprio, sem sinal e sem mexer nos finalizados", async () => {
  const d = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 2, 'YYYY-MM-DD') d")).d;
  const hd = (min) => new Date(new Date(`${d}T19:00:00-03:00`).getTime() + min * 60000).toISOString();
  const base = (i, x) => ({ entrega_id: `canc18_${String(i).padStart(5, "0")}`, codigo: `CA${i}`, cidade: "ITABAIANA - SE", loja: "Loja Canc", bairro: "Centro",
    chamado_em: hd(i), entregador_situacao: "sem_id", entregador_opcoes: [], ...x });
  const fin = Array.from({ length: 6 }, (_, i) => base(i, { aceite_em: hd(i + 4), chegou_em: hd(i + 8), saiu_em: hd(i + 10), entregue_em: hd(i + 20),
    finalizado_em: hd(i + 21), entregador_nome: "Zé Itabaiana", entregador_id: "ze00018", entregador_situacao: "ok" }));
  const can = [base(100, { status: "cancelado" }), base(101, { status: "cancelado" }), base(102, { status: "cancelado", aceite_em: hd(110) }),
    base(103, { status: "cancelado", aceite_em: hd(110), chegou_em: hd(115) }), base(104, { status: "cancelado", aceite_em: hd(110), chegou_em: hd(115), saiu_em: hd(118), entregue_em: hd(130), finalizado_em: hd(131) })];
  const fecha = () => rpc(mod, "fechar_importacao_pedidos", { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` });
  await rpc(mod, "importar_pedidos", { p_itens: fin });
  await fecha();
  await db.query("update pedidos_log set importado_em = now() - interval '1 day' where entrega_id like 'canc18_%'");
  await rpc(mod, "importar_pedidos", { p_itens: can });
  const r = await fecha();
  igual(r.cancelados, 5, "cancelados no fechamento");
  const pd = await um("select pedidos, cancelados from pedidos_dia where dia = $1 and cidade = 'ITABAIANA - SE'", [d]);
  igual([pd.pedidos, pd.cancelados], [6, 5], "pedidos do dia");
  igual(Number((await um("select sum(pedidos) n from pedidos_resumo where dia = $1 and cidade = 'ITABAIANA - SE'", [d])).n), 6, "finalizados no resumo (envio só de cancelados não troca)");
  const et = Object.fromEntries((await db.query("select etapa, sum(n)::int n from pedidos_resumo_cancel where dia = $1 group by 1 order by 1", [d])).rows.map((x) => [x.etapa, x.n]));
  igual(et, { depois_de_entregar: 1, indo_para_loja: 1, na_loja: 1, sem_entregador: 2 }, "etapas");
  const sinal = await um("select count(*) filter (where tem_sinal)::int s from pedidos_log where entrega_id like 'canc18_01%'");
  igual(sinal.s, 0, "cancelado não tem sinal");
  // tempo até associar e tempo de entrega no resumo por hora/loja e por bairro
  const rr = await um("select sum(n_associar)::int na, sum(soma_associar)::numeric sa, sum(n_total)::int nt, sum(soma_total)::numeric st from pedidos_resumo where dia = $1 and cidade = 'ITABAIANA - SE'", [d]);
  igual([rr.na, Number(rr.sa), rr.nt, Number(rr.st)], [6, 24, 6, 120], "associar 4 min, total 20 min");
  const rb = await um("select n_associar, lojas from pedidos_resumo_bairro where dia = $1 and cidade = 'ITABAIANA - SE' and bairro = 'CENTRO'", [d]);
  igual([rb.n_associar, rb.lojas], [6, { "Loja Canc": 6 }], "bairro com as lojas");
  // reenviar os finalizados não apaga os cancelados do resumo
  await db.query("update pedidos_log set importado_em = now() - interval '1 day' where entrega_id like 'canc18_%'");
  await db.query("delete from pedidos_log where status = 'cancelado' and entrega_id like 'canc18_%'");
  await rpc(mod, "importar_pedidos", { p_itens: fin });
  await fecha();
  igual(Number((await um("select sum(n) n from pedidos_resumo_cancel where dia = $1", [d])).n), 5, "cancelados continuam");
});

await t("009z18: resumo por entregador (atrasos do entregador, chegada, em tela, finalização) e rota separada por cidade", async () => {
  const d = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 3, 'YYYY-MM-DD') d")).d;
  const hd = (min) => new Date(new Date(`${d}T11:00:00-03:00`).getTime() + min * 60000).toISOString();
  const p = (i, cidade, nome, id, m) => ({ entrega_id: `ent18_${String(i).padStart(5, "0")}`, codigo: `EN${i}`, cidade, loja: "Loja E",
    chamado_em: hd(m.c), aceite_em: hd(m.c + 1), chegou_em: hd(m.c + m.l), saiu_em: hd(m.c + m.s), entregue_em: hd(m.c + m.e), finalizado_em: hd(m.c + m.f),
    entregador_nome: nome, entregador_id: id, entregador_situacao: id ? "ok" : "sem_id", entregador_opcoes: [] });
  await rpc(mod, "importar_pedidos", { p_itens: [
    p(1, "ITABAIANA - SE", "Mesmo Nome", "mes0001", { c: 0, l: 20, s: 22, e: 28, f: 29 }),      // chegada 19 min
    p(2, "ITABAIANA - SE", "Mesmo Nome", "mes0001", { c: 60, l: 5, s: 6, e: 40, f: 41 }),       // 39 em tela sozinho + atraso
    p(3, "ITABAIANA - SE", "Mesmo Nome", "mes0001", { c: 120, l: 5, s: 6, e: 15, f: 40 }),      // finalizou 25 min depois
    p(4, "LAGARTO - SE", "Mesmo Nome", null, { c: 60, l: 3, s: 6, e: 12, f: 13 }),              // outra cidade, mesma hora de saída
  ] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` });
  const e = await um("select pedidos, atraso, at_entregador, chegada, tela, finalizou, em_rota from pedidos_resumo_entregador where dia = $1 and chave = 'mes0001'", [d]);
  igual([e.pedidos, e.atraso, e.at_entregador, e.chegada, e.tela, e.finalizou, e.em_rota], [3, 1, 2, 1, 1, 1, 0], "entregador");
  igual((await um("select rota_n from pedidos_log where entrega_id = 'ent18_00002'")).rota_n, 1, "não junta com o homônimo de outra cidade");
  verdade(await um("select 1 from pedidos_resumo_entregador where dia = $1 and chave = '?mesmo nome' and cidade = 'LAGARTO - SE'", [d]), "sem ID: chave pelo nome");
});

await t("009z18: Parceiros separa parou, chamando menos, voltou e chamando mais, com as 8 semanas", async () => {
  await db.query("insert into cidades (nome) values ('BOQUIM - SE') on conflict do nothing");
  const ref = (await um("select (now() at time zone 'America/Sao_Paulo')::date - 1 d")).d;
  const dias = (await db.query("select generate_series($1::date - 60, $1::date, '1 day')::date d", [ref])).rows.map((x) => x.d);
  for (const d of dias) {
    const k = Math.round((new Date(ref) - d) / 86400000);
    const linhas = [["B Viva", 2]];
    if (k >= 5) linhas.push(["B Parada", 2]);
    linhas.push(["B Fraca", k < 7 ? (k % 3 === 0 ? 1 : 0) : 4]);
    if (k < 3 || k > 15) linhas.push(["B Voltou", 2]);   // parada do 3º ao 15º dia antes do último
    linhas.push(["B Forte", k < 7 ? 6 : 2]);
    for (const [loja, q] of linhas) if (q) await db.query("insert into pedidos_resumo (dia, hora, cidade, loja, pedidos, atraso_min) values ($1, 12, 'BOQUIM - SE', $2, $3, 30)", [d, loja, q]);
  }
  const s = await rpc(sup, "monitor_parceiros", { p_cidade: "BOQUIM - SE" });
  igual(s.parou.map((x) => x.loja), ["B Parada"], "parou");
  igual(s.menos.map((x) => x.loja), ["B Fraca"], "menos");
  igual(s.voltou.map((x) => [x.loja, x.parado_dias]), [["B Voltou", 13]], "voltou");
  igual(s.mais.map((x) => [x.loja, x.variacao]), [["B Forte", 200]], "mais");
  const forte = s.mais[0];
  igual(forte.semanas.length, 8, "8 semanas");
  igual(forte.semanas[7], 42, "a última semana por último");
});

await t("009z18: ranking dos entregadores (quem mais pesa / quem mais ajuda no SLA) e o detalhe", async () => {
  const r = await rpc(sup, "monitor_entregadores", { p_cidade: "ITABAIANA - SE", p_min: 0 });
  const mes = r.lista.find((x) => x.chave === "mes0001");
  verdade(mes, "Mesmo Nome no ranking");
  igual([mes.pedidos, mes.at_entregador, mes.atraso], [3, 2, 1], "números");
  igual(mes.impacto_cidade, Math.round(2 * 10000 / r.pedidos) / 100, "impacto = 2 atrasos do entregador / pedidos da cidade");
  igual(r.lista[0].chave, "mes0001", "quem mais pesa primeiro");
  verdade(r.sla > 0 && r.sla <= 100, "SLA");
  const aj = await rpc(sup, "monitor_entregadores", { p_cidade: "ITABAIANA - SE", p_min: 0, p_modo: "ajuda" });
  verdade(!aj.lista.some((x) => x.chave === "mes0001"), "quem atrasa acima da média não ajuda");
  verdade(aj.lista.some((x) => x.chave === "ze00018"), "Zé, sem atrasos, ajuda");
  igual((await rpc(sup, "monitor_entregadores", { p_cidade: "ITABAIANA - SE", p_min: 0, p_busca: "mes0" })).lista.map((x) => x.chave), ["mes0001"], "busca pelo ID");
  igual((await rpc(sup, "monitor_entregadores", { p_cidade: "ITABAIANA - SE", p_min: 30 })).lista.length, 0, "mínimo de entregas");
  const d = await rpc(sup, "monitor_entregador", { p_chave: "mes0001" });
  igual([d.chegada, d.tela, d.finalizou, d.cidade], [1, 1, 1, "ITABAIANA - SE"], "de onde vêm");
  igual(d.horas.length > 0, true, "quando mais atrasa");
  await erro(rpc(fora, "monitor_entregadores", {}), "");
});

await t("009z18: Cidade traz bairros (associar, entrega, cancelados, lojas), lojas com atraso e o mapa com cancelados", async () => {
  const c = await rpc(sup, "monitor_cidade", { p_cidade: "ITABAIANA - SE", p_min: 0 });
  const centro = c.bairros.find((b) => b.bairro === "CENTRO");
  verdade(centro, "bairro Centro");
  igual([centro.assoc, centro.cancelados, centro.sem_entregador, centro.lojas], [4, 5, 2, ["Loja Canc"]], "Centro");
  verdade(c.cidades.includes("ITABAIANA - SE") && c.sla > 0, "cidades e SLA");
  verdade(c.mapa.some((x) => x.cancelados > 0), "mapa com cancelados");
  igual(c.cancelados, 5, "cancelados no período");
  const mes = await rpc(sup, "monitor_cidade", { p_cidade: "ITABAIANA - SE", p_comparar: "mes" });
  verdade(mes.comp_de < mes.de, "comparar com o mês passado");
});

await t("009z18: Calendário soma clima, tempo e cancelamentos (semana e mês passados) e guarda o planejamento", async () => {
  const hoje = (await um("select public.hoje_brasilia() d")).d;
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const amanha = iso(new Date(hoje.getTime() + 86400000));
  await rpc(sup, "salvar_clima", { p_cidade: "ITABAIANA - SE", p_itens: [{ dia: amanha, chance: 85, chuva_mm: 9, descricao: "chuva forte", das: "18h", ate: "22h" }] });
  await rpc(mon, "salvar_planejamento", { p_cidade: "ITABAIANA - SE", p_dia: amanha, p_convocar: 6, p_reforco_de: "18:00", p_reforco_ate: "22:00", p_acoes: ["mensagem", "xx"], p_observacao: "teste" });
  await erro(rpc(sup, "salvar_planejamento", { p_cidade: "ITABAIANA - SE", p_dia: amanha, p_convocar: 1, p_reforco_de: null, p_reforco_ate: null, p_acoes: [], p_observacao: null }), "");
  const c = await rpc(sup, "monitor_calendario", { p_cidade: "ITABAIANA - SE", p_mes: amanha });
  const d = c.dias.find((x) => x.dia === amanha);
  igual([d.p_clima, d.planejado, d.plano.acoes, d.plano.convocar, d.futuro], [2, true, ["mensagem"], 6, true], "amanhã: chuva forte e planejado");
  verdade(d.nivel >= 1 && d.nivel <= 4 && d.pontos === d.p_clima + d.p_tempo + d.p_canc, "nível pelos pontos");
  const ontem2 = c.dias.find((x) => x.pedidos > 0);
  if (ontem2) verdade(!ontem2.futuro, "dia com dados já aconteceu");
  await rpc(mod, "salvar_chave_clima", { p_chave: "abc123abc123abc123" });
  igual(await rpc(sup, "chave_clima"), "abc123abc123abc123", "a chave do clima para quem é da equipe");
  await erro(rpc(sup, "salvar_chave_clima", { p_chave: "zzzzzzzzzzzzzzzzzzzz" }), "");
});

await t("009z18: pedidos com sinal mais antigos que guardar_sinal_dias saem do banco (o resumo fica)", async () => {
  await db.query("update parametros_pedidos set guardar_sinal_dias = 35, guardar_resumo_dias = 70 where unico");
  const d = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 50, 'YYYY-MM-DD') d")).d;
  const hd = (min) => new Date(new Date(`${d}T11:00:00-03:00`).getTime() + min * 60000).toISOString();
  await rpc(mod, "importar_pedidos", { p_itens: [{ entrega_id: "velho18_0001", codigo: "VE1", cidade: "LAGARTO - SE", loja: "Loja V",
    chamado_em: hd(0), aceite_em: hd(1), chegou_em: hd(25), saiu_em: hd(27), entregue_em: hd(50), finalizado_em: hd(51),
    entregador_nome: "Vel Ho", entregador_id: "vel0001", entregador_situacao: "ok", entregador_opcoes: [] }] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` });
  await db.query("update pedidos_log set importado_em = now() - interval '1 day' where entrega_id = 'velho18_0001'");   // 009z19: só sai no envio seguinte
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` });
  igual(Number((await um("select count(*) c from pedidos_log where entrega_id = 'velho18_0001'")).c), 0, "apagado");
  igual(Number((await um("select sum(atraso) a from pedidos_resumo_entregador where chave = 'vel0001'")).a), 1, "resumo ficou");
});

await t("009z18: resumos mais antigos que guardar_resumo_dias (70) saem do banco; o que a comparação usa fica", async () => {
  await db.query("update parametros_pedidos set guardar_sinal_dias = 35, guardar_resumo_dias = 70 where unico");
  const velho = (await um("select public.hoje_brasilia() - 80 d")).d, novo = (await um("select public.hoje_brasilia() - 60 d")).d;
  for (const d of [velho, novo]) await db.query("insert into pedidos_resumo_entregador (dia, cidade, chave, pedidos) values ($1, 'LAGARTO - SE', 'guarda01', 5) on conflict do nothing", [d]);
  const d = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 4, 'YYYY-MM-DD') d")).d;
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` });
  igual(Number((await um("select count(*) c from pedidos_resumo_entregador where chave = 'guarda01'")).c), 1, "só o de 60 dias ficou");
});

await t("009z18: só as cidades da Regras de equipe aparecem no Monitoramento", async () => {
  const d = (await um("select to_char((now() at time zone 'America/Sao_Paulo')::date - 2, 'YYYY-MM-DD') d")).d;
  const hd = (min) => new Date(new Date(`${d}T15:00:00-03:00`).getTime() + min * 60000).toISOString();
  await rpc(mod, "importar_pedidos", { p_itens: [{ entrega_id: "foracid00001", codigo: "FC1", cidade: "CIDADE DE FORA - XX", loja: "Loja Fora",
    chamado_em: hd(0), aceite_em: hd(1), chegou_em: hd(25), saiu_em: hd(26), entregue_em: hd(50), finalizado_em: hd(51),
    entregador_nome: "Fora Daqui", entregador_id: "for0001", entregador_situacao: "ok", entregador_opcoes: [] }] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` });
  const e = await rpc(sup, "monitor_entregadores", { p_min: 0 });
  verdade(!e.cidades.includes("CIDADE DE FORA - XX") && !e.lista.some((x) => x.chave === "for0001"), "ranking sem a cidade de fora");
  verdade(!(await rpc(sup, "monitor_cidade", {})).cidades.includes("CIDADE DE FORA - XX"), "Cidade sem ela");
  igual((await rpc(sup, "monitor_cidade", { p_cidade: "CIDADE DE FORA - XX" })).vazio, true, "pedir a cidade de fora não traz nada");
  verdade(!(await rpc(sup, "listar_pedidos", {})).cidades.includes("CIDADE DE FORA - XX"), "lista de atrasados sem ela");
  await db.query("insert into cidades (nome) values ('CIDADE DE FORA - XX')");
  verdade((await rpc(sup, "monitor_entregadores", { p_min: 0 })).cidades.includes("CIDADE DE FORA - XX"), "cadastrada em Regras de equipe, aparece");
  await db.query("delete from cidades where nome = 'CIDADE DE FORA - XX'");
});

await t("009z19: envio de dias antigos (mais de 35 dias) fechado um dia por vez não apaga os dias ainda não calculados", async () => {
  await db.query("update parametros_pedidos set guardar_sinal_dias = 35, guardar_resumo_dias = 70 where unico");
  const d1 = (await um("select to_char(public.hoje_brasilia() - 45, 'YYYY-MM-DD') d")).d, d2 = (await um("select to_char(public.hoje_brasilia() - 44, 'YYYY-MM-DD') d")).d;
  const p = (id, d, atraso) => ({ entrega_id: id, codigo: id.slice(-4), cidade: "LAGARTO - SE", loja: "Loja Antiga",
    chamado_em: `${d}T12:00:00-03:00`, aceite_em: `${d}T12:01:00-03:00`, chegou_em: `${d}T12:${atraso ? 30 : 5}:00-03:00`, saiu_em: `${d}T12:${atraso ? 32 : 7}:00-03:00`,
    entregue_em: `${d}T12:${atraso ? 50 : 20}:00-03:00`, finalizado_em: `${d}T12:${atraso ? 51 : 21}:00-03:00`, entregador_nome: "Ana Antiga", entregador_id: "ant0001", entregador_situacao: "ok", entregador_opcoes: [] });
  await rpc(mod, "importar_pedidos", { p_itens: [p("antigo190001", d1, true), p("antigo190002", d1, false), p("antigo190003", d2, true), p("antigo190004", d2, false)] });
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d1}T00:00:00-03:00`, p_ate: `${d1}T23:59:59-03:00` });
  igual(Number((await um("select count(*) c from pedidos_log where entrega_id in ('antigo190003', 'antigo190004')")).c), 2, "o 2º dia continua inteiro");
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d2}T00:00:00-03:00`, p_ate: `${d2}T23:59:59-03:00` });
  igual(Number((await um("select sum(pedidos) n from pedidos_resumo where loja = 'Loja Antiga'")).n), 4, "os dois dias no resumo");
  await db.query("update pedidos_log set importado_em = now() - interval '1 day' where entrega_id like 'antigo19%'");
  await rpc(mod, "fechar_importacao_pedidos", { p_de: `${d2}T00:00:00-03:00`, p_ate: `${d2}T23:59:59-03:00` });
  igual(Number((await um("select count(*) c from pedidos_log where entrega_id like 'antigo19%'")).c), 0, "no envio seguinte, os antigos saem");
  igual(Number((await um("select sum(pedidos) n from pedidos_resumo where loja = 'Loja Antiga'")).n), 4, "e o resumo fica");
});

await t("009z21: o cálculo em 3 partes (sinais, resumo, limpar) dá o mesmo que de uma vez", async () => {
  const d = (await um("select to_char(public.hoje_brasilia() - 5, 'YYYY-MM-DD') d")).d;
  const p = (id, atraso) => ({ entrega_id: id, codigo: id.slice(-4), cidade: "LAGARTO - SE", loja: "Loja Partes",
    chamado_em: `${d}T13:00:00-03:00`, aceite_em: `${d}T13:01:00-03:00`, chegou_em: `${d}T13:${atraso ? 30 : 5}:00-03:00`, saiu_em: `${d}T13:${atraso ? 32 : 7}:00-03:00`,
    entregue_em: `${d}T13:${atraso ? 50 : 20}:00-03:00`, finalizado_em: `${d}T13:${atraso ? 51 : 21}:00-03:00`, entregador_nome: "Pa Rtes", entregador_id: "par0001", entregador_situacao: "ok", entregador_opcoes: [] });
  await rpc(mod, "importar_pedidos", { p_itens: [p("partes210001", true), p("partes210002", false)] });
  const per = { p_de: `${d}T00:00:00-03:00`, p_ate: `${d}T23:59:59-03:00` };
  igual((await rpc(mod, "fechar_importacao_pedidos", { ...per, p_etapa: "sinais" })).etapa, "sinais");
  igual((await um("select sinal_chegada from pedidos_log where entrega_id = 'partes210001'")).sinal_chegada, true, "sinais calculados");
  igual(Number((await um("select count(*) c from pedidos_resumo where loja = 'Loja Partes'")).c), 0, "resumo ainda não");
  await rpc(mod, "fechar_importacao_pedidos", { ...per, p_etapa: "resumo" });
  igual(Number((await um("select sum(pedidos) n from pedidos_resumo where loja = 'Loja Partes'")).n), 2, "resumo");
  const r = await rpc(mod, "fechar_importacao_pedidos", { ...per, p_etapa: "limpar" });
  verdade(r.pedidos >= 2, "limpar devolve os números de sempre");
  await erro(rpc(mod, "fechar_importacao_pedidos", { ...per, p_etapa: "outra" }), "Etapa inválida");
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
