// Planeia e grava a rota de uma viagem + localidades ao longo da rota ("horário de comboio").
import { HttpError } from './http.js';
import { many, one, type Tx } from './db.js';
import { planRoute, RouteUnavailable, type PlannedRoute } from './routing.js';
import { projectOnLine, simplify, type LngLat } from '../src/lib/geo/geometry.js';
import type { RouteModel } from '../src/lib/geo/progress.js';

type PlaceRow = { id: string; name: string; kind: string; importance: number; province_id: string | null; lng: number; lat: number };

export async function placeById(c: Tx, id: string) {
  const p = await one<PlaceRow>(c, 'select id, name, kind, importance, province_id, ST_X(geom::geometry) lng, ST_Y(geom::geometry) lat from places where id = $1 and deleted_at is null', [id]);
  if (!p) throw new HttpError(400, 'localidade_invalida');
  return p;
}

/** Calcula e grava a rota atual da viagem (nova versão). Devolve null se o motor de rotas estiver indisponível. */
export async function planAndStoreTripRoute(c: Tx, tripId: string, reason: 'plan' | 'deviation' | 'edit', startAt?: LngLat, baseKm = 0): Promise<PlannedRoute | null> {
  const t = await one<{ organization_id: string; origin_place_id: string; destination_place_id: string; vehicle_id: string | null }>(c,
    'select organization_id, origin_place_id, destination_place_id, vehicle_id from trips where id = $1', [tripId]);
  if (!t) throw new HttpError(404, 'nao_encontrado');
  const origin = await placeById(c, t.origin_place_id);
  const dest = await placeById(c, t.destination_place_id);
  const stops = await many<PlaceRow>(c, `select p.id, p.name, p.kind, p.importance, p.province_id, ST_X(p.geom::geometry) lng, ST_Y(p.geom::geometry) lat
     from trip_stops s join places p on p.id = s.place_id where s.trip_id = $1 and s.arrived_at is null order by s.seq`, [tripId]);
  const v = t.vehicle_id ? await one<{ height_m: number; width_m: number; length_m: number; gross_weight_t: number; axles: number }>(c,
    'select height_m, width_m, length_m, gross_weight_t, axles from vehicles where id = $1', [t.vehicle_id]) : null;
  const points: LngLat[] = [startAt ?? [origin.lng, origin.lat], ...stops.map((s) => [s.lng, s.lat] as LngLat), [dest.lng, dest.lat]];
  let r: PlannedRoute & { cached?: boolean };
  try {
    r = await planRoute(c, points, { heightM: v?.height_m, widthM: v?.width_m, lengthM: v?.length_m, weightT: v?.gross_weight_t, axles: v?.axles });
  } catch (e) {
    if (e instanceof RouteUnavailable) { console.warn('[rotas] indisponível', e.message); return null; }
    throw e;
  }
  if (!r.cached) await c.query(`select bump_usage($1, 'route_requests')`, [t.organization_id]);

  const ver = await one<{ v: number }>(c, 'select coalesce(max(version), 0) + 1 as v from trip_routes where trip_id = $1', [tripId]);
  const old = await one<{ id: string }>(c, 'select id from trip_routes where trip_id = $1 and is_current', [tripId]);
  await c.query('update trip_routes set is_current = false where trip_id = $1 and is_current', [tripId]);
  const tr = await one<{ id: string }>(c, `insert into trip_routes (organization_id, trip_id, version, reason, provider, geom, cum_m, length_m, duration_s, roads, validated_for_truck, base_km)
     values ($1, $2, $3, $4, $5, ST_GeomFromGeoJSON($6)::geography, $7, $8, $9, $10, $11, $12) returning id`,
    [t.organization_id, tripId, ver!.v, reason, r.provider, JSON.stringify({ type: 'LineString', coordinates: r.coords }), r.cum, r.lengthM, r.durationS, r.roads, r.validatedForTruck, baseKm]);
  let seq = 1;
  const keepIds = new Set<string>();
  if (reason === 'deviation' && old) {
    // as localidades já passadas mantêm-se na linha do tempo, com a hora real
    const passed = await many<{ place_id: string; km_from_origin: number; offset_m: number; passed_at: string }>(c,
      `select place_id, km_from_origin, offset_m, passed_at from trip_route_places where trip_route_id = $1 and state = 'passada' order by seq`, [old.id]);
    for (const p of passed) {
      keepIds.add(p.place_id);
      await c.query(`insert into trip_route_places (organization_id, trip_route_id, place_id, seq, km_from_origin, offset_m, state, passed_at) values ($1,$2,$3,$4,$5,$6,'passada',$7)`,
        [t.organization_id, tr!.id, p.place_id, seq++, p.km_from_origin, p.offset_m, p.passed_at]);
    }
  }

  // Localidades a ≤ 2 km da estrada, projetadas com o MESMO motor que mede o progresso.
  const cands = await many<PlaceRow & { offset_m: number }>(c, `select a.place_id id, a.name, a.kind, a.importance, a.province_id, a.offset_m,
       ST_X(p.geom::geometry) lng, ST_Y(p.geom::geometry) lat
     from places_along_route(ST_GeomFromGeoJSON($1)::geography, $2, 1, 2000) a join places p on p.id = a.place_id`,
    [JSON.stringify({ type: 'LineString', coordinates: simplify(r.coords, 20) }), t.organization_id]);
  const must = new Map<string, PlaceRow>([[origin.id, origin], [dest.id, dest], ...stops.map((s) => [s.id, s] as [string, PlaceRow])]);
  const rows: { id: string; km: number; off: number; name: string; must: boolean }[] = [];
  const seen = new Set<string>();
  for (const p of [...cands, ...must.values()]) {
    if (seen.has(p.id) || keepIds.has(p.id) || (startAt && p.id === origin.id)) continue;
    seen.add(p.id);
    const pr = projectOnLine(r.coords, r.cum, [p.lng, p.lat]);
    if (!pr) continue;
    let km = baseKm + pr.alongM / 1000;
    if (p.id === origin.id && !startAt) km = 0;
    if (p.id === dest.id) km = baseKm + r.lengthM / 1000;
    rows.push({ id: p.id, km, off: pr.offsetM, name: p.name, must: must.has(p.id) });
  }
  rows.sort((a, b) => a.km - b.km);
  // o OSM tem às vezes vários pontos com o mesmo nome no mesmo sítio (ex.: 21 "Portagem" na mesma praça): fica só um por 1,5 km
  const lastByName = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r0 = rows[i]!; const prev = lastByName.get(r0.name);
    if (!r0.must && prev != null && r0.km - prev < 1.5) { rows.splice(i--, 1); continue; }
    lastByName.set(r0.name, r0.km);
  }
  for (const row of rows) {
    await c.query(`insert into trip_route_places (organization_id, trip_route_id, place_id, seq, km_from_origin, offset_m) values ($1,$2,$3,$4,$5,$6)`,
      [t.organization_id, tr!.id, row.id, seq++, row.km, row.off]);
  }
  await c.query(`insert into trip_progress (trip_id, organization_id, trip_route_id) values ($1, $2, $3)
     on conflict (trip_id) do update set trip_route_id = excluded.trip_route_id, engine_state = case when $4 then '{}'::jsonb else trip_progress.engine_state end`,
    [tripId, t.organization_id, tr!.id, reason !== 'deviation']);
  return r;
}

/** Carrega o modelo da rota atual para o motor de progresso. */
export async function loadRouteModel(c: Tx, tripId: string): Promise<(RouteModel & { routeId: string; routeVersion: number; baseKm: number }) | null> {
  const r = await one<{ id: string; version: number; g: string; cum_m: number[]; length_m: number; duration_s: number; roads: string[]; base_km: number }>(c,
    `select id, version, ST_AsGeoJSON(geom::geometry, 6) g, cum_m, length_m, duration_s, roads, base_km from trip_routes where trip_id = $1 and is_current`, [tripId]);
  if (!r) return null;
  const places = await many<{ place_id: string; name: string; kind: string; importance: number; province_id: string | null; province_name: string | null; km_from_origin: number }>(c,
    `select rp.place_id, p.name, p.kind, p.importance, p.province_id, a.name province_name, rp.km_from_origin
     from trip_route_places rp join places p on p.id = rp.place_id left join admin_areas a on a.id = p.province_id
     where rp.trip_route_id = $1 and rp.km_from_origin >= $2 order by rp.seq`, [r.id, r.base_km]);
  return {
    routeId: r.id, routeVersion: r.version, baseKm: r.base_km, coords: JSON.parse(r.g).coordinates, cum: r.cum_m, lengthM: r.length_m, plannedDurationS: r.duration_s,
    places: places.map((p) => ({ placeId: p.place_id, name: p.name, kind: p.kind, importance: p.importance, provinceId: p.province_id, provinceName: p.province_name, kmFromOrigin: p.km_from_origin - r.base_km })),
  };
}

/** Distritos atravessados pela rota, por ordem, com o km (desde o início da geometria da rota) em que se entra em cada um.
 * Amostra a rota a cada 400 m e vê em que distrito (ADM2) cai cada ponto; só regista as mudanças. Sem distritos importados: []. */
export async function routeDistricts(c: Tx, routeId: string) {
  // em savepoint: se falhar, a transação do pedido continua válida (a voz dos distritos é um extra)
  await c.query('savepoint route_districts');
  try {
    const rows = await districtsQuery(c, routeId);
    await c.query('release savepoint route_districts');
    return rows;
  } catch (e) {
    await c.query('rollback to savepoint route_districts');
    console.warn('[distritos da rota]', (e as Error).message);
    return [];
  }
}
function districtsQuery(c: Tx, routeId: string) {
  return many<{ code: string; name: string; province: string | null; km: number }>(c, `
    with r as (select geom::geometry g, length_m from trip_routes where id = $1),
    pts as (select ST_LineLocatePoint(r.g, d.geom) f, d.geom p from r, ST_DumpPoints(ST_Segmentize(r.g::geography, 400)::geometry) d),
    lab as (select f, (select a.id from admin_areas a where a.level = 2 and ST_Covers(a.geom, p::geography) order by ST_Area(a.geom) limit 1) aid from pts),
    runs as (select f, aid, lag(aid) over (order by f) prev from lab where aid is not null)
    select a.code, a.name, pv.name province, round((runs.f * (select length_m from r) / 1000)::numeric, 3)::float8 km
    from runs join admin_areas a on a.id = runs.aid left join admin_areas pv on pv.id = a.parent_id
    where runs.aid is distinct from runs.prev order by runs.f`, [routeId]);
}
