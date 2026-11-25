#!/usr/bin/env bash
# E2E local: Postgres+PostGIS local, API (modo de teste: rotas e estilo de mapa locais), build Vite e navegador real.
set -euo pipefail
PGURL=${E2E_PG_ADMIN:-postgres://postgres:postgres@localhost}
DB=frota_e2e_$$
psql "$PGURL/postgres" -q -c "create database $DB"
trap 'kill $API $PREV 2>/dev/null || true; psql "$PGURL/postgres" -q -c "drop database if exists $DB with (force)"' EXIT
DATABASE_URL="$PGURL/$DB" npx tsx db/migrate.ts >/dev/null
psql "$PGURL/$DB" -q -c "alter role app_api login password 'app_api_local'"
SYSTEM_DATABASE_URL="$PGURL/$DB" node tests/e2e/seed.mjs
APPURL=$(echo "$PGURL" | sed -E 's#//[^@]+@#//app_api:app_api_local@#')
PAYMENTS_SMS_SECRET=e2e-sms-segredo-123 PUBLIC_BASE_URL=http://localhost:4173 DATABASE_URL="$APPURL/$DB" SYSTEM_DATABASE_URL="$PGURL/$DB" E2E_ROUTING_STUB=1 API_PORT=3001 npx tsx server/dev.ts > test-results-api.log 2>&1 & API=$!
node scripts/copy-ocr.mjs >/dev/null
VITE_E2E=1 VITE_MAP_STYLE_URL=http://localhost:4173/__test/style.json npx vite build --outDir dist-e2e >/dev/null
npx vite preview --outDir dist-e2e --port 4173 --strictPort >/dev/null 2>&1 & PREV=$!
sleep 6
SYSTEM_DATABASE_URL="$PGURL/$DB" node tests/e2e/fluxo.cjs
