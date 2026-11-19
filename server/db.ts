// Acesso à BD. Cada pedido corre numa transação com o contexto (utilizador/organização/motorista)
// definido por set_config(..., true) — o RLS da BD aplica-se ao papel app_api (ADR-016).
import pg from 'pg';

let pool: pg.Pool | null = null;
let systemPool: pg.Pool | null = null;

const mk = (url: string) => new pg.Pool({
  connectionString: url,
  max: Number(process.env.DB_POOL_MAX ?? 3),
  idleTimeoutMillis: 10_000,
  ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined,
});

/**
 * Ligação de SISTEMA (papel dono, ignora RLS) — equivalente ao service_role. Usada SÓ em caminhos do servidor
 * já autenticados e validados: processamento da ingestão GPS (progresso, eventos, alertas) e jobs.
 * Nunca exposta ao cliente. Segredo: SYSTEM_DATABASE_URL.
 */
export async function withSystem<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!systemPool) {
    const url = process.env.SYSTEM_DATABASE_URL;
    if (!url) throw new Error('SYSTEM_DATABASE_URL não definida');
    systemPool = mk(url);
  }
  const c = await systemPool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definida');
    pool = mk(url);
  }
  return pool;
}

export function setPoolsForTests(app: pg.Pool, system: pg.Pool) { pool = app; systemPool = system; }

export type DbCtx = { userId?: string | null; orgId?: string | null; driverId?: string | null };
export type Tx = pg.PoolClient;

export async function withTx<T>(ctx: DbCtx, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('begin');
    await c.query(
      "select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true), set_config('app.driver_id', $3, true)",
      [ctx.userId ?? '', ctx.orgId ?? '', ctx.driverId ?? ''],
    );
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function one<T = Record<string, unknown>>(c: Tx, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await c.query(sql, params);
  return (r.rows[0] as T) ?? null;
}
export async function many<T = Record<string, unknown>>(c: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(sql, params)).rows as T[];
}
