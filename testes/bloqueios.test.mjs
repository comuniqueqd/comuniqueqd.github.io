// Testes do módulo de bloqueios (supabase/002-bloqueios.sql) num Postgres local.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node bloqueios.test.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
const db = new pg.Client({ connectionString: url });
await db.connect();
for (const f of ["./supabase-local.sql", "../supabase/schema.sql", "../supabase/002-bloqueios.sql"])
  await db.query(readFileSync(new URL(f, import.meta.url), "utf8"));

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
const mon = pessoa("jocimara@x.com", "Jocimara");
const mon2 = pessoa("lucas@x.com", "Lucas Bismarque");
const sup = pessoa("eduarda@x.com", "Eduarda");
const semBloq = pessoa("so.ativacao@x.com", "Só Ativação");

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
// histórico com datas no passado, como a importação da planilha faz (só pelo dono do banco)
const importar = (id, nome, cidade, infracao, diasAtras, revisar = null) =>
  db.query("select public.importar_bloqueio($1, $2, $3, $4, now() - make_interval(days => $5), 'Planilha', $6)", [id, nome, cidade, infracao, diasAtras, revisar]);

let n = 0, falhas = 0;
async function t(nome, fn) { n++; try { await fn(); console.log("ok    ", nome); } catch (e) { falhas++; console.log("FALHOU", nome, "→", e.message); } }
const igual = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
async function falha(p, trecho) {
  try { await p; } catch (e) { if (trecho && !e.message.includes(trecho)) throw new Error(`erro diferente: "${e.message}"`); return e; }
  throw new Error("deveria ter falhado");
}
const INF = Object.fromEntries((await db.query("select nome, id from infracoes")).rows.map((r) => [r.nome, r.id]));
const INF_LEVE = (n) => INF[n];
const REABRIR = INF["Reabrir Pedido Após Aceite Sem Justificativa Plausível"], MAL_USO = INF["Mal Uso Proposital do Aplicativo"],
  ATRASO = INF["Atraso na Coleta ou na Entrega Sem Justificativa"], RETENCAO = INF["Retenção de Valores ou Equipamentos de Pagamento"],
  FURTO = INF["Furto ou Extravio: Desvio de Produtos ou Valores"], AVARIA = INF["Avaria de Produto"];
const registrar = (quem, id, infracao, cidade = "LAGARTO - SE", nome = "Entregador " + id) =>
  rpc(quem, "registrar_bloqueio", { p_id_app: id, p_nome: nome, p_cidade: cidade, p_infracao: infracao, p_observacao: null });
const bloqueio = async (id) => (await db.query("select b.*, b.horas::float8 as horas, public.situacao_bloqueio(b) sit, t.tipo t_tipo, t.status t_status, t.responsavel_email t_resp from bloqueios b left join tarefas t on t.bloqueio_id = b.id where b.id = $1", [id])).rows[0];

// ---------- equipe e regras ----------
await t("migração mantém o admin final e dá a ele moderador nos bloqueios", async () => {
  const r = await rpc(admin, "entrar");
  igual([r.papel, r.papel_bloqueios, r.admin_final], ["moderador", "moderador", true]);
});
await t("equipe com acesso por módulo", async () => {
  await rpc(admin, "salvar_membro", { p_email: mon.email, p_nome: mon.nome, p_papel: "suporte", p_papel_bloqueios: "monitorador" });
  await rpc(admin, "salvar_membro", { p_email: mon2.email, p_nome: mon2.nome, p_papel: "suporte", p_papel_bloqueios: "monitorador" });
  await rpc(admin, "salvar_membro", { p_email: sup.email, p_nome: sup.nome, p_papel: "suporte", p_papel_bloqueios: "suporte" });
  await rpc(admin, "salvar_membro", { p_email: semBloq.email, p_nome: semBloq.nome, p_papel: "suporte", p_papel_bloqueios: null });
  for (const p of [mon, mon2, sup, semBloq]) await rpc(p, "entrar");
  igual((await rpc(mon, "entrar")).papel_bloqueios, "monitorador");
  igual((await rpc(admin, "listar_equipe")).membros.find((m) => m.email === semBloq.email).papel_bloqueios, null);
});
await t("admin final não pode perder o moderador dos bloqueios", () =>
  falha(db.query("update membros set papel_bloqueios = 'suporte' where admin_final"), "membros_admin_final_moderador"));
await t("quem não tem o módulo não acessa os bloqueios", async () => {
  await falha(rpc(semBloq, "regras_bloqueio"), "módulo de bloqueios");
  await falha(registrar(semBloq, "zzzz0000", REABRIR), "módulo de bloqueios");
});
await t("moderador liga cidades aos responsáveis; suporte não", async () => {
  await rpc(admin, "salvar_cidade", { p_nome: "lagarto - se", p_responsavel_email: mon.email, p_ativa: true });
  await rpc(admin, "salvar_cidade", { p_nome: "ITABAIANA - SE", p_responsavel_email: mon2.email, p_ativa: true });
  await falha(rpc(admin, "salvar_cidade", { p_nome: "RECIFE - PE", p_responsavel_email: sup.email, p_ativa: true }), "monitorador ou moderador");
  await falha(rpc(sup, "salvar_cidade", { p_nome: "RECIFE - PE", p_responsavel_email: null, p_ativa: true }), "não permite");
  const r = await rpc(sup, "regras_bloqueio");
  igual(r.cidades.find((c) => c.nome === "LAGARTO - SE").responsavel_nome, "Jocimara");
  igual(r.infracoes.find((i) => i.id === MAL_USO).previstas, [48, 72, 94, 122, 159]);
});

// ---------- cálculo das punições ----------
await t("1ª ocorrência curta: punição da regra e sem tratativa (< 10 h)", async () => {
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "abc12345", p_infracao: REABRIR });
  igual([pv.ocorrencia, pv.horas, pv.gera_tratativa, pv.encerramento], [1, 1, false, false]);
  const r = await registrar(sup, "abc12345", REABRIR);
  const b = await bloqueio(r.id);
  igual([b.ocorrencia, b.horas, b.sit, b.t_tipo, b.registrado_por_nome], [1, 1, "bloqueado", null, "Eduarda"]);
});
await t("registro em dobro em poucos minutos é recusado", () => falha(registrar(mon, "ABC12345", REABRIR), "há poucos minutos"));
await t("3ª ocorrência = 2ª + 30%, gera tratativa para o responsável da cidade", async () => {
  await importar("mal00001", "Fulano", "LAGARTO - SE", "Mal Uso Proposital do Aplicativo", 100);
  await importar("mal00001", "Fulano", "LAGARTO - SE", "Mal Uso Proposital do Aplicativo", 50);
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "mal00001", p_infracao: MAL_USO });
  igual([pv.ocorrencia, pv.horas, pv.gera_tratativa, pv.historico.length], [3, 94, true, 2]);
  const b = await bloqueio((await registrar(sup, "mal00001", MAL_USO)).id);
  igual([b.ocorrencia, b.horas, b.t_tipo, b.t_status, b.t_resp], [3, 94, "tratativa", "pendente", mon.email]);
});
await t("atraso: mais de 60 dias sem atraso zera a punição, mas o histórico continua", async () => {
  await importar("atr00001", "Ciclano", "LAGARTO - SE", "Atraso na Coleta ou na Entrega Sem Justificativa", 200);
  await importar("atr00001", "Ciclano", "LAGARTO - SE", "Atraso na Coleta ou na Entrega Sem Justificativa", 150);
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "atr00001", p_infracao: ATRASO });
  igual([pv.ocorrencia, pv.total, pv.reiniciada, pv.horas, pv.janela_dias], [1, 3, true, 24, 60]);
  const b = await bloqueio((await registrar(sup, "atr00001", ATRASO)).id);
  igual([b.ocorrencia, b.ocorrencia_total, b.horas], [1, 3, 24]);
});
await t("atraso: sequência com intervalos de até 60 dias continua contando", async () => {
  await importar("atr00002", "Beltrano", "LAGARTO - SE", "Atraso na Coleta ou na Entrega Sem Justificativa", 100);
  await importar("atr00002", "Beltrano", "LAGARTO - SE", "Atraso na Coleta ou na Entrega Sem Justificativa", 50);
  const b = await bloqueio((await registrar(sup, "atr00002", ATRASO)).id);
  igual([b.ocorrencia, b.horas], [3, 62]);
});
await t("outras infrações contam para sempre", async () => {
  await importar("mal00002", "Antigo", "LAGARTO - SE", "Mal Uso Proposital do Aplicativo", 400);
  const b = await bloqueio((await registrar(sup, "mal00002", MAL_USO)).id);
  igual([b.ocorrencia, b.horas], [2, 72]);
});
await t("2ª retenção = encerramento de parceria, com tarefa própria", async () => {
  await importar("ret00001", "Retentor", "ITABAIANA - SE", "Retenção de Valores ou Equipamentos de Pagamento", 10);
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "ret00001", p_infracao: RETENCAO });
  igual([pv.ocorrencia, pv.horas, pv.encerramento, pv.fim], [2, null, true, null]);
  const b = await bloqueio((await registrar(sup, "ret00001", RETENCAO, "ITABAIANA - SE")).id);
  igual([b.horas, b.fim, b.sit, b.t_tipo, b.t_resp], [null, null, "encerramento", "encerramento_parceria", mon2.email]);
});
await t("3ª avaria = encerramento (coluna da 3ª era 0); furto encerra na 1ª", async () => {
  await importar("ava00001", "Avariador", "LAGARTO - SE", "Avaria de Produto", 20);
  await importar("ava00001", "Avariador", "LAGARTO - SE", "Avaria de Produto", 10);
  igual((await bloqueio((await registrar(sup, "ava00001", AVARIA)).id)).sit, "encerramento");
  igual((await bloqueio((await registrar(sup, "fur00001", FURTO, "RECIFE - PE")).id)).t_resp, null, "cidade sem responsável → moderadores:");
});
await t("cidade fora da lista é recusada", () => falha(registrar(sup, "cid00001", REABRIR, "CIDADE INVENTADA - XX"), "cidade da lista"));

// ---------- tratativas ----------
await t("cada monitorador vê só as tratativas das suas cidades; moderador vê todas", async () => {
  const m1 = await rpc(mon, "listar_tarefas", { p_status: "pendente" });
  const m2 = await rpc(mon2, "listar_tarefas", { p_status: "pendente" });
  const ad = await rpc(admin, "listar_tarefas", { p_status: "pendente" });
  if (!m1.length || m1.some((x) => x.cidade !== "LAGARTO - SE")) throw new Error("monitor 1: " + m1.map((x) => x.cidade));
  if (!m2.length || m2.some((x) => x.cidade !== "ITABAIANA - SE")) throw new Error("monitor 2: " + m2.map((x) => x.cidade));
  igual(ad.length, m1.length + m2.length + 1, "moderador (inclui RECIFE sem responsável):");
});
await t("suporte acompanha as tratativas dos bloqueios que registrou, sem concluir", async () => {
  const l = await rpc(sup, "listar_tarefas", { p_status: "pendente" });
  if (!l.length || l.some((x) => x.bloqueio.registrado_por !== sup.sub)) throw new Error("lista do suporte errada");
  await falha(rpc(sup, "concluir_tratativa", { p_tarefa: l[0].id, p_nota: null }), "não permite");
});
await t("monitorador não conclui tratativa de outra cidade", async () => {
  const outra = (await rpc(mon2, "listar_tarefas", { p_status: "pendente" }))[0];
  await falha(rpc(mon, "concluir_tratativa", { p_tarefa: outra.id, p_nota: null }), "outro responsável");
});
await t("tratativa concluída: sai das pendentes, bloqueio continua e o suporte é avisado", async () => {
  const tarefa = (await rpc(mon, "listar_tarefas", { p_status: "pendente" })).find((x) => x.bloqueio.id_app === "mal00001");
  await rpc(mon, "concluir_tratativa", { p_tarefa: tarefa.id, p_nota: "Entregador orientado por telefone" });
  const b = await bloqueio(tarefa.bloqueio.id);
  igual([b.t_status, b.sit], ["concluida", "bloqueado"]);
  if ((await rpc(mon, "listar_tarefas", { p_status: "pendente" })).some((x) => x.id === tarefa.id)) throw new Error("continua pendente");
  const notif = await rpc(sup, "minhas_notificacoes");
  igual(notif.nao_lidas, 1);
  if (!/Tratativa realizada por Jocimara: Entregador mal00001.*continua até/.test(notif.itens[0].texto)) throw new Error(notif.itens[0].texto);
  await rpc(sup, "marcar_notificacoes_lidas");
  igual((await rpc(sup, "minhas_notificacoes")).nao_lidas, 0);
  await falha(rpc(admin, "concluir_tratativa", { p_tarefa: tarefa.id, p_nota: null }), "já foi concluída");
});
await t("moderador conclui tratativa de cidade sem responsável", async () => {
  const t1 = (await rpc(admin, "listar_tarefas", { p_status: "pendente" })).find((x) => x.cidade === "RECIFE - PE");
  await rpc(admin, "concluir_tratativa", { p_tarefa: t1.id, p_nota: null });
});
await t("trocar o responsável da cidade passa as tratativas pendentes para ele", async () => {
  await rpc(admin, "salvar_cidade", { p_nome: "ITABAIANA - SE", p_responsavel_email: mon.email, p_ativa: true });
  igual((await rpc(mon2, "listar_tarefas", { p_status: "pendente" })).length, 0);
  if (!(await rpc(mon, "listar_tarefas", { p_status: "pendente" })).some((x) => x.cidade === "ITABAIANA - SE")) throw new Error("não passou");
});

// ---------- liberar antes, excluir ----------
await t("só monitorador/moderador libera antes do prazo, com motivo", async () => {
  const id = (await db.query("select id from bloqueios where id_app = 'atr00002' and not importado")).rows[0].id;
  await falha(rpc(sup, "liberar_bloqueio", { p_bloqueio: id, p_motivo: "x" }), "não permite");
  await falha(rpc(mon, "liberar_bloqueio", { p_bloqueio: id, p_motivo: " " }), "motivo");
  await rpc(mon, "liberar_bloqueio", { p_bloqueio: id, p_motivo: "Comprovou o atraso do restaurante" });
  igual((await bloqueio(id)).sit, "liberado_antes");
  if (!(await rpc(sup, "minhas_notificacoes")).itens[0].texto.includes("liberado antes do prazo")) throw new Error("sem aviso");
  await falha(rpc(mon, "liberar_bloqueio", { p_bloqueio: id, p_motivo: "de novo" }), "não está ativo");
});
await t("só moderador exclui", async () => {
  const id = (await db.query("select id from bloqueios where id_app = 'abc12345'")).rows[0].id;
  await falha(rpc(mon, "excluir_bloqueio", { p_bloqueio: id }), "não permite");
  await rpc(admin, "excluir_bloqueio", { p_bloqueio: id });
});

// ---------- leitura e permissões ----------
await t("suporte só lê os bloqueios que registrou (função e tabela)", async () => {
  const meus = await rpc(sup, "listar_bloqueios", { p_escopo: "todos" });
  if (!meus.length || meus.some((b) => b.registrado_por !== sup.sub)) throw new Error("vazou");
  const direto = await sqlComo(sup, "select count(*)::int n from public.bloqueios where importado");
  igual(direto[0].n, 0);
  const todos = await rpc(mon, "listar_bloqueios", { p_escopo: "todos" });
  if (todos.length <= meus.length) throw new Error("monitor deveria ver tudo");
});
await t("ninguém grava direto nas tabelas", async () => {
  await falha(sqlComo(admin, "insert into public.bloqueios (id_app, nome_entregador, infracao_id, infracao, ocorrencia, ocorrencia_total, registrado_por_nome) values ('aaaa1111','x',1,'x',1,1,'x')"), "permission denied");
  await falha(sqlComo(admin, "update public.infracoes set horas_1a = 999"), "permission denied");
});
await t("app não chama a importação", () => falha(rpc(admin, "importar_bloqueio", { p_id_app: "imp00001", p_nome: "x", p_cidade: null, p_infracao: "Fraude Documental", p_inicio: new Date().toISOString(), p_registrado_por_nome: "x", p_revisar: null }), "permission denied"));
await t("consulta do entregador junta bloqueios e o cadastro da ativação", async () => {
  await rpc(sup, "enviar_cadastro", { p_id_app: "mal00001", p_cpf: null, p_cidade: "LAGARTO - SE", p_observacao: null });
  const r = await rpc(sup, "consultar_entregador", { p_busca: "MAL00001" });
  igual([r.bloqueios.length, r.cadastros[0].situacao], [3, "Aguardando análise"]);
  igual((await rpc(sup, "consultar_entregador", { p_busca: "ciclan" })).bloqueios.length, 2, "busca por nome (os 2 importados com esse nome):");
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "mal00001", p_infracao: MAL_USO })).cadastro.situacao, "Aguardando análise");
});

// ---------- regras editáveis ----------
await t("moderador edita a regra: vale para os próximos, os antigos mantêm as horas", async () => {
  const antes = (await db.query("select horas from bloqueios where id_app = 'atr00001' and not importado")).rows[0].horas;
  await falha(rpc(mon, "salvar_infracao", { p_id: ATRASO, p_nome: "x", p_horas_1a: 1, p_horas_2a: 1, p_terceira_encerra: false, p_fator: 1.3, p_janela_dias: 60, p_ativa: true }), "não permite");
  await rpc(admin, "salvar_infracao", { p_id: ATRASO, p_nome: "Atraso na Coleta ou na Entrega Sem Justificativa", p_horas_1a: 12, p_horas_2a: 48, p_terceira_encerra: false, p_fator: 1.5, p_janela_dias: 60, p_ativa: true });
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "novo0001", p_infracao: ATRASO })).horas, 12);
  igual((await rpc(sup, "regras_bloqueio")).infracoes.find((i) => i.id === ATRASO).previstas, [12, 48, 72, 108, 162]);
  igual((await db.query("select horas from bloqueios where id_app = 'atr00001' and not importado")).rows[0].horas, antes);
  await falha(rpc(admin, "salvar_infracao", { p_id: ATRASO, p_nome: "x", p_horas_1a: null, p_horas_2a: 10, p_terceira_encerra: false, p_fator: 1.3, p_janela_dias: null, p_ativa: true }), "também encerra");
  const nova = await rpc(admin, "salvar_infracao", { p_id: null, p_nome: "Ausência de Resposta ao Suporte", p_horas_1a: 12, p_horas_2a: 24, p_terceira_encerra: false, p_fator: 1.3, p_janela_dias: null, p_ativa: true });
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "novo0001", p_infracao: nova })).horas, 12);
});

// ---------- importação ----------
await t("importação: tratativa pendente só para quem ainda está bloqueado; marca revisão", async () => {
  await importar("imp00001", "Ainda Bloqueado", "LAGARTO - SE", "Mal Uso Proposital do Aplicativo", 1); // 48 h, começou ontem
  await importar("imp00002", "Já Passou", "LAGARTO - SE", "Mal Uso Proposital do Aplicativo", 30);
  await importar("imp00003", "Encerrado Antigo", "CIDADE X - ZZ", "Fraude Documental", 30, "ID com nomes diferentes");
  const r = (await db.query(`select b.id_app, b.cidade, b.revisar, t.status, t.importada from bloqueios b join tarefas t on t.bloqueio_id = b.id where b.id_app like 'imp%' order by b.id_app`)).rows;
  igual(r.map((x) => [x.id_app, x.status]), [["imp00001", "pendente"], ["imp00002", "concluida"], ["imp00003", "concluida"]]);
  igual([r[2].cidade, r[2].revisar], [null, "ID com nomes diferentes"]);
});

// ---------- métricas e tela inicial ----------
await t("métricas para todos os papéis, com filtros", async () => {
  const m = await rpc(sup, "metricas_bloqueios", { p_dias: null });
  if (m.resumo.total < 10 || m.resumo.encerramentos < 3) throw new Error(JSON.stringify(m.resumo));
  const eu = await rpc(sup, "metricas_bloqueios", { p_pessoas: `{${sup.sub}}`, p_dias: null });
  igual(eu.resumo.total, (await rpc(sup, "listar_bloqueios", { p_escopo: "meus" })).length, "filtro só eu:");
  igual(eu.por_pessoa.map((p) => p.nome), ["Eduarda"]);
  const lag = await rpc(sup, "metricas_bloqueios", { p_dias: null, p_cidade: "ITABAIANA - SE" });
  if (lag.por_cidade.some((c) => c.cidade !== "ITABAIANA - SE")) throw new Error("filtro cidade");
  const ret = await rpc(sup, "metricas_bloqueios", { p_dias: 7, p_infracao: RETENCAO });
  igual([ret.resumo.total, ret.por_dia.length], [1, 7]);
  if (!m.reincidentes.some((r) => r.id_app === "mal00001")) throw new Error("ranking de reincidentes");
});
await t("tela inicial mostra os números de cada módulo", async () => {
  const r = await rpc(mon, "resumo_inicio");
  if (!(r.bloqueios.tratativas_pendentes >= 1)) throw new Error(JSON.stringify(r));
  igual((await rpc(semBloq, "resumo_inicio")).bloqueios, null);
  igual((await rpc(sup, "resumo_inicio")).ativacao.aguardando_analise, 1);
});
await t("importação guarda as horas aplicadas na planilha (0 ou Definitivo = encerramento)", async () => {
  await db.query("select public.importar_bloqueio('pla00001', 'Planilha 168', 'LAGARTO - SE', 'Finalização Falsa de Entrega', now() - interval '2 days', 'Joyce', null, '168')");
  await db.query("select public.importar_bloqueio('pla00002', 'Planilha zero', 'LAGARTO - SE', 'Mau Comportamento com Clientes Finais ou Parceiros: Desrespeito ou Atitude Inapropriada', now() - interval '20 days', 'Joyce', null, '0')");
  await db.query("select public.importar_bloqueio('pla00003', 'Planilha def', 'LAGARTO - SE', 'Uso da Conta por Terceiros Não Autorizados', now() - interval '20 days', 'Joyce', null, 'Definitivo')");
  const r = (await db.query("select b.id_app, b.horas::float8 as horas, public.situacao_bloqueio(b) sit, t.status from bloqueios b left join tarefas t on t.bloqueio_id = b.id where id_app like 'pla%' order by id_app")).rows;
  igual(r.map((x) => [x.horas, x.sit, x.status]), [[168, "bloqueado", "pendente"], [null, "encerramento", "concluida"], [null, "encerramento", "concluida"]]);
});
// ---------- infrações leves ----------
const LEVE_REAB = INF_LEVE("Reabertura de Pedido (aviso)"), LEVE_ATR = INF_LEVE("Atraso na Coleta (aviso)");
const leve = (quem, id, inf) => rpc(quem, "registrar_infracao_leve", { p_id_app: id, p_infracao: inf, p_observacao: null });
await t("leve de ID conhecido: 30 min, nome e cidade vêm do histórico, sem tarefa", async () => {
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "mal00001", p_infracao: LEVE_REAB });
  igual([pv.leve, pv.horas, pv.gera_tratativa, pv.leves.esta_sera, pv.leves.limite, pv.leves.janela_dias, pv.nome_conhecido, pv.cidade_conhecida],
        [true, 0.5, false, 1, 3, 50, "Entregador mal00001", "LAGARTO - SE"]);
  const r = await leve(sup, "mal00001", LEVE_REAB);
  igual([r.horas, r.dados_pendentes, r.leves, r.gerado], [0.5, false, 1, null]);
  const b = await bloqueio(r.id);
  igual([b.leve, b.horas, b.nome_entregador, b.cidade, b.sit, b.t_tipo], [true, 0.5, "Entregador mal00001", "LAGARTO - SE", "bloqueado", null]);
  if (!(new Date(b.fim) - new Date(b.inicio) === 30 * 60000)) throw new Error("fim errado");
});
await t("leve não conta como ocorrência da infração normal (e vice-versa)", async () => {
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "mal00001", p_infracao: REABRIR });
  igual(pv.ocorrencia, 1);
});
await t("registro normal recusa motivo leve e o registro leve recusa infração normal", async () => {
  await falha(registrar(sup, "zzzz1234", LEVE_REAB), "Escolha a infração");
  await falha(leve(sup, "zzzz1234", REABRIR), "motivo da infração leve");
});
await t("ID nunca visto: registra com dados a completar e cria tarefa para o monitoramento", async () => {
  const r = await leve(sup, "novo9999", LEVE_ATR);
  igual([r.dados_pendentes, r.nome, r.cidade], [true, null, null]);
  const b = await bloqueio(r.id);
  igual([b.nome_entregador, b.dados_pendentes, b.t_tipo, b.t_resp], ["(a completar)", true, "completar_dados", null]);
  const doMon = (await rpc(mon2, "listar_tarefas", { p_status: "pendente" })).find((x) => x.tipo === "completar_dados");
  if (!doMon || !doMon.minha) throw new Error("monitorador de qualquer cidade deve ver e poder completar");
  await falha(rpc(mon2, "concluir_tratativa", { p_tarefa: doMon.id, p_nota: null }), "Completar dados");
  await falha(rpc(sup, "completar_dados_bloqueio", { p_tarefa: doMon.id, p_nome: "X", p_cidade: "LAGARTO - SE" }), "não permite");
});
await t("3ª leve em 50 dias (motivos juntos) gera bloqueio normal + tarefa e zera a contagem", async () => {
  // a 1ª (atraso) passa a ter sido ontem, para não esbarrar na trava de registro em dobro
  await db.query("update bloqueios set inicio = inicio - interval '1 day', fim = fim - interval '1 day' where id_app = 'novo9999'");
  await leve(sup, "novo9999", LEVE_REAB);  // 2ª
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "novo9999", p_infracao: LEVE_ATR });
  igual([pv.leves.esta_sera, pv.leves.gera_bloqueio, pv.leves.bloqueio_infracao, pv.leves.bloqueio_horas], [3, true, "Atraso na Coleta ou na Entrega Sem Justificativa", 12]); // o teste de regras mudou o atraso para 12 h
  const r = await leve(mon, "novo9999", LEVE_ATR); // 3ª, registrada por monitorador
  igual([r.leves, r.gerado?.infracao, r.gerado?.ocorrencia, r.gerado?.horas], [3, "Atraso na Coleta ou na Entrega Sem Justificativa", 1, 12]);
  const g = await bloqueio(r.gerado.id);
  igual([g.leve, g.horas, g.t_tipo, g.t_status, g.dados_pendentes], [false, 12, "leves_acumuladas", "pendente", true]);
  igual((await bloqueio(r.id)).gerou_bloqueio, r.gerado.id);
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "novo9999", p_infracao: LEVE_REAB })).leves.esta_sera, 1, "contagem zerada:");
});
await t("completar dados atualiza todos os registros do ID e passa a tarefa para o responsável da cidade", async () => {
  const tar = (await rpc(mon2, "listar_tarefas", { p_status: "pendente" })).filter((x) => x.tipo === "completar_dados");
  igual(tar.length, 1, "uma tarefa por ID sem dados:");
  await rpc(mon2, "completar_dados_bloqueio", { p_tarefa: tar[0].id, p_nome: "Novato Silva", p_cidade: "lagarto - se" });
  const r = (await db.query("select nome_entregador, cidade, dados_pendentes from bloqueios where id_app = 'novo9999'")).rows;
  if (r.some((x) => x.nome_entregador !== "Novato Silva" || x.cidade !== "LAGARTO - SE" || x.dados_pendentes)) throw new Error(JSON.stringify(r));
  igual((await rpc(mon2, "listar_tarefas", { p_status: "pendente" })).filter((x) => x.tipo === "completar_dados").length, 0, "todas concluídas:");
  const acum = (await rpc(mon, "listar_tarefas", { p_status: "pendente" })).find((x) => x.tipo === "leves_acumuladas");
  igual([acum?.cidade, acum?.responsavel_email], ["LAGARTO - SE", mon.email]);
  await rpc(mon, "concluir_tratativa", { p_tarefa: acum.id, p_nota: "Conversei sobre as reaberturas" });
});
await t("leves fora da janela de 50 dias não contam", async () => {
  await db.query("select public.importar_bloqueio('vel00001', 'Veterano', 'LAGARTO - SE', 'Atraso na Coleta (aviso)', now() - interval '80 days', 'Planilha')");
  await db.query("select public.importar_bloqueio('vel00001', 'Veterano', 'LAGARTO - SE', 'Atraso na Coleta (aviso)', now() - interval '60 days', 'Planilha')");
  await db.query("select public.importar_bloqueio('vel00001', 'Veterano', 'LAGARTO - SE', 'Reabertura de Pedido (aviso)', now() - interval '10 days', 'Planilha')");
  igual((await rpc(sup, "previa_bloqueio", { p_id_app: "vel00001", p_infracao: LEVE_ATR })).leves.esta_sera, 2);
});
await t("moderador edita duração, limite e período das leves", async () => {
  await falha(rpc(mon, "salvar_parametros_leves", { p_limite: 2, p_janela_dias: 30 }), "não permite");
  await rpc(admin, "salvar_parametros_leves", { p_limite: 2, p_janela_dias: 100 });
  await rpc(admin, "salvar_infracao_leve", { p_id: LEVE_ATR, p_nome: "Atraso na Coleta (aviso)", p_minutos: 45, p_escala_para: ATRASO, p_ativa: true });
  const pv = await rpc(sup, "previa_bloqueio", { p_id_app: "vel00001", p_infracao: LEVE_ATR });
  igual([pv.horas, pv.leves.esta_sera, pv.leves.limite, pv.leves.gera_bloqueio], [0.75, 4, 2, true]);
  await falha(rpc(admin, "salvar_infracao_leve", { p_id: LEVE_ATR, p_nome: "x", p_minutos: 0, p_escala_para: ATRASO, p_ativa: true }), "1 a 1440");
  await falha(rpc(admin, "salvar_infracao", { p_id: LEVE_ATR, p_nome: "x", p_horas_1a: 5, p_horas_2a: 5, p_terceira_encerra: false, p_fator: 1.3, p_janela_dias: null, p_ativa: true }), "não encontrada");
  const r = await rpc(sup, "regras_bloqueio");
  igual([r.leves.limite, r.leves.janela_dias, r.infracoes.filter((i) => i.leve).length], [2, 100, 2]);
  await rpc(admin, "salvar_parametros_leves", { p_limite: 3, p_janela_dias: 50 });
});
await t("métricas separam normais e leves", async () => {
  const m = await rpc(sup, "metricas_bloqueios", { p_dias: null });
  if (!(m.resumo.leves >= 4 && m.resumo.leves_que_geraram === 1 && m.resumo.normais > 0)) throw new Error(JSON.stringify(m.resumo));
  const so = await rpc(sup, "metricas_bloqueios", { p_dias: null, p_tipo: "leve" });
  igual(so.resumo.total, so.resumo.leves);
  const nor = await rpc(sup, "metricas_bloqueios", { p_dias: null, p_tipo: "normal" });
  igual(nor.resumo.leves, 0);
});
await t("migração pode rodar de novo sem erro", () => db.query(readFileSync(new URL("../supabase/002-bloqueios.sql", import.meta.url), "utf8")));

await db.end();
console.log(`\n${n - falhas}/${n} passaram`);
process.exit(falhas ? 1 : 0);
