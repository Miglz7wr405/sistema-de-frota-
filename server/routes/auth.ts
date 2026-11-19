import { z } from 'zod';
import { route, ok, parse, HttpError } from '../http.js';
import { getPool, withTx, many } from '../db.js';
import { getMember, sessionCookie, SESSION_HOURS, limitOr429 } from '../auth.js';
import { checkPassword, hashPassword, randomToken, sha256, ipHash, dummyHash } from '../crypto.js';
import { sendEmail, emailConfigured } from '../email.js';

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal(''));
const RegisterSchema = z.object({
  email: z.string().email().max(200), password: z.string().min(8).max(200), fullName: z.string().min(2).max(120),
  orgName: z.string().min(2).max(120), phone, province: z.string().max(60).optional(),
});

async function createSession(userId: string, ua: string | undefined) {
  const token = randomToken(32);
  const c = await getPool().connect();
  try { await c.query('select auth_session_create($1, $2, $3, $4)', [userId, sha256(token), ua ?? '', SESSION_HOURS]); }
  finally { c.release(); }
  return token;
}

route('POST', '/api/auth/register', async (req) => {
  await limitOr429(`register:${ipHash(req.ip)}`, 3600, 10);
  const b = parse(RegisterSchema, req.body);
  const hash = await hashPassword(b.password);
  const c = await getPool().connect();
  let userId: string;
  try {
    userId = (await c.query('select * from auth_register($1,$2,$3,$4,$5,$6)', [b.email.toLowerCase(), hash, b.fullName, b.orgName, b.phone ?? '', b.province ?? ''])).rows[0].user_id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'email_existente');
    throw e;
  } finally { c.release(); }
  const token = await createSession(userId, req.headers['user-agent']);
  return ok({ ok: true }, 201, { 'set-cookie': sessionCookie(token, SESSION_HOURS * 3600) });
});

route('POST', '/api/auth/login', async (req) => {
  const b = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
  await limitOr429(`login:${ipHash(req.ip)}`, 900, 20);
  await limitOr429(`login:${b.email.toLowerCase()}`, 900, 10);
  const c = await getPool().connect();
  let u: { id: string; password_hash: string } | undefined;
  try { u = (await c.query('select * from auth_user_by_email($1)', [b.email.toLowerCase()])).rows[0]; } finally { c.release(); }
  // compara sempre (mesmo sem utilizador) para não revelar contas por tempo de resposta
  const good = await checkPassword(b.password, u?.password_hash ?? dummyHash());
  if (!u || !good) throw new HttpError(401, 'credenciais_invalidas');
  const token = await createSession(u.id, req.headers['user-agent']);
  return ok({ ok: true }, 200, { 'set-cookie': sessionCookie(token, SESSION_HOURS * 3600) });
});

route('POST', '/api/auth/logout', async (req) => {
  const m = await getMember(req);
  if (m) { const c = await getPool().connect(); try { await c.query('select auth_session_revoke($1)', [m.tokenHash]); } finally { c.release(); } }
  return ok({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
});

route('GET', '/api/auth/me', async (req) => {
  const m = await getMember(req);
  if (!m) return ok({ user: null });
  const orgs = await withTx({ userId: m.userId }, (c) =>
    many(c, `select o.id, o.name, mm.role from organization_members mm join organizations o on o.id = mm.organization_id
             where mm.user_id = $1 and o.deleted_at is null order by o.name`, [m.userId]));
  return ok({
    user: { id: m.userId, fullName: m.fullName, email: m.email, isPlatformAdmin: m.isPlatformAdmin },
    activeOrgId: m.orgId, role: m.role, orgs, emailRecovery: emailConfigured(), serverTime: new Date().toISOString(),
  });
});

route('POST', '/api/auth/switch-org', async (req) => {
  const m = await getMember(req);
  if (!m) throw new HttpError(401, 'nao_autenticado');
  const b = parse(z.object({ orgId: z.string().uuid() }), req.body);
  const c = await getPool().connect();
  try {
    const r = (await c.query('select auth_session_switch_org($1, $2) as ok', [m.tokenHash, b.orgId])).rows[0];
    if (!r.ok) throw new HttpError(403, 'sem_permissao');
  } finally { c.release(); }
  return ok({ ok: true });
});

route('POST', '/api/auth/forgot', async (req) => {
  const b = parse(z.object({ email: z.string().email() }), req.body);
  if (!emailConfigured()) throw new HttpError(501, 'email_nao_configurado');
  await limitOr429(`forgot:${ipHash(req.ip)}`, 3600, 5);
  const token = randomToken(32);
  const c = await getPool().connect();
  let exists = false;
  try { exists = (await c.query('select auth_password_reset_create($1, $2) as ok', [b.email.toLowerCase(), sha256(token)])).rows[0].ok; }
  finally { c.release(); }
  if (exists) {
    const link = `${publicBase(req)}/reset-password#${token}`;
    await sendEmail(b.email, 'Recuperar palavra-passe — insightFrota',
      `Para definir uma nova palavra-passe, abra este link (válido 1 hora):\n${link}\n\nSe não pediu, ignore esta mensagem.`);
  }
  return ok({ ok: true }); // resposta igual exista ou não a conta
});

route('POST', '/api/auth/reset', async (req) => {
  const b = parse(z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(200) }), req.body);
  await limitOr429(`reset:${ipHash(req.ip)}`, 3600, 10);
  const c = await getPool().connect();
  try {
    const r = (await c.query('select auth_password_reset_use($1, $2) as ok', [sha256(b.token), await hashPassword(b.password)])).rows[0];
    if (!r.ok) throw new HttpError(400, 'token_invalido');
  } finally { c.release(); }
  return ok({ ok: true });
});

route('POST', '/api/invites/accept', async (req) => {
  const m = await getMember(req);
  if (!m) throw new HttpError(401, 'nao_autenticado');
  const b = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
  const c = await getPool().connect();
  try {
    const org = (await c.query('select auth_invite_accept($1, $2) as org', [sha256(b.token), m.userId])).rows[0].org;
    if (!org) throw new HttpError(400, 'convite_invalido');
    await c.query('select auth_session_switch_org($1, $2)', [m.tokenHash, org]);
    return ok({ ok: true, orgId: org });
  } finally { c.release(); }
});

export function publicBase(req: { headers: Record<string, string | undefined> }) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:5173';
  const proto = req.headers['x-forwarded-proto'] ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
