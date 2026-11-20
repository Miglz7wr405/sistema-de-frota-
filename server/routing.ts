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

/** SÓ PARA TESTES LOCAIS (E2E sem acesso à internet). Nunca ativa na Vercel.
 *  Com E2E_ROUTES_FILE: devolve a rota REAL (calculada antes pelo Valhalla e guardada) quando a origem e o destino coincidem
 *  (≤ 5 km); caso contrário, linha sintética entre os pontos. */
let realRoutes: { from: LngLat; to: LngLat; coords: LngLat[]; durationS: number; roads: string[] }[] | null = null;
async function loadRealRoutes() {
  if (realRoutes || !process.env.E2E_ROUTES_FILE) return realRoutes ?? [];
  const { readFileSync } = await import('node:fs');
  const f = JSON.parse(readFileSync(process.env.E2E_ROUTES_FILE, 'utf8')) as { rotas: { polyline: string; duracao_s: number; estradas: string[] }[] };
  const decode = (str: string): LngLat[] => { let i = 0, lat = 0, lng = 0; const out: LngLat[] = [];
    while (i < str.length) { for (const k of [0, 1]) { let r = 0, sh = 0, b: number; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) lat += d; else lng += d; } out.push([lng / 1e5, lat / 1e5]); } return out; };
  realRoutes = f.rotas.map((r) => { const coords = decode(r.polyline); return { from: coords[0]!, to: coords[coords.length - 1]!, coords, durationS: r.duracao_s, roads: r.estradas }; });
  return realRoutes;
}
const near = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
const e2eStub: RoutingProvider = async (points) => {
  const real = (await loadRealRoutes()).find((r) => points.length === 2 && near(points[0]!, r.from) && near(points[1]!, r.to));
  if (real) { const cum = cumulative(real.coords); return { provider: 'valhalla-fossgis (guardada)', coords: real.coords, cum, lengthM: cum[cum.length - 1]!, durationS: real.durationS, roads: real.roads, validatedForTruck: false }; }
  const coords: LngLat[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [a, b] = [points[k]!, points[k + 1]!];
    for (let i = k ? 1 : 0; i <= 120; i++) { const f = i / 120; coords.push([a[0] + (b[0] - a[0]) * f + Math.sin(f * Math.PI) * 0.05, a[1] + (b[1] - a[1]) * f]); }
  }
  const cum = cumulative(coords);
  return { provider: 'teste-local', coords, cum, lengthM: cum[cum.length - 1]!, durationS: (cum[cum.length - 1]! / 1000 / 55) * 3600, roads: [], validatedForTruck: false };
};

async function callProviders(points: LngLat[], truck: TruckProfile): Promise<PlannedRoute> {
  if (override) return override(points, truck);
  if (process.env.E2E_ROUTING_STUB === '1' && !process.env.VERCEL) return e2eStub(points, truck);
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
