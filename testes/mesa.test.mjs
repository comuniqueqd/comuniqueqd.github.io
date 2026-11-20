// Testes da 009u (supabase/009u-sem-cpf-nos-textos.sql): CPF em texto livre sai na gravação; quem_e para o adicional.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node mesa.test.mjs
import pg from "pg";
import { completar } from "./carregar-banco.mjs";
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
  "../supabase/009p-bairros-parecidos.sql", "../supabase/009s-sem-cpf.sql"];
for (const f of M) { if (process.env.LOG) console.log(f); await db.query(arquivo(f)); }

const pessoa = (email, nome) => ({ email, nome, sub: randomUUID() });
const admin = pessoa("mateuslopesmb@gmail.com", "Mateus Lopes");
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
await db.query("insert into cidades (nome) values ('LAGARTO - SE') on conflict do nothing");
await db.query("update membros set papel_bloqueios = 'moderador' where email = $1", [admin.email]);

// AT1: massa fictícia (1.500 IDs bloqueados em 50 dias, 300 aprovados há pouco) para comparar a função antiga com a nova
await db.query(`insert into cadastros (id_app, cidade, status, enviado_por, enviado_em, status_desde, nome, decidido_por, decidido_em)
  select 'at'||lpad(i::text,5,'0'), 'LAGARTO - SE', 'aprovado', m.user_id, now() - (i % 40) * interval '1 day', now() - (i % 40) * interval '1 day',
         'Teste Atencao '||i, m.user_id, now() - (i % 40) * interval '1 day'
    from generate_series(1, 300) i, (select user_id from membros where email = '${admin.email}') m`);
await db.query(`insert into eventos (cadastro_id, tipo, status_anterior, status_novo, por, em)
  select id, 'aprovado', 'aguardando_analise', 'aprovado', decidido_por, decidido_em from cadastros where id_app like 'at%'`);
await db.query(`insert into bloqueios (id_app, nome_entregador, cidade, infracao_id, infracao, ocorrencia, ocorrencia_total, horas, inicio, fim,
    registrado_por, registrado_por_nome, leve)
  select 'at'||lpad((1 + i % 1500)::text,5,'0'), 'Teste Atencao '||(1 + i % 1500), 'LAGARTO - SE', inf.id, inf.nome, 1, 1, inf.h,
         now() - (i % 49) * interval '1 day' - (i % 7) * interval '1 hour', now() - (i % 49) * interval '1 day' + inf.h * interval '1 hour',
         m.user_id, 'Mateus Lopes', inf.leve
    from generate_series(1, 4000) i, (select user_id from membros where email = '${admin.email}') m,
    lateral (select id, nome, leve, coalesce(horas_1a, 24) h from infracoes where leve = (i % 5 = 0) order by id offset (i % 3) limit 1) inf`);
const antes = await rpc(admin, "entregadores_atencao");

// a 009u, duas vezes (pode rodar de novo)
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009u-sem-cpf-nos-textos.sql"));
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009v-tarefas-abertas.sql"));
await completar(db, "009v-tarefas-abertas.sql", { manterRegras: true });   // A7-04: e todas as migrações que vieram depois

await t("AT1: entregadores_atencao() nova devolve exatamente o mesmo que a antiga", async () => {
  const depois = await rpc(admin, "entregadores_atencao");
  if (!antes.length || !antes.some((x) => x.motivos.includes("aprovado há pouco e já bloqueado"))) throw new Error("massa sem casos de atenção: " + antes.length);
  igual(JSON.stringify(depois), JSON.stringify(antes));
});
await t("AT1: e o resumo da tela inicial responde rápido com a massa", async () => {
  const t0 = Date.now(); await rpc(admin, "resumo_e_avisos"); const ms = Date.now() - t0;
  if (ms > 1500) throw new Error(ms + " ms");
  console.log("       resumo_e_avisos com 4.000 bloqueios:", ms, "ms");
});
await rpc(admin, "cadastrar_entregador", { p_id_app: "mesa0001", p_nome: "Fulano de Tal", p_cidade: "LAGARTO - SE", p_comentario: null });

await t("quando alguém escreve um CPF formatado num comentário, então ele é gravado como [CPF removido]", async () => {
  await rpc(admin, "comentar_entregador", { p_id_app: "mesa0001", p_texto: "Mandou o CPF 529.982.247-25 no chat, telefone 79999998888" });
  const c = await um("select texto from comentarios_entregador where id_app = 'mesa0001' and texto like 'Mandou%'");
  igual(c.texto, "Mandou o CPF [CPF removido] no chat, telefone 79999998888");
});
await t("quando o CPF vem só em números depois da palavra CPF, então também sai (e o telefone fica)", async () => {
  await rpc(admin, "criar_aviso_geral", { p_texto: "cpf: 52998224725 do entregador, ligar 79999998888", p_horas: 1 });
  const a = await um("select texto from avisos_rapidos where tipo = 'aviso' order by criado_em desc limit 1");
  igual(a.texto, "cpf: [CPF removido] do entregador, ligar 79999998888");
});
await t("quando há CPF dentro de um jsonb, então ele sai e o jsonb continua válido", async () => {
  await rpc(admin, "sugerir_atividade", { p_titulo: "Teste do jsonb", p_descricao: null, p_para: null });
  await db.query(`update atividades set campos = '{"obs": "CPF 111.444.777-35", "n": 3}'::jsonb where titulo = 'Teste do jsonb'`);
  const v = await um("select campos as j from atividades where titulo = 'Teste do jsonb'");
  igual(v.j, { n: 3, obs: "CPF [CPF removido]" });
});
await t("quando o ID tem ficha, então quem_e devolve nome e cidade", async () => {
  igual(await rpc(admin, "quem_e", { p_id_app: " MESA0001 " }), { nome: "Fulano de Tal", cidade: "LAGARTO - SE", id_app: "mesa0001", tem_ficha: true });
});
await t("quando o ID não tem ficha, então quem_e não inventa nome", async () => {
  igual(await rpc(admin, "quem_e", { p_id_app: "naoexiste9" }), { nome: null, cidade: null, id_app: "naoexiste9", tem_ficha: false });
  igual(await rpc(admin, "quem_e", { p_id_app: "ab" }), null, "ID curto");
});
await t("quem não é da equipe não usa quem_e", async () => {
  await falha(rpc(pessoa("estranho@x.com", "Estranho"), "quem_e", { p_id_app: "mesa0001" }));
});

await t("avisos sem o código do entregador: o nome fica, o código sai, sem nome vira 'sem nome' e a busca continua pelo id_app", async () => {
  const para = (await um("select user_id from membros where email = $1", [admin.email])).user_id;
  await db.query(`insert into notificacoes (para, texto) values ($1, 'Suporte registrou um bloqueio: Fulano de Tal (mesa0001) · Atraso · LAGARTO - SE'),
    ($1, 'Seu cadastro ID abc99999 foi aprovado por Monitor.'), ($1, 'Suporte enviou um cadastro: xyz12345 · LAGARTO - SE'),
    ($1, '👏 Suporte agradeceu por: Ligar (2 vezes)')`, [para]);
  const l = (await db.query("select texto, id_app from notificacoes where para = $1 order by id desc limit 4", [para])).rows.reverse();
  igual(l, [{ texto: "Suporte registrou uma restrição: Fulano de Tal · Atraso · LAGARTO - SE", id_app: "mesa0001" },   // 009x4: "restrição"
    // 009x/009x2 (PB-6): o código só sai quando é de um entregador conhecido (ficha, cadastro ou restrição); estes dois não são
    { texto: "Seu cadastro ID abc99999 foi aprovado por Monitor.", id_app: null },
    { texto: "Suporte enviou um cadastro: xyz12345 · LAGARTO - SE", id_app: null },
    { texto: "Suporte agradeceu por: Ligar (2 vezes)", id_app: null }]);
});

await t("009v: quando há tarefa aberta criada por outra pessoa, então ela conta em abertas_para_pegar (a minha não conta)", async () => {
  const outro = pessoa("outro.mesa@x.com", "Outro Mesa");
  await db.query("insert into membros (email, nome, papel) values ($1, $2, 'suporte') on conflict do nothing", [outro.email, outro.nome]);
  await rpc(outro, "entrar");
  const antes = (await rpc(admin, "resumo_inicio")).atividades.abertas_para_pegar;
  await rpc(outro, "sugerir_atividade", { p_titulo: "Aberta do outro" });
  await rpc(admin, "sugerir_atividade", { p_titulo: "Aberta minha" });
  const r = (await rpc(admin, "resumo_inicio")).atividades;
  igual(r.abertas_para_pegar, antes + 1, "abertas_para_pegar");
  igual(r.para_aceitar <= r.abertas_para_pegar, true, "para_aceitar é parte das abertas");
});

await t("009v: aviso que só trazia o ID mostra o nome do cadastro (e 'sem nome' só quando não há nome)", async () => {
  await rpc(admin, "enviar_cadastro", { p_id_app: "6aeff32c5ac2", p_cpf: null, p_cidade: "LAGARTO - SE", p_nome: "Paulo Mauricio da Silva" });
  const para = (await um("select user_id from membros where email = $1", [admin.email])).user_id;
  await db.query(`insert into notificacoes (para, texto) values ($1, 'Cadastro novo em LAGARTO - SE: ID 6aeff32c5ac2, enviado por Maria.'),
    ($1, 'Seu cadastro ID 6aeff32c5ac2 foi aprovado por Monitor.'), ($1, 'Cadastro novo em LAGARTO - SE: ID zz9sem9nome, enviado por Maria.')`, [para]);
  const l = (await db.query("select texto from notificacoes where para = $1 order by id desc limit 3", [para])).rows.map((x) => x.texto).reverse();
  igual(l, ["Cadastro novo em LAGARTO - SE: Paulo Mauricio da Silva, enviado por Maria.", "Seu cadastro Paulo Mauricio da Silva foi aprovado por Monitor.",
    "Cadastro novo em LAGARTO - SE: ID zz9sem9nome, enviado por Maria."]   /* 009x2: ID desconhecido fica */);
});
await t("009v: os avisos que a 009u deixou com 'sem nome' ganham o nome ao rodar a 009v", async () => {
  const para = (await um("select user_id from membros where email = $1", [admin.email])).user_id;
  await db.query("alter table notificacoes disable trigger aac_aviso_sem_id");
  await db.query("insert into notificacoes (para, texto, id_app) values ($1, 'Cadastro novo em LAGARTO - SE: sem nome, enviado por Maria.', '6aeff32c5ac2')", [para]);
  await db.query("alter table notificacoes enable trigger aac_aviso_sem_id");
  await db.query(arquivo("../supabase/009v-tarefas-abertas.sql"));
  await completar(db, "009v-tarefas-abertas.sql", { manterRegras: true });
  igual((await um("select texto from notificacoes where para = $1 order by id desc limit 1", [para])).texto, "Cadastro novo em LAGARTO - SE: Paulo Mauricio da Silva, enviado por Maria.");
});

console.log(`\n${n - falhas}/${n} ok`);
await db.end();
process.exit(falhas ? 1 : 0);
