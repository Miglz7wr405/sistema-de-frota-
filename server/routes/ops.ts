// Alertas, notificações, push, dispositivos GPS, chaves de ingestão.
import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { many, one } from '../db.js';
import { requireMember, asMember, WRITE, ADMIN, audit } from '../auth.js';
import { randomToken, sha256 } from '../crypto.js';
import { pushConfigured } from '../push.js';

route('GET', '/api/alerts', async (req) => {
  const m = await requireMember(req);
  const status = req.query.get('status') ?? 'aberto';
  return ok(await asMember(m, (c) => many(c, `select a.*, v.plate_normalized plate, t.code trip_code from alerts a
    left join vehicles v on v.id = a.vehicle_id left join trips t on t.id = a.trip_id
    where a.organization_id = $1 and ($2 = 'todos' or a.status = $2) order by a.opened_at desc limit 200`, [m.orgId, status])));
});

route('POST', '/api/alerts/:id/:action', async (req, p) => {
  const m = await requireMember(req, WRITE);
  if (!['ack', 'resolve'].includes(p.action!)) throw new HttpError(404, 'rota_inexistente');
  const r = await asMember(m, (c) => one(c, p.action === 'ack'
    ? `update alerts set status = 'reconhecido', acknowledged_by = $2, acknowledged_at = now() where id = $1 and status = 'aberto' returning id`
    : `update alerts set status = 'resolvido', resolved_at = now() where id = $1 and status <> 'resolvido' returning id`, [assertUuid(p.id), ...(p.action === 'ack' ? [m.userId] : [])]));
  if (!r) throw new HttpError(409, 'estado_invalido');
  return ok(r);
});

route('GET', '/api/alert-rules', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, (c) => many(c, 'select id, kind, enabled, severity, params from alert_rules where organization_id = $1 order by kind', [m.orgId])));
});

route('PATCH', '/api/alert-rules/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(z.object({ enabled: z.boolean().optional(), severity: z.enum(['baixa', 'media', 'alta']).optional(),
    params: z.record(z.union([z.number(), z.array(z.number())])).optional() }), req.body);
  return ok(await asMember(m, async (c) => {
    const r = await one(c, `update alert_rules set enabled = coalesce($2, enabled), severity = coalesce($3, severity), params = coalesce($4::jsonb, params)
      where id = $1 returning id, kind, enabled, severity, params`, [assertUuid(p.id), b.enabled ?? null, b.severity ?? null, b.params ? JSON.stringify(b.params) : null]);
    if (!r) throw new HttpError(404, 'nao_encontrado');
    await audit(c, m, 'alerta.regra', 'alert_rules', p.id!, b);
    return r;
  }));
});

route('GET', '/api/notifications', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, async (c) => ({
    items: await many(c, 'select id, title, body, alert_id, read_at, created_at from notifications where user_id = $1 and organization_id = $2 order by created_at desc limit 50', [m.userId, m.orgId]),
    unread: (await one<{ n: number }>(c, 'select count(*)::int n from notifications where user_id = $1 and organization_id = $2 and read_at is null', [m.userId, m.orgId]))?.n ?? 0,
  })));
});
route('POST', '/api/notifications/read', async (req) => {
  const m = await requireMember(req);
  await asMember(m, (c) => c.query('update notifications set read_at = now() where user_id = $1 and organization_id = $2 and read_at is null', [m.userId, m.orgId]));
  return ok({ ok: true });
});

route('GET', '/api/push/config', async () => ok({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null }));
route('POST', '/api/push/subscribe', async (req) => {
  const m = await requireMember(req);
  if (!pushConfigured()) throw new HttpError(501, 'push_nao_configurado');
  const b = parse(z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), req.body);
  await asMember(m, (c) => c.query(`insert into push_subscriptions (organization_id, user_id, endpoint, keys) values ($1,$2,$3,$4)
    on conflict (endpoint) do nothing`, [m.orgId, m.userId, b.endpoint, JSON.stringify(b.keys)]));
  return ok({ ok: true }, 201);
});

// ── Dispositivos GPS ──
route('GET', '/api/devices', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, (c) => many(c, `select g.id, g.imei, g.protocol, g.model, g.sim_phone, g.last_contact_at, g.status, g.created_at,
      da.vehicle_id, v.plate_normalized plate, da.valid_from
    from gps_devices g left join device_assignments da on da.device_id = g.id and da.valid_to is null left join vehicles v on v.id = da.vehicle_id
    where g.organization_id = $1 and g.deleted_at is null order by g.created_at desc`, [m.orgId])));
});

route('POST', '/api/devices', async (req) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(z.object({ imei: z.string().regex(/^\d{10,20}$/), protocol: z.string().max(40).nullable().optional(), model: z.string().max(60).nullable().optional(),
    sim_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional() }), req.body);
  return ok(await asMember(m, async (c) => {
    const r = await one<{ id: string }>(c, `insert into gps_devices (organization_id, imei, protocol, model, sim_phone) values ($1,$2,$3,$4,$5) returning id`,
      [m.orgId, b.imei, b.protocol ?? null, b.model ?? null, b.sim_phone ?? null]);
    await audit(c, m, 'dispositivo.criar', 'gps_devices', r!.id, { imei: b.imei });
    return r;
  }), 201);
});

route('POST', '/api/devices/:id/assign', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(z.object({ vehicleId: z.string().uuid().nullable() }), req.body);
  const id = assertUuid(p.id);
  await asMember(m, async (c) => {
    await c.query('update device_assignments set valid_to = now() where device_id = $1 and valid_to is null', [id]);
    if (b.vehicleId) {
      await c.query('update device_assignments set valid_to = now() where vehicle_id = $1 and valid_to is null', [b.vehicleId]);
      await c.query('insert into device_assignments (organization_id, device_id, vehicle_id) values ($1,$2,$3)', [m.orgId, id, b.vehicleId]);
    }
    await audit(c, m, b.vehicleId ? 'dispositivo.associar' : 'dispositivo.desassociar', 'gps_devices', id, b);
  });
  return ok({ ok: true });
});

route('DELETE', '/api/devices/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, async (c) => {
    const id = assertUuid(p.id);
    await c.query('update device_assignments set valid_to = now() where device_id = $1 and valid_to is null', [id]);
    await c.query(`update gps_devices set deleted_at = now(), status = 'inativo', imei = imei || '-del-' || extract(epoch from now())::bigint where id = $1`, [id]);
    await audit(c, m, 'dispositivo.eliminar', 'gps_devices', id);
  });
  return ok({ ok: true });
});

route('GET', '/api/ingest-keys', async (req) => {
  const m = await requireMember(req, ADMIN);
  return ok(await asMember(m, (c) => many(c, 'select id, name, scope, last_used_at, revoked_at, created_at from ingest_keys where organization_id = $1 order by created_at desc', [m.orgId])));
});
route('POST', '/api/ingest-keys', async (req) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(z.object({ name: z.string().min(2).max(60), scope: z.enum(['traccar', 'simulator']) }), req.body);
  const key = 'ifk_' + randomToken(24);
  const id = await asMember(m, (c) => one<{ id: string }>(c, 'select ingest_key_issue($1,$2,$3,$4) as id', [m.orgId, b.name, b.scope, sha256(key)]));
  return ok({ id: id!.id, key }, 201); // a chave em claro só é mostrada agora
});
route('DELETE', '/api/ingest-keys/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, async (c) => {
    await c.query('update ingest_keys set revoked_at = now() where id = $1 and revoked_at is null', [assertUuid(p.id)]);
    await audit(c, m, 'chave_ingestao.revogar', 'ingest_keys', p.id!);
  });
  return ok({ ok: true });
});
