// Sessões: membros por cookie httpOnly; motoristas por "Authorization: Bearer" (PWA guarda-o para enviar offline);
// fontes de GPS (Traccar/simulador) por "X-Ingest-Key". Os tokens só existem em claro no cliente: a BD guarda o hash.
import { HttpError, cookie, type Req } from './http.js';
import { getPool, withTx, type Tx } from './db.js';
import { sha256 } from './crypto.js';

export const SESSION_COOKIE = 'if_session';
export const SESSION_HOURS = 24 * 14;

export type Member = { kind: 'member'; userId: string; orgId: string | null; role: string | null; isPlatformAdmin: boolean; fullName: string; email: string; tokenHash: string };
export type Driver = { kind: 'driver'; driverId: string; orgId: string; fullName: string; revokedAt: Date | null };

export function sessionCookie(token: string, maxAgeS: number) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`;
}

export async function getMember(req: Req): Promise<Member | null> {
  const tok = cookie(req, SESSION_COOKIE);
  if (!tok) return null;
  const tokenHash = sha256(tok);
  const c = await getPool().connect();
  try {
    const s = (await c.query('select * from auth_session_resolve($1)', [tokenHash])).rows[0];
    if (!s) return null;
    let role: string | null = null;
    if (s.active_org_id) {
      try {
        await c.query('begin');
        await c.query("select set_config('app.user_id', $1, true)", [s.user_id]);
        role = (await c.query('select role from organization_members where organization_id = $1 and user_id = $2', [s.active_org_id, s.user_id])).rows[0]?.role ?? null;
        await c.query('commit');
      } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
    }
    return { kind: 'member', userId: s.user_id, orgId: role ? s.active_org_id : null, role, isPlatformAdmin: s.is_platform_admin, fullName: s.full_name, email: s.email, tokenHash };
  } finally { c.release(); }
}

export async function requireMember(req: Req, roles?: string[]): Promise<Member & { orgId: string; role: string }> {
  const m = await getMember(req);
  if (!m) throw new HttpError(401, 'nao_autenticado');
  if (!m.orgId || !m.role) throw new HttpError(403, 'sem_organizacao');
  if (roles && !roles.includes(m.role)) throw new HttpError(403, 'sem_permissao');
  return m as Member & { orgId: string; role: string };
}

export const WRITE = ['owner', 'admin', 'dispatcher'];
export const ADMIN = ['owner', 'admin'];

export async function getDriver(req: Req): Promise<Driver | null> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  const tokenHash = sha256(h.slice(7).trim());
  const c = await getPool().connect();
  try {
    const d = (await c.query('select * from driver_session_resolve($1)', [tokenHash])).rows[0];
    if (!d) return null;
    return { kind: 'driver', driverId: d.driver_id, orgId: d.organization_id, fullName: d.full_name, revokedAt: d.revoked_at };
  } finally { c.release(); }
}

export async function requireDriver(req: Req, allowRevoked = false): Promise<Driver> {
  const d = await getDriver(req);
  if (!d) throw new HttpError(401, 'nao_autenticado');
  if (d.revokedAt && !allowRevoked) throw new HttpError(401, 'acesso_revogado');
  return d;
}

/** Atalho: transação com o contexto do membro. */
export const asMember = <T>(m: Member, fn: (c: Tx) => Promise<T>) => withTx({ userId: m.userId, orgId: m.orgId }, fn);
export const asDriver = <T>(d: Driver, fn: (c: Tx) => Promise<T>) => withTx({ driverId: d.driverId, orgId: d.orgId }, fn);

export async function audit(c: Tx, m: Member, action: string, entity: string, entityId: string | null, after?: unknown) {
  await c.query(
    "insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after) values ($1, 'member', $2, $3, $4, $5, $6)",
    [m.orgId, m.userId, action, entity, entityId, after == null ? null : JSON.stringify(after)],
  );
}

export async function hit(key: string, windowS: number, max: number): Promise<boolean> {
  const c = await getPool().connect();
  try { return (await c.query('select rate_limit_hit($1, $2, $3) as ok', [key, windowS, max])).rows[0].ok; }
  finally { c.release(); }
}
export async function limitOr429(key: string, windowS: number, max: number) {
  if (!(await hit(key, windowS, max))) throw new HttpError(429, 'demasiados_pedidos');
}
