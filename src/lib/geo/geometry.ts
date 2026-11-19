// Geometria pura (sem DOM nem APIs do Node) — partilhada pela API (Vercel) e pela PWA do motorista (offline).
// Coordenadas sempre [lng, lat] em graus WGS84. Distâncias em metros.

export type LngLat = [number, number];

const R = 6371008.8; // raio médio da Terra (m)
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Distâncias acumuladas ao longo de uma linha (m). cum[0] = 0. */
export function cumulative(coords: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + haversine(coords[i - 1]!, coords[i]!));
  return cum;
}

export type Projection = { alongM: number; offsetM: number; segIdx: number; point: LngLat };

/**
 * Projeta um ponto numa linha com medidas acumuladas.
 * Se `fromM`/`toM` forem dados, só procura nos segmentos que intersectam essa janela (evita saltar para
 * um troço paralelo ou para a estrada de regresso — ADR-004).
 */
export function projectOnLine(coords: LngLat[], cum: number[], p: LngLat, fromM = -Infinity, toM = Infinity): Projection | null {
  let best: Projection | null = null;
  const cosLat = Math.cos(toRad(p[1]));
  for (let i = 0; i < coords.length - 1; i++) {
    const s0 = cum[i]!;
    const s1 = cum[i + 1]!;
    if (s1 < fromM || s0 > toM) continue;
    const a = coords[i]!;
    const b = coords[i + 1]!;
    // projeção equirretangular local (precisão suficiente para segmentos de estrada < alguns km)
    const ax = a[0] * cosLat, ay = a[1], bx = b[0] * cosLat, by = b[1], px = p[0] * cosLat, py = p[1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const q: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const off = haversine(p, q);
    if (!best || off < best.offsetM) best = { alongM: s0 + (s1 - s0) * t, offsetM: off, segIdx: i, point: q };
  }
  return best;
}

/** Ponto da linha à distância `m` da origem. */
export function pointAt(coords: LngLat[], cum: number[], m: number): LngLat {
  if (m <= 0) return coords[0]!;
  const total = cum[cum.length - 1]!;
  if (m >= total) return coords[coords.length - 1]!;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid]! <= m) lo = mid; else hi = mid; }
  const seg = cum[hi]! - cum[lo]!;
  const t = seg === 0 ? 0 : (m - cum[lo]!) / seg;
  const a = coords[lo]!, b = coords[hi]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Sub-linha entre duas medidas (para desenhar percurso feito vs por fazer). */
export function sliceLine(coords: LngLat[], cum: number[], fromM: number, toM: number): LngLat[] {
  const out: LngLat[] = [pointAt(coords, cum, fromM)];
  for (let i = 0; i < coords.length; i++) if (cum[i]! > fromM && cum[i]! < toM) out.push(coords[i]!);
  out.push(pointAt(coords, cum, toM));
  return out;
}

/** Descodifica polyline com precisão 6 (formato do Valhalla). */
export function decodePolyline6(str: string): LngLat[] {
  const coords: LngLat[] = [];
  let index = 0, lat = 0, lng = 0;
  const factor = 1e6;
  while (index < str.length) {
    for (const which of [0, 1] as const) {
      let result = 0, shift = 0, byte: number;
      do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

/** Simplificação Douglas-Peucker (tolerância em metros), para enviar rotas leves ao telemóvel. */
export function simplify(coords: LngLat[], tolM: number): LngLat[] {
  if (coords.length <= 2) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = 1; keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    const seg = [coords[s]!, coords[e]!];
    const segCum = [0, haversine(seg[0]!, seg[1]!)];
    for (let i = s + 1; i < e; i++) {
      const pr = projectOnLine(seg as LngLat[], segCum, coords[i]!);
      if (pr && pr.offsetM > maxD) { maxD = pr.offsetM; idx = i; }
    }
    if (idx >= 0 && maxD > tolM) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return coords.filter((_, i) => keep[i]);
}
