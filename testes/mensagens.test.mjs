// Testes da 009c (supabase/009c-mensagens-agravante.sql): explicação das regras, modelos de mensagem,
// agravante no registro do bloqueio e na prévia.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node mensagens.test.mjs
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
  "../supabase/009a-regras-politica.sql", "../supabase/009b-ferramentas-financeiro.sql", "../supabase/009c-mensagens-agravante.sql",
  // rodar de novo não pode quebrar
  "../supabase/009c-mensagens-agravante.sql"]) await db.query(arquivo(f));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");
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
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const num = (x) => (x == null ? null : Number(x));

await rpc(admin, "entrar");
for (const [p, pa, pb] of [[mon, "monitorador", "monitorador"], [sup, "suporte", "suporte"]])
  await rpc(admin, "salvar_membro", { p_email: p.email, p_nome: p.nome, p_papel: pa, p_papel_bloqueios: pb });
for (const p of [mon, sup]) await rpc(p, "entrar");
const inf = async (nome) => (await um("select id from infracoes where nome = $1", [nome])).id;
const RET = await inf("Retenção de Valores ou Equipamentos de Pagamento");
const TER = await inf("Uso da Conta por Terceiros Não Autorizados");
const MAL = await inf("Mal Uso Proposital do Aplicativo");

await t("mensagens: todos leem os modelos e as explicações; a regra nunca diz 'bloqueio'", async () => {
  const m = await rpc(sup, "mensagens");
  igual(m.pode_editar, false);
  igual(m.modelos.map((x) => x.chave).slice(0, 4), ["restricao", "encerramento", "liberacao", "leve"]);
  const r = m.modelos.find((x) => x.chave === "restricao").texto;
  if (!r.includes("restrição temporária") || /bloqueio/i.test(r) || !r.includes("{nome}")) throw new Error(r);
  const ret = m.infracoes.find((x) => x.id === RET);
  if (!ret.explicacao.includes("1 hora")) throw new Error("explicação: " + ret.explicacao);
  igual([ret.agravante_efeito, m.infracoes.find((x) => x.id === TER).agravante_efeito], ["mais_uma", "encerra"]);
  igual(m.leves, { limite: 3, janela_dias: 50 });
});

await t("modelos: só moderador altera; texto vazio é recusado", async () => {
  await falha(rpc(sup, "salvar_modelo_mensagem", { p_chave: "liberacao", p_texto: "Oi" }), "Só moderadores");
  await falha(rpc(admin, "salvar_modelo_mensagem", { p_chave: "liberacao", p_texto: "  " }), "vazio");
  await rpc(admin, "salvar_modelo_mensagem", { p_chave: "liberacao", p_texto: "Olá, {nome}! Liberado." });
  igual((await rpc(mon, "mensagens")).modelos.find((x) => x.chave === "liberacao").texto, "Olá, {nome}! Liberado.");
});

await t("explicação e agravante: só moderador dos bloqueios; agravante precisa do efeito", async () => {
  await falha(rpc(mon, "salvar_explicacao_infracao", { p_infracao: MAL, p_explicacao: "x" }), "não permite");
  await falha(rpc(admin, "salvar_explicacao_infracao", { p_infracao: MAL, p_explicacao: "x", p_agravante: "Algo", p_agravante_efeito: null }), "Escolha o que o agravante faz");
  await rpc(admin, "salvar_explicacao_infracao", { p_infracao: MAL, p_explicacao: "Marcar as etapas no app.", p_agravante: null });
  igual((await rpc(sup, "mensagens")).infracoes.find((x) => x.id === MAL).explicacao, "Marcar as etapas no app.");
});

await t("prévia: mostra a punição com o agravante (retenção 1ª: 24 h, com agravante 168 h)", async () => {
  const p = await rpc(sup, "previa_bloqueio", { p_id_app: "agr00001", p_infracao: RET });
  igual([num(p.horas), p.agravante.texto.includes("8 horas"), num(p.agravante.horas), p.agravante.encerramento], [24, true, 168, false]);
  const t2 = await rpc(sup, "previa_bloqueio", { p_id_app: "agr00001", p_infracao: TER });
  igual([num(t2.horas), t2.agravante.encerramento], [168, true]);
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "agr00001", p_infracao: MAL })).agravante, null, "sem agravante:");
});

await t("registrar com agravante: conta como a próxima ocorrência e fica anotado", async () => {
  const r = await rpc(sup, "registrar_bloqueio_agravante", { p_id_app: "agr00001", p_nome: "Ana Agravo", p_cidade: "LAGARTO - SE", p_infracao: RET, p_agravante: true, p_solucionado: true });
  igual([r.ocorrencia, num(r.horas), r.agravante.includes("8 horas"), r.tarefa], [1, 168, true, true]);
  const ev = await um("select detalhe from eventos_bloqueio where bloqueio_id = $1 and tipo = 'registrado'", [r.id]);
  if (!ev.detalhe.includes("agravante")) throw new Error(ev.detalhe);
});

await t("agravante que encerra: encerramento já na 1ª, com tarefa de encerramento", async () => {
  const r = await rpc(mon, "registrar_bloqueio_agravante", { p_id_app: "agr00002", p_nome: "Beto Conta", p_cidade: "LAGARTO - SE", p_infracao: TER, p_agravante: true });
  igual([r.horas, r.fim], [null, null]);
  igual((await um("select tipo from tarefas where bloqueio_id = $1", [r.id])).tipo, "encerramento_parceria");
});

await t("sem agravante: igual ao registro normal; agravante em infração sem agravante é recusado", async () => {
  const r = await rpc(sup, "registrar_bloqueio_agravante", { p_id_app: "agr00003", p_nome: "Caio Normal", p_cidade: "LAGARTO - SE", p_infracao: RET, p_solucionado: true });
  igual([num(r.horas), r.agravante, r.pendencia], [24, null, null]);
  await falha(rpc(sup, "registrar_bloqueio_agravante", { p_id_app: "agr00004", p_nome: "Dani", p_cidade: "LAGARTO - SE", p_infracao: MAL, p_agravante: true }), "não tem agravante");
  await falha(rpc(sup, "registrar_bloqueio_agravante", { p_id_app: "agr00003", p_nome: "Caio Normal", p_cidade: "LAGARTO - SE", p_infracao: RET, p_solucionado: true }), "há poucos minutos");
});

await t("pendência: retenção pergunta se já foi solucionado; se não, nasce o aviso rápido na tela inicial", async () => {
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "pen00001", p_infracao: RET })).pendencia, "Aguardando prestação de contas");
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "pen00001", p_infracao: MAL })).pendencia, null);
  await falha(rpc(sup, "registrar_bloqueio_agravante", { p_id_app: "pen00001", p_nome: "Paulo Pendente", p_cidade: "LAGARTO - SE", p_infracao: RET }), "já foi solucionado");
  const r = await rpc(sup, "registrar_bloqueio_agravante", { p_id_app: "pen00001", p_nome: "Paulo Pendente", p_cidade: "LAGARTO - SE", p_infracao: RET, p_solucionado: false });
  igual(r.pendencia, "Aguardando prestação de contas");
  const av = (await rpc(mon, "resumo_e_avisos")).resumo.avisos_rapidos;
  igual(av.map((a) => [a.titulo, a.nome, a.id_app, a.criado_por_nome]), [["Aguardando prestação de contas", "Paulo Pendente", "pen00001", "Eduarda"]]);
  // sem pendência em outra infração, mesmo com p_solucionado falso
  await rpc(sup, "registrar_bloqueio_agravante", { p_id_app: "pen00002", p_nome: "Quem", p_cidade: "LAGARTO - SE", p_infracao: MAL, p_solucionado: false });
  igual((await rpc(admin, "resumo_e_avisos")).resumo.avisos_rapidos.length, 1);
});

await t("resolver o aviso rápido: qualquer pessoa; some da tela e fica no histórico do bloqueio", async () => {
  const [a] = (await rpc(admin, "resumo_e_avisos")).resumo.avisos_rapidos;
  await rpc(mon, "resolver_aviso_rapido", { p_id: a.id, p_nota: "Prestou contas na loja" });
  igual((await rpc(sup, "resumo_e_avisos")).resumo.avisos_rapidos, []);
  const ev = await um("select tipo, por_nome, detalhe from eventos_bloqueio where bloqueio_id = $1 and tipo = 'pendencia_resolvida'", [a.bloqueio_id]);
  igual([ev.por_nome, ev.detalhe], ["Jocimara", "Aguardando prestação de contas · Prestou contas na loja"]);
  await falha(rpc(sup, "resolver_aviso_rapido", { p_id: a.id }), "já foi resolvido");
  const n = await um("select texto from notificacoes where texto like '%marcou como resolvido%' order by id desc limit 1");
  if (!n?.texto.includes("aguardando prestação de contas")) throw new Error("aviso de Registros: " + n?.texto);
});

await t("segurança: a tabela de modelos não abre direto; a função interna não fica exposta", async () => {
  await db.query("begin"); await db.query("set local role authenticated");
  await falha(db.query("select * from modelos_mensagem"), "permission denied"); await db.query("rollback");
  igual((await um("select has_function_privilege('authenticated', 'public.horas_com_agravante(public.infracoes, integer)', 'execute') x")).x, false);
});

await db.end();
console.log(`\n${n - falhas}/${n} ok`);
process.exit(falhas ? 1 : 0);
