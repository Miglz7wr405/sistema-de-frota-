// Aplicação das migrações a partir do servidor (a BD Neon só é alcançável a partir da Vercel).
// Protegido por MIGRATE_SECRET (variável de ambiente). Sem a variável, o endpoint não existe na prática.
// Uso único no deploy: depois, remover MIGRATE_SECRET das variáveis do projeto.
import { route, ok, HttpError } from '../http.js';
import { safeEqual } from '../crypto.js';
import pg from 'pg';
import { MIGRATIONS } from '../generated/migrations.js';
export { MIGRATIONS };

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

/** Completa a base de províncias (11) a partir do geoBoundaries, se faltar alguma. No máximo 1 tentativa a cada 30 min. */
async function completeProvinces() {
  try {
    const have = await withSystem((c) => c.query('select count(*)::int n from admin_areas where level = 1'));
    if (have.rows[0].n >= 11 || !(await hit('jobs:provinces', 1800, 1))) return null;
    const { importProvincesGeoBoundaries } = await import('../../tools/import-places/core.js');
    const r = await withSystem((c) => importProvincesGeoBoundaries(c));
    console.log('[provincias]', JSON.stringify(r));
    return r;
  } catch (e) { console.warn('[provincias]', (e as Error).message); return null; }
}

/** Distritos (ADM2) a partir do geoBoundaries, se faltarem (depois das províncias). No máximo 1 tentativa a cada 30 min. */
async function completeDistricts() {
  try {
    const have = await withSystem((c) => c.query('select (select count(*) from admin_areas where level = 1)::int p, (select count(*) from admin_areas where level = 2)::int d'));
    if (have.rows[0].p < 11 || have.rows[0].d >= 140 || !(await hit('jobs:districts', 1800, 1))) return null;
    const { importDistrictsGeoBoundaries } = await import('../../tools/import-places/core.js');
    const r = await withSystem((c) => importDistrictsGeoBoundaries(c));
    console.log('[distritos]', JSON.stringify(r));
    return r;
  } catch (e) { console.warn('[distritos]', (e as Error).message); return null; }
}

export async function runJobs(kind: 'periodic' | 'daily') {
  if (kind === 'periodic') { await completeProvinces(); await completeDistricts(); }
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

// Importação da base geográfica a partir do servidor (o contentor de desenvolvimento não tem acesso ao Overpass).
// Protegido por IMPORT_SECRET temporário. ?step=provinces | places
import { importPlaces, importProvince, listProvinces } from '../../tools/import-places/core.js';
route('GET', '/api/admin/import-places', async (req) => {
  const secret = process.env.IMPORT_SECRET;
  if (!secret || secret.length < 24 || !safeEqual(req.query.get('secret') ?? '', secret)) throw new HttpError(404, 'rota_inexistente');
  const step = req.query.get('step');
  const mirror = req.query.get('mirror');
  if (mirror != null) process.env.OVERPASS_MIRROR_INDEX = mirror; else delete process.env.OVERPASS_MIRROR_INDEX;
  if (req.query.get('timeout')) process.env.OVERPASS_TIMEOUT_MS = String(Math.min(280_000, Number(req.query.get('timeout'))));
  try {
    if (step === 'provinces-list') return ok(await listProvinces());
    if (step === 'province') return ok(await withSystem<unknown>((c) => importProvince(c, Number(req.query.get('id')))));
    return ok(await withSystem<unknown>((c) => importPlaces(c)));
  }
  catch (e) { throw new HttpError(502, (e as Error).message.slice(0, 500)); }
});
