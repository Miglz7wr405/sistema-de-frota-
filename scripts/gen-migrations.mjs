// Gera server/generated/migrations.ts a partir de db/migrations/*.sql (para o endpoint de migração no servidor).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const files = readdirSync('db/migrations').filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
const body = files.map((f) => `  [${JSON.stringify(f)}, ${JSON.stringify(readFileSync(`db/migrations/${f}`, 'utf8'))}],`).join('\n');
writeFileSync('server/generated/migrations.ts', `// GERADO por scripts/gen-migrations.mjs — não editar à mão.\nexport const MIGRATIONS: [string, string][] = [\n${body}\n];\n`);
console.log(`${files.length} migrações`);
