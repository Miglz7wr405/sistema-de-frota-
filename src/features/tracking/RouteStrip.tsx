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
  const H = Math.max(260, TOP * 2 + (all.length - 1) * ROW * 1.15);
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
  const ang = frac != null ? (Math.atan2((H - TOP * 2) / N, curveX(Math.min(1, frac + 1 / N)) - curveX(frac)) * 180) / Math.PI + 90 : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${origin} → ${destination}`}>
      <path d={path(0, 1)} fill="none" stroke="#CBD5E1" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 9" />
      {frac != null && frac > 0 && <path d={path(0, frac)} fill="none" stroke="#16A36A" strokeWidth="6" strokeLinecap="round" />}
      {all.map((p, i) => {
        const f = p.km / totalKm, x = curveX(f), y = yOf(p.km), ly = labelY[i]!;
        const end = i === 0 || i === all.length - 1;
        const passed = frac != null && f <= frac;
        const right = p.passedAt ? `${t.strip.passed} ${formatTime(p.passedAt)}` : showEta && p.eta && !passed ? `~${formatTime(p.eta)}` : '';
        return (
          <g key={`${p.name}-${i}`}>
            {Math.abs(ly - y) > 2 && <line x1={x + 8} y1={y} x2={X0 + AMP + 22} y2={ly - 4} stroke="#CBD5E1" strokeWidth="1" />}
            <circle cx={x} cy={y} r={end ? 8 : 5.5} fill={i === 0 ? '#16A36A' : i === all.length - 1 ? '#DC2626' : passed ? '#16A36A' : '#fff'}
              stroke={end ? '#fff' : passed ? '#fff' : '#1769E8'} strokeWidth="2.5" />
            <text x={X0 + AMP + 26} y={ly} fontSize={end ? 15 : 13.5} fontWeight={end || (p.importance ?? 3) >= 4 ? 700 : 500} fill="#10243D" dominantBaseline="middle">{p.name}</text>
            <text x={X0 + AMP + 26} y={ly + 15} fontSize="11" fill="#64748B" dominantBaseline="middle">km {Math.round(p.km)}{right ? ` · ${right}` : ''}</text>
          </g>
        );
      })}
      {truckX != null && truckY != null && (
        <g transform={`translate(${truckX},${truckY}) rotate(${ang})`}>
          <circle r="15" fill="#1769E8" fillOpacity="0.16" />
          <rect x="-5.5" y="-4" width="11" height="15" rx="2" fill="#fff" stroke="#1769E8" strokeWidth="1.6" />
          <rect x="-5" y="-12" width="10" height="8" rx="2.5" fill="#1769E8" stroke="#fff" strokeWidth="1.2" />
        </g>
      )}
      {frac != null && <text x={W - 6} y={TOP - 10} fontSize="11" textAnchor="end" fill="#64748B">{t.strip.done(formatKm(kmDone))} · {t.strip.left(formatKm(Math.max(0, totalKm - (kmDone ?? 0))))}</text>}
    </svg>
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
