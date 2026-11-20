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
  "supabase/009x2-avisos-sem-codigo.sql", "supabase/009x3-tarefas-automaticas.sql", "supabase/009x4-restricao.sql", "supabase/009x5-avisos-que-importam.sql"];

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
