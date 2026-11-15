#!/bin/bash
# Liga o Postgres de teste e recria do zero um banco por agente com todas as migrações.
# Uso: bash preparar.sh a1 a2 a5 ...   (sem argumentos: a1..a12)
set -u
PG=/usr/lib/postgresql/16/bin
RAIZ="$(cd "$(dirname "$0")/../../../.." && pwd)"
pg_isready -h 127.0.0.1 -p 54329 >/dev/null 2>&1 || su postgres -c "$PG/pg_ctl -D /var/tmp/pgteste -o '-p 54329 -k /tmp' -l /var/tmp/pgteste/log -w start" >/dev/null
IDS=${*:-a1 a2 a3 a4 a5 a6 a7 a9 a10 a11 a12}
for id in $IDS; do
  su postgres -c "$PG/dropdb -h 127.0.0.1 -p 54329 --if-exists teste_$id" && su postgres -c "$PG/createdb -h 127.0.0.1 -p 54329 teste_$id"
  (cd "$RAIZ/testes" && DATABASE_URL=postgres://postgres@127.0.0.1:54329/teste_$id node carregar-banco.mjs) || echo "falhou: $id"
done
