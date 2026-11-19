import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { many, one } from '../db.js';
import { requireMember, asMember, ADMIN, audit } from '../auth.js';
import { randomToken, sha256 } from '../crypto.js';
import { publicBase } from './auth.js';

route('GET', '/api/org', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, async (c) => {
    const org = await one(c, 'select id, name, phone, province, timezone, default_currency, settings, public_name, logo_file_id, created_at from organizations where id = $1', [m.orgId]);
    const sub = m.role === 'owner' || m.role === 'admin'
      ? await one(c, `select s.status, s.period_end, p.code, p.name, p.limits from subscriptions s join plans p on p.id = s.plan_id
                      where s.organization_id = $1 and s.status <> 'canceled'`, [m.orgId]) : null;
    const usage = m.role === 'owner' || m.role === 'admin'
      ? await one(c, `select positions_ingested, route_requests, public_views from usage_counters where organization_id = $1 and period = date_trunc('month', now())::date`, [m.orgId]) : null;
    return { org, subscription: sub, usage, role: m.role };
  }));
});

const SettingsSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
  province: z.string().max(60).nullable().optional(),
  public_name: z.string().max(120).nullable().optional(),
  logo_file_id: z.string().uuid().nullable().optional(),
  settings: z.object({
    freshness_current_s: z.number().int().min(30).max(3600), freshness_stale_s: z.number().int().min(60).max(86400),
    late_tolerance_min: z.number().int().min(0).max(720), doc_alert_days: z.array(z.number().int().min(1).max(365)).max(5),
    gps_interval_moving_s: z.number().int().min(5).max(300), gps_interval_stopped_s: z.number().int().min(30).max(1800),
    deviation_corridor_m: z.number().int().min(100).max(5000), deviation_points: z.number().int().min(2).max(20),
    deviation_min_minutes: z.number().int().min(1).max(60), abnormal_stop_minutes: z.number().int().min(5).max(600),
    voice_min_importance: z.number().int().min(1).max(5),
  }).partial().optional(),
});

route('PATCH', '/api/org', async (req) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(SettingsSchema, req.body);
  return ok(await asMember(m, async (c) => {
    const before = await one<{ settings: Record<string, unknown> }>(c, 'select settings from organizations where id = $1', [m.orgId]);
    const settings = b.settings ? { ...before!.settings, ...b.settings } : undefined;
    const r = await one(c, `update organizations set
        name = coalesce($2, name), phone = case when $3::boolean then $4 else phone end,
        province = case when $5::boolean then $6 else province end, public_name = case when $7::boolean then $8 else public_name end,
        logo_file_id = case when $9::boolean then $10::uuid else logo_file_id end, settings = coalesce($11::jsonb, settings)
      where id = $1 returning id, name, phone, province, public_name, logo_file_id, settings`,
      [m.orgId, b.name ?? null, b.phone !== undefined, b.phone ?? null, b.province !== undefined, b.province ?? null,
       b.public_name !== undefined, b.public_name ?? null, b.logo_file_id !== undefined, b.logo_file_id ?? null,
       settings ? JSON.stringify(settings) : null]);
    await audit(c, m, 'organizacao.editar', 'organizations', m.orgId, b);
    return r;
  }));
});

route('GET', '/api/org/members', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, async (c) => ({
    members: await many(c, `select mm.id, mm.role, mm.created_at, u.id as user_id, u.full_name, u.email from organization_members mm
                            join app_users u on u.id = mm.user_id where mm.organization_id = $1 order by mm.created_at`, [m.orgId]),
    invites: m.role === 'owner' || m.role === 'admin'
      ? await many(c, 'select id, email, role, expires_at, accepted_at, created_at from organization_invites where organization_id = $1 and accepted_at is null order by created_at desc', [m.orgId])
      : [],
  })));
});

route('POST', '/api/org/invites', async (req) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(z.object({ email: z.string().email(), role: z.enum(['admin', 'dispatcher', 'viewer']) }), req.body);
  const token = randomToken(32);
  const inv = await asMember(m, async (c) => {
    await c.query('delete from organization_invites where organization_id = $1 and email = $2 and accepted_at is null', [m.orgId, b.email.toLowerCase()]);
    const r = await one<{ id: string }>(c, `insert into organization_invites (organization_id, email, role, token_hash, invited_by, expires_at)
                         values ($1, $2, $3, $4, $5, now() + interval '7 days') returning id`, [m.orgId, b.email.toLowerCase(), b.role, sha256(token), m.userId]);
    await audit(c, m, 'membro.convidar', 'organization_invites', r!.id, { email: b.email, role: b.role });
    return r;
  });
  // O link é devolvido para o dono enviar (WhatsApp/e-mail). Sem serviço de e-mail não fingimos que foi enviado.
  return ok({ id: inv!.id, link: `${publicBase(req)}/invite#${token}` }, 201);
});

route('DELETE', '/api/org/invites/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, (c) => c.query('delete from organization_invites where id = $1 and organization_id = $2', [assertUuid(p.id), m.orgId]));
  return ok({ ok: true });
});

route('PATCH', '/api/org/members/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(z.object({ role: z.enum(['owner', 'admin', 'dispatcher', 'viewer']) }), req.body);
  if (b.role === 'owner' && m.role !== 'owner') throw new HttpError(403, 'sem_permissao');
  return ok(await asMember(m, async (c) => {
    const r = await one(c, 'update organization_members set role = $2 where id = $1 and organization_id = $3 returning id, role', [assertUuid(p.id), b.role, m.orgId]);
    if (!r) throw new HttpError(404, 'nao_encontrado');
    await audit(c, m, 'membro.papel', 'organization_members', p.id!, b);
    return r;
  }));
});

route('DELETE', '/api/org/members/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, async (c) => {
    const r = await c.query('delete from organization_members where id = $1 and organization_id = $2', [assertUuid(p.id), m.orgId]);
    if (!r.rowCount) throw new HttpError(404, 'nao_encontrado');
    await audit(c, m, 'membro.remover', 'organization_members', p.id!);
  });
  return ok({ ok: true });
});

route('GET', '/api/org/audit', async (req) => {
  const m = await requireMember(req, ADMIN);
  return ok(await asMember(m, (c) => many(c, `select a.id, a.action, a.entity, a.entity_id, a.actor_type, a.at, a.after,
      coalesce(u.full_name, d.full_name) as actor_name from audit_logs a
      left join app_users u on u.id = a.actor_id left join drivers d on d.id = a.actor_id
      where a.organization_id = $1 order by a.at desc limit 200`, [m.orgId])));
});
