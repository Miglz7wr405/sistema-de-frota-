// Ajuste à estrada (map matching) com o Valhalla trace_attributes: a partir das últimas posições GPS REAIS,
// devolve a posição em cima da estrada, o nome da estrada e o limite de velocidade SE estiver etiquetado no OSM.
// Nada é inventado: sem resposta → null (a interface mostra a posição GPS bruta "sem ajuste à estrada");
// sem etiqueta maxspeed → speedLimitKmh = null ("limite desconhecido").
// ⚠️ DEPENDÊNCIA EXTERNA: Valhalla público da FOSSGIS (gratuito, sem SLA).

export type Fix = { lat: number; lng: number; t: number; accuracyM?: number | null };
export type Match = { lat: number; lng: number; roadName: string | null; speedLimitKmh: number | null; roadClass: string | null };
export type Matcher = (fixes: Fix[]) => Promise<Match | null>;

type TraceResponse = {
  edges?: { names?: string[]; speed_limit?: number | string; road_class?: string }[];
  matched_points?: { lat: number; lon: number; type: string; edge_index?: number }[];
};

/** Interpreta a resposta do trace_attributes (função pura, testada). */
export function parseTrace(j: TraceResponse): Match | null {
  const pts = j.matched_points ?? [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    if (p.type !== 'matched' || p.edge_index == null) continue;
    const e = j.edges?.[p.edge_index];
    const lim = typeof e?.speed_limit === 'number' ? e.speed_limit : Number(e?.speed_limit);
    return {
      lat: p.lat, lng: p.lon,
      roadName: e?.names?.length ? e.names.join(' / ') : null,
      // o Valhalla devolve 0 ou nada quando a via não tem limite etiquetado → desconhecido
      speedLimitKmh: Number.isFinite(lim) && lim >= 5 && lim <= 200 ? Math.round(lim) : null,
      roadClass: e?.road_class ?? null,
    };
  }
  return null;
}

const valhallaMatcher: Matcher = async (fixes) => {
  const base = (process.env.VALHALLA_URL ?? 'https://valhalla1.openstreetmap.de/route').replace(/\/route$/, '');
  const body = {
    shape: fixes.map((f) => ({ lat: f.lat, lon: f.lng, time: Math.round(f.t / 1000) })),
    costing: 'auto', shape_match: 'map_snap',
    filters: { attributes: ['edge.names', 'edge.speed_limit', 'edge.road_class', 'matched.point', 'matched.type', 'matched.edge_index'], action: 'include' },
  };
  const r = await fetch(`${base}/trace_attributes`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'insightFrota/0.1' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!r.ok) { console.warn('[estrada] trace_attributes', r.status); return null; }
  return parseTrace((await r.json()) as TraceResponse);
};

// Só no E2E local (nunca na Vercel): sem internet para o Valhalla. Devolve a própria posição GPS e uma estrada de TESTE.
const e2eMatcher: Matcher = async (fixes) => { const f = fixes[fixes.length - 1]!; return { lat: f.lat, lng: f.lng, roadName: 'EN-E2E (teste)', speedLimitKmh: 60, roadClass: 'test' }; };

let override: Matcher | null = null;
export const setMatcherForTests = (m: Matcher | null) => { override = m; };
export const matchToRoad: Matcher = (fixes) => (override ?? (process.env.E2E_ROUTING_STUB === '1' && !process.env.VERCEL ? e2eMatcher : valhallaMatcher))(fixes).catch((e) => { console.warn('[estrada]', (e as Error).message); return null; });
