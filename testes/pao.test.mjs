// Testes da migração 007 (supabase/007-pao-quentinho.sql): nome no cadastro, ficha na aprovação, marca "revisar",
// tarefa opcional, aviso da decisão, histórico do ID, busca rápida e as funções de menos tráfego.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node pao.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
const arquivo = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql", "../supabase/003-entregadores.sql",
  "../supabase/004-atividades-registros.sql", "../supabase/005-analises-anexos.sql", "../supabase/006-equipe-previsao-atencao.sql",
  "../supabase/007-pao-quentinho.sql", "../supabase/007-pao-quentinho.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");
const sup = pessoa("eduarda@x.com", "Eduarda");
const sup2 = pessoa("joyce@x.com", "Joyce");
const soAtiv = pessoa("ativ@x.com", "Só Ativação");
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

for (const p of [admin]) await rpc(p, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [sup2, "suporte", "suporte"], [soAtiv, "suporte", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, sup2, soAtiv, estranho]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
const infr = (await um("select id from infracoes where not leve order by id limit 1")).id;
const meusIds = async (p) => (await db.query("select user_id from membros where email = $1", [p.email])).rows[0].user_id;

await t("cadastro completo: sem marca e sem tarefa", async () => {
  const id = await rpc(sup, "enviar_cadastro", { p_id_app: "comp0001", p_cpf: null, p_cidade: "lagarto - se", p_nome: "  Ana   Souza " });
  const c = await um("select nome from cadastros where id = $1", [id]);
  igual(c.nome, "Ana Souza");
  const l = (await rpc(sup, "listar_cadastros", { p_escopo: "meus" })).find((x) => x.id === id);
  igual(l.revisar, null); igual(l.tarefa_aberta, false);
  igual((await um("select count(*)::int n from atividades where cadastro_id = $1", [id])).n, 0);
});

let incompleto;
await t("cadastro sem nome: marca revisar e uma tarefa (normal p/ admin, opcional p/ os outros)", async () => {
  incompleto = await rpc(sup, "enviar_cadastro", { p_id_app: "semn0001", p_cpf: null, p_cidade: "LAGARTO - SE" });
  const l = (await rpc(sup, "listar_cadastros", { p_escopo: "meus" })).find((x) => x.id === incompleto);
  igual(l.revisar, "falta o nome do entregador"); igual(l.tarefa_aberta, true);
  const a = await um("select * from atividades where cadastro_id = $1", [incompleto]);
  igual(a.opcional, true); igual(a.sugeridas_para, [await meusIds(admin)]);
  const paraAdmin = (await rpc(admin, "listar_atividades")).find((x) => x.cadastro_id === incompleto);
  igual([paraAdmin.opcional_para_mim, paraAdmin.pode_aceitar], [false, true]);
  const paraSup2 = (await rpc(sup2, "listar_atividades")).find((x) => x.cadastro_id === incompleto);
  igual([paraSup2.opcional_para_mim, paraSup2.pode_aceitar], [true, true], "opcional já aberta para todos");
  if (!(await avisos(admin)).some((x) => x.texto.includes("cadastro para completar"))) throw new Error("admin sem aviso");
});

await t("quem aceita tira a tarefa dos outros", async () => {
  const a = await um("select id from atividades where cadastro_id = $1", [incompleto]);
  await rpc(sup2, "aceitar_atividade", { p_id: a.id });
  const paraAdmin = (await rpc(admin, "listar_atividades")).find((x) => x.cadastro_id === incompleto);
  igual(paraAdmin.pode_aceitar, false);
  await falha(rpc(sup, "aceitar_atividade", { p_id: a.id }), "já foi aceita");
});

await t("suporte de outro cadastro abre e completa (antes/depois no histórico); a tarefa conclui sozinha", async () => {
  const v = await rpc(sup2, "ver_cadastro", { p_cadastro: incompleto });
  igual(v.revisar, "falta o nome do entregador");
  await falha(rpc(sup2, "completar_cadastro", { p_cadastro: incompleto, p_id_app: "semn0001", p_cpf: null, p_nome: null, p_cidade: "LAGARTO - SE" }), "Nada foi alterado");
  await falha(rpc(sup2, "completar_cadastro", { p_cadastro: incompleto, p_id_app: "semn0001", p_cpf: "123", p_nome: "Bia", p_cidade: "LAGARTO - SE" }), "CPF inválido");
  await falha(rpc(sup2, "completar_cadastro", { p_cadastro: incompleto, p_id_app: "comp0001", p_cpf: null, p_nome: "Bia", p_cidade: "LAGARTO - SE" }), "Outro cadastro");
  const r = await rpc(sup2, "completar_cadastro", { p_cadastro: incompleto, p_id_app: "semn0001", p_cpf: null, p_nome: "Bia Lima", p_cidade: "LAGARTO - SE", p_motivo: "liguei pra ela" });
  igual(r.revisar, null);
  const e = await um("select detalhe from eventos where cadastro_id = $1 and tipo = 'editado'", [incompleto]);
  igual(e.detalhe, "nome: (vazio) → Bia Lima · motivo: liguei pra ela");
  const a = await um("select status, nota from atividades where cadastro_id = $1", [incompleto]);
  igual([a.status, a.nota], ["concluida", "Dados do cadastro completados."]);
  igual((await rpc(sup2, "ver_cadastro", { p_cadastro: incompleto })).edicoes.length, 1);
  await falha(rpc(estranho, "completar_cadastro", { p_cadastro: incompleto, p_id_app: "x1234", p_cpf: null, p_nome: "X", p_cidade: "LAGARTO - SE" }));
});

await t("aprovado com ID e nome: a ficha nasce; quem enviou é avisado (quem decidiu não)", async () => {
  const antes = (await avisos(admin)).length;
  await rpc(admin, "decidir", { p_cadastro: incompleto, p_acao: "aprovar" });
  const f = await um("select nome, cidade from entregadores where id_app = 'semn0001'");
  igual([f.nome, f.cidade], ["Bia Lima", "LAGARTO - SE"]);
  const s = await avisos(sup);
  igual(s.at(-1), { texto: "Seu cadastro Bia Lima (ID semn0001) foi aprovado por Mateus Lopes.", link: "#ativacao/meus" });
  igual((await avisos(admin)).length, antes);
});

await t("desfazer ignora edições e avisa quem enviou; reprovação leva o motivo", async () => {
  await rpc(admin, "completar_cadastro", { p_cadastro: incompleto, p_id_app: "semn0001", p_cpf: null, p_nome: "Bia Lima", p_cidade: "LAGARTO - SE", p_observacao: "ok" });
  const l = (await rpc(admin, "listar_cadastros", { p_escopo: "todos" })).find((x) => x.id === incompleto);
  igual(l.pode_desfazer, true);
  await rpc(admin, "desfazer", { p_cadastro: incompleto });
  igual((await avisos(sup)).at(-1).texto, "Seu cadastro Bia Lima (ID semn0001) teve a decisão desfeita por Mateus Lopes.");
  const motivo = (await um("select texto from motivos order by ordem limit 1")).texto;
  await rpc(mon, "decidir", { p_cadastro: incompleto, p_acao: "reprovar", p_motivo: motivo, p_detalhe: "foto" });
  igual((await avisos(sup)).at(-1).texto, `Seu cadastro Bia Lima (ID semn0001) foi reprovado por Jocimara: ${motivo} (foto).`);
  igual((await um("select nome from entregadores where id_app = 'semn0001'")).nome, "Bia Lima", "a ficha fica");
});

await t("ID com ficha de outro nome: revisar; monitorador marca como revisado; suporte não", async () => {
  await rpc(mon, "registrar_bloqueio", { p_id_app: "ficha001", p_nome: "Carlos Dias", p_cidade: "LAGARTO - SE", p_infracao: infr });
  const id = await rpc(sup, "enviar_cadastro", { p_id_app: "FICHA001", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Carla Dias" });
  igual((await rpc(sup, "ver_cadastro", { p_cadastro: id })).revisar, "o ID já tem ficha com outro nome: Carlos Dias");
  await falha(rpc(sup, "marcar_cadastro_revisado", { p_cadastro: id }));
  await rpc(mon, "marcar_cadastro_revisado", { p_cadastro: id });
  const v = await rpc(sup, "ver_cadastro", { p_cadastro: id });
  igual([v.revisar, v.revisado, v.tarefa_aberta], [null, true, false]);
  // aprovar não sobrescreve a ficha
  await rpc(admin, "decidir", { p_cadastro: id, p_acao: "aprovar" });
  igual((await um("select nome from entregadores where id_app = 'ficha001'")).nome, "Carlos Dias");
});

await t("sugerir tarefa: com pessoa = normal só para ela; sem pessoa = admin + opcional", async () => {
  const id = await db.query("insert into cadastros (cpf, cidade, enviado_por) values ('52998224725', 'LAGARTO - SE', $1) returning id", [await meusIds(sup)]).then((r) => r.rows[0].id);
  igual((await rpc(sup, "ver_cadastro", { p_cadastro: id })).revisar, "falta o nome do entregador · falta o ID do entregador");
  igual((await um("select count(*)::int n from atividades where cadastro_id = $1", [id])).n, 0, "cadastro antigo não gera tarefa");
  const tid = await rpc(sup, "sugerir_tarefa_cadastro", { p_cadastro: id, p_para: await meusIds(mon) });
  const a = await um("select opcional, titulo from atividades where id = $1", [tid]);
  igual([a.opcional, a.titulo], [false, "Completar cadastro: CPF 529.982.247-25 · LAGARTO - SE"]);
  await falha(rpc(sup, "sugerir_tarefa_cadastro", { p_cadastro: id }), "Já existe uma tarefa");
  await db.query("delete from atividades where id = $1", [tid]);
  const t2 = await rpc(sup, "sugerir_tarefa_cadastro", { p_cadastro: id });
  igual((await um("select opcional from atividades where id = $1", [t2])).opcional, true);
  await falha(rpc(sup, "sugerir_tarefa_cadastro", { p_cadastro: (await um("select id from cadastros where id_app = 'comp0001'")).id }), "já está completo");
});

await t("histórico do ID: no Novo cadastro e nos Pendentes; quem não tem bloqueios não vê", async () => {
  await rpc(mon, "registrar_bloqueio", { p_id_app: "hist0001", p_nome: "Zeferino Teste", p_cidade: "LAGARTO - SE", p_infracao: infr });
  await rpc(mon, "comentar_entregador", { p_id_app: "hist0001", p_texto: "sempre atrasa" });
  const h = await rpc(sup, "historico_id", { p_id_app: "HIST-0001" });
  igual([h.cadastro, h.historico.nome, h.historico.bloqueios, h.historico.comentarios, h.historico.bloqueado_agora, h.tem_bloqueios_modulo],
    [null, "Zeferino Teste", 1, 1, true, true]);
  const s = await rpc(soAtiv, "historico_id", { p_id_app: "hist0001" });
  igual([s.historico, s.tem_bloqueios_modulo], [null, false]);
  igual((await rpc(sup, "historico_id", { p_id_app: "nada9999" })).historico, null);
  igual((await rpc(soAtiv, "historico_id", { p_cpf: "529.982.247-25" })).cadastro.situacao, "Aguardando análise");
  const id = await rpc(sup, "enviar_cadastro", { p_id_app: "hist0001", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Zeferino Teste" });
  const p = (await rpc(mon, "listar_cadastros", { p_escopo: "pendentes" })).find((x) => x.id === id);
  igual(p.historico.bloqueios, 1);
  igual((await rpc(soAtiv, "listar_cadastros", { p_escopo: "meus" })).length, 0);
  await falha(rpc(estranho, "historico_id", { p_id_app: "hist0001" }));
});

await t("busca rápida: fichas só com o módulo de bloqueios; cadastros por ID, CPF e nome", async () => {
  const r = await rpc(mon, "busca_rapida", { p_q: "zeferino" });
  igual(r.entregadores.map((x) => x.id_app), ["hist0001"]);
  igual(r.cadastros.map((x) => x.id_app), ["hist0001"]);
  igual((await rpc(soAtiv, "busca_rapida", { p_q: "zeferino" })).entregadores, []);
  igual((await rpc(mon, "busca_rapida", { p_q: "529.982" })).cadastros.length, 1);
  igual((await rpc(mon, "busca_rapida", { p_q: "da" })).cadastros, [], "menos de 3 letras");
  await falha(rpc(estranho, "busca_rapida", { p_q: "zeferino" }));
});

await t("ultima_mudanca sobe a cada escrita; resumo_e_avisos junta tudo", async () => {
  const v1 = Number(await rpc(sup, "ultima_mudanca"));
  await rpc(sup, "comentar_entregador", { p_id_app: "hist0001", p_texto: "outro" });
  const v2 = Number(await rpc(sup, "ultima_mudanca"));
  if (!(v2 > v1)) throw new Error(`${v1} → ${v2}`);
  igual(await rpc(estranho, "ultima_mudanca"), null);
  const r = await rpc(admin, "resumo_e_avisos");
  if (!r.resumo || !Array.isArray(r.notif?.itens ?? r.notif)) throw new Error(JSON.stringify(Object.keys(r)));
  igual(typeof r.resumo.pedidos_acesso, "number");
  igual(r.resumo.bloqueios_revisar, 0);
  const s = await rpc(sup, "resumo_e_avisos");
  igual([s.resumo.pedidos_acesso, s.resumo.bloqueios_revisar], [null, null]);
  await falha(rpc(estranho, "resumo_e_avisos"));
  await falha(db.query("set role authenticated; update versao_dados set n = 0"), "permission");
  await db.query("reset role");
});

await t("histórico de bloqueios paginado no banco, com filtros", async () => {
  for (let i = 0; i < 5; i++) await db.query("select public.importar_bloqueio($1, 'Pessoa ' || $2, 'LAGARTO - SE', (select nome from infracoes where id = $3), now() - make_interval(days => $2::int + 1), 'Planilha', $4)",
    [`pag0000${i}`, i, infr, i < 2 ? "conferir" : null]);
  const p1 = await rpc(mon, "listar_bloqueios_pagina", { p_pagina: 1, p_por: 3 });
  igual([p1.total, p1.itens.length, p1.total_geral], [p1.total_geral, 3, p1.total_geral]);
  const p3 = await rpc(mon, "listar_bloqueios_pagina", { p_pagina: Math.ceil(p1.total / 3), p_por: 3 });
  igual(p3.itens.length, p1.total % 3 || 3);
  igual((await rpc(mon, "listar_bloqueios_pagina", { p_situacao: "revisar" })).total, 2);
  igual((await rpc(mon, "listar_bloqueios_pagina", { p_busca: "pessoa 3" })).itens.map((x) => x.id_app), ["pag00003"]);
  igual((await rpc(mon, "listar_bloqueios_pagina", { p_quem: "Planilha" })).total, 5);
  igual((await rpc(admin, "resumo_e_avisos")).resumo.bloqueios_revisar, 2);
  // suporte só os próprios (RLS)
  igual((await rpc(sup, "listar_bloqueios_pagina", {})).total, 0);
  await falha(rpc(soAtiv, "listar_bloqueios_pagina", {}));
});

await t("internas não ficam expostas", async () => {
  for (const f of ["criar_tarefa_cadastro(uuid,uuid)", "concluir_tarefas_cadastro(uuid)", "marcar_mudanca()", "avisar_decisao()", "cadastro_cria_ficha()"]) {
    const r = await um(`select has_function_privilege('authenticated', 'public.${f}', 'execute') ok`);
    igual(r.ok, false, f);
  }
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
