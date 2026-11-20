// Porta única de entrada de posições (correção 5): telemóvel (PWA), Traccar e simulador passam todos aqui.
// Valida → corrige relógio → rejeita saltos impossíveis → grava (dedup, viagem ativa, última posição) →
// atualiza progresso, localidades, eventos e alertas.
import { z } from 'zod';
import { HttpError } from './http.js';
import { withSystem, many, one, type Tx } from './db.js';
import { haversine, type LngLat } from '../src/lib/geo/geometry.js';
import { DEFAULT_SETTINGS, initialState, step, type EngineEvent, type EngineSettings, type EngineState, type Snapshot } from '../src/lib/geo/progress.js';
import { loadRouteModel, planAndStoreTripRoute } from './trip-route.js';
import { t as i18n } from '../src/i18n/pt-MZ.js';
import { sendPushForAlerts } from './push.js';
import { matchToRoad } from './matching.js';
import { hit } from './auth.js';

export const PointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  device_time: z.string().datetime({ offset: true }),
  speed_kmh: z.number().min(0).max(300).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
  battery_pct: z.number().int().min(0).max(100).nullable().optional(),
  ignition: z.boolean().nullable().optional(),
}).refine((p) => !(Math.abs(p.lat) < 1e-6 && Math.abs(p.lng) < 1e-6), { message: 'coordenadas_nulas' });
export type InPoint = z.infer<typeof PointSchema>;

export type Source = { orgId: string; vehicleId: string; source: 'device' | 'phone' | 'simulator'; sourceId: string; acceptBefore?: Date | null; deviceId?: string };

const MAX_IMPLIED_KMH = 160;
const MAX_FUTURE_MS = 2 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;

type Clean = { lat: number; lng: number; device_time: string; speed_kmh: number | null; heading: number | null; accuracy_m: number | null;
  battery_pct: number | null; ignition: boolean | null; sent_at: string | null; flags: string[] };

/** Validação e limpeza do lote (função pura, testada). */
export function cleanBatch(points: InPoint[], sentAt: string | null, now: number, prev: { t: number; p: LngLat } | null, acceptBefore?: Date | null) {
  const accepted: Clean[] = [];
  const rejected: { point: InPoint; reason: string }[] = [];
  // Correção de relógio (lacuna L3): o lote traz sent_at; se o relógio do telemóvel estiver desviado > 5 min, corrige.
  const skew = sentAt ? now - new Date(sentAt).getTime() : 0;
  const correct = Math.abs(skew) > CLOCK_SKEW_MS;
  const seen = new Set<number>();
  const sorted = [...points].sort((a, b) => Date.parse(a.device_time) - Date.parse(b.device_time));
  let last = prev;
  for (const p of sorted) {
    let tms = Date.parse(p.device_time);
    const flags: string[] = [];
    if (correct) { tms += skew; flags.push('clock_corrected'); }
    if (tms > now + MAX_FUTURE_MS) { rejected.push({ point: p, reason: 'futuro' }); continue; }
    if (tms < now - 7 * 864e5) { rejected.push({ point: p, reason: 'demasiado_antiga' }); continue; }
    if (acceptBefore && tms >= acceptBefore.getTime()) { rejected.push({ point: p, reason: 'acesso_revogado' }); continue; }
    if (seen.has(tms)) { rejected.push({ point: p, reason: 'duplicada' }); continue; }
    const here: LngLat = [p.lng, p.lat];
    if (last && tms > last.t) {
      const kmh = (haversine(last.p, here) / 1000) / ((tms - last.t) / 3_600_000);
      const tolerant = (p.accuracy_m ?? 0) > 100; // pontos imprecisos ficam marcados, não contam para o salto
      if (kmh > MAX_IMPLIED_KMH && !tolerant) { rejected.push({ point: p, reason: 'salto_impossivel' }); continue; }
    }
    if ((p.accuracy_m ?? 0) > 100) flags.push('low_accuracy');
    if (prev && tms < prev.t) flags.push('late');
    seen.add(tms);
    accepted.push({ lat: p.lat, lng: p.lng, device_time: new Date(tms).toISOString(), speed_kmh: p.speed_kmh ?? null, heading: p.heading ?? null,
      accuracy_m: p.accuracy_m ?? null, battery_pct: p.battery_pct ?? null, ignition: p.ignition ?? null, sent_at: sentAt, flags });
    if (!flags.includes('low_accuracy')) last = { t: tms, p: here };
  }
  return { accepted, rejected };
}

// viagens concluídas automaticamente nesta ingestão (pós-processamento fora da transação)
const autoClosed = new Set<string>();

export async function ingest(src: Source, points: InPoint[], sentAt: string | null) {
  const res = await ingestTx(src, points, sentAt);
  for (const id of [...autoClosed]) { autoClosed.delete(id); const { afterTripClosed } = await import('./routes/trips.js'); await afterTripClosed(id); }
  // Ajuste à estrada com as posições REAIS mais recentes (fora da transação: é um pedido de rede).
  let road: Awaited<ReturnType<typeof updateRoadMatch>> = null;
  if (res.accepted > 0 && src.source !== 'simulator' && (await hit(`match:${src.vehicleId}`, 4, 1))) road = await updateRoadMatch(src.vehicleId);
  return { ...res, road };
}

/** Ajusta a última posição à estrada e guarda estrada + limite (só o que o OSM tem). */
export async function updateRoadMatch(vehicleId: string) {
  const fixes = await withSystem((c) => many<{ lat: number; lng: number; t: number; accuracy_m: number | null }>(c,
    `select ST_Y(geom::geometry) lat, ST_X(geom::geometry) lng, extract(epoch from device_time) * 1000 t, accuracy_m
     from vehicle_positions where vehicle_id = $1 and device_time > now() - interval '10 minutes' and coalesce(accuracy_m, 0) <= 100
     order by device_time desc limit 12`, [vehicleId]));
  if (!fixes.length) return null;
  const ordered = fixes.reverse().map((f) => ({ lat: f.lat, lng: f.lng, t: Number(f.t), accuracyM: f.accuracy_m }));
  const m = await matchToRoad(ordered.length >= 2 ? ordered : [ordered[0]!, { ...ordered[0]!, t: ordered[0]!.t + 1000 }]);
  if (!m) return null;
  // Só aceita o ajuste se o ponto ajustado estiver perto do GPS real (≤ 60 m): nunca "arrasta" o camião para outra estrada.
  const last = ordered[ordered.length - 1]!;
  if (haversine([last.lng, last.lat], [m.lng, m.lat]) > 60) return null;
  await withSystem(async (c) => {
    await c.query(`update vehicle_latest_positions set matched_geom = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
        road_name = $4, speed_limit_kmh = $5, matched_at = to_timestamp($6::float8 / 1000) where vehicle_id = $1`, [vehicleId, m.lng, m.lat, m.roadName, m.speedLimitKmh, last.t]);
    await c.query(`update trip_progress p set road_name = $2, speed_limit_kmh = $3 from vehicle_latest_positions lp
        where lp.vehicle_id = $1 and p.trip_id = lp.trip_id`, [vehicleId, m.roadName, m.speedLimitKmh]);
  });
  return { roadName: m.roadName, speedLimitKmh: m.speedLimitKmh, lat: m.lat, lng: m.lng };
}

async function ingestTx(src: Source, points: InPoint[], sentAt: string | null) {
  return withSystem(async (c) => {
    const first = points.length ? points.reduce((a, b) => (Date.parse(a.device_time) < Date.parse(b.device_time) ? a : b)) : null;
    const prevRow = first ? await one<{ device_time: Date; lng: number; lat: number }>(c, 'select * from last_position_before($1, $2, $3)',
      [src.vehicleId, src.sourceId, first.device_time]) : null;
    const prev = prevRow ? { t: new Date(prevRow.device_time).getTime(), p: [prevRow.lng, prevRow.lat] as LngLat } : null;
    const { accepted, rejected } = cleanBatch(points, sentAt, Date.now(), prev, src.acceptBefore);
    for (const r of rejected) await c.query('select log_ingest_rejection($1, $2, $3, $4)', [src.orgId, src.sourceId, r.reason, JSON.stringify(r.point)]);
    if (!accepted.length) return { accepted: 0, duplicates: 0, rejected: rejected.map((r) => r.reason) };

    const rows = await many<{ id: string; device_time: Date; trip_id: string | null; lng: number; lat: number; speed_kmh: number | null; accuracy_m: number | null }>(c,
      'select * from ingest_positions($1, $2, $3, $4, $5)', [src.orgId, src.vehicleId, src.source, src.sourceId, JSON.stringify(accepted)]);
    if (src.deviceId) await c.query('update gps_devices set last_contact_at = now() where id = $1', [src.deviceId]);

    const byTrip = new Map<string, typeof rows>();
    for (const r of rows) if (r.trip_id) byTrip.set(r.trip_id, [...(byTrip.get(r.trip_id) ?? []), r]);
    const alertIds: string[] = [];
    for (const [tripId, pts] of byTrip) alertIds.push(...(await processTrip(c, tripId, pts)));
    if (alertIds.length) await sendPushForAlerts(c, alertIds).catch((e) => console.warn('[push]', e.message));
    return { accepted: rows.length, duplicates: accepted.length - rows.length, rejected: rejected.map((r) => r.reason) };
  });
}

type Pt = { device_time: Date; lng: number; lat: number; speed_kmh: number | null; accuracy_m: number | null };

/** Atualiza progresso/localidades/eventos/alertas de uma viagem com as posições novas. Devolve alertas abertos. */
export async function processTrip(c: Tx, tripId: string, pts: Pt[]): Promise<string[]> {
  const trip = await one<{ id: string; organization_id: string; status: string; planned_arrival: Date | null; vehicle_id: string; settings: Record<string, number>;
    plate: string }>(c, `select t.id, t.organization_id, t.status, t.planned_arrival, t.vehicle_id, o.settings, v.plate_normalized plate
      from trips t join organizations o on o.id = t.organization_id join vehicles v on v.id = t.vehicle_id where t.id = $1`, [tripId]);
  if (!trip || !['em_viagem', 'pausada'].includes(trip.status)) return [];
  let model = await loadRouteModel(c, tripId);
  if (!model) return [];
  const st = trip.settings ?? {};
  const settings: EngineSettings = {
    ...DEFAULT_SETTINGS,
    corridorM: st.deviation_corridor_m ?? DEFAULT_SETTINGS.corridorM,
    deviationPoints: st.deviation_points ?? DEFAULT_SETTINGS.deviationPoints,
    deviationMinMs: (st.deviation_min_minutes ?? 3) * 60_000,
  };
  const prog = await one<{ engine_state: EngineState & { routeId?: string }; trip_route_id: string }>(c, 'select engine_state, trip_route_id from trip_progress where trip_id = $1', [tripId]);
  let state: EngineState = prog?.engine_state && (prog.engine_state as { routeId?: string }).routeId === model.routeId
    ? prog.engine_state : { ...initialState(), ...(carryOver(prog?.engine_state)) };
  // só posições mais recentes do que as já processadas (as atrasadas da fila ficam no histórico)
  const fresh = pts.filter((p) => state.lastFixT == null || new Date(p.device_time).getTime() > state.lastFixT)
    .sort((a, b) => +a.device_time - +b.device_time);
  if (!fresh.length) return [];

  const alerts: string[] = [];
  let snap: Snapshot | null = null;
  const allEvents: EngineEvent[] = [];
  let lastPoint: Pt | null = null;
  for (const p of fresh) {
    const r = step(model, state, { t: new Date(p.device_time).getTime(), lng: p.lng, lat: p.lat, accuracyM: p.accuracy_m, speedKmh: p.speed_kmh }, settings);
    state = r.state; snap = r.snapshot; allEvents.push(...r.events); lastPoint = p;
    // Desvio confirmado → recalcula a rota a partir da posição atual (base = km já feitos).
    if (r.events.some((e) => e.kind === 'desvio')) {
      const base = model.baseKm + (state.doneM ?? 0) / 1000;
      const planned = await planAndStoreTripRoute(c, tripId, 'deviation', [p.lng, p.lat], base);
      if (planned) {
        await event(c, trip.organization_id, tripId, 'recalculo', { km: Math.round(planned.lengthM / 100) / 10 }, p);
        const nm = await loadRouteModel(c, tripId);
        if (nm) { model = nm; state = { ...initialState(), ...carryOver(state) }; }
      }
    }
  }
  if (!snap || !lastPoint) return [];

  // Eventos relevantes para a linha do tempo e alertas.
  for (const e of allEvents) {
    const at = fresh.find((p) => new Date(p.device_time).getTime() === e.t) ?? lastPoint;
    switch (e.kind) {
      case 'chegou_localidade':
        if (e.importance >= 3) await event(c, trip.organization_id, tripId, 'chegou_localidade', { place: e.name }, at, e.t);
        break;
      case 'passou_localidade':
        await c.query(`update trip_route_places set passed_at = $3, state = 'passada' where trip_route_id = $1 and place_id = $2 and passed_at is null`, [model.routeId, e.placeId, new Date(e.t)]);
        if (e.importance >= 3) await event(c, trip.organization_id, tripId, 'passou_localidade', { place: e.name }, at, e.t);
        break;
      case 'entrou_provincia': await event(c, trip.organization_id, tripId, 'entrou_provincia', { province: e.name }, at, e.t); break;
      case 'paragem_inicio': await event(c, trip.organization_id, tripId, 'paragem_inicio', {}, at, e.t); break;
      case 'paragem_fim': await event(c, trip.organization_id, tripId, 'paragem_fim', { minutes: e.minutes }, at, e.t); break;
      case 'desvio': {
        await event(c, trip.organization_id, tripId, 'desvio', { offset_m: Math.round(e.offsetM) }, at, e.t);
        const a = await openAlert(c, trip.organization_id, 'desvio', `desvio:${tripId}`, `${trip.plate} fora da rota`,
          `A ${Math.round(e.offsetM)} m da rota planeada.`, trip.vehicle_id, tripId);
        if (a) alerts.push(a);
        break;
      }
      case 'regressou_rota':
        await event(c, trip.organization_id, tripId, 'regressou_rota', {}, at, e.t);
        await c.query('select resolve_alert_by_key($1, $2)', [trip.organization_id, `desvio:${tripId}`]);
        break;
      case 'chegou_destino': {
        await event(c, trip.organization_id, tripId, 'chegou_destino', {}, at, e.t);
        const a = await openAlert(c, trip.organization_id, 'chegada', `chegada:${tripId}`, `${trip.plate} chegou ao destino`, null, trip.vehicle_id, tripId);
        if (a) alerts.push(a);
        // Chegou ao destino (a ≤300 m do fim da rota, medido pelo GPS real): a viagem conclui-se sozinha, sem tocar em "Concluir".
        const done = await c.query(`update trips set status = 'concluida', actual_arrival = $2 where id = $1 and status in ('em_viagem','pausada')`, [tripId, new Date(e.t)]);
        if (done.rowCount) {
          await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload, occurred_at)
            values ($1, $2, 'chegada', 'system', null, '{"automatica": true}', $3)`, [trip.organization_id, tripId, new Date(e.t)]);
          await c.query(`insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after)
            values ($1, 'system', null, 'viagem.estado', 'trips', $2, '{"status":"concluida","automatica":true}')`, [trip.organization_id, tripId]);
          autoClosed.add(tripId);
        }
        break;
      }
      case 'voltou_para_tras': await event(c, trip.organization_id, tripId, 'voltou_para_tras', {}, at, e.t); break;
      default: break;
    }
  }

  // Paragem anormal: parado há mais de N min, longe de localidades conhecidas da rota (±2 km).
  const abnormalMin = st.abnormal_stop_minutes ?? 30;
  if (snap.stoppedMs >= abnormalMin * 60_000 && state.doneM != null && trip.status === 'em_viagem') {
    const near = model.places.some((pl) => Math.abs(pl.kmFromOrigin * 1000 - state.doneM!) < 2000);
    if (!near) {
      const a = await openAlert(c, trip.organization_id, 'paragem_anormal', `paragem:${tripId}:${state.stopSince}`, `${trip.plate} parado há ${Math.round(snap.stoppedMs / 60000)} min`,
        i18n.label(snap.label), trip.vehicle_id, tripId);
      if (a) alerts.push(a);
    }
  }

  // Atraso (indicador calculado, não é estado): só com ETA de confiança alta/média.
  const tol = (st.late_tolerance_min ?? 30) * 60_000;
  if (trip.planned_arrival && snap.etaDestination && (snap.etaConfidence === 'alta' || snap.etaConfidence === 'media')) {
    if (snap.etaDestination > new Date(trip.planned_arrival).getTime() + tol) {
      const a = await openAlert(c, trip.organization_id, 'atraso', `atraso:${tripId}`, `Viagem com atraso (${trip.plate})`,
        `Chegada prevista ${fmtTime(snap.etaDestination)} (planeado ${fmtTime(new Date(trip.planned_arrival).getTime())}).`, trip.vehicle_id, tripId);
      if (a) alerts.push(a);
    } else await c.query('select resolve_alert_by_key($1, $2)', [trip.organization_id, `atraso:${tripId}`]);
  }

  // Estado das localidades e ETA por localidade.
  for (const ps of snap.places) {
    await c.query(`update trip_route_places set state = $3, eta = $4, eta_confidence = $5, passed_at = coalesce(passed_at, $6)
      where trip_route_id = $1 and place_id = $2`,
      [model.routeId, ps.placeId, ps.state, ps.eta ? new Date(ps.eta) : null, ps.eta ? snap.etaConfidence : null, ps.passedAt ? new Date(ps.passedAt) : null]);
  }
  const totalKm = model.baseKm + model.lengthM / 1000;
  const kmDone = snap.kmDone == null ? null : model.baseKm + snap.kmDone;
  await c.query(`insert into trip_progress (trip_id, organization_id, trip_route_id, km_done, km_left, pct, current_label, current_place_id, next_place_id,
       province_id, eta_destination, eta_confidence, speed_kmh_smoothed, last_position_at, engine_state)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (trip_id) do update set trip_route_id = excluded.trip_route_id, km_done = excluded.km_done, km_left = excluded.km_left, pct = excluded.pct,
       current_label = excluded.current_label, current_place_id = excluded.current_place_id, next_place_id = excluded.next_place_id,
       province_id = excluded.province_id, eta_destination = excluded.eta_destination, eta_confidence = excluded.eta_confidence,
       speed_kmh_smoothed = excluded.speed_kmh_smoothed, last_position_at = excluded.last_position_at, engine_state = excluded.engine_state`,
    [tripId, trip.organization_id, model.routeId, kmDone, snap.kmLeft, kmDone == null ? null : Math.min(100, (kmDone / totalKm) * 100),
     snap.label ? i18n.label(snap.label) : null, snap.currentPlaceId, snap.nextPlace?.placeId ?? null,
     isUuid(snap.provinceId) ? snap.provinceId : null, snap.etaDestination ? new Date(snap.etaDestination) : null, snap.etaConfidence,
     snap.speedKmh, new Date(lastPoint.device_time), JSON.stringify({ ...state, routeId: model.routeId })]);
  return alerts;
}

const isUuid = (s: string | null) => !!s && /^[0-9a-f-]{36}$/i.test(s);
const carryOver = (s?: Partial<EngineState> | null): Partial<EngineState> =>
  s ? { speedEmaMs: s.speedEmaMs ?? null, movingDataMs: s.movingDataMs ?? 0, passed: s.passed ?? {}, entered: s.entered ?? {}, provinceId: s.provinceId ?? null, lastFixT: s.lastFixT ?? null } : {};
const fmtTime = (ms: number) => new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Maputo' }).format(ms);

async function event(c: Tx, org: string, trip: string, kind: string, payload: unknown, at: { lng: number; lat: number }, t?: number) {
  await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, payload, position, occurred_at)
    values ($1,$2,$3,'system',$4, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, coalesce($7, now()))`,
    [org, trip, kind, JSON.stringify(payload), at.lng, at.lat, t ? new Date(t) : null]);
}
async function openAlert(c: Tx, org: string, kind: string, key: string, title: string, detail: string | null, vehicle: string | null, trip: string | null) {
  const r = await one<{ id: string | null }>(c, 'select open_alert($1,$2,$3,$4,$5,$6,$7) as id', [org, kind, key, title, detail, vehicle, trip]);
  return r?.id ?? null;
}

/** Resolve a fonte a partir da autenticação e do corpo. */
export async function sourceForDriver(driverId: string, orgId: string, revokedAt: Date | null): Promise<Source> {
  return withSystem(async (c) => {
    const t = await one<{ vehicle_id: string }>(c, `select vehicle_id from trips where driver_id = $1 and organization_id = $2
      and status in ('em_viagem','pausada') and deleted_at is null and vehicle_id is not null limit 1`, [driverId, orgId]);
    // Privacidade (L2): o telemóvel só é aceite durante uma viagem ativa atribuída ao motorista.
    if (!t) throw new HttpError(409, 'sem_viagem_ativa');
    return { orgId, vehicleId: t.vehicle_id, source: 'phone', sourceId: `driver:${driverId}`, acceptBefore: revokedAt };
  });
}

export async function sourceForDevice(orgId: string, imei: string, at: string): Promise<Source> {
  return withSystem(async (c) => {
    const d = await one<{ id: string; vehicle_id: string | null }>(c, `select g.id, da.vehicle_id from gps_devices g
      left join device_assignments da on da.device_id = g.id and da.valid_from <= $3 and (da.valid_to is null or da.valid_to > $3)
      where g.imei = $1 and g.organization_id = $2 and g.deleted_at is null and g.status = 'ativo'`, [imei, orgId, at]);
    if (!d) throw new HttpError(404, 'dispositivo_desconhecido');
    if (!d.vehicle_id) throw new HttpError(409, 'dispositivo_sem_camiao');
    return { orgId, vehicleId: d.vehicle_id, source: 'device', sourceId: `device:${d.id}`, deviceId: d.id };
  });
}
