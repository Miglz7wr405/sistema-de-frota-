// Esquema do percurso: uma linha com curvas suaves da origem ao destino, com as localidades REAIS da rota planeada
// (trip_route_places) colocadas pela distância RODOVIÁRIA desde a origem, e o camião na posição real (km feitos
// calculados pelo motor de percurso). Nada é inventado: sem km feitos, não há camião desenhado.
// Também usado na página pública (sem dependências da área administrativa).
import { t } from '@/i18n/pt-MZ';
import { formatKm, formatTime } from '@/lib/format';

export type StripPlace = { name: string; km: number; importance?: number; state?: string | null; passedAt?: string | null; eta?: string | null };

type Props = {
  origin: string; destination: string; totalKm: number;
  places: StripPlace[]; kmDone: number | null; showEta?: boolean;
};

const W = 360, X0 = 64, AMP = 26, ROW = 46, TOP = 26;

// curva suave: x oscila à volta da coluna, y proporcional aos km de estrada
const curveX = (f: number) => X0 + AMP * Math.sin(f * Math.PI * 3);

export function RouteStrip({ origin, destination, totalKm, places, kmDone, showEta = true }: Props) {
  if (!(totalKm > 0)) return null;
  // localidades intermédias importantes (cidades/vilas), sem repetir a origem e o destino
  const mids = places.filter((p) => p.km > 0.5 && p.km < totalKm - 0.5 && (p.importance ?? 3) >= 3)
    .sort((a, b) => a.km - b.km);
  // limitar o número de etiquetas mantendo as mais importantes (para não baralhar)
  const MAX = 9;
  let shown = mids;
  if (mids.length > MAX) {
    const keep = new Set([...mids].sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || a.km - b.km).slice(0, MAX));
    shown = mids.filter((p) => keep.has(p));
  }
  const all: StripPlace[] = [{ name: origin, km: 0, state: 'origem' }, ...shown, { name: destination, km: totalKm, state: 'destino' }];
  // altura: o suficiente para cada localidade ficar ao lado do seu ponto (sem linhas de ligação), até um máximo
  let pxPerKm = (Math.max(260, (all.length - 1) * ROW * 1.15)) / totalKm;
  for (let i = 1; i < all.length; i++) { const dk = all[i]!.km - all[i - 1]!.km; if (dk > 0) pxPerKm = Math.max(pxPerKm, 36 / dk); }
  const H = Math.min(Math.max(260, (all.length - 1) * ROW * 1.15, 820), TOP * 2 + totalKm * pxPerKm);
  const yOf = (km: number) => TOP + (km / totalKm) * (H - TOP * 2);

  // etiquetas: y real pela distância, empurradas para baixo só o necessário para não se sobreporem
  const labelY: number[] = [];
  all.forEach((p, i) => { const y = yOf(p.km); labelY.push(i === 0 ? y : Math.max(y, labelY[i - 1]! + 34)); });
  const overflow = labelY[labelY.length - 1]! - (H - TOP);
  if (overflow > 0) for (let i = labelY.length - 1; i > 0; i--) labelY[i] = Math.min(labelY[i]!, i === labelY.length - 1 ? H - TOP : labelY[i + 1]! - 34);

  const N = 80;
  const pts = Array.from({ length: N + 1 }, (_, i) => { const f = i / N; return [curveX(f), TOP + f * (H - TOP * 2)] as const; });
  const path = (from: number, to: number) => pts.filter((_, i) => i / N >= from - 1e-9 && i / N <= to + 1e-9)
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const frac = kmDone != null ? Math.min(1, Math.max(0, kmDone / totalKm)) : null;
  const truckY = frac != null ? TOP + frac * (H - TOP * 2) : null;
  const truckX = frac != null ? curveX(frac) : null;

  // onde está agora (localidades REAIS da rota): última passada e próxima
  const lastPassed = kmDone != null ? [...places].filter((p) => p.km > 0.5 && p.km <= kmDone).sort((a, b) => b.km - a.km)[0] ?? null : null;
  const nextIdx = kmDone != null ? all.findIndex((p) => p.km > kmDone) : -1;

  return (
    <div>
      {frac != null && <p className="mb-1 text-sm"><span className="font-semibold text-success-text">{t.strip.done(formatKm(kmDone))}</span>
        {lastPassed ? <span className="text-muted"> · {t.strip.near(lastPassed.name)}</span> : null}
        <span className="text-muted"> · {t.strip.left(formatKm(Math.max(0, totalKm - (kmDone ?? 0))))}</span></p>}
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${origin} → ${destination}`}>
      <path d={path(0, 1)} fill="none" stroke="#CBD5E1" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 9" />
      {frac != null && frac > 0 && <path d={path(0, frac)} fill="none" stroke="#16A36A" strokeWidth="6" strokeLinecap="round" />}
      {all.map((p, i) => {
        const f = p.km / totalKm, x = curveX(f), y = yOf(p.km), ly = labelY[i]!;
        const end = i === 0 || i === all.length - 1;
        const passed = frac != null && f <= frac;
        const isNext = i === nextIdx && kmDone != null;
        const right = p.passedAt ? `${t.strip.passed} ${formatTime(p.passedAt)}` : isNext ? `${t.strip.left(formatKm(p.km - kmDone!))}${showEta && p.eta ? ` · ~${formatTime(p.eta)}` : ''}` : showEta && p.eta && !passed ? `~${formatTime(p.eta)}` : '';
        return (
          <g key={`${p.name}-${i}`}>
            {Math.abs(ly - y) > 2 && <line x1={x + 8} y1={y} x2={X0 + AMP + 22} y2={ly - 4} stroke="#CBD5E1" strokeWidth="1" />}
            <circle cx={x} cy={y} r={end ? 8 : 5.5} fill={i === 0 ? '#16A36A' : i === all.length - 1 ? '#DC2626' : passed ? '#16A36A' : '#fff'}
              stroke={end ? '#fff' : passed ? '#fff' : '#1769E8'} strokeWidth="2.5" />
            <text x={X0 + AMP + 26} y={ly} fontSize={end ? 15 : 13.5} fontWeight={end || isNext || (p.importance ?? 3) >= 4 ? 700 : 500} fill={isNext ? '#1769E8' : '#10243D'} dominantBaseline="middle">{p.name}</text>
            <text x={X0 + AMP + 26} y={ly + 15} fontSize="11" fill={isNext ? '#1769E8' : passed ? '#0F7A4F' : '#64748B'} dominantBaseline="middle">km {Math.round(p.km)}{right ? ` · ${right}` : ''}</text>
          </g>
        );
      })}
      {truckX != null && truckY != null && (
        // movimento suave entre atualizações (a única animação obrigatória)
        <g style={{ transform: `translate(${truckX}px, ${truckY}px)`, transition: 'transform 1.5s ease-in-out' }}>
          {/* o mesmo camião do mapa: visto de lado, direito, num círculo azul */}
          <circle r="17" fill="#1769E8" stroke="#fff" strokeWidth="2.5" />
          <g transform="translate(-20,-19)">
            <rect x="7" y="11.5" width="16" height="11" rx="1.5" fill="#fff" />
            <path d="M24.5 14.5 h4.6 a1.5 1.5 0 0 1 1.2.6 l2.6 3.6 a1.5 1.5 0 0 1 .3.9 v2.9 h-8.7 z" fill="#fff" />
            <circle cx="12" cy="24.5" r="2.7" fill="#1769E8" stroke="#fff" strokeWidth="1.6" />
            <circle cx="28" cy="24.5" r="2.7" fill="#1769E8" stroke="#fff" strokeWidth="1.6" />
          </g>
        </g>
      )}
    </svg>
    </div>
  );
}

/** Tendência da velocidade a partir das últimas velocidades REAIS do GPS (ordem cronológica). */
export function speedTrend(speeds: (number | null)[] | null | undefined): 'accelerating' | 'slowing' | 'steady' | 'stopped' | null {
  const s = (speeds ?? []).filter((x): x is number => x != null && Number.isFinite(x));
  if (s.length < 3) return null;
  const last = s[s.length - 1]!;
  if (last < 3) return 'stopped';
  const k = Math.min(3, Math.floor(s.length / 2));
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const d = avg(s.slice(-k)) - avg(s.slice(0, k));
  return d > 4 ? 'accelerating' : d < -4 ? 'slowing' : 'steady';
}

/** Linha do /api/fleet/live → props do esquema (só quando há viagem ativa com rota). */
export type LiveTrip = { trip_origin: string | null; trip_destination: string | null; route_km: number | null; km_done: number | null;
  route_places: { name: string; km: number; importance: number; passedAt: string | null }[] | null };
export function stripFromLive(v: LiveTrip) {
  if (!v.trip_origin || !v.trip_destination || !(Number(v.route_km) > 0)) return null;
  return { origin: v.trip_origin, destination: v.trip_destination, totalKm: Number(v.route_km), kmDone: v.km_done,
    places: (v.route_places ?? []).map((p) => ({ name: p.name, km: Number(p.km), importance: p.importance, passedAt: p.passedAt })) };
}
