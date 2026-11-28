// Carrega no banco de DATABASE_URL o mínimo do Supabase e TODAS as migrações em ordem (até a mais nova).
// Para a varredura e para quem precisa de um banco completo sem rodar um teste inteiro. Apaga tudo antes (schema.sql).
// Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste_a1 node carregar-banco.mjs
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRACOES = ["testes/supabase-local.sql", "supabase/schema.sql", "supabase/002-bloqueios.sql", "supabase/003-entregadores.sql",
  "supabase/004-atividades-registros.sql", "supabase/005-analises-anexos.sql", "supabase/006-equipe-previsao-atencao.sql",
  "supabase/007-pao-quentinho.sql", "supabase/008-espionagem.sql", "supabase/008b-cadastrar-entregador.sql", "supabase/008b-notificacoes.sql",
  "supabase/008c-analises.sql", "supabase/008d-avisos-parte2.sql", "supabase/009a-regras-politica.sql", "supabase/009b-ferramentas-financeiro.sql",
  "supabase/009c-mensagens-agravante.sql", "supabase/009c2-mensagens-opcoes.sql", "supabase/009d-ajuda-aviso-turno.sql",
  "supabase/009d2-tarefas-cards.sql", "supabase/009d3-painel-metas-recorrentes.sql", "supabase/009e-parceiros.sql",
  "supabase/009f-parceiros-completo.sql", "supabase/009g-tarefas-compartilhadas.sql", "supabase/009h-entregador-pelo-lancamento.sql",
  "supabase/009p-bairros-parecidos.sql", "supabase/009s-sem-cpf.sql", "supabase/009u-sem-cpf-nos-textos.sql",
  "supabase/009v-tarefas-abertas.sql", "supabase/009x-casa-em-ordem.sql",
  "supabase/009x2-avisos-sem-codigo.sql", "supabase/009x3-tarefas-automaticas.sql", "supabase/009x4-restricao.sql", "supabase/009x5-avisos-que-importam.sql", "supabase/009x6-suporte-ve-tudo.sql", "supabase/009y1-mensagens-ativacao.sql", "supabase/009y1b-entrar-liberado.sql", "supabase/009y1c-atividades-equipe.sql", "supabase/009y1d-concluir-atividade-equipe.sql", "supabase/009y1e-equipe-sem-dono.sql", "supabase/009z1-base-firme.sql", "supabase/009z2-funcoes-sem-uso.sql", "supabase/009z3-mais-rapido.sql", "supabase/009z4-mensagem-certa.sql", "supabase/009z5-casa-certa.sql", "supabase/009z6-pedidos-fora-do-limite.sql", "supabase/009z7-guarda-7-dias.sql", "supabase/009z8-pedidos-limpeza-por-semana.sql", "supabase/009z9-escolher-entregador-pedido.sql", "supabase/009z10-analises-pedidos.sql", "supabase/009z11-analises-atraso-30.sql", "supabase/009z12-missao-da-equipe.sql", "supabase/009z13-rota-e-bairro.sql", "supabase/009z14-limite-35.sql", "supabase/009z15-limite-30.sql", "supabase/009z16-reenvio-que-vale.sql", "supabase/009z17-mais-entregadores.sql", "supabase/009z18-monitoramento-novo.sql", "supabase/009z19-envio-que-cabe.sql", "supabase/009z20-envio-leve.sql"];

export async function carregarBanco(url) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query("set client_min_messages = warning");
  for (const f of MIGRACOES) await db.query(fs.readFileSync(path.join(RAIZ, f), "utf8"));
  await db.end();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/teste";
  await carregarBanco(url);
  console.log("banco carregado:", url.replace(/\/\/[^@]*@/, "//"));
}

// A7-04 (009y1): os testes de cada migração carregam as migrações dela e, em seguida, TODAS as que vieram depois,
// para conferir o banco como ele está hoje (e não a versão antiga das funções). `ultimo` = a última migração que o
// teste já carregou (ex.: "009d2-tarefas-cards.sql").
// manterRegras: a 009a troca as HORAS das infrações pelas da política (dado, não lógica); os testes do cálculo
// continuam com os números da semente que eles conhecem, então as horas voltam ao que eram antes de completar.
export async function completar(db, ultimo, { manterRegras = false } = {}) {
  const i = MIGRACOES.findIndex((f) => f.endsWith("/" + ultimo));
  if (i < 0) throw new Error("migração desconhecida: " + ultimo);
  if (manterRegras) await db.query("drop table if exists _regras_semente; create table _regras_semente as select id, horas_1a, horas_2a, terceira_encerra, fator, janela_dias from public.infracoes");
  for (const f of MIGRACOES.slice(i + 1)) await db.query(fs.readFileSync(path.join(RAIZ, f), "utf8"));
  await liberarParaTestes(db);
  if (manterRegras) await db.query(`update public.infracoes i set horas_1a = s.horas_1a, horas_2a = s.horas_2a, terceira_encerra = s.terceira_encerra,
      fator = s.fator, janela_dias = s.janela_dias from _regras_semente s where s.id = i.id; drop table _regras_semente`);
}

// 009z2: estas funções perderam o acesso no Supabase (sem uso no site), mas os testes antigos ainda as usam para
// montar dados (registrar uma restrição, uma cidade, uma tarefa). Só no banco de teste: devolve o acesso.
export const SO_PARA_TESTES = ["public.registrar_bloqueio(text, text, text, smallint, text, text)", "public.salvar_cidade(text, text, boolean)",
  "public.sugerir_atividade(text, text, uuid[], timestamp with time zone)", "public.salvar_telefone(text, text)", "public.aprovados_e_bloqueios()"];
export async function liberarParaTestes(db) {
  for (const f of SO_PARA_TESTES) await db.query(`do $$ begin if to_regprocedure('${f}') is not null then execute 'grant execute on function ${f} to authenticated'; end if; end $$`);
}
