// Motor de progresso ao vivo (ADR-004). Função pura e determinística:
//   novo estado + instantâneo + acontecimentos = step(modelo da rota, estado anterior, posição)
// Usado no servidor (ingestão) e no telemóvel do motorista (offline). Nunca inventa valores:
// sem rota ou sem posições válidas, os campos ficam null e a confiança "indisponivel".

import { type LngLat, haversine, projectOnLine } from './geometry';

export type RoutePlace = {
  placeId: string;
  name: string;
  kind: string;
  importance: number;
  provinceId?: string | null;
  provinceName?: string | null;
  kmFromOrigin: number;
};

export type RouteModel = {
  coords: LngLat[];
  cum: number[];
  lengthM: number;
  plannedDurationS: number; // duração do motor de rotas (perfil camião)
  places: RoutePlace[]; // ordenadas por kmFromOrigin
  segmentSpeedsKmh?: (number | null)[]; // velocidade típica por troço de 10 km (histórico); opcional
};

export type Fix = { t: number; lng: number; lat: number; accuracyM?: number | null; speedKmh?: number | null };

export type EtaConfidence = 'alta' | 'media' | 'baixa' | 'indisponivel';
export type PlaceState = 'proxima' | 'atual' | 'passada';

export type EngineSettings = {
  maxAccuracyM: number; // posições piores não entram no progresso
  corridorM: number; // corredor para desvio
  deviationPoints: number; // N posições consecutivas fora do corredor
  deviationMinMs: number; // durante pelo menos Z
  backtrackM: number; // recuo tolerado antes de considerar "voltou para trás"
  stopSpeedKmh: number;
  stopRadiusM: number;
  heavyFactor: number; // fator sobre a velocidade do motor de rotas (⚠️ a calibrar com viagens reais)
};

export const DEFAULT_SETTINGS: EngineSettings = {
  maxAccuracyM: 100,
  corridorM: 500,
  deviationPoints: 3,
  deviationMinMs: 3 * 60_000,
  backtrackM: 500,
  stopSpeedKmh: 3,
  stopRadiusM: 150,
  heavyFactor: 0.85,
};

export type EngineState = {
  doneM: number | null;
  lastFixT: number | null;
  lastAlongM: number | null;
  lastAlongT: number | null;
  speedEmaMs: number | null; // velocidade ao longo da rota (m/s), média exponencial
  movingDataMs: number; // tempo acumulado de dados de velocidade (para a confiança)
  backtrackCount: number;
  offCount: number;
  offSince: number | null;
  offRoute: boolean;
  stopAnchor: LngLat | null;
  stopSince: number | null;
  stopAnnounced: boolean;
  passed: Record<string, number>; // placeId → hora da passagem (ms)
  entered: Record<string, number>; // placeId → hora de entrada
  provinceId: string | null;
  arrived: boolean;
};

export const initialState = (): EngineState => ({
  doneM: null, lastFixT: null, lastAlongM: null, lastAlongT: null, speedEmaMs: null, movingDataMs: 0,
  backtrackCount: 0, offCount: 0, offSince: null, offRoute: false, stopAnchor: null, stopSince: null,
  stopAnnounced: false, passed: {}, entered: {}, provinceId: null, arrived: false,
});

export type PlaceSnapshot = { placeId: string; name: string; kmFromOrigin: number; importance: number; state: PlaceState; passedAt: number | null; eta: number | null };

export type Label =
  | { type: 'em'; place: string }
  | { type: 'perto'; place: string; km: number }
  | { type: 'entre'; from: string; to: string }
  | { type: 'apos'; place: string }
  | { type: 'origem' }
  | { type: 'destino' };

export type Snapshot = {
  kmDone: number | null;
  kmLeft: number | null;
  pct: number | null;
  label: Label | null;
  currentPlaceId: string | null;
  nextPlace: { placeId: string; name: string; km: number; eta: number | null } | null;
  provinceId: string | null;
  provinceName: string | null;
  etaDestination: number | null;
  etaConfidence: EtaConfidence;
  speedKmh: number | null;
  offRoute: boolean;
  offsetM: number | null;
  stoppedMs: number;
  places: PlaceSnapshot[];
};

export type EngineEvent =
  | { kind: 'chegou_localidade' | 'passou_localidade'; t: number; placeId: string; name: string; importance: number }
  | { kind: 'entrou_provincia'; t: number; provinceId: string; name: string }
  | { kind: 'desvio' | 'regressou_rota' | 'voltou_para_tras'; t: number; offsetM: number }
  | { kind: 'paragem_inicio' | 'paragem_fim'; t: number; minutes: number }
  | { kind: 'chegou_destino'; t: number }
  | { kind: 'ignorada'; t: number; reason: 'precisao' | 'fora_corredor' | 'recuo' };

export const placeRadiusM = (kind: string): number =>
  kind === 'city' ? 3000 : kind === 'town' ? 1500 : kind === 'village' || kind === 'locality' ? 1000 : 300;

/** Velocidade estimada (m/s) e confiança, sem nunca inventar (ADR-004). */
function estimateSpeed(route: RouteModel, s: EngineState, settings: EngineSettings): { v: number | null; conf: EtaConfidence } {
  if (s.doneM === null) return { v: null, conf: 'indisponivel' };
  const vRoute = route.plannedDurationS > 0 ? (route.lengthM / route.plannedDurationS) * settings.heavyFactor : null;
  const seg = route.segmentSpeedsKmh?.[Math.floor(s.doneM / 10_000)] ?? null;
  const vTyp = seg ? seg / 3.6 : vRoute;
  const dataMin = s.movingDataMs / 60_000;
  const vRecent = s.speedEmaMs;
  if (vTyp == null && vRecent == null) return { v: null, conf: 'indisponivel' };
  const alpha = dataMin >= 20 ? 0.6 : 0.3;
  const v = vRecent != null && vTyp != null ? alpha * vRecent + (1 - alpha) * vTyp : (vRecent ?? vTyp)!;
  if (!(v > 0.5)) return { v: null, conf: 'indisponivel' };
  const conf: EtaConfidence = dataMin >= 20 && seg != null ? 'alta' : dataMin >= 10 ? 'media' : 'baixa';
  return { v, conf };
}

export function step(route: RouteModel, prev: EngineState, fix: Fix, settings: EngineSettings = DEFAULT_SETTINGS) {
  const s: EngineState = { ...prev, passed: { ...prev.passed }, entered: { ...prev.entered } };
  const events: EngineEvent[] = [];
  let offsetM: number | null = null;
  const p: LngLat = [fix.lng, fix.lat];

  // Paragem (independente da qualidade da projeção).
  const spd = fix.speedKmh ?? null;
  // Uma paragem começa com velocidade ≈ 0 e só termina quando o camião sai do raio (picos de velocidade do GPS parado não contam).
  const goodFix = fix.accuracyM == null || fix.accuracyM <= settings.maxAccuracyM;
  const stopped = !goodFix ? s.stopAnchor != null : s.stopAnchor != null
    ? haversine(s.stopAnchor, p) <= settings.stopRadiusM
    : spd != null && spd < settings.stopSpeedKmh;
  if (!goodFix) {
    // posição imprecisa: não inicia nem termina paragens
  } else if (stopped) {
    if (s.stopAnchor == null) { s.stopAnchor = p; s.stopSince = fix.t; }
    if (!s.stopAnnounced && s.stopSince != null && fix.t - s.stopSince >= 5 * 60_000) {
      s.stopAnnounced = true;
      events.push({ kind: 'paragem_inicio', t: s.stopSince, minutes: Math.round((fix.t - s.stopSince) / 60_000) });
    }
  } else {
    if (s.stopAnnounced && s.stopSince != null) events.push({ kind: 'paragem_fim', t: fix.t, minutes: Math.round((fix.t - s.stopSince) / 60_000) });
    s.stopAnchor = null; s.stopSince = null; s.stopAnnounced = false;
  }

  if (fix.accuracyM != null && fix.accuracyM > settings.maxAccuracyM) {
    events.push({ kind: 'ignorada', t: fix.t, reason: 'precisao' });
  } else {
    const dt = s.lastFixT != null ? Math.max(0, fix.t - s.lastFixT) : 0;
    const fwd = Math.max(30_000, (140 / 3.6) * (dt / 1000) * 1.2);
    const proj = s.doneM == null
      ? projectOnLine(route.coords, route.cum, p)
      : projectOnLine(route.coords, route.cum, p, s.doneM - 2_000, s.doneM + fwd) ?? projectOnLine(route.coords, route.cum, p);
    if (proj) {
      offsetM = proj.offsetM;
      if (proj.offsetM > settings.corridorM) {
        s.offCount += 1;
        if (s.offSince == null) s.offSince = fix.t;
        if (!s.offRoute && s.offCount >= settings.deviationPoints && fix.t - s.offSince >= settings.deviationMinMs) {
          s.offRoute = true;
          events.push({ kind: 'desvio', t: fix.t, offsetM: proj.offsetM });
        }
        events.push({ kind: 'ignorada', t: fix.t, reason: 'fora_corredor' });
      } else {
        if (s.offRoute) events.push({ kind: 'regressou_rota', t: fix.t, offsetM: proj.offsetM });
        s.offRoute = false; s.offCount = 0; s.offSince = null;
        let accept = true;
        if (s.doneM != null && proj.alongM < s.doneM - settings.backtrackM) {
          s.backtrackCount += 1;
          if (s.backtrackCount >= 3) { events.push({ kind: 'voltou_para_tras', t: fix.t, offsetM: proj.offsetM }); s.doneM = proj.alongM; s.backtrackCount = 0; }
          else { events.push({ kind: 'ignorada', t: fix.t, reason: 'recuo' }); }
          accept = false;
        } else s.backtrackCount = 0;
        if (accept) {
          const along = Math.max(proj.alongM, s.doneM ?? 0); // monotonia: nunca anda para trás por ruído
          if (s.lastAlongM != null && s.lastAlongT != null) {
            const dtA = (fix.t - s.lastAlongT) / 1000;
            const v = (along - s.lastAlongM) / Math.max(dtA, 1);
            // Só conta tempo em movimento (paragens > 5 min não entram, ADR-004) e rejeita saltos absurdos.
            if (dtA > 0 && dtA <= 20 * 60 && v >= 0 && v < 45 && (v > 1 || dtA < 300)) {
              const a = 1 - Math.exp(-dtA / 600);
              s.speedEmaMs = s.speedEmaMs == null ? v : s.speedEmaMs + a * (v - s.speedEmaMs);
              if (v > 1) s.movingDataMs += dtA * 1000;
            }
          }
          s.doneM = along; s.lastAlongM = along; s.lastAlongT = fix.t;
        }
      }
    }
  }
  s.lastFixT = fix.t;

  // Localidades: passada / atual / próxima (com hora real da passagem).
  const places: PlaceSnapshot[] = [];
  if (s.doneM != null) {
    for (const pl of route.places) {
      const atM = pl.kmFromOrigin * 1000;
      const r = placeRadiusM(pl.kind);
      let state: PlaceState = 'proxima';
      if (s.passed[pl.placeId] != null || s.doneM >= atM + r) state = 'passada';
      else if (Math.abs(s.doneM - atM) <= r) state = 'atual';
      if (state !== 'proxima' && s.entered[pl.placeId] == null) {
        s.entered[pl.placeId] = fix.t;
        events.push({ kind: 'chegou_localidade', t: fix.t, placeId: pl.placeId, name: pl.name, importance: pl.importance });
      }
      if (state === 'passada' && s.passed[pl.placeId] == null) {
        s.passed[pl.placeId] = fix.t;
        events.push({ kind: 'passou_localidade', t: fix.t, placeId: pl.placeId, name: pl.name, importance: pl.importance });
      }
      places.push({ placeId: pl.placeId, name: pl.name, kmFromOrigin: pl.kmFromOrigin, importance: pl.importance, state, passedAt: s.passed[pl.placeId] ?? null, eta: null });
    }
    // Província atual = a da localidade mais avançada já alcançada (funciona offline, sem polígonos).
    const reached = [...route.places].reverse().find((pl) => s.entered[pl.placeId] != null && pl.provinceId);
    if (reached && reached.provinceId !== s.provinceId) {
      if (s.provinceId != null) events.push({ kind: 'entrou_provincia', t: fix.t, provinceId: reached.provinceId!, name: reached.provinceName ?? '' });
      s.provinceId = reached.provinceId!;
    }
    if (!s.arrived && s.doneM >= route.lengthM - 300) { s.arrived = true; events.push({ kind: 'chegou_destino', t: fix.t }); }
  } else {
    for (const pl of route.places) places.push({ placeId: pl.placeId, name: pl.name, kmFromOrigin: pl.kmFromOrigin, importance: pl.importance, state: 'proxima', passedAt: null, eta: null });
  }

  // ETA (destino e por localidade).
  const { v, conf } = estimateSpeed(route, s, settings);
  let etaDestination: number | null = null;
  if (s.doneM != null && v != null) {
    etaDestination = fix.t + ((route.lengthM - s.doneM) / v) * 1000;
    for (const ps of places) if (ps.state === 'proxima') ps.eta = fix.t + ((ps.kmFromOrigin * 1000 - s.doneM) / v) * 1000;
  }

  const snapshot = buildSnapshot(route, s, places, etaDestination, v == null ? 'indisponivel' : conf, offsetM, fix.t);
  return { state: s, snapshot, events };
}

function buildSnapshot(route: RouteModel, s: EngineState, places: PlaceSnapshot[], eta: number | null, conf: EtaConfidence,
  offsetM: number | null, t: number): Snapshot {
  const done = s.doneM;
  const cur = places.find((p) => p.state === 'atual') ?? null;
  const next = places.find((p) => p.state === 'proxima') ?? null;
  const prev = [...places].reverse().find((p) => p.state === 'passada') ?? null;
  let label: Label | null = null;
  if (done != null) {
    if (s.arrived) label = { type: 'destino' };
    else if (cur) label = { type: 'em', place: cur.name };
    else if (next && next.kmFromOrigin * 1000 - done <= 15_000) label = { type: 'perto', place: next.name, km: Math.max(1, Math.round((next.kmFromOrigin * 1000 - done) / 1000)) };
    else if (prev && next) label = { type: 'entre', from: prev.name, to: next.name };
    else if (prev) label = { type: 'apos', place: prev.name };
    else label = { type: 'origem' };
  }
  const provincePlace = route.places.find((p) => p.provinceId === s.provinceId);
  return {
    kmDone: done == null ? null : done / 1000,
    kmLeft: done == null ? null : Math.max(0, route.lengthM - done) / 1000,
    pct: done == null ? null : Math.min(100, (done / route.lengthM) * 100),
    label,
    currentPlaceId: cur?.placeId ?? null,
    nextPlace: next ? { placeId: next.placeId, name: next.name, km: next.kmFromOrigin, eta: next.eta } : null,
    provinceId: s.provinceId,
    provinceName: provincePlace?.provinceName ?? null,
    etaDestination: s.arrived ? null : eta,
    etaConfidence: s.arrived ? 'indisponivel' : conf,
    speedKmh: s.speedEmaMs == null ? null : s.speedEmaMs * 3.6,
    offRoute: s.offRoute,
    offsetM,
    stoppedMs: s.stopSince != null ? t - s.stopSince : 0,
    places,
  };
}
