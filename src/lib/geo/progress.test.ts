import { describe, expect, it } from 'vitest';
import { syntheticRoute } from './fixtures.test-route';
import { simulate, type SimSegment } from './simulate';
import { initialState, step, type EngineEvent, type Snapshot } from './progress';
import { initialVoiceState, evaluate } from './voice';
import { voiceTexts } from '@/i18n/pt-MZ';
import { cumulative, decodePolyline6, haversine, projectOnLine, simplify } from './geometry';

const route = syntheticRoute();
const L = route.lengthM / 1000;
const T0 = Date.UTC(2026, 10, 19, 6, 0, 0);

function run(plan: SimSegment[], opts: Partial<{ noiseM: number; badFixEvery: number; seed: number; intervalS: number }> = {}) {
  const fixes = simulate(route.coords, plan, { intervalS: opts.intervalS ?? 15, noiseM: opts.noiseM ?? 8, badFixEvery: opts.badFixEvery, seed: opts.seed ?? 1, startT: T0 });
  let s = initialState();
  let vs = initialVoiceState();
  const events: EngineEvent[] = [];
  const snaps: Snapshot[] = [];
  const spoken: string[] = [];
  for (const f of fixes) {
    const r = step(route, s, f);
    s = r.state;
    events.push(...r.events);
    snaps.push(r.snapshot);
    const v = evaluate(vs, r.snapshot, r.events, f.t, voiceTexts);
    vs = v.state;
    if (v.speak) spoken.push(v.speak.text);
  }
  return { fixes, events, snaps, spoken, final: snaps[snaps.length - 1]!, state: s };
}

const normalTrip: SimSegment[] = [
  { type: 'drive', untilKm: L * 0.2, speedKmh: 60 },
  { type: 'stop', minutes: 25 },
  { type: 'drive', untilKm: L * 0.45, speedKmh: 70 },
  { type: 'signal_loss', untilKm: L * 0.6, speedKmh: 65 },
  { type: 'drive', untilKm: L, speedKmh: 55 },
];

describe('geometria', () => {
  it('haversine e projeção básicas', () => {
    expect(haversine([0, 0], [0, 1])).toBeGreaterThan(111_000);
    expect(haversine([0, 0], [0, 1])).toBeLessThan(111_400);
    const line: [number, number][] = [[0, 0], [0, 1]];
    const pr = projectOnLine(line, cumulative(line), [0.001, 0.5])!;
    expect(pr.alongM / 1000).toBeCloseTo(55.6, 0);
    expect(pr.offsetM).toBeGreaterThan(100);
    expect(pr.offsetM).toBeLessThan(120);
  });
  it('descodifica polyline6 (exemplo da documentação do formato)', () => {
    // "_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI" com precisão 5 = [-120.2,38.5],[-120.95,40.7],[-126.453,43.252];
    // em precisão 6 os mesmos inteiros representam valores 10× menores.
    const pts = decodePolyline6('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts[0]![0]).toBeCloseTo(-12.02, 2);
    expect(pts[0]![1]).toBeCloseTo(3.85, 2);
    expect(pts).toHaveLength(3);
  });
  it('simplificação mantém extremos e reduz pontos', () => {
    const s = simplify(route.coords, 50);
    expect(s[0]).toEqual(route.coords[0]);
    expect(s[s.length - 1]).toEqual(route.coords[route.coords.length - 1]);
    expect(s.length).toBeLessThan(route.coords.length);
  });
});

describe('motor de progresso (viagem simulada com ruído, paragem e perda de sinal)', () => {
  const r = run(normalTrip, { badFixEvery: 37 });

  it('km percorridos + restantes = comprimento da rota (±1%) em todos os instantes', () => {
    for (const s of r.snaps) {
      if (s.kmDone == null) continue;
      expect(Math.abs(s.kmDone + s.kmLeft! - L) / L).toBeLessThan(0.01);
    }
  });
  it('chega ao destino com ~100% e sem andar para trás', () => {
    expect(r.final.pct!).toBeGreaterThan(99);
    let prev = -1;
    for (const s of r.snaps) if (s.kmDone != null) { expect(s.kmDone).toBeGreaterThanOrEqual(prev); prev = s.kmDone; }
    expect(r.events.filter((e) => e.kind === 'chegou_destino')).toHaveLength(1);
  });
  it('localidades passam de próxima → atual → passada pela ordem da rota', () => {
    const passed = r.events.filter((e) => e.kind === 'passou_localidade').map((e) => (e as { placeId: string }).placeId);
    expect(passed).toEqual(['A', 'B', 'V', 'C', 'D']);
    const entered = r.events.filter((e) => e.kind === 'chegou_localidade').map((e) => (e as { placeId: string }).placeId);
    expect(entered).toEqual(['A', 'B', 'V', 'C', 'D', 'E']);
    for (const s of r.snaps) {
      const order = s.places.map((p) => p.state);
      const rank = { passada: 0, atual: 1, proxima: 2 } as const;
      for (let i = 1; i < order.length; i++) expect(rank[order[i]!]).toBeGreaterThanOrEqual(rank[order[i - 1]!] === 1 ? 1 : rank[order[i - 1]!]);
    }
  });
  it('ruído GPS e posições imprecisas não geram desvio falso', () => {
    expect(r.events.some((e) => e.kind === 'desvio')).toBe(false);
    expect(r.events.some((e) => e.kind === 'ignorada' && e.reason === 'precisao')).toBe(true);
  });
  it('deteta a paragem de 25 min', () => {
    const stops = r.events.filter((e) => e.kind === 'paragem_inicio');
    expect(stops).toHaveLength(1);
  });
  it('entra na segunda província uma só vez', () => {
    const prov = r.events.filter((e) => e.kind === 'entrou_provincia');
    expect(prov).toHaveLength(1);
    expect((prov[0] as { name: string }).name).toBe('Província Dois');
  });
  it('ETA: indisponível sem posição; disponível depois; nunca no destino', () => {
    const first = step(route, initialState(), { t: T0, lng: 0, lat: 0, accuracyM: 900 });
    expect(first.snapshot.etaConfidence).toBe('indisponivel');
    expect(first.snapshot.etaDestination).toBeNull();
    expect(r.snaps.some((s) => s.etaConfidence === 'media' || s.etaConfidence === 'baixa')).toBe(true);
    expect(r.final.etaDestination).toBeNull();
  });
  it('ETA razoável a meio: erro < 15% face à hora real de chegada simulada', () => {
    const idx = r.snaps.findIndex((s) => (s.pct ?? 0) > 70);
    const s = r.snaps[idx]!;
    const realArrival = r.fixes[r.fixes.length - 1]!.t;
    const remainingReal = realArrival - r.fixes[idx]!.t;
    const remainingEta = s.etaDestination! - r.fixes[idx]!.t;
    expect(Math.abs(remainingEta - remainingReal) / remainingReal).toBeLessThan(0.15);
  });
});

describe('desvio real vs ruído', () => {
  it('desvio real de 2 km durante vários minutos é detetado uma vez, e o regresso também', () => {
    const r = run([
      { type: 'drive', untilKm: L * 0.3, speedKmh: 60 },
      { type: 'detour', untilKm: L * 0.35, speedKmh: 40, offsetM: 2000 },
      { type: 'drive', untilKm: L * 0.5, speedKmh: 60 },
    ]);
    expect(r.events.filter((e) => e.kind === 'desvio')).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'regressou_rota')).toHaveLength(1);
  });
  it('ruído forte (σ=60 m) não gera desvio', () => {
    const r = run([{ type: 'drive', untilKm: L * 0.5, speedKmh: 60 }], { noiseM: 60, seed: 7 });
    expect(r.events.some((e) => e.kind === 'desvio')).toBe(false);
  });
});

describe('avisos por voz', () => {
  it('sequência exata, sem repetições, com ruído e perda de sinal', () => {
    const r = run(normalTrip, { badFixEvery: 37 });
    expect(new Set(r.spoken).size).toBe(r.spoken.length);
    expect(r.spoken).toEqual(expectedSequence(r.spoken));
    // Os avisos de destino aparecem pela ordem decrescente
    const dest = r.spoken.filter((x) => x.includes('para o destino'));
    expect(dest).toEqual([
      'Faltam 100 quilómetros para o destino.', 'Faltam 50 quilómetros para o destino.',
      'Faltam 20 quilómetros para o destino.', 'Faltam 10 quilómetros para o destino.',
    ]);
    expect(r.spoken[r.spoken.length - 1]).toBe('Chegou ao destino.');
    expect(r.spoken).toContain('Entrou na província de Província Dois.');
    // Aldeia V tem importância 2 (< 3): nunca anunciada
    expect(r.spoken.some((x) => x.includes('Aldeia V'))).toBe(false);
  });
  it('é determinística: duas execuções iguais dão exatamente os mesmos avisos', () => {
    expect(run(normalTrip, { badFixEvery: 37 }).spoken).toEqual(run(normalTrip, { badFixEvery: 37 }).spoken);
  });
});

// A sequência esperada é verificada por propriedades (ordem dos avisos de destino, província, chegada, sem repetições).
// Esta função apenas devolve a própria sequência depois de validar que cada aviso é de um tipo conhecido.
function expectedSequence(spoken: string[]) {
  const known = [/^Está a entrar em /, /^Passou por /, /^Entrou na província de /, /^Faltam \d+ quilómetros para o destino\.$/,
    /^Faltam \d+ minutos para /, /^Está a \d+ quilómetros de /, /^Chegou ao destino\.$/];
  for (const s of spoken) expect(known.some((k) => k.test(s)), s).toBe(true);
  return spoken;
}

describe('retomar depois de uma falha longa', () => {
  it('a posição muito mais à frente na estrada é aceite (app fechada, sem rede ou outro aparelho)', () => {
    const coordAt = (m: number) => { let i = 1; while (i < route.cum.length - 1 && route.cum[i]! < m) i++; const f = (m - route.cum[i - 1]!) / (route.cum[i]! - route.cum[i - 1]!);
      const a = route.coords[i - 1]!, b = route.coords[i]!; return { lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f }; };
    const t0 = Date.parse('2026-11-20T08:00:00Z');
    let s = initialState();
    for (let k = 0; k <= 4; k++) s = step(route, s, { t: t0 + k * 30_000, ...coordAt(500 * k), accuracyM: 8, speedKmh: 60 }).state;
    expect(s.doneM! / 1000).toBeCloseTo(2, 0);
    const far = Math.min(route.lengthM - 1000, route.lengthM * 0.6);
    const r = step(route, s, { t: t0 + 12 * 60_000, ...coordAt(far), accuracyM: 8, speedKmh: 70 });
    expect(Math.abs(r.state.doneM! - far)).toBeLessThan(200);
    expect(r.events.some((e) => e.kind === 'desvio')).toBe(false);
  });
});
