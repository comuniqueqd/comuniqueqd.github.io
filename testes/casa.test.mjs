// Testes da 009x (supabase/009x-casa-em-ordem.sql): listas com limite (Histórico da ativação em páginas,
// tratativas concluídas com "Ver mais", atividades com as concluídas limitadas) e o índice do Resumo semanal.
// Carrega TODAS as migrações (carregar-banco.mjs), como o banco de verdade.
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste node casa.test.mjs
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
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
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009x2-avisos-sem-codigo.sql"));
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009x3-tarefas-automaticas.sql"));
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009x4-restricao.sql"));
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009x5-avisos-que-importam.sql"));
for (let i = 0; i < 2; i++) await db.query(arquivo("../supabase/009x6-suporte-ve-tudo.sql"));

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
await t("Histórico: 'Só os que eu enviei'; o suporte vê todos (009x6) e filtra os seus", async () => {
  igual((await rpc(admin, "listar_cadastros_pagina", { p_meus: true })).total, 4700, "admin: os seus");
  const s = await rpc(sup, "listar_cadastros_pagina", {});
  igual([s.total, s.contagens.cadastros], [5000, 5000], "suporte vê todos");
  igual((await rpc(sup, "listar_cadastros_pagina", { p_meus: true })).total, 300, "suporte: os seus");
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
await t("Tratativas concluídas: o suporte vê todas (009x6), sem poder agir", async () => {
  const l = (await rpc(sup, "listar_tarefas_concluidas", {})).itens;
  igual(l.length, 100); verdade(l.every((x) => !x.minha), "nenhuma é dele");
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

// ---------- correções do estudo de nov/2026 ----------
const mona = pessoa("mona.casa@x.com", "Mona Monitora");
await db.query("insert into membros (email, nome, papel, papel_bloqueios) values ($1, $2, 'monitorador', 'monitorador') on conflict do nothing", [mona.email, mona.nome]);
await rpc(mona, "entrar");

await t("PB-1: tarefa sugerida só para outra pessoa (nos primeiros 10 min) e a que eu criei não contam nas minhas abertas", async () => {
  const antes = (await rpc(sup, "resumo_inicio")).atividades.abertas_para_pegar;
  const uMona = (await um("select user_id from membros where email = $1", [mona.email])).user_id;
  await rpc(admin, "sugerir_atividade", { p_titulo: "Só para a Mona", p_para: [uMona] });
  await rpc(sup, "sugerir_atividade", { p_titulo: "Criada pela suporte" });
  igual((await rpc(sup, "resumo_inicio")).atividades.abertas_para_pegar, antes, "suporte");
  const lista = await rpc(sup, "listar_atividades", { p_concluidas: 0 });
  verdade(!lista.some((a) => a.titulo === "Só para a Mona"), "a suporte não vê a da Mona (por isso não conta)");
  verdade((await rpc(mona, "resumo_inicio")).atividades.para_aceitar >= 1, "a Mona vê e conta a dela");
});
await t("PB-2: quem entra junto numa tarefa compartilhada conta ela em 'minhas em andamento'", async () => {
  const tf = await rpc(admin, "criar_tarefa", { p_tipo: "ativar_entregadores", p_campos: { cidade: "LAGARTO - SE", quantidade: 3 } });
  await rpc(sup, "aceitar_atividade", { p_id: tf.id });
  await rpc(mona, "aceitar_atividade", { p_id: tf.id });
  const s1 = (await rpc(sup, "resumo_inicio")).atividades.minhas_em_andamento, m1 = (await rpc(mona, "resumo_inicio")).atividades.minhas_em_andamento;
  verdade(s1 >= 1 && m1 >= 1, `suporte ${s1}, Mona ${m1}`);
});
await t("PB-3: quem perde o papel nos bloqueios deixa a cidade sem responsável e a tratativa vai para os moderadores", async () => {
  await db.query("update cidades set responsavel_email = $1 where nome = 'ITABAIANA - SE'", [mona.email]);
  await db.query(`with b as (insert into bloqueios (id_app, nome_entregador, cidade, infracao_id, infracao, ocorrencia, ocorrencia_total, horas, inicio, fim, registrado_por, registrado_por_nome, leve)
      select 'pb3x0001', 'Entregador PB3', 'ITABAIANA - SE', id, nome, 1, 1, 24, now(), now() + interval '24 hours', $2, 'Mateus Lopes', false from infracoes where not leve order by id limit 1 returning id)
    insert into tarefas (modulo, tipo, bloqueio_id, cidade, responsavel_email, status) select 'bloqueios', 'tratativa', id, 'ITABAIANA - SE', $1, 'pendente' from b`, [mona.email, uAdmin]);
  await rpc(admin, "salvar_membro", { p_email: mona.email, p_nome: mona.nome, p_papel: "monitorador", p_papel_bloqueios: null });
  igual((await um("select responsavel_email r from cidades where nome = 'ITABAIANA - SE'")).r, null, "cidade");
  igual((await um("select t.responsavel_email r from tarefas t join bloqueios b on b.id = t.bloqueio_id where b.id_app = 'pb3x0001'")).r, null, "tratativa");
});
await t("PB-3: quem sai da equipe devolve as tarefas que tinha aceitado", async () => {
  const tf = await rpc(admin, "sugerir_atividade", { p_titulo: "Aceita pela Mona" });
  const id = tf?.id || (await um("select id from atividades where titulo = 'Aceita pela Mona'")).id;
  await rpc(mona, "aceitar_atividade", { p_id: id });
  await rpc(admin, "remover_membro", { p_email: mona.email });
  igual((await um("select status, aceita_por from atividades where id = $1", [id])), { status: "aberta", aceita_por: null });
});
await t("PB-4: a busca das tratativas concluídas acha por quem registrou", async () => {
  verdade((await rpc(admin, "listar_tarefas_concluidas", { p_busca: "mateus lopes" })).itens.length > 0, "por quem registrou");
});
await t("PB-6: pedido de ajuda e aviso geral ficam como a pessoa escreveu (placa e códigos não somem)", async () => {
  await db.query(`insert into notificacoes (para, texto, categoria) values ($1, 'Mateus Lopes pediu ajuda: moto do entregador (QWE1A23) parada no posto', 'ajuda'),
    ($1, 'Aviso geral de Mateus Lopes: cupom NATAL25 no ar', 'aviso_geral')`, [uSup]);
  const l = (await db.query("select texto, id_app from notificacoes where para = $1 and categoria in ('ajuda', 'aviso_geral') order by id", [uSup])).rows;
  igual(l, [{ texto: "Mateus Lopes pediu ajuda: moto do entregador (QWE1A23) parada no posto", id_app: null }, { texto: "Aviso geral de Mateus Lopes: cupom NATAL25 no ar", id_app: null }]);
});
await t("PB-5: aviso de cadastro com ID só de números também perde o código e ganha o id_app", async () => {
  const c = (await um("insert into cadastros (id_app, nome, cidade, status, enviado_por) values ('48291377', 'Jose Numeros', 'LAGARTO - SE', 'aprovado', $1) returning id", [uSup])).id;
  await db.query("insert into notificacoes (para, texto, link) values ($1, 'Seu cadastro Jose Numeros (ID 48291377) foi aprovado por Monitor.', $2)", [uSup, "#cadastro/" + c]);
  igual(await um("select texto, id_app from notificacoes where link = $1", ["#cadastro/" + c]), { texto: "Seu cadastro Jose Numeros foi aprovado por Monitor.", id_app: "48291377" });
});

await t("009x2: aviso pessoal sobre cadastro (link #ativacao/meus) perde o código; aviso não começa com emoji", async () => {
  await db.query("insert into cadastros (id_app, nome, cidade, status, enviado_por) values ('pess0001', 'Pessoa Pessoal', 'LAGARTO - SE', 'aprovado', $1) on conflict do nothing", [uSup]);
  await db.query(`insert into notificacoes (para, texto, link) values ($1, 'Seu cadastro ID pess0001 foi aprovado por Monitor.', '#ativacao/meus'),
    ($1, 'Suporte: cadastro para completar (ID pess0001).', '#atividades/sugeridas'), ($1, '✅ Mateus revisou "Ligar": tudo certo.', '#atividades/sugeridas')`, [uSup]);
  const l = (await db.query("select texto, id_app from notificacoes where para = $1 order by id desc limit 3", [uSup])).rows.reverse();
  igual(l, [{ texto: "Seu cadastro Pessoa Pessoal foi aprovado por Monitor.", id_app: "pess0001" },
    { texto: "Suporte: cadastro para completar.", id_app: "pess0001" }, { texto: 'Mateus revisou "Ligar": tudo certo.', id_app: null }]);
});

await t("009x3: tarefa automática do parceiro conta as aprovações de qualquer pessoa na cidade, desde que nasceu; a manual só as de quem pegou", async () => {
  const aprovar = async (id, quem) => {
    const c = await um("insert into cadastros (id_app, nome, cidade, status, enviado_por) values ($1, 'Aprovado Auto', 'CARPINA - PE', 'aprovado', $2) returning id", [id, quem]);
    await db.query("insert into eventos (cadastro_id, tipo, status_novo, por) values ($1, 'aprovado', 'aprovado', $2)", [c.id, quem]);
  };
  await aprovar("auto0000", uSup);   // antes da tarefa existir: não conta
  await db.query("update eventos set em = now() - interval '1 hour' where cadastro_id = (select id from cadastros where id_app = 'auto0000')");
  const r = await rpc(admin, "registrar_parceiro", { p_estabelecimento: "Sorveteria Teste", p_cidade: "CARPINA - PE" });
  igual(r.tarefa_entregadores.nova, true, "nasceu a automática");
  const auto = await um("select id, automatica from atividades where cidade = 'CARPINA - PE' and tipo = 'ativar_entregadores'");
  igual(auto.automatica, true, "marcada como automática");
  const manual = await rpc(admin, "criar_tarefa", { p_tipo: "ativar_entregadores", p_campos: JSON.stringify({ cidade: "CARPINA - PE", quantidade: 3 }) });
  const idManual = manual.id || manual;
  await rpc(admin, "aceitar_atividade", { p_id: idManual });
  await aprovar("auto0001", uSup);   // o suporte aprova, ninguém pegou a automática
  await aprovar("auto0002", uAdmin);
  const prog = async (id) => (await um("select public.progresso_tarefa(a) p from atividades a where id = $1", [id])).p;
  igual(await prog(auto.id), 2, "automática: as duas aprovações de pessoas diferentes");
  igual(await prog(idManual), 1, "manual: só a de quem pegou");
  const conta = await rpc(sup, "tarefas_que_contam", { p_tipo: "ativar_entregadores", p_cidade: "CARPINA - PE" });
  igual(conta.map((x) => x.id), [auto.id], "para o suporte, contou na automática");
  const j = await rpc(sup, "listar_atividades");
  verdade(j.find((x) => x.id === auto.id)?.automatica === true, "o cartão sabe que é automática");
});

await t("009x3: a tarefa automática fecha sozinha ao bater a meta e avisa quem participou", async () => {
  const aprovar = async (id, quem) => {
    const c = await um("insert into cadastros (id_app, nome, cidade, status, enviado_por) values ($1, 'Aprovado Auto', 'CARPINA - PE', 'aprovado', $2) returning id", [id, quem]);
    await db.query("insert into eventos (cadastro_id, tipo, status_novo, por) values ($1, 'aprovado', 'aprovado', $2)", [c.id, quem]);
  };
  const auto = await um("select id from atividades where cidade = 'CARPINA - PE' and automatica");
  await aprovar("auto0003", uSup); await aprovar("auto0004", uSup);
  igual((await um("select status from atividades where id = $1", [auto.id])).status, "aberta", "4 de 5: continua aberta");
  await db.query("delete from notificacoes where para in ($1, $2)", [uAdmin, uSup]);
  await aprovar("auto0005", uAdmin);
  const a = await um("select status, concluida_por_nome, nota from atividades where id = $1", [auto.id]);
  igual([a.status, a.concluida_por_nome], ["concluida", "Equipe"], "fechou");
  verdade(a.nota.includes("Mateus Lopes") && a.nota.includes("Suporte Casa"), "nota com quem participou: " + a.nota);
  const av = (await db.query("select texto from notificacoes where para = $1", [uSup])).rows.map((x) => x.texto);
  verdade(av.some((x) => x.startsWith("Meta da equipe atingida")), "o suporte foi avisado: " + JSON.stringify(av));
  igual((await um("select status from atividades a where cidade = 'CARPINA - PE' and not automatica")).status, "aceita", "a manual não fecha");
});

await t("009x3 (A6-01): quem sai da equipe perde os avisos e não recebe novos", async () => {
  const ex = pessoa("ex.membro@x.com", "Ex Membro");
  await db.query("insert into membros (email, nome, papel) values ($1, $2, 'suporte')", [ex.email, ex.nome]);
  await rpc(ex, "entrar");
  const uEx = (await um("select user_id from membros where email = $1", [ex.email])).user_id;
  await db.query("insert into notificacoes (para, texto) values ($1, 'Aviso antigo')", [uEx]);
  await db.query("insert into seguindo (para, tipo, alvo) values ($1, 'cidade', 'LAGARTO - SE')", [uEx]);
  await rpc(admin, "remover_membro", { p_email: ex.email });
  igual((await um("select count(*)::int n from notificacoes where para = $1", [uEx])).n, 0, "avisos apagados");
  igual((await um("select count(*)::int n from seguindo where para = $1", [uEx])).n, 0, "seguindo apagado");
  await db.query("insert into notificacoes (para, texto) values ($1, 'Aviso novo')", [uEx]);
  igual((await um("select count(*)::int n from notificacoes where para = $1", [uEx])).n, 0, "aviso novo não é gravado");
  // e a leitura direta da tabela (API REST/Realtime) não devolve nada para quem não é membro
  await db.query("begin"); await db.query("set local role postgres");
  await db.query("alter table notificacoes disable trigger aa0_so_para_membros");
  await db.query("insert into notificacoes (para, texto) values ($1, 'Escapou')", [uEx]);
  await db.query("alter table notificacoes enable trigger aa0_so_para_membros");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ex.sub, email: ex.email, role: "authenticated" })]);
  const n = (await db.query("select count(*)::int n from notificacoes")).rows[0].n;
  await db.query("rollback");
  igual(n, 0, "a política não deixa ler");
});

await t("009x3 (A5-09): reverter um encerramento fecha a tarefa de encerramento", async () => {
  const b = await um(`insert into bloqueios (id_app, nome_entregador, cidade, infracao_id, infracao, ocorrencia, ocorrencia_total, horas, inicio, registrado_por, registrado_por_nome, leve)
      select 'enc00001', 'Entregador Enc', 'LAGARTO - SE', id, nome, 1, 1, null, now(), $1, 'Mateus Lopes', false from infracoes where not leve order by id limit 1 returning id`, [uAdmin]);
  await db.query("insert into tarefas (modulo, tipo, bloqueio_id, cidade, status) values ('bloqueios', 'encerramento_parceria', $1, 'LAGARTO - SE', 'pendente')", [b.id]);
  await rpc(admin, "liberar_bloqueio", { p_bloqueio: b.id, p_motivo: "Provou que não foi ele" });
  const tf = await um("select status, nota from tarefas where bloqueio_id = $1", [b.id]);
  igual(tf.status, "concluida", "fechou");
  verdade(tf.nota.includes("Provou que não foi ele"), "nota com o motivo: " + tf.nota);
});

await t("009x3 (A8-04): adicional repetido pergunta antes; com p_confirmar grava", async () => {
  const args = { p_cidade: "LAGARTO - SE", p_id_app: "rep00001", p_nome: "Repetido Teste", p_origem: "qd", p_mercado: false, p_motivo: "Distância",
    p_valor_entrega: 5, p_valor_pedido: 40, p_valor_combinado: 12, p_pedido: "AB-CD" };
  const r1 = await rpc(sup, "registrar_adicional", args);
  verdade(r1.id && !r1.precisa_confirmar, "o 1º grava");
  const r2 = await rpc(admin, "registrar_adicional", args);
  igual(r2.precisa_confirmar, true, "o 2º pergunta");
  verdade(r2.texto.includes("R$ 7,00") && r2.texto.includes("Suporte Casa") && r2.texto.includes("AB-CD"), "texto: " + r2.texto);
  const r3 = await rpc(admin, "registrar_adicional", { ...args, p_pedido: "XY-ZZ", p_valor_combinado: 15 });
  verdade(r3.id, "outro pedido e outro valor: grava direto");
  const r4 = await rpc(admin, "registrar_adicional", { ...args, p_confirmar: true });
  verdade(r4.id, "confirmado: grava");
  igual((await um("select count(*)::int n from lancamentos_financeiros where id_app = 'rep00001'")).n, 3);
});

await t("009x4: aviso novo e erro dizem 'restrição'; as regras do banco, do site e da extensão são as mesmas", async () => {
  await db.query("insert into notificacoes (para, texto) values ($1, 'Fulano registrou um bloqueio em LAGARTO.')", [uSup]);
  igual((await um("select texto from notificacoes where para = $1 order by id desc limit 1", [uSup])).texto, "Fulano registrou uma restrição em LAGARTO.");
  igual((await um("select public.texto_restricao('Este bloqueio não está ativo.') t")).t, "Esta restrição não está ativa.");
  const pega = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8").match(/const REGRAS_RESTRICAO = (\[.*?\]);/s)[1]);
  const site = pega("../js/base.js"), ext = pega("../extensao/api.js");
  igual(ext, site, "extensão = site");
  const sql = readFileSync(new URL("../supabase/009x4-restricao.sql", import.meta.url), "utf8");
  for (const [a, b] of site) verdade(sql.includes(`'\\1${b}'`) && sql.includes(a.replace(/[().]/g, (c) => "\\" + c)), "regra no banco: " + a);
});

await t("009x5: moderador recebe o aviso de cidade sem responsável, não o de cidade com responsável (a menos que peça tudo)", async () => {
  const mod2 = pessoa("mod.dois@x.com", "Moderador Dois"), resp = pessoa("resp.cidade@x.com", "Responsavel Cidade");
  await db.query("insert into membros (email, nome, papel, papel_bloqueios) values ($1, $2, 'moderador', 'moderador'), ($3, $4, 'monitorador', 'monitorador') on conflict do nothing",
    [mod2.email, mod2.nome, resp.email, resp.nome]);
  await rpc(mod2, "entrar"); await rpc(resp, "entrar");
  const uMod2 = (await um("select user_id from membros where email = $1", [mod2.email])).user_id;
  const uResp = (await um("select user_id from membros where email = $1", [resp.email])).user_id;
  await db.query("insert into cidades (nome, responsavel_email) values ('ARACAJU - SE', $1), ('ESTANCIA - SE', null) on conflict (nome) do update set responsavel_email = excluded.responsavel_email", [resp.email]);
  const conta = async (u) => (await um("select count(*)::int n from notificacoes where para = $1", [u])).n;
  const enviar = (cid, id) => rpc(sup, "enviar_cadastro", { p_id_app: id, p_cpf: null, p_nome: "Teste Avisos", p_cidade: cid });
  let a = await conta(uMod2), r = await conta(uResp);
  await enviar("ARACAJU - SE", "avis0001");
  igual([await conta(uMod2) - a, await conta(uResp) - r], [0, 1], "cidade com responsável: só o responsável");
  a = await conta(uMod2);
  await enviar("ESTANCIA - SE", "avis0002");
  igual(await conta(uMod2) - a, 1, "cidade sem responsável: o moderador recebe");
  const pr = await rpc(mod2, "salvar_receber_tudo", { p_receber: true });
  igual([pr.receber_tudo, pr.sou_moderador], [true, true]);
  a = await conta(uMod2);
  await enviar("ARACAJU - SE", "avis0003");
  igual(await conta(uMod2) - a, 1, "pediu tudo: recebe também");
});

await t("009x5: aviso com mais de 7 dias sem ler conta como lido; restrições da planilha deixam de pedir revisão", async () => {
  await db.query("insert into notificacoes (para, texto, criada_em) values ($1, 'Velho', now() - interval '8 days')", [uSup]);
  await db.query("insert into notificacoes (para, texto) values ($1, 'Novo')", [uSup]);
  igual((await um("select lida_em is not null l from notificacoes where para = $1 and texto = 'Velho'", [uSup])).l, true, "o velho ficou lido");
  igual((await um("select lida_em is null l from notificacoes where para = $1 and texto = 'Novo'", [uSup])).l, true, "o novo continua sem ler");
  await db.query(`insert into bloqueios (id_app, nome_entregador, cidade, infracao_id, infracao, ocorrencia, ocorrencia_total, horas, inicio, fim, registrado_por, registrado_por_nome, leve, importado, revisar)
      select 'plan0001', 'Da Planilha', 'LAGARTO - SE', id, nome, 1, 1, 1, now() - interval '30 days', now() - interval '29 days', $1, 'Mateus Lopes', false, true, 'Nomes diferentes na planilha' from infracoes where not leve order by id limit 1`, [uAdmin]);
  await db.query(arquivo("../supabase/009x5-avisos-que-importam.sql"));
  igual((await um("select revisar from bloqueios where id_app = 'plan0001'")).revisar, null);
});

await t("009x6: o suporte vê os cadastros e as tratativas de todos (só leitura) e continua sem anexar nas restrições dos outros", async () => {
  const h = await rpc(sup, "listar_cadastros_pagina", { p_pagina: 1, p_por: 10 });
  verdade(h.total > 300, "o suporte vê mais que os 300 dele: " + h.total);
  const b = await um(`insert into bloqueios (id_app, nome_entregador, cidade, infracao_id, infracao, ocorrencia, ocorrencia_total, horas, inicio, fim, registrado_por, registrado_por_nome, leve)
      select 'vis00001', 'Visivel Teste', 'LAGARTO - SE', id, nome, 1, 1, 24, now(), now() + interval '24 hours', $1, 'Mateus Lopes', false from infracoes where not leve order by id limit 1 returning id`, [uAdmin]);
  await db.query("insert into tarefas (modulo, tipo, bloqueio_id, cidade, status) values ('bloqueios', 'tratativa', $1, 'LAGARTO - SE', 'pendente')", [b.id]);
  const tr = await rpc(sup, "listar_tarefas", { p_status: "pendente" });
  const x = tr.find((t) => t.bloqueio.id_app === "vis00001");
  verdade(x && !x.minha, "o suporte vê a tratativa de outra pessoa, sem poder agir");
  let erro = ""; try { await rpc(sup, "anexar", { p_bloqueio: b.id, p_nome: "a.png", p_tipo: "image/png", p_base64: "iVBORw0KGgo=" }); } catch (e) { erro = e.message; }
  verdade(/só pode anexar/.test(erro), "anexar continua só nas dele: " + erro);
  igual(Array.isArray(await rpc(sup, "listar_anexos", { p_bloqueio: b.id })), true, "mas vê a lista de anexos");
});

await t("009x6: notícias rápidas = tarefas concluídas; parceiros têm a semana e os 10 últimos", async () => {
  const n = await rpc(sup, "noticias_rapidas", { p_limite: 6 });
  verdade(n.length && n.every((x) => x.tipo === "tarefa"), "só tarefas: " + JSON.stringify(n.slice(0, 2)));
  verdade(n.some((x) => x.equipe), "a meta batida pela equipe aparece");
  const p = await rpc(sup, "parceiros_semana");
  verdade(p.esta_semana >= 1 && p.ultimos.length >= 1 && p.ultimos.length <= 10 && "semana_passada" in p, JSON.stringify(p).slice(0, 200));
});

// A7-01: as funções remendadas têm a versão atual escrita em supabase/funcoes/ e ela é igual à do banco
await t("A7-01: cada arquivo de supabase/funcoes/ é igual à função que está no banco", async () => {
  const pasta = new URL("../supabase/funcoes/", import.meta.url);
  const arqs = readdirSync(pasta).filter((f) => f.endsWith(".sql"));
  verdade(arqs.length >= 12, "arquivos: " + arqs.length);
  const tira = (x) => x.replace(/^--.*$/gm, "").replace(/;\s*$/, "").replace(/\s+/g, "");
  const dif = [];
  for (const f of arqs) {
    const txt = readFileSync(new URL(f, pasta), "utf8");
    const sig = txt.match(/^-- (\S+\(.*?\)):/m)[1];
    const banco = (await um("select pg_get_functiondef($1::regprocedure) d", ["public." + sig])).d;
    if (tira(txt) !== tira(banco)) dif.push(f);
  }
  igual(dif, [], "diferentes");
});

console.log(`\n${n - falhas}/${n} ok`);
await db.end();
process.exit(falhas ? 1 : 0);
