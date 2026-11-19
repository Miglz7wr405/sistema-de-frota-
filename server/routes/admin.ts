// Aplicação das migrações a partir do servidor (a BD Neon só é alcançável a partir da Vercel).
// Protegido por MIGRATE_SECRET (variável de ambiente). Sem a variável, o endpoint não existe na prática.
// Uso único no deploy: depois, remover MIGRATE_SECRET das variáveis do projeto.
import { route, ok, HttpError } from '../http.js';
import { safeEqual } from '../crypto.js';
import pg from 'pg';
import m0001 from '../../db/migrations/0001_base.sql';
import m0002 from '../../db/migrations/0002_frota.sql';
import m0003 from '../../db/migrations/0003_viagens.sql';
import m0004 from '../../db/migrations/0004_percurso.sql';
import m0005 from '../../db/migrations/0005_telemetria.sql';
import m0006 from '../../db/migrations/0006_partilha.sql';
import m0007 from '../../db/migrations/0007_alertas.sql';
import m0008 from '../../db/migrations/0008_custos.sql';
import m0009 from '../../db/migrations/0009_rls.sql';
import m0010 from '../../db/migrations/0010_plataforma.sql';
import m0011 from '../../db/migrations/0011_rota_base.sql';
import m0012 from '../../db/migrations/0012_utilizacao_e_eta.sql';
import m0013 from '../../db/migrations/0013_transicao_offline.sql';

export const MIGRATIONS: [string, string][] = [
  ['0001_base.sql', m0001], ['0002_frota.sql', m0002], ['0003_viagens.sql', m0003], ['0004_percurso.sql', m0004], ['0005_telemetria.sql', m0005],
  ['0006_partilha.sql', m0006], ['0007_alertas.sql', m0007], ['0008_custos.sql', m0008], ['0009_rls.sql', m0009], ['0010_plataforma.sql', m0010],
  ['0011_rota_base.sql', m0011], ['0012_utilizacao_e_eta.sql', m0012], ['0013_transicao_offline.sql', m0013],
];

route('GET', '/api/admin/migrate', async (req) => {
  const secret = process.env.MIGRATE_SECRET;
  const given = req.query.get('secret') ?? '';
  if (!secret || secret.length < 24 || !safeEqual(given, secret)) throw new HttpError(404, 'rota_inexistente');
  const c = new pg.Client({ connectionString: process.env.SYSTEM_DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  const applied: string[] = [];
  try {
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    await c.query('alter table schema_migrations enable row level security');
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
    for (const [name, sql] of MIGRATIONS) {
      if (done.has(name)) continue;
      await c.query('begin');
      try { await c.query(sql); await c.query('insert into schema_migrations (name) values ($1)', [name]); await c.query('commit'); applied.push(name); }
      catch (e) { await c.query('rollback'); throw new HttpError(500, `migracao_falhou:${name}:${(e as Error).message}`); }
    }
  } finally { await c.end(); }
  return ok({ applied });
});

// Jobs periódicos (alertas "sem sinal", documentos, manutenção, dispositivos, partições; diário: retenção).
// Chamado pela Neon Function "jobs" (trigger de agenda) com o cabeçalho x-jobs-secret.
import { withSystem } from '../db.js';
import { hit } from '../auth.js';
import { sendPushForAlerts } from '../push.js';

export async function runJobs(kind: 'periodic' | 'daily') {
  return withSystem(async (c) => {
    const since = new Date();
    const r = (await c.query(kind === 'daily' ? 'select run_daily_jobs() j' : 'select run_periodic_jobs() j')).rows[0].j;
    const ids = (await c.query('select id from alerts where opened_at >= $1', [since])).rows.map((x) => x.id);
    await sendPushForAlerts(c, ids).catch(() => {});
    return r;
  });
}

route('POST', '/api/jobs/run', async (req) => {
  const secret = process.env.JOBS_SECRET;
  if (!secret || !safeEqual(req.headers['x-jobs-secret'] ?? '', secret)) throw new HttpError(404, 'rota_inexistente');
  return ok(await runJobs(req.query.get('kind') === 'daily' ? 'daily' : 'periodic'));
});

/** Reserva: se ninguém agendou, a utilização da app também corre os jobs (no máximo 1 vez a cada 5 min). */
export async function maybeRunJobs() {
  try { if (await hit('jobs:periodic', 300, 1)) await runJobs('periodic'); } catch (e) { console.warn('[jobs]', (e as Error).message); }
}
