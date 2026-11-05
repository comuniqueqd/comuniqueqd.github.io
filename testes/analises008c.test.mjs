// Testes da 008c (supabase/008c-analises.sql): análises simples e complexas.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node analises008c.test.mjs
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
  "../supabase/008b-notificacoes.sql", "../supabase/008c-analises.sql", "../supabase/008c-analises.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");
const sup = pessoa("eduarda@x.com", "Eduarda");
const semBq = pessoa("joyce@x.com", "Joyce");

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

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"], [semBq, "suporte", null]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup, semBq]) await rpc(p, "entrar");
await rpc(admin, "salvar_cidade", { p_nome: "LAGARTO - SE", p_responsavel_email: mon.email, p_ativa: true });
await rpc(admin, "salvar_cidade", { p_nome: "ITABAIANA - SE", p_responsavel_email: null, p_ativa: true });
const inf = (await um("select id, nome from infracoes where not leve and ativa and horas_1a is not null order by id limit 1"));
const leve = (await um("select id from infracoes where leve and ativa order by id limit 1")).id;

// ativação: 4 cadastros do suporte; 1 aprovado, 1 reprovado, 1 encerrado, 1 reprovado e desfeito
const cad = [];
for (const [i, cid] of [["an000001", "LAGARTO - SE"], ["an000002", "LAGARTO - SE"], ["an000003", "LAGARTO - SE"], ["an000004", "ITABAIANA - SE"]])
  cad.push((await rpc(sup, "enviar_cadastro", { p_id_app: i, p_cpf: null, p_cidade: cid, p_nome: "Teste " + i })).id);
await rpc(mon, "decidir", { p_cadastro: cad[0], p_acao: "aprovar" });
await rpc(mon, "decidir", { p_cadastro: cad[1], p_acao: "reprovar", p_motivo: "Documento ilegível" });
await rpc(mon, "decidir", { p_cadastro: cad[2], p_acao: "encerrar", p_motivo: "CPF com restrição" });
await rpc(mon, "decidir", { p_cadastro: cad[3], p_acao: "reprovar", p_motivo: "Documento ilegível" });
await rpc(admin, "desfazer", { p_cadastro: cad[3] });

// bloqueios: um que sai hoje, um que fica, uma leve; um bloqueio do monitorador
await rpc(sup, "registrar_bloqueio", { p_id_app: "blq00001", p_nome: "Sai Hoje", p_cidade: "LAGARTO - SE", p_infracao: inf.id });
await rpc(sup, "registrar_bloqueio", { p_id_app: "blq00002", p_nome: "Fica", p_cidade: "LAGARTO - SE", p_infracao: inf.id });
await rpc(mon, "registrar_bloqueio", { p_id_app: "blq00003", p_nome: "Outra Cidade", p_cidade: "ITABAIANA - SE", p_infracao: inf.id });
await rpc(sup, "registrar_infracao_leve", { p_id_app: "blq00002", p_infracao: leve });
await db.query("update bloqueios set fim = now() + interval '1 minute' where id_app = 'blq00001'");
await db.query("update bloqueios set fim = now() + interval '3 days' where id_app in ('blq00002', 'blq00003') and not leve");

await t("simples: ativação do período (enviados, aprovados, em aberto, encerrados)", async () => {
  const a = (await rpc(sup, "analises_simples", { p_dias: 30 })).ativacao;
  igual([a.enviados, a.aprovados, a.encerrados, a.em_aberto, a.aguardando_analise, a.aguardando_contato, a.reprovados_alguma_vez], [4, 1, 1, 2, 1, 1, 2]);
  if (a.horas_ate_aprovar == null) throw new Error("sem tempo até aprovar");
});

await t("simples: motivos das não aprovações, sem a reprovação desfeita", async () => {
  const m = (await rpc(sup, "analises_simples", { p_dias: 30 })).motivos_nao_aprovacao;
  igual(m.map((x) => [x.tipo, x.motivo, x.qtd]).sort(), [["encerrado", "CPF com restrição", 1], ["reprovado", "Documento ilegível", 1]]);
});

await t("simples: filtro por cidade", async () => {
  const r = await rpc(sup, "analises_simples", { p_dias: 30, p_cidade: "ITABAIANA - SE" });
  igual([r.ativacao.enviados, r.agora.bloqueados, r.motivos_nao_aprovacao.length], [1, 1, 0]);
});

await t("simples: bloqueados agora, quem sai hoje e por cidade", async () => {
  const r = await rpc(mon, "analises_simples", { p_dias: 30 });
  igual([r.agora.bloqueados, r.agora.saem_hoje], [3, 1]);
  igual(r.agora.saem_hoje_por_hora.reduce((s, x) => s + x.qtd, 0), 1);
  igual(r.bloqueados_por_cidade.map((x) => [x.cidade, x.agora, x.saem_hoje]), [["LAGARTO - SE", 2, 1], ["ITABAIANA - SE", 1, 0]]);
  if (!r.agora.proximo_fim) throw new Error("sem próximo fim");
});

await t("simples: quando a equipe registra e quando você registra (bloqueios, leves e cadastros)", async () => {
  const s = await rpc(sup, "analises_simples", { p_dias: 30 });
  const soma = (l) => l.reduce((a, x) => a + x.qtd, 0);
  igual([soma(s.dia_hora), soma(s.dia_hora_meu)], [8, 7], "equipe 4 cadastros + 4 registros; suporte 4 + 3:");
  igual(soma((await rpc(mon, "analises_simples", { p_dias: 30 })).dia_hora_meu), 1);
});

await t("simples: o que você fez no período", async () => {
  const v = (await rpc(mon, "analises_simples", { p_dias: 30 })).voce;
  igual([v.cadastros, v.decisoes, v.bloqueios, v.leves], [0, 4, 1, 0]);
  const vs = (await rpc(sup, "analises_simples", { p_dias: 30 })).voce;
  igual([vs.cadastros, vs.bloqueios, vs.leves], [4, 2, 1]);
});

await t("simples: leves, infrações mais registradas, tratativas e atividades", async () => {
  const r = await rpc(mon, "analises_simples", { p_dias: 30 });
  igual([r.leves.total, r.leves.entregadores], [1, 1]);
  igual(r.por_infracao[0].qtd, 3);
  igual(typeof r.tratativas.criadas, "number");
  igual(Object.keys(r.atividades).sort(), ["abertas_agora", "concluidas", "em_andamento", "sugeridas"]);
});

await t("simples: quem não tem bloqueios recebe só a ativação e as atividades", async () => {
  const r = await rpc(semBq, "analises_simples", { p_dias: 30 });
  igual([r.tem_bloqueios, r.agora, r.reincidencia, r.leves, r.por_infracao], [false, null, null, null, null]);
  igual(r.dia_hora.reduce((a, x) => a + x.qtd, 0), 4, "só os cadastros:");
  igual(r.ativacao.enviados, 4);
});

await t("complexas: as de sempre e as novas", async () => {
  const c = await rpc(sup, "analises_complexas", { p_dias: 90 });
  for (const k of ["eficacia", "tratativas_por_responsavel", "ativacao_bloqueio", "reincidencia_por_infracao", "escada", "cidades", "resposta_ativacao", "liberacoes"])
    if (!(k in c)) throw new Error("falta " + k);
  igual(c.escada.entregadores, 3);
  igual(c.cidades.map((x) => [x.cidade, x.bloqueios, x.leves]), [["LAGARTO - SE", 2, 1], ["ITABAIANA - SE", 1, 0]]);
  const p = c.resposta_ativacao.por_pessoa;
  igual([p.length, p[0].pessoa, p[0].decisoes, p[0].aprovou], [1, "Jocimara", 4, 1], "a 1ª resposta de cada cadastro conta, mesmo se desfeita depois:");
});

await t("complexas: reincidência por infração e liberações antes do prazo", async () => {
  await db.query("update bloqueios set inicio = now() - interval '2 days' where id_app = 'blq00002' and not leve");
  await rpc(sup, "registrar_bloqueio", { p_id_app: "blq00002", p_nome: "Fica", p_cidade: "LAGARTO - SE", p_infracao: inf.id });
  const b = (await um("select id from bloqueios where id_app = 'blq00003'")).id;
  await rpc(mon, "liberar_bloqueio", { p_bloqueio: b, p_motivo: "Erro do app" });
  const c = await rpc(mon, "analises_complexas", { p_dias: 90 });
  const r = c.reincidencia_por_infracao.find((x) => x.infracao === inf.nome);
  igual([r.entregadores, r.repetiram], [3, 1]);
  const l = c.liberacoes.find((x) => x.infracao === inf.nome);
  igual([l.bloqueios, l.liberados], [4, 1]);
});

// revisão: o número de versão só sobe quando algo muda de verdade
const versao = async () => Number((await um("select n from versao_dados")).n);
await t("versão: entrar de novo, marcar avisos já lidos e verificar atrasos sem nada novo não sobem o número", async () => {
  await rpc(mon, "marcar_notificacoes_lidas");
  const v = await versao();
  await rpc(mon, "entrar"); await rpc(sup, "entrar");
  await rpc(mon, "marcar_notificacoes_lidas");
  await rpc(mon, "verificar_atrasos");
  igual(await versao(), v);
});

await t("versão: insert, update com mudança e delete sobem o número; update sem mudança não", async () => {
  let v = await versao();
  await rpc(sup, "comentar_entregador", { p_id_app: "blq00001", p_texto: "Comentário para a versão." });
  if (!(await versao() > v)) throw new Error("insert não subiu");
  v = await versao();
  await db.query("update membros set nome = nome where email = $1", [sup.email]);
  igual(await versao(), v, "update sem mudança:");
  await db.query("update membros set nome = 'Eduarda S' where email = $1", [sup.email]);
  if (!(await versao() > v)) throw new Error("update com mudança não subiu");
  v = await versao();
  await db.query("delete from comentarios_entregador where texto = 'Comentário para a versão.'");
  if (!(await versao() > v)) throw new Error("delete não subiu");
  v = await versao();
  await db.query("delete from comentarios_entregador where false");
  igual(await versao(), v, "delete sem linhas:");
});

await t("versão: tabelas com jsonb e bytea também funcionam; nenhum gatilho antigo sobrou", async () => {
  await db.query("update casos set checklist = checklist where true");
  await db.query("update anexos set nome = nome where true");
  igual((await um("select count(*)::int n from pg_trigger where tgname = 'marcar_mudanca'")).n, 0);
  if ((await um("select count(*)::int n from pg_trigger where tgname = 'marcar_mudanca_upd'")).n < 15) throw new Error("poucas tabelas com o gatilho novo");
});

await t("segurança: quem não é da equipe não descobre o nome da ficha pelo motivo_revisar_cadastro", async () => {
  const fora = pessoa("curioso@gmail.com", "Curioso");
  const linha = { id: randomUUID(), id_app: "blq00001", nome: "Outro Nome", cidade: "LAGARTO - SE", revisado: false };
  const chamar = async (p) => {
    await db.query("begin"); await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: p.sub, email: p.email, role: "authenticated" })]);
    const r = (await db.query("select public.motivo_revisar_cadastro(jsonb_populate_record(null::public.cadastros, $1)) m", [JSON.stringify(linha)])).rows[0].m;
    await db.query("commit"); return r;
  };
  igual(await chamar(fora), null);
  if (!String(await chamar(mon)).includes("Sai Hoje")) throw new Error("a equipe deveria ver o motivo");
});

await t("fora da equipe não vê nada; anon não chama", async () => {
  await falha(rpc(pessoa("x@x.com", "X"), "analises_simples", {}));
  const r = await um("select has_function_privilege('anon', 'public.analises_simples(integer,text)', 'execute') a, has_function_privilege('anon', 'public.analises_complexas(integer,text)', 'execute') b");
  igual([r.a, r.b], [false, false]);
});

console.log(`\n${n - falhas}/${n} testes passaram`);
await db.end();
process.exit(falhas ? 1 : 0);
