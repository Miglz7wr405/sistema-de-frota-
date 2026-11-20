// API da PWA do motorista (ADR-008: link + PIN).
import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { many, one, withSystem } from '../db.js';
import { requireDriver, asDriver, limitOr429 } from '../auth.js';
import { checkPassword, randomToken, sha256, ipHash, dummyHash } from '../crypto.js';
import { loadRouteModel } from '../trip-route.js';
import { simplify } from '../../src/lib/geo/geometry.js';
import { afterTripClosed } from './trips.js';

import { CONSENT_VERSION } from '../own-driver.js';
export { CONSENT_VERSION };
const DRIVER_SESSION_HOURS = 12;

route('POST', '/api/driver/session', async (req) => {
  const b = parse(z.object({ token: z.string().min(20).max(200), pin: z.string().regex(/^\d{4,6}$/) }), req.body);
  await limitOr429(`drvlogin:${ipHash(req.ip)}`, 900, 30);
  const a = await withSystem((c) => one<{ access_id: string; pin_hash: string; locked_until: Date | null; revoked: boolean; driver_active: boolean }>(c,
    'select * from driver_access_lookup($1)', [sha256(b.token)]));
  if (!a || a.revoked || !a.driver_active) { await checkPassword(b.pin, dummyHash()); throw new HttpError(401, 'link_invalido'); }
  if (a.locked_until && new Date(a.locked_until) > new Date()) throw new HttpError(429, 'bloqueado');
  const good = await checkPassword(b.pin, a.pin_hash);
  await withSystem((c) => c.query('select driver_access_attempt($1, $2)', [a.access_id, good]));
  if (!good) throw new HttpError(401, 'pin_incorreto');
  const token = randomToken(32);
  await withSystem((c) => c.query('select driver_session_create($1, $2, $3)', [a.access_id, sha256(token), DRIVER_SESSION_HOURS]));
  return ok({ token, expiresInH: DRIVER_SESSION_HOURS });
});

route('GET', '/api/driver/me', async (req) => {
  const d = await requireDriver(req);
  return ok(await asDriver(d, async (c) => {
    const consent = await one(c, 'select accepted_at from driver_consents where driver_id = $1 and consent_version = $2', [d.driverId, CONSENT_VERSION]);
    const org = await one<{ name: string; settings: Record<string, number> }>(c, 'select coalesce(public_name, name) name, settings from organizations where id = $1', [d.orgId]);
    const trip = await one<{ id: string }>(c, `select t.id, t.code, t.status, t.planned_departure, t.planned_arrival, t.cargo_description, t.recipient_name, t.recipient_phone,
        po.name origin, pd.name destination, v.plate_normalized plate
      from trips t join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id left join vehicles v on v.id = t.vehicle_id
      where t.driver_id = $1 and t.deleted_at is null and t.status in ('planeada','aguardando_partida','em_viagem','pausada')
      order by case t.status when 'em_viagem' then 0 when 'pausada' then 1 when 'aguardando_partida' then 2 else 3 end, t.planned_departure nulls last limit 1`, [d.driverId]);
    let route_ = null;
    let stops: unknown[] = [];
    let progress = null;
    if (trip) {
      const model = await loadRouteModel(c, trip.id);
      // Geometria simplificada (~10 m) para descarregar e calcular offline com poucos dados móveis (lacuna L6).
      if (model) {
        const coords = simplify(model.coords, 10);
        route_ = { routeId: model.routeId, version: model.routeVersion, baseKm: model.baseKm, coords, lengthM: model.lengthM, plannedDurationS: model.plannedDurationS, places: model.places };
      }
      stops = await many(c, `select s.id, s.seq, s.kind, s.arrived_at, p.name place_name, s.recipient_name from trip_stops s join places p on p.id = s.place_id where s.trip_id = $1 order by s.seq`, [trip.id]);
      progress = await one(c, 'select km_done, km_left, pct, current_label, eta_destination, eta_confidence, engine_state from trip_progress where trip_id = $1', [trip.id]);
    }
    const testMode = !!(await one(c, 'select 1 from drivers where id = $1 and user_id is not null', [d.driverId]));
    return { testMode, driver: { id: d.driverId, fullName: d.fullName }, org: { name: org?.name, settings: org?.settings }, consentRequired: !consent,
      consentVersion: CONSENT_VERSION, trip, route: route_, stops, progress, serverTime: new Date().toISOString() };
  }));
});

route('POST', '/api/driver/consent', async (req) => {
  const d = await requireDriver(req);
  await asDriver(d, (c) => c.query(`insert into driver_consents (organization_id, driver_id, consent_version, user_agent) values ($1,$2,$3,$4) on conflict do nothing`,
    [d.orgId, d.driverId, CONSENT_VERSION, (req.headers['user-agent'] ?? '').slice(0, 300)]));
  return ok({ ok: true });
});

route('POST', '/api/driver/trips/:id/transition', async (req, p) => {
  const d = await requireDriver(req);
  const b = parse(z.object({ to: z.enum(['em_viagem', 'pausada', 'concluida']), at: z.string().datetime({ offset: true }).optional() }), req.body);
  const id = assertUuid(p.id);
  const t = await asDriver(d, (c) => one(c, 'select id, status from trip_transition($1, $2, null, $3)', [id, b.to, b.at ?? null]));
  if (b.to === 'concluida') await afterTripClosed(id);
  return ok(t);
});

const pos = z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).nullable().optional();
const point = (p: { lng: number; lat: number } | null | undefined) => (p ? `SRID=4326;POINT(${p.lng} ${p.lat})` : null);

route('POST', '/api/driver/trips/:id/incidents', async (req, p) => {
  const d = await requireDriver(req);
  const b = parse(z.object({ kind: z.enum(['avaria', 'acidente', 'controlo_policial', 'estrada_cortada', 'outra']), note: z.string().max(1000).nullable().optional(),
    photo_file_id: z.string().uuid().nullable().optional(), occurred_at: z.string().datetime({ offset: true }).optional(), position: pos }), req.body);
  const id = assertUuid(p.id);
  const r = await asDriver(d, async (c) => {
    const i = await one<{ id: string }>(c, `insert into incidents (organization_id, trip_id, kind, note, photo_file_id, occurred_at, position)
      values ($1,$2,$3,$4,$5,coalesce($6, now()),$7::geography) returning id`, [d.orgId, id, b.kind, b.note ?? null, b.photo_file_id ?? null, b.occurred_at ?? null, point(b.position)]);
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload, position, occurred_at)
      values ($1,$2,'ocorrencia','driver',$3,$4,$5::geography,coalesce($6, now()))`, [d.orgId, id, d.driverId, JSON.stringify({ kind: b.kind, note: b.note }), point(b.position), b.occurred_at ?? null]);
    return i;
  });
  // A ocorrência gera alerta para o despachante (sem depender de RLS do motorista).
  await withSystem((c) => c.query(`select open_alert(t.organization_id, 'paragem_anormal', 'ocorrencia:' || $2, 'Ocorrência: ' || $3 || ' (' || coalesce(v.plate_normalized, t.code) || ')', $4, t.vehicle_id, t.id)
    from trips t left join vehicles v on v.id = t.vehicle_id where t.id = $1`, [id, r!.id, b.kind.replace('_', ' '), b.note ?? null]));
  return ok(r, 201);
});

route('POST', '/api/driver/trips/:id/delivery', async (req, p) => {
  const d = await requireDriver(req);
  const b = parse(z.object({ received_by_name: z.string().min(2).max(120), signature_file_id: z.string().uuid().nullable().optional(),
    photo_file_id: z.string().uuid().nullable().optional(), stop_id: z.string().uuid().nullable().optional(), position: pos,
    delivered_at: z.string().datetime({ offset: true }).optional() }), req.body);
  const id = assertUuid(p.id);
  return ok(await asDriver(d, async (c) => {
    const r = await one(c, `insert into delivery_proofs (organization_id, trip_id, stop_id, received_by_name, signature_file_id, photo_file_id, position, delivered_at)
      values ($1,$2,$3,$4,$5,$6,$7::geography,coalesce($8, now())) returning id`, [d.orgId, id, b.stop_id ?? null, b.received_by_name, b.signature_file_id ?? null, b.photo_file_id ?? null, point(b.position), b.delivered_at ?? null]);
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload, position) values ($1,$2,'entrega','driver',$3,$4,$5::geography)`,
      [d.orgId, id, d.driverId, JSON.stringify({ received_by: b.received_by_name }), point(b.position)]);
    if (b.stop_id) await c.query('update trip_stops set arrived_at = coalesce(arrived_at, now()) where id = $1 and trip_id = $2', [b.stop_id, id]);
    return r;
  }), 201);
});

route('POST', '/api/driver/trips/:id/stops/:stopId/arrive', async (req, p) => {
  const d = await requireDriver(req);
  const id = assertUuid(p.id), stop = assertUuid(p.stopId);
  await asDriver(d, async (c) => {
    const r = await c.query('update trip_stops set arrived_at = coalesce(arrived_at, now()) where id = $1 and trip_id = $2 returning place_id', [stop, id]);
    if (!r.rowCount) throw new HttpError(404, 'nao_encontrado');
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload) values ($1,$2,'chegada_ponto','driver',$3,$4)`,
      [d.orgId, id, d.driverId, JSON.stringify({ stop_id: stop })]);
  });
  return ok({ ok: true });
});

route('POST', '/api/driver/trips/:id/expenses', async (req, p) => {
  const d = await requireDriver(req);
  const b = parse(z.object({ category: z.enum(['portagem', 'alimentacao', 'alojamento', 'reparacao', 'outra']), amount: z.number().min(0).max(10_000_000),
    note: z.string().max(500).nullable().optional(), receipt_file_id: z.string().uuid().nullable().optional(), spent_at: z.string().datetime({ offset: true }).optional() }), req.body);
  return ok(await asDriver(d, (c) => one(c, `insert into trip_expenses (organization_id, trip_id, category, amount, note, receipt_file_id, spent_at, created_by_driver_id)
      values ($1,$2,$3,$4,$5,$6,coalesce($7, now()),$8) returning id`, [d.orgId, assertUuid(p.id), b.category, b.amount, b.note ?? null, b.receipt_file_id ?? null, b.spent_at ?? null, d.driverId])), 201);
});

// Registo dos avisos por voz tocados (prompt 8A.5). Idempotente.
route('POST', '/api/driver/trips/:id/voice', async (req, p) => {
  const d = await requireDriver(req);
  const b = parse(z.object({ items: z.array(z.object({ key: z.string().max(120), kind: z.string().max(40), text: z.string().max(300),
    at: z.string().datetime({ offset: true }), km: z.number().nullable().optional(), played: z.boolean() })).max(100) }), req.body);
  const id = assertUuid(p.id);
  await asDriver(d, async (c) => {
    for (const it of b.items) await c.query(`insert into voice_announcements (organization_id, trip_id, idempotency_key, kind, text, triggered_at, km_at, played)
      values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (trip_id, idempotency_key) do nothing`, [d.orgId, id, it.key, it.kind, it.text, it.at, it.km ?? null, it.played]);
  });
  return ok({ ok: true });
});
