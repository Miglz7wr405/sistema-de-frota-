// Motor de rotas para camiões (ADR-002/ADR-019). Distâncias SEMPRE pela estrada; se o serviço falhar,
// devolve erro e nada é inventado (sem linha reta).
// ⚠️ DEPENDÊNCIA EXTERNA: Valhalla público da FOSSGIS (valhalla1.openstreetmap.de) — grátis, uso justo, sem SLA.
// ⚠️ DEPENDÊNCIA EXTERNA (opcional): OpenRouteService (driving-hgv) com ORS_API_KEY gratuita.
import { cumulative, decodePolyline6, type LngLat } from '../src/lib/geo/geometry.js';
import { sha256 } from './crypto.js';
import type { Tx } from './db.js';

export type TruckProfile = { heightM?: number | null; widthM?: number | null; lengthM?: number | null; weightT?: number | null; axles?: number | null };
export type PlannedRoute = { provider: string; coords: LngLat[]; cum: number[]; lengthM: number; durationS: number; roads: string[]; validatedForTruck: boolean };
export type RoutingProvider = (points: LngLat[], truck: TruckProfile) => Promise<PlannedRoute>;

export class RouteUnavailable extends Error {}

const valhalla: RoutingProvider = async (points, truck) => {
  const url = process.env.VALHALLA_URL ?? 'https://valhalla1.openstreetmap.de/route';
  const body = {
    locations: points.map(([lon, lat]) => ({ lat, lon, type: 'break' })),
    costing: 'truck',
    costing_options: { truck: {
      ...(truck.heightM ? { height: truck.heightM } : {}), ...(truck.widthM ? { width: truck.widthM } : {}),
      ...(truck.lengthM ? { length: truck.lengthM } : {}), ...(truck.weightT ? { weight: truck.weightT } : {}),
      ...(truck.axles ? { axle_count: truck.axles } : {}),
    } },
    units: 'kilometers', language: 'pt-PT', directions_type: 'maneuvers',
  };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'insightFrota/0.1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new RouteUnavailable(`valhalla_${r.status}`);
  const j = (await r.json()) as { trip?: { legs: { shape: string; maneuvers?: { street_names?: string[] }[] }[]; summary: { length: number; time: number } } };
  if (!j.trip) throw new RouteUnavailable('valhalla_sem_rota');
  const coords: LngLat[] = [];
  const roads = new Set<string>();
  for (const leg of j.trip.legs) {
    const pts = decodePolyline6(leg.shape);
    coords.push(...(coords.length ? pts.slice(1) : pts));
    for (const mnv of leg.maneuvers ?? []) for (const n of mnv.street_names ?? []) if (/^(EN|N|R)\s?\d+/i.test(n)) roads.add(n.toUpperCase().replace(/\s+/, ''));
  }
  const cum = cumulative(coords);
  return { provider: 'valhalla-fossgis', coords, cum, lengthM: cum[cum.length - 1]!, durationS: j.trip.summary.time, roads: [...roads], validatedForTruck: false };
};

const ors: RoutingProvider = async (points) => {
  const r = await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
    method: 'POST', headers: { authorization: process.env.ORS_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ coordinates: points }), signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new RouteUnavailable(`ors_${r.status}`);
  const j = (await r.json()) as { features?: { geometry: { coordinates: LngLat[] }; properties: { summary: { duration: number } } }[] };
  const f = j.features?.[0];
  if (!f) throw new RouteUnavailable('ors_sem_rota');
  const cum = cumulative(f.geometry.coordinates);
  return { provider: 'openrouteservice-hgv', coords: f.geometry.coordinates, cum, lengthM: cum[cum.length - 1]!, durationS: f.properties.summary.duration, roads: [], validatedForTruck: false };
};

let override: RoutingProvider | null = null;
export const setRoutingProviderForTests = (p: RoutingProvider | null) => { override = p; };

async function callProviders(points: LngLat[], truck: TruckProfile): Promise<PlannedRoute> {
  if (override) return override(points, truck);
  const chain: RoutingProvider[] = process.env.ORS_API_KEY ? [ors, valhalla] : [valhalla];
  let last: unknown;
  for (const p of chain) {
    try { return await p(points, truck); } catch (e) { last = e; }
  }
  throw last instanceof RouteUnavailable ? last : new RouteUnavailable(String(last));
}

/** Rota com cache (route_cache, 30 dias). A chave inclui os pontos arredondados a ~100 m e o perfil do camião. */
export async function planRoute(c: Tx, points: LngLat[], truck: TruckProfile): Promise<PlannedRoute & { cached: boolean }> {
  const key = sha256(JSON.stringify({ p: points.map(([a, b]) => [a.toFixed(3), b.toFixed(3)]), t: truck, v: 1 }));
  const hit = await c.query(`update route_cache set hits = hits + 1 where cache_key = $1 and expires_at > now()
      returning provider, ST_AsGeoJSON(geom::geometry) as g, cum_m, length_m, duration_s, roads, validated_for_truck`, [key]);
  if (hit.rows[0]) {
    const h = hit.rows[0];
    return { provider: h.provider, coords: JSON.parse(h.g).coordinates, cum: h.cum_m, lengthM: h.length_m, durationS: h.duration_s, roads: h.roads, validatedForTruck: h.validated_for_truck, cached: true };
  }
  const r = await callProviders(points, truck);
  await c.query(`insert into route_cache (cache_key, provider, profile, geom, cum_m, length_m, duration_s, roads, validated_for_truck, expires_at)
      values ($1, $2, $3, ST_GeomFromGeoJSON($4)::geography, $5, $6, $7, $8, $9, now() + interval '30 days')
      on conflict (cache_key) do update set geom = excluded.geom, cum_m = excluded.cum_m, length_m = excluded.length_m,
        duration_s = excluded.duration_s, roads = excluded.roads, expires_at = excluded.expires_at`,
    [key, r.provider, JSON.stringify(truck), JSON.stringify({ type: 'LineString', coordinates: r.coords }), r.cum, r.lengthM, r.durationS, r.roads, r.validatedForTruck]);
  return { ...r, cached: false };
}
