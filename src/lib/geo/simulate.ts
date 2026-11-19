// Gerador determinístico de posições ao longo de uma rota (usado pelo simulador GPS e pelos testes).
// Reproduz: velocidade variável, paragens, perda de sinal, ruído de precisão, pontos muito imprecisos e desvios.

import { type LngLat, cumulative, pointAt, bearing } from './geometry';

export type SimSegment =
  | { type: 'drive'; untilKm: number; speedKmh: number }
  | { type: 'stop'; minutes: number }
  | { type: 'signal_loss'; untilKm: number; speedKmh: number }
  | { type: 'detour'; untilKm: number; speedKmh: number; offsetM: number };

export type SimOptions = {
  intervalS: number;
  noiseM: number; // desvio-padrão do ruído GPS
  badFixEvery?: number; // a cada N posições, uma com precisão muito má (ex.: 800 m)
  seed: number;
  startT: number;
};

export type SimFix = { t: number; lng: number; lat: number; speedKmh: number; heading: number; accuracyM: number };

/** RNG determinístico (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function offsetPoint(p: LngLat, dxM: number, dyM: number): LngLat {
  const dLat = dyM / 111_320;
  const dLng = dxM / (111_320 * Math.cos((p[1] * Math.PI) / 180));
  return [p[0] + dLng, p[1] + dLat];
}

export function simulate(coords: LngLat[], plan: SimSegment[], o: SimOptions): SimFix[] {
  const cum = cumulative(coords);
  const total = cum[cum.length - 1]!;
  const r = rng(o.seed);
  const out: SimFix[] = [];
  let m = 0, t = o.startT, n = 0;
  const emit = (pos: LngLat, speed: number, acc: number, along: number) => {
    n++;
    const bad = o.badFixEvery && n % o.badFixEvery === 0;
    const accuracy = bad ? 800 : acc;
    const noise = bad ? 600 : o.noiseM;
    const q = offsetPoint(pos, gauss(r) * noise, gauss(r) * noise);
    const ahead = pointAt(coords, cum, Math.min(total, along + 50));
    out.push({ t, lng: q[0], lat: q[1], speedKmh: Math.max(0, speed + gauss(r) * 2), heading: bearing(pos, ahead), accuracyM: accuracy });
  };
  for (const seg of plan) {
    if (seg.type === 'stop') {
      const end = t + seg.minutes * 60_000;
      while (t < end) { emit(pointAt(coords, cum, m), 0, 15, m); t += o.intervalS * 1000; }
      continue;
    }
    const target = Math.min(seg.untilKm * 1000, total);
    const v = seg.speedKmh / 3.6;
    while (m < target) {
      m = Math.min(target, m + v * o.intervalS);
      t += o.intervalS * 1000;
      if (seg.type === 'signal_loss') continue; // sem posições neste troço
      let pos = pointAt(coords, cum, m);
      if (seg.type === 'detour') pos = offsetPoint(pos, seg.offsetM, 0);
      emit(pos, seg.speedKmh, 12 + r() * 10, m);
    }
  }
  return out;
}
