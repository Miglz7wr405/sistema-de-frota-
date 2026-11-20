import { z } from 'zod';
import { route, ok, parse, HttpError } from '../http.js';
import { many, one } from '../db.js';
import { requireMember, asMember, WRITE } from '../auth.js';
import { planRoute, RouteUnavailable } from '../routing.js';
import { placeById } from '../trip-route.js';
import { maybeRunJobs } from './admin.js';

route('GET', '/api/health', async () => ok({ ok: true, time: new Date().toISOString() }));

route('GET', '/api/places/search', async (req) => {
  const m = await requireMember(req);
  const q = (req.query.get('q') ?? '').trim();
  if (q.length < 2) return ok([]);
  return ok(await asMember(m, (c) => many(c, `
    select p.id, p.name, p.kind, p.importance, p.organization_id is not null as private, a.name as province,
      ST_X(p.geom::geometry) lng, ST_Y(p.geom::geometry) lat
    from places p left join admin_areas a on a.id = p.province_id
    where p.deleted_at is null and (p.organization_id is null or p.organization_id = $2)
      and (p.name ilike $1 || '%' or p.name % $1 or exists (select 1 from unnest(p.name_variants) v where v ilike $1 || '%'))
    order by (p.name ilike $1 || '%') desc, p.importance desc, similarity(p.name, $1) desc limit 15`, [q, m.orgId])));
});

route('GET', '/api/places/status', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, (c) => one(c, `select (select count(*) from places where organization_id is null)::int as public_places,
     (select count(*) from places where organization_id = $1 and deleted_at is null)::int as private_places,
     (select count(*) from admin_areas where level = 1)::int as provinces,
     (select json_agg(json_build_object('name', name, 'source_url', source_url, 'license', license, 'retrieved_at', retrieved_at)) from geo_datasets) as datasets`, [m.orgId])));
});


route('GET', '/api/places/private', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, (c) => many(c, `select id, name, kind, ST_X(geom::geometry) lng, ST_Y(geom::geometry) lat, created_at from places
    where organization_id = $1 and deleted_at is null order by name`, [m.orgId])));
});

route('POST', '/api/places', async (req) => {
  const m = await requireMember(req, WRITE);
  const b = parse(z.object({ name: z.string().min(2).max(120), kind: z.enum(['warehouse', 'customer', 'depot', 'workshop', 'other']),
    lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }), req.body);
  return ok(await asMember(m, (c) => one(c, `insert into places (organization_id, name, kind, importance, geom, province_id)
    values ($1, $2, $3, 3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, (select id from province_at($4, $5)))
    returning id, name, kind`, [m.orgId, b.name, b.kind, b.lng, b.lat])), 201);
});

route('DELETE', '/api/places/:id', async (req, p) => {
  const m = await requireMember(req, WRITE);
  await asMember(m, (c) => c.query('update places set deleted_at = now() where id = $1 and organization_id = $2', [p.id, m.orgId]));
  return ok({ ok: true });
});

// Ferramenta "Distâncias": km e tempo rodoviários entre duas localidades (orçamentos de frete).
route('POST', '/api/routes/plan', async (req) => {
  const m = await requireMember(req);
  const b = parse(z.object({ from: z.string().uuid(), to: z.string().uuid(), vehicleId: z.string().uuid().optional() }), req.body);
  return ok(await asMember(m, async (c) => {
    const a = await placeById(c, b.from), z2 = await placeById(c, b.to);
    const v = b.vehicleId ? await one<{ height_m: number; width_m: number; length_m: number; gross_weight_t: number; axles: number }>(c,
      'select height_m, width_m, length_m, gross_weight_t, axles from vehicles where id = $1', [b.vehicleId]) : null;
    try {
      const r = await planRoute(c, [[a.lng, a.lat], [z2.lng, z2.lat]], { heightM: v?.height_m, widthM: v?.width_m, lengthM: v?.length_m, weightT: v?.gross_weight_t, axles: v?.axles });
      const { simplify, projectOnLine } = await import('../../src/lib/geo/geometry.js');
      const along = await many<{ id: string; name: string; kind: string; importance: number; lng: number; lat: number }>(c, `select a.place_id id, a.name, a.kind, a.importance,
          ST_X(p.geom::geometry) lng, ST_Y(p.geom::geometry) lat from places_along_route(ST_GeomFromGeoJSON($1)::geography, $2, 3, 2000) a join places p on p.id = a.place_id`,
        [JSON.stringify({ type: 'LineString', coordinates: simplify(r.coords, 20) }), m.orgId]);
      const places = along.map((p) => ({ name: p.name, kind: p.kind, km: (projectOnLine(r.coords, r.cum, [p.lng, p.lat])?.alongM ?? 0) / 1000 }))
        .sort((x, y) => x.km - y.km);
      return { from: a.name, to: z2.name, lengthKm: r.lengthM / 1000, durationS: r.durationS, roads: r.roads, provider: r.provider,
        validatedForTruck: r.validatedForTruck, places, geometry: { type: 'LineString', coordinates: simplify(r.coords, 50) } };
    } catch (e) {
      if (e instanceof RouteUnavailable) throw new HttpError(503, 'rota_indisponivel');
      throw e;
    }
  }));
});

route('GET', '/api/fleet/live', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, async (c) => ({
    vehicles: await many(c, `select s.id, s.plate, s.main_status, s.freshness, s.last_position_at, s.last_source, s.speed_kmh, s.heading,
        case when lp.matched_geom is not null and lp.matched_at >= lp.device_time - interval '1 second' then ST_X(lp.matched_geom::geometry) else s.lng end lng,
        case when lp.matched_geom is not null and lp.matched_at >= lp.device_time - interval '1 second' then ST_Y(lp.matched_geom::geometry) else s.lat end lat,
        lp.road_name, lp.speed_limit_kmh,
        s.active_trip_id, s.active_trip_code, p.current_label, p.km_left, p.km_done, p.eta_destination, p.eta_confidence, d.full_name driver,
        po.name trip_origin, pd.name trip_destination, (r.base_km + r.length_m / 1000.0) route_km,
        (select coalesce(jsonb_agg(jsonb_build_object('name', pl.name, 'km', rp.km_from_origin, 'importance', pl.importance, 'passedAt', rp.passed_at) order by rp.seq), '[]')
           from trip_route_places rp join places pl on pl.id = rp.place_id where rp.trip_route_id = r.id and pl.importance >= 3) route_places
      from vehicle_status_v s left join vehicle_latest_positions lp on lp.vehicle_id = s.id left join trip_progress p on p.trip_id = s.active_trip_id left join trips t on t.id = s.active_trip_id left join drivers d on d.id = t.driver_id
        left join places po on po.id = t.origin_place_id left join places pd on pd.id = t.destination_place_id
        left join trip_routes r on r.trip_id = t.id and r.is_current
      where s.organization_id = $1 order by s.plate`, [m.orgId]),
    serverTime: new Date().toISOString(),
  })));
});

route('GET', '/api/dashboard', async (req) => {
  const m = await requireMember(req);
  await maybeRunJobs();
  return ok(await asMember(m, async (c) => {
    const counts = await one(c, `select count(*)::int total,
        count(*) filter (where main_status = 'em_viagem')::int em_viagem, count(*) filter (where main_status = 'disponivel')::int disponiveis,
        count(*) filter (where main_status = 'em_manutencao')::int manutencao,
        count(*) filter (where active_trip_id is not null and freshness in ('sem_sinal','sem_dados'))::int sem_sinal
      from vehicle_status_v where organization_id = $1`, [m.orgId]);
    const tripCounts = await one(c, `select count(*) filter (where status in ('em_viagem','pausada'))::int ativas,
        count(*) filter (where status = 'concluida' and actual_arrival > now() - interval '30 days')::int concluidas_30d,
        count(*) filter (where status in ('planeada','aguardando_partida'))::int planeadas
      from trips where organization_id = $1 and deleted_at is null`, [m.orgId]);
    const alerts = await many(c, `select id, kind, severity, title, detail, opened_at, trip_id from alerts where organization_id = $1 and status = 'aberto' order by opened_at desc limit 6`, [m.orgId]);
    const openAlerts = await one<{ n: number }>(c, `select count(*)::int n from alerts where organization_id = $1 and status = 'aberto'`, [m.orgId]);
    const upcoming = await many(c, `select t.id, t.code, t.planned_departure, po.name origin, pd.name destination from trips t
      join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id
      where t.organization_id = $1 and t.status in ('planeada','aguardando_partida') and t.deleted_at is null order by t.planned_departure nulls last limit 5`, [m.orgId]);
    const docs = await many(c, `select doc.id, doc.doc_type, doc.expires_on, coalesce(v.plate_normalized, d.full_name) owner_label,
        (doc.expires_on - (now() at time zone 'Africa/Maputo')::date) days_left
      from documents doc left join vehicles v on v.id = doc.vehicle_id left join drivers d on d.id = doc.driver_id
      where doc.organization_id = $1 and doc.expires_on <= (now() at time zone 'Africa/Maputo')::date + 30 and coalesce(v.deleted_at, d.deleted_at) is null
      order by doc.expires_on limit 5`, [m.orgId]);
    const maint = m.role === 'viewer' ? [] : await many(c, `select s.id, s.kind, s.next_due_at, s.next_due_km, v.plate_normalized plate, v.odometer_km
      from maintenance_schedules s join vehicles v on v.id = s.vehicle_id where s.organization_id = $1 and v.deleted_at is null
        and (s.next_due_at <= current_date + 30 or (s.next_due_km is not null and v.odometer_km >= s.next_due_km - 2000))
      order by s.next_due_at nulls last limit 5`, [m.orgId]);
    const recent = await many(c, `select e.kind, e.occurred_at, e.payload, t.code, t.id trip_id from trip_events e join trips t on t.id = e.trip_id
      where e.organization_id = $1 order by e.occurred_at desc limit 8`, [m.orgId]);
    const places = await one<{ n: number }>(c, 'select count(*)::int n from places where organization_id is null or organization_id = $1', [m.orgId]);
    const devices = await one(c, `select count(*)::int total, count(*) filter (where last_contact_at > now() - interval '1 hour')::int online
      from gps_devices where organization_id = $1 and deleted_at is null`, [m.orgId]);
    return { counts, tripCounts, alerts, openAlerts: openAlerts?.n ?? 0, upcoming, docs, maint, recent, placesCount: places?.n ?? 0, devices, serverTime: new Date().toISOString() };
  }));
});

// Províncias importadas (usadas no registo e nos filtros). Sem importação → lista vazia (nada escrito à mão).
route('GET', '/api/geo/provinces', async () => {
  const { withSystem } = await import('../db.js');
  return ok(await withSystem((c) => many(c, 'select id, name from admin_areas where level = 1 order by name')));
});
