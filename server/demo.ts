// Demonstração com o SIMULADOR (fonte 'simulator', identificada na interface como "Simulador").
// Cria camião, motorista e viagem Quelimane → Beira com a ROTA REAL do motor de rotas, e gera posições
// ao longo dessa rota em tempo real (≈ 70 km/h), começando 30 min "atrás" para já haver progresso visível.
// As posições passam pela mesma ingestão do GPS real (validação, progresso, localidades, alertas).
import { HttpError } from './http.js';
import { withSystem, one, type Tx } from './db.js';
import { planAndStoreTripRoute, loadRouteModel } from './trip-route.js';
import { ingest } from './ingest.js';
import { hit } from './auth.js';
import { pointAt, bearing } from '../src/lib/geo/geometry.js';

const SPEED_KMH = 70;
const STEP_S = 30; // uma posição a cada 30 s de viagem
const BACKFILL_MIN = 30;
export const DEMO_PLATE = 'DEMO 001';

type DemoState = { tripId: string; vehicleId: string; driverId: string; startedAt: string; lastT?: number };

async function state(c: Tx, org: string): Promise<DemoState | null> {
  const r = await one<{ demo: DemoState | null }>(c, `select settings->'demo' demo from organizations where id = $1`, [org]);
  return r?.demo ?? null;
}

export async function startDemo(org: string, userId: string) {
  const existing = await withSystem((c) => state(c, org));
  if (existing) return existing;
  return withSystem(async (c) => {
    const q = await one<{ id: string }>(c, `select id from places where organization_id is null and name = 'Quelimane' order by importance desc limit 1`);
    const b = await one<{ id: string }>(c, `select id from places where organization_id is null and name = 'Beira' order by importance desc limit 1`);
    if (!q || !b) throw new HttpError(409, 'sem_localidades');
    const v = await one<{ id: string }>(c, `insert into vehicles (organization_id, plate, make, model, notes, gps_source_priority)
      values ($1, $2, 'Demonstração', 'Simulador', 'Camião de demonstração (posições do simulador)', 'device') returning id`, [org, DEMO_PLATE]);
    // telefone obrigatório: número reservado a demonstração, nunca usado para contactar ninguém
    const d = await one<{ id: string }>(c, `insert into drivers (organization_id, full_name, phone) values ($1, 'Motorista Demonstração', '+258800000000')
      on conflict do nothing returning id`, [org]) ?? await one<{ id: string }>(c, `select id from drivers where organization_id = $1 and phone = '+258800000000' and deleted_at is null`, [org]);
    const t = await one<{ id: string }>(c, `insert into trips (organization_id, vehicle_id, driver_id, origin_place_id, destination_place_id, cargo_description, notes, created_by)
      values ($1, $2, $3, $4, $5, 'Demonstração', 'DEMO: viagem simulada', $6) returning id`, [org, v!.id, d!.id, q.id, b.id, userId]);
    const r = await planAndStoreTripRoute(c, t!.id, 'plan');
    if (!r) throw new HttpError(503, 'rota_indisponivel');
    const startedAt = new Date(Date.now() - BACKFILL_MIN * 60_000).toISOString();
    // chegada prevista = duração do motor de rotas (perfil camião) + 20 % de margem — não é usada para inventar ETA
    await c.query(`update trips set status = 'em_viagem', actual_departure = $2, planned_departure = $2,
      planned_arrival = $2::timestamptz + make_interval(secs => $3) where id = $1`, [t!.id, startedAt, Math.max(r.durationS, (r.lengthM / 1000 / SPEED_KMH) * 3600) * 1.2]);
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, payload, occurred_at) values ($1,$2,'partida','system','{"demo":true}',$3)`, [org, t!.id, startedAt]);
    const st: DemoState = { tripId: t!.id, vehicleId: v!.id, driverId: d!.id, startedAt };
    await c.query(`update organizations set settings = jsonb_set(settings, '{demo}', $2::jsonb) where id = $1`, [org, JSON.stringify(st)]);
    return st;
  }).then(async (st) => { await advanceDemo(org, true); return st; });
}

/** Gera as posições em falta até "agora". Chamado pelos ecrãs (no máximo de 15 em 15 s por organização). */
export async function advanceDemo(org: string, force = false) {
  if (!force && !(await hit(`demo:${org}`, 15, 1))) return;
  const st = await withSystem((c) => state(c, org));
  if (!st) return;
  const model = await withSystem((c) => loadRouteModel(c, st.tripId));
  if (!model) return;
  const t0 = Date.parse(st.startedAt);
  const from = st.lastT ?? t0;
  const now = Date.now();
  const pts: Parameters<typeof ingest>[1] = [];
  for (let t = from + STEP_S * 1000; t <= now; t += STEP_S * 1000) {
    const along = Math.min(model.lengthM, ((t - t0) / 3_600_000) * SPEED_KMH * 1000);
    const p = pointAt(model.coords, model.cum, along);
    const ahead = pointAt(model.coords, model.cum, Math.min(model.lengthM, along + 60));
    pts.push({ lat: p[1], lng: p[0], device_time: new Date(t).toISOString(), speed_kmh: along >= model.lengthM ? 0 : SPEED_KMH, heading: bearing(p, ahead) % 360, accuracy_m: 8 });
    if (along >= model.lengthM) break;
  }
  if (!pts.length) return;
  for (let i = 0; i < pts.length; i += 50) {
    await ingest({ orgId: org, vehicleId: st.vehicleId, source: 'simulator', sourceId: `demo:${org}` }, pts.slice(i, i + 50), null);
  }
  const lastT = Date.parse(pts[pts.length - 1]!.device_time);
  await withSystem((c) => c.query(`update organizations set settings = jsonb_set(settings, '{demo,lastT}', to_jsonb($2::bigint)) where id = $1`, [org, lastT]));
}

export async function stopDemo(org: string) {
  await withSystem(async (c) => {
    const st = await state(c, org);
    if (!st) return;
    await c.query(`delete from vehicle_positions where vehicle_id = $1`, [st.vehicleId]);
    await c.query(`delete from trips where id = $1`, [st.tripId]);
    await c.query(`delete from vehicles where id = $1`, [st.vehicleId]);
    await c.query(`delete from drivers where id = $1 and not exists (select 1 from trips where driver_id = $1)`, [st.driverId]);
    await c.query(`update organizations set settings = settings - 'demo' where id = $1`, [org]);
  });
}

export async function demoStatus(org: string) {
  return withSystem((c) => state(c, org));
}
