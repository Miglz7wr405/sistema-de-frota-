import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { many, one, withSystem, type Tx } from '../db.js';
import { createOwnDriverSession } from '../own-driver.js';
import { requireMember, asMember, WRITE, ADMIN, audit } from '../auth.js';
import { planAndStoreTripRoute } from '../trip-route.js';
import { randomToken, sha256 } from '../crypto.js';
import { publicBase } from './auth.js';

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional();
const dt = z.string().datetime({ offset: true }).nullable().optional();
const StopSchema = z.object({ place_id: z.string().uuid(), kind: z.enum(['entrega', 'recolha', 'passagem']).default('passagem'),
  recipient_name: z.string().max(120).nullable().optional(), recipient_phone: phone, planned_at: dt });
const TripSchema = z.object({
  vehicle_id: z.string().uuid().nullable().optional(), driver_id: z.string().uuid().nullable().optional(),
  origin_place_id: z.string().uuid(), destination_place_id: z.string().uuid(),
  planned_departure: dt, planned_arrival: dt, cargo_description: z.string().max(500).nullable().optional(),
  cargo_weight_t: z.number().min(0).max(500).nullable().optional(), recipient_name: z.string().max(120).nullable().optional(),
  recipient_phone: phone, client_reference: z.string().max(80).nullable().optional(), notes: z.string().max(2000).nullable().optional(),
  stops: z.array(StopSchema).max(20).default([]),
}).refine((b) => b.origin_place_id !== b.destination_place_id, { message: 'origem_igual_destino', path: ['destination_place_id'] })
  .refine((b) => !b.planned_departure || !b.planned_arrival || b.planned_arrival > b.planned_departure, { message: 'datas', path: ['planned_arrival'] });
const TCOLS = ['vehicle_id', 'driver_id', 'origin_place_id', 'destination_place_id', 'planned_departure', 'planned_arrival', 'cargo_description',
  'cargo_weight_t', 'recipient_name', 'recipient_phone', 'client_reference', 'notes'] as const;

route('GET', '/api/trips', async (req) => {
  const m = await requireMember(req);
  const q = req.query;
  const statuses = q.get('status')?.split(',').filter(Boolean) ?? null;
  return ok(await asMember(m, (c) => many(c, `
    select t.id, t.code, t.status, t.planned_departure, t.planned_arrival, t.actual_departure, t.actual_arrival, t.client_reference,
      po.name as origin, pd.name as destination, v.plate_normalized as plate, d.full_name as driver, d.user_id as driver_user_id, t.recipient_name, t.cargo_description,
      p.pct, p.km_left, p.eta_destination, p.eta_confidence, p.current_label, lp.device_time as last_position_at,
      (p.eta_destination is not null and p.eta_confidence in ('alta','media') and t.planned_arrival is not null
        and p.eta_destination > t.planned_arrival + make_interval(mins => coalesce((o.settings->>'late_tolerance_min')::int, 30))) as is_late
    from trips t join organizations o on o.id = t.organization_id
      join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id
      left join vehicles v on v.id = t.vehicle_id left join drivers d on d.id = t.driver_id
      left join trip_progress p on p.trip_id = t.id
      left join vehicle_latest_positions lp on lp.vehicle_id = t.vehicle_id and lp.trip_id = t.id
    where t.organization_id = $1 and t.deleted_at is null
      and ($2::text[] is null or t.status::text = any($2))
      and ($3::text is null or t.code ilike '%'||$3||'%' or t.recipient_name ilike '%'||$3||'%' or t.client_reference ilike '%'||$3||'%' or v.plate_normalized ilike '%'||$3||'%' or po.name ilike '%'||$3||'%' or pd.name ilike '%'||$3||'%')
      and ($4::uuid is null or t.vehicle_id = $4) and ($5::uuid is null or t.driver_id = $5)
      and ($6::timestamptz is null or coalesce(t.actual_departure, t.planned_departure, t.created_at) >= $6)
      and ($7::timestamptz is null or coalesce(t.actual_departure, t.planned_departure, t.created_at) < $7)
    order by case when t.status in ('em_viagem','pausada') then 0 when t.status in ('planeada','aguardando_partida') then 1 else 2 end,
      coalesce(t.actual_departure, t.planned_departure, t.created_at) desc
    limit 300`,
    [m.orgId, statuses, q.get('q') || null, q.get('vehicleId') || null, q.get('driverId') || null, q.get('from') || null, q.get('to') || null])));
});

const ReplaceSchema = z.object({ tripIds: z.array(z.string().uuid()).min(1).max(2), action: z.enum(['cancelar', 'concluir']) }).optional();
type Replace = z.infer<typeof ReplaceSchema>;

/** Antes de iniciar uma viagem:
 *  - testes "Testar com o meu telemóvel" esquecidos com o mesmo camião/motorista terminam sozinhos;
 *  - viagens REAIS em curso com o mesmo camião/motorista: sem escolha → 409 `ja_em_viagem` com os dados delas (para o aviso);
 *    com `replace` (o utilizador escolheu no aviso) → canceladas ou concluídas na mesma transação, pela máquina de estados.
 *  Só vê viagens da própria organização (RLS). Devolve as viagens fechadas (para o pós-processamento). */
async function prepareStart(c: Tx, tripId: string, replace: Replace): Promise<string[]> {
  const closed: string[] = [];
  const tests = await many<{ id: string }>(c, `select o.id from trips t join trips o on o.id <> t.id and o.deleted_at is null
      and o.status in ('em_viagem','pausada') and (o.vehicle_id = t.vehicle_id or o.driver_id = t.driver_id)
      join vehicles ov on ov.id = o.vehicle_id and ov.is_test where t.id = $1`, [tripId]);
  for (const r of tests) { await c.query(`select 1 from trip_transition($1, 'concluida')`, [r.id]); closed.push(r.id); }
  const busy = await many<{ id: string; code: string; status: string; origin: string; destination: string; plate: string | null; driver: string | null; same_vehicle: boolean; same_driver: boolean }>(c,
    `select o.id, o.code, o.status, po.name origin, pd.name destination, ov.plate_normalized plate, od.full_name driver,
        o.vehicle_id = t.vehicle_id same_vehicle, o.driver_id = t.driver_id same_driver
     from trips t join trips o on o.id <> t.id and o.deleted_at is null and o.status in ('em_viagem','pausada')
       and (o.vehicle_id = t.vehicle_id or o.driver_id = t.driver_id)
     join places po on po.id = o.origin_place_id join places pd on pd.id = o.destination_place_id
     left join vehicles ov on ov.id = o.vehicle_id left join drivers od on od.id = o.driver_id
     where t.id = $1`, [tripId]);
  if (!busy.length) return closed;
  // só substitui se o utilizador escolheu TODAS as viagens em conflito (as que viu no aviso)
  if (!replace || !busy.every((x) => replace.tripIds.includes(x.id))) throw new HttpError(409, 'ja_em_viagem', { trips: busy });
  const code = (await one<{ code: string }>(c, 'select code from trips where id = $1', [tripId]))!.code;
  for (const x of busy) {
    if (replace.action === 'cancelar') await c.query(`select 1 from trip_transition($1, 'cancelada', $2)`, [x.id, `Substituída pela viagem ${code}`]);
    else await c.query(`select 1 from trip_transition($1, 'concluida')`, [x.id]);
    closed.push(x.id);
  }
  return closed;
}

route('POST', '/api/trips', async (req) => {
  const m = await requireMember(req, WRITE);
  const b = parse(TripSchema, req.body);
  const start = (req.body as { start?: unknown } | null)?.start === true;
  const replace = parse(ReplaceSchema, (req.body as { replace?: unknown } | null)?.replace);
  let closed: string[] = [];
  const res = await asMember(m, async (c) => {
    const cols = TCOLS.filter((k) => b[k] !== undefined);
    const t = await one<{ id: string; code: string }>(c, `insert into trips (organization_id, created_by, ${cols.join(',')})
      values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(',')}) returning id, code`, [m.orgId, m.userId, ...cols.map((k) => b[k])]);
    let seq = 1;
    for (const s of b.stops ?? []) {
      await c.query(`insert into trip_stops (organization_id, trip_id, seq, kind, place_id, recipient_name, recipient_phone, planned_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [m.orgId, t!.id, seq++, s.kind, s.place_id, s.recipient_name ?? null, s.recipient_phone ?? null, s.planned_at ?? null]);
    }
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id) values ($1, $2, 'criada', 'member', $3)`, [m.orgId, t!.id, m.userId]);
    const r = await planAndStoreTripRoute(c, t!.id, 'plan');
    if (r) await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload) values ($1,$2,'rota','system',null,$3)`,
      [m.orgId, t!.id, JSON.stringify({ km: Math.round(r.lengthM / 100) / 10, provider: r.provider })]);
    await audit(c, m, 'viagem.criar', 'trips', t!.id);
    // criar + iniciar na MESMA transação: se não puder iniciar, nada fica criado (sem viagens "Planeada" a mais)
    if (start) {
      closed = await prepareStart(c, t!.id, replace);
      await c.query(`select 1 from trip_transition($1, 'em_viagem')`, [t!.id]);
    }
    return { id: t!.id, code: t!.code, route: r ? { lengthKm: r.lengthM / 1000, durationS: r.durationS } : null };
  });
  for (const id of closed) await afterTripClosed(id);
  return ok(res, 201);
});

route('GET', '/api/trips/:id', async (req, p) => {
  const m = await requireMember(req);
  const id = assertUuid(p.id);
  return ok(await asMember(m, async (c) => {
    const trip = await one(c, `select t.*, po.name origin, ST_X(po.geom::geometry) origin_lng, ST_Y(po.geom::geometry) origin_lat,
        pd.name destination, ST_X(pd.geom::geometry) dest_lng, ST_Y(pd.geom::geometry) dest_lat,
        v.plate_normalized plate, v.make, v.model, d.full_name driver_name, d.phone driver_phone, d.user_id driver_user_id,
        (select doc.expires_on from documents doc where doc.driver_id = d.id and doc.doc_type = 'carta_conducao' order by doc.expires_on desc limit 1) license_expires,
        coalesce((o.settings->>'late_tolerance_min')::int, 30) late_tolerance_min,
        coalesce((o.settings->>'freshness_current_s')::int, 120) freshness_current_s, coalesce((o.settings->>'freshness_stale_s')::int, 900) freshness_stale_s
      from trips t join organizations o on o.id = t.organization_id join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id
      left join vehicles v on v.id = t.vehicle_id left join drivers d on d.id = t.driver_id where t.id = $1 and t.deleted_at is null`, [id]);
    if (!trip) throw new HttpError(404, 'nao_encontrado');
    const stops = await many(c, `select s.*, p.name place_name from trip_stops s join places p on p.id = s.place_id where s.trip_id = $1 order by seq`, [id]);
    const events = await many(c, `select e.id, e.kind, e.occurred_at, e.actor_type, e.payload, coalesce(u.full_name, d.full_name) actor_name
      from trip_events e left join app_users u on u.id = e.actor_id left join drivers d on d.id = e.actor_id
      where e.trip_id = $1 order by e.occurred_at desc limit 300`, [id]);
    const route_ = await one(c, `select id, version, provider, length_m, duration_s, roads, validated_for_truck, created_at, base_km,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom::geometry, 0.0002), 5)::json geometry from trip_routes where trip_id = $1 and is_current`, [id]);
    const places = route_ ? await many(c, `select rp.place_id, p.name, p.kind, p.importance, rp.km_from_origin, rp.state, rp.eta, rp.eta_confidence, rp.passed_at
      from trip_route_places rp join places p on p.id = rp.place_id where rp.trip_route_id = $1 order by rp.seq`, [route_.id]) : [];
    const progress = await one(c, `select km_done, km_left, pct, road_name, speed_limit_kmh, current_label, eta_destination, eta_confidence, speed_kmh_smoothed, last_position_at, updated_at,
        (engine_state->>'offRoute')::boolean off_route from trip_progress where trip_id = $1`, [id]);
    const position = await one(c, `select ST_X(l.geom::geometry) lng, ST_Y(l.geom::geometry) lat, l.speed_kmh, l.heading, l.accuracy_m, l.device_time, l.source,
        ST_X(l.matched_geom::geometry) matched_lng, ST_Y(l.matched_geom::geometry) matched_lat, l.road_name, l.speed_limit_kmh, l.matched_at,
        (select array_agg(s order by t) from (select p.device_time t, p.speed_kmh s from vehicle_positions p
           where p.vehicle_id = l.vehicle_id and p.device_time > l.device_time - interval '2 minutes' and p.speed_kmh is not null
           order by p.device_time desc limit 8) x) recent_speeds
      from vehicle_latest_positions l where l.vehicle_id = $1 and l.trip_id = $2`, [trip.vehicle_id, id]);
    const shares = ['owner', 'admin', 'dispatcher'].includes(m.role) ? await many(c, `select id, short_code, expires_at, revoked_at, is_active, options, views_count, created_at
      from tracking_shares where trip_id = $1 order by created_at desc`, [id]) : [];
    const incidents = await many(c, 'select id, kind, note, photo_file_id, occurred_at, resolved_at from incidents where trip_id = $1 order by occurred_at desc', [id]);
    const proofs = await many(c, 'select id, received_by_name, signature_file_id, photo_file_id, delivered_at from delivery_proofs where trip_id = $1', [id]);
    const expenses = m.role === 'viewer' ? [] : await many(c, 'select id, category, amount, currency, spent_at, note, receipt_file_id from trip_expenses where trip_id = $1 order by spent_at', [id]);
    return { trip, stops, events, route: route_, places, progress, position, shares, incidents, proofs, expenses, serverTime: new Date().toISOString() };
  }));
});

route('PATCH', '/api/trips/:id', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const id = assertUuid(p.id);
  const b = parse(z.object({ ...Object.fromEntries(TCOLS.map((k) => [k, z.any().optional()])) }).passthrough(), req.body);
  const partial = parse(z.object({
    vehicle_id: z.string().uuid().nullable().optional(), driver_id: z.string().uuid().nullable().optional(),
    origin_place_id: z.string().uuid().optional(), destination_place_id: z.string().uuid().optional(),
    planned_departure: dt, planned_arrival: dt, cargo_description: z.string().max(500).nullable().optional(),
    cargo_weight_t: z.number().min(0).max(500).nullable().optional(), recipient_name: z.string().max(120).nullable().optional(),
    recipient_phone: phone, client_reference: z.string().max(80).nullable().optional(), notes: z.string().max(2000).nullable().optional(),
  }), b);
  const keys = TCOLS.filter((k) => partial[k] !== undefined);
  if (!keys.length) throw new HttpError(400, 'sem_alteracoes');
  return ok(await asMember(m, async (c) => {
    const before = await one<{ status: string; origin_place_id: string; destination_place_id: string; vehicle_id: string }>(c,
      'select status, origin_place_id, destination_place_id, vehicle_id from trips where id = $1 and deleted_at is null', [id]);
    if (!before) throw new HttpError(404, 'nao_encontrado');
    if (['concluida', 'cancelada'].includes(before.status)) throw new HttpError(422, 'viagem_fechada');
    await c.query(`update trips set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => partial[k])]);
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload) values ($1,$2,'editada','member',$3,$4)`,
      [m.orgId, id, m.userId, JSON.stringify(Object.fromEntries(keys.filter((k) => !k.startsWith('recipient')).map((k) => [k, partial[k]])))]);
    let routeKm: number | null | undefined;
    if ((partial.origin_place_id && partial.origin_place_id !== before.origin_place_id) || (partial.destination_place_id && partial.destination_place_id !== before.destination_place_id)
        || (partial.vehicle_id !== undefined && partial.vehicle_id !== before.vehicle_id)) {
      const r = await planAndStoreTripRoute(c, id, 'edit');
      routeKm = r ? r.lengthM / 1000 : null;
    }
    await audit(c, m, 'viagem.editar', 'trips', id);
    return { ok: true, routeKm };
  }));
});

route('POST', '/api/trips/:id/replan', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const id = assertUuid(p.id);
  return ok(await asMember(m, async (c) => {
    const r = await planAndStoreTripRoute(c, id, 'edit');
    if (!r) throw new HttpError(503, 'rota_indisponivel');
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload) values ($1,$2,'rota','member',$3,$4)`,
      [m.orgId, id, m.userId, JSON.stringify({ km: Math.round(r.lengthM / 100) / 10, provider: r.provider })]);
    return { lengthKm: r.lengthM / 1000, durationS: r.durationS };
  }));
});

route('POST', '/api/trips/:id/transition', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const b = parse(z.object({ to: z.enum(['aguardando_partida', 'em_viagem', 'pausada', 'concluida', 'cancelada']), reason: z.string().max(500).optional() }), req.body);
  const id = assertUuid(p.id);
  let closed: string[] = [];
  const t = await asMember(m, async (c) => {
    if (b.to === 'em_viagem') closed = await prepareStart(c, id, parse(ReplaceSchema, (req.body as { replace?: unknown } | null)?.replace));
    return one(c, 'select id, status, code from trip_transition($1, $2, $3)', [id, b.to, b.reason ?? null]);
  });
  for (const x of closed) await afterTripClosed(x);
  if (b.to === 'concluida') await afterTripClosed(id);
  return ok(t);
});

// Viagem em curso em que o motorista é o próprio utilizador (para ligar o GPS sozinho ao entrar na app, no telemóvel).
route('GET', '/api/own-active-trip', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, (c) => one(c, `select t.id, po.name origin, pd.name destination from trips t join drivers d on d.id = t.driver_id
      join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id
    where d.user_id = $1 and t.status in ('em_viagem','pausada') and t.deleted_at is null order by t.actual_departure desc limit 1`, [m.userId])) ?? null);
});

// "Usar o GPS deste telemóvel": só quando o motorista da viagem é o próprio utilizador (motorista ligado à conta).
route('POST', '/api/trips/:id/my-driver-session', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const id = assertUuid(p.id);
  const t = await asMember(m, (c) => one<{ driver_id: string; status: string }>(c,
    `select t.driver_id, t.status from trips t join drivers d on d.id = t.driver_id where t.id = $1 and t.deleted_at is null and d.user_id = $2`, [id, m.userId]));
  if (!t) throw new HttpError(403, 'sem_permissao');
  const token = await withSystem((c) => createOwnDriverSession(c, m.orgId!, t.driver_id, m.userId, 'GPS deste telemóvel (consentimento no botão)'));
  await asMember(m, (c) => audit(c, m, 'motorista.sessao_propria', 'trips', id));
  return ok({ driverToken: token }, 201);
});

route('POST', '/api/trips/:id/notes', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const b = parse(z.object({ text: z.string().min(1).max(1000) }), req.body);
  await asMember(m, (c) => c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload) values ($1,$2,'nota','member',$3,$4)`,
    [m.orgId, assertUuid(p.id), m.userId, JSON.stringify({ text: b.text })]));
  return ok({ ok: true }, 201);
});

route('DELETE', '/api/trips/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, async (c) => {
    const r = await c.query(`update trips set deleted_at = now() where id = $1 and deleted_at is null and status in ('planeada','aguardando_partida','cancelada','concluida')`, [assertUuid(p.id)]);
    if (!r.rowCount) throw new HttpError(422, 'viagem_ativa_ou_inexistente');
    await audit(c, m, 'viagem.eliminar', 'trips', p.id!);
  });
  return ok({ ok: true });
});

// Reprodução do percurso (replay): posições da viagem, sob pedido.
route('GET', '/api/trips/:id/track', async (req, p) => {
  const m = await requireMember(req);
  const id = assertUuid(p.id);
  return ok(await asMember(m, async (c) => {
    const pts = await many(c, `select ST_X(geom::geometry) lng, ST_Y(geom::geometry) lat, device_time, speed_kmh, heading
      from vehicle_positions where trip_id = $1 and not ('rejected' = any(flags)) order by device_time limit 20000`, [id]);
    if (pts.length) return { points: pts, simplified: false };
    const tr = await one(c, 'select ST_AsGeoJSON(geom::geometry, 5)::json geometry, points_count from trip_tracks where trip_id = $1', [id]);
    return { points: [], track: tr, simplified: true };
  }));
});

// ── Partilhas (ADR-009) ──
route('POST', '/api/trips/:id/shares', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const b = parse(z.object({
    expires_at: z.string().datetime({ offset: true }).optional(), stop_id: z.string().uuid().nullable().optional(),
    options: z.object({ show_company: z.boolean(), show_logo: z.boolean(), show_plate_masked: z.boolean(), show_driver_first_name: z.boolean() }).optional(),
  }), req.body ?? {});
  const id = assertUuid(p.id);
  const token = randomToken(16); // 128 bits
  const s = await asMember(m, async (c) => {
    const t = await one<{ planned_arrival: string | null }>(c, 'select planned_arrival from trips where id = $1', [id]);
    if (!t) throw new HttpError(404, 'nao_encontrado');
    // validade por omissão: chegada prevista + 48 h (ou 7 dias se não houver chegada prevista)
    const exp = b.expires_at ?? new Date((t.planned_arrival ? new Date(t.planned_arrival).getTime() : Date.now() + 5 * 864e5) + 48 * 3600e3).toISOString();
    return one<{ id: string; short_code: string; expires_at: string }>(c, 'select id, short_code, expires_at from share_create($1, $2, $3, $4, $5)',
      [id, b.stop_id ?? null, sha256(token), exp, b.options ? JSON.stringify(b.options) : null]);
  });
  return ok({ ...s, link: `${publicBase(req)}/t/${token}` }, 201);
});

route('POST', '/api/shares/:id/revoke', async (req, p) => {
  const m = await requireMember(req, WRITE);
  await asMember(m, (c) => c.query('select share_revoke($1)', [assertUuid(p.id)]));
  return ok({ ok: true });
});

route('GET', '/api/shares/:id/logs', async (req, p) => {
  const m = await requireMember(req, WRITE);
  return ok(await asMember(m, (c) => many(c, 'select accessed_at, via from tracking_access_logs where share_id = $1 order by accessed_at desc limit 200', [assertUuid(p.id)])));
});

/** Ao concluir: percurso simplificado para replay e estatísticas de velocidade por troço. */
export async function afterTripClosed(tripId: string) {
  const { withSystem } = await import('../db.js');
  await withSystem(async (c) => {
    await c.query('select build_trip_track($1)', [tripId]);
    await c.query(`update trip_progress set eta_destination = null, eta_confidence = 'indisponivel' where trip_id = $1`, [tripId]);
  }).catch((e) => console.error('[viagem] pós-conclusão falhou', e));
}
