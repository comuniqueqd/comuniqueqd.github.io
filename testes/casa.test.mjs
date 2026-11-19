// Testes da 009x (supabase/009x-casa-em-ordem.sql): listas com limite (Histórico da ativação em páginas,
// tratativas concluídas com "Ver mais", atividades com as concluídas limitadas) e o índice do Resumo semanal.
// Carrega TODAS as migrações (carregar-banco.mjs), como o banco de verdade.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node casa.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { carregarBanco } from "./carregar-banco.mjs";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
await carregarBanco(url);
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("set client_min_messages = warning");
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const sup = pessoa("suporte.casa@x.com", "Suporte Casa");
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
const verdade = (c, msg) => { if (!c) throw new Error(msg); };
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0];

for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009x-casa-em-ordem.sql"));   // pode rodar de novo

await rpc(admin, "entrar");
await db.query("update membros set papel_bloqueios = 'moderador' where email = $1", [admin.email]);
await db.query("insert into membros (email, nome, papel, papel_bloqueios) values ($1, $2, 'suporte', 'suporte') on conflict do nothing", [sup.email, sup.nome]);
await rpc(sup, "entrar");
await db.query("insert into cidades (nome) values ('LAGARTO - SE'), ('ITABAIANA - SE') on conflict do nothing");
const uAdmin = (await um("select user_id from membros where email = $1", [admin.email])).user_id;
const uSup = (await um("select user_id from membros where email = $1", [sup.email])).user_id;

// massa: 5.000 cadastros (300 do suporte), situações variadas
await db.query(`insert into cadastros (id_app, nome, cidade, status, enviado_por, enviado_em, status_desde, observacao)
  select 'cs'||lpad(i::text,6,'0'), 'Candidato Casa '||i, case when i % 3 = 0 then 'ITABAIANA - SE' else 'LAGARTO - SE' end,
         (case when i % 10 = 0 then 'aguardando_analise' when i % 10 = 1 then 'aguardando_contato' when i % 10 = 2 then 'encerrado' else 'aprovado' end)::status_cadastro,
         case when i <= 300 then $2::uuid else $1::uuid end, now() - i * interval '1 minute', now() - i * interval '1 minute',
         case when i = 4321 then 'Observação com a palavra Jabuticaba' end
    from generate_series(1, 5000) i`, [uAdmin, uSup]);

await t("Histórico: a 1ª página traz 100 cadastros (os mais novos) e menos de 150 KB, com o total e as contagens certos", async () => {
  const r = await rpc(admin, "listar_cadastros_pagina", { p_pagina: 1, p_por: 100 });
  igual(r.itens.length, 100, "itens");
  igual(r.total, 5000, "total");
  igual(r.itens[0].id_app, "cs000001", "mais novo primeiro");
  igual(r.contagens, { aprovado: 3500, cadastros: 5000, encerrado: 500, aguardando_analise: 500, aguardando_contato: 500 }, "contagens");
  igual(r.cidades, ["ITABAIANA - SE", "LAGARTO - SE"], "cidades");
  const kb = Buffer.byteLength(JSON.stringify(r)) / 1024;
  verdade(kb < 150, `página com ${kb.toFixed(0)} KB`);
  verdade(!("cpf" in r.itens[0]) && !("caso_aberto" in r.itens[0]), "sem cpf nem caso_aberto");
});
await t("Histórico: a página 2 continua de onde a 1 parou", async () => {
  const r = await rpc(admin, "listar_cadastros_pagina", { p_pagina: 2, p_por: 100 });
  igual([r.itens[0].id_app, r.itens.length], ["cs000101", 100]);
});
await t("Histórico: busca (sem acento), situação e cidade são filtradas no banco", async () => {
  igual((await rpc(admin, "listar_cadastros_pagina", { p_busca: "jabutícaba" })).itens.map((x) => x.id_app), ["cs004321"], "busca na observação");
  const r = await rpc(admin, "listar_cadastros_pagina", { p_status: "encerrado", p_cidade: "ITABAIANA - SE" });
  verdade(r.itens.every((x) => x.status === "encerrado" && x.cidade === "ITABAIANA - SE"), "filtro");
  igual(r.total, 167, "encerrados em Itabaiana (i%10=2 e i%3=0)");
  igual(r.contagens.cadastros, 5000, "as contagens não dependem do filtro de situação");
});
await t("Histórico: 'Só os que eu enviei' e o suporte só vê os seus (RLS)", async () => {
  igual((await rpc(admin, "listar_cadastros_pagina", { p_meus: true })).total, 4700, "admin: os seus");
  const s = await rpc(sup, "listar_cadastros_pagina", {});
  igual([s.total, s.contagens.cadastros], [300, 300], "suporte");
});
await t("Histórico: o CSV pede até 5.000 de uma vez", async () => {
  igual((await rpc(admin, "listar_cadastros_pagina", { p_por: 5000 })).itens.length, 5000);
});

// tratativas: 150 concluídas (Lagarto), 1 pendente
await db.query(`with b as (
    insert into bloqueios (id_app, nome_entregador, cidade, infracao_id, infracao, ocorrencia, ocorrencia_total, horas, inicio, fim, registrado_por, registrado_por_nome, leve)
    select 'tr'||lpad(i::text,5,'0'), case when i = 77 then 'Zé Tratado' else 'Tratado '||i end, 'LAGARTO - SE', inf.id, inf.nome, 1, 1, 24,
           now() - i * interval '1 hour', now() - i * interval '1 hour' + interval '24 hours', $1, 'Mateus Lopes', false
      from generate_series(1, 151) i, (select id, nome from infracoes where not leve order by id limit 1) inf
    returning id, id_app, cidade)
  insert into tarefas (modulo, tipo, bloqueio_id, cidade, responsavel_email, status, concluida_em)
  select 'bloqueios', 'tratativa', b.id, b.cidade, null, case when b.id_app = 'tr00151' then 'pendente' else 'concluida' end,
         case when b.id_app = 'tr00151' then null else now() - substr(b.id_app, 3)::int * interval '1 hour' end
    from b`, [uAdmin]);

await t("Tratativas concluídas: vêm as 100 mais recentes e avisa que há mais", async () => {
  const r = await rpc(admin, "listar_tarefas_concluidas", { p_limite: 100 });
  igual([r.itens.length, r.mais], [100, true]);
  igual(r.itens[0].bloqueio.id_app, "tr00001", "mais recente primeiro");
  verdade(r.itens.every((x) => x.status === "concluida"), "só concluídas");
  igual((await rpc(admin, "listar_tarefas_concluidas", { p_limite: 200 })).mais, false, "com 200, acabou");
});
await t("Tratativas concluídas: busca no banco acha uma antiga que não estava entre as 100", async () => {
  const r = await rpc(admin, "listar_tarefas_concluidas", { p_limite: 100, p_busca: "ze tratado" });
  igual(r.itens.map((x) => x.bloqueio.id_app), ["tr00077"]);
});
await t("Tratativas concluídas: o suporte só vê as dos bloqueios que registrou", async () => {
  igual((await rpc(sup, "listar_tarefas_concluidas", {})).itens.length, 0);
});

// atividades: 60 concluídas recentes + 1 aberta
await db.query(`insert into atividades (titulo, criada_por, criada_por_nome, status, aceita_por, aceita_em, concluida_em)
  select 'Feita '||i, $1, 'Mateus Lopes', 'concluida', $1, now() - interval '2 days', now() - i * interval '1 hour' from generate_series(1, 60) i`, [uAdmin]);
await rpc(sup, "sugerir_atividade", { p_titulo: "Aberta da casa" });

await t("Atividades: com p_concluidas = 50 vêm as abertas e só as 50 concluídas mais recentes", async () => {
  const l = await rpc(admin, "listar_atividades", { p_concluidas: 50 });
  const conc = l.filter((a) => a.status === "concluida");
  igual(conc.length, 50, "concluídas");
  verdade(conc.some((a) => a.titulo === "Feita 1") && !conc.some((a) => a.titulo === "Feita 60"), "as mais recentes");
  verdade(l.some((a) => a.titulo === "Aberta da casa"), "a aberta continua");
});
await t("Atividades: 0 = sem concluídas (Minha fila); sem parâmetro = todas, como antes", async () => {
  igual((await rpc(admin, "listar_atividades", { p_concluidas: 0 })).filter((a) => a.status === "concluida").length, 0);
  igual((await rpc(admin, "listar_atividades")).filter((a) => a.status === "concluida").length, 60);
});

await t("AT2: o índice da leve que gerou o bloqueio existe", async () => {
  verdade(await um("select 1 from pg_indexes where indexname = 'bloqueios_gerou_bloqueio_idx'"), "sem índice");
});

console.log(`\n${n - falhas}/${n} ok`);
await db.end();
process.exit(falhas ? 1 : 0);
