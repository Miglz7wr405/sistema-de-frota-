// Aplica as migrações SQL por ordem (db/migrations/NNNN_*.sql), registando-as em schema_migrations.
// Uso: DATABASE_URL=postgres://... npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(url: string, log = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    await client.query('alter table schema_migrations enable row level security');
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [f]);
        await client.query('commit');
        applied.push(f);
        log(`✔ ${f}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Falhou ${f}: ${(e as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Defina DATABASE_URL'); process.exit(1); }
  migrate(url).then((a) => console.log(a.length ? `${a.length} migração(ões) aplicada(s).` : 'Nada a aplicar.'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
