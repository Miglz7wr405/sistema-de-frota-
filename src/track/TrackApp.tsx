import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Clock, MapPin, Truck } from 'lucide-react';
import { t } from '@/i18n/pt-MZ';
import { formatAgo, formatKm, formatTime, freshnessOf, normalizeTripCode } from '@/lib/format';

import { RouteStrip } from '@/features/tracking/RouteStrip';
const TrackMap = lazy(() => import('./TrackMap'));

export type Dto = {
  code: string; status: string; origin: string; destination: string; origin_point: [number, number]; destination_point: [number, number];
  departed_at: string | null; delivered_at: string | null; planned_arrival: string | null;
  position: { lng: number; lat: number; heading: number | null; device_time: string } | null;
  progress: { pct: number; km_done: number; km_left: number; current_label: string | null; eta: string | null; eta_confidence: string } | null;
  route_done: { coordinates: [number, number][] } | null; route_left: { coordinates: [number, number][] } | null; route_validated_for_truck: boolean | null;
  places: { name: string; km: number; state: string; passed_at: string | null; eta: string | null; eta_confidence: string | null }[];
  company: string | null; logo_file_id: string | null; plate: string | null; driver_first_name: string | null; server_time: string;
};

function useTracking(query: string | null) {
  const [dto, setDto] = useState<Dto | null>(null);
  const [error, setError] = useState<'unavailable' | 'invalid' | 'rate' | 'network' | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const timer = useRef<number>();
  useEffect(() => {
    if (!query) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/track?${query}`, { cache: 'no-store' });
        if (r.status === 404) { setError('unavailable'); setDto(null); return; }
        if (r.status === 400) { setError('invalid'); return; }
        if (r.status === 429) { setError('rate'); } else if (!r.ok) setError('network');
        else { const d = (await r.json()) as Dto; setDto(d); setError(null); setFetchedAt(Date.now()); if (d.status === 'concluida' || d.status === 'cancelada') return; }
      } catch { setError('network'); }
      if (!stop) timer.current = window.setTimeout(load, document.hidden ? 60_000 : 20_000); // polling (ADR-007)
    };
    load();
    const vis = () => { if (!document.hidden) { clearTimeout(timer.current); load(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearTimeout(timer.current); document.removeEventListener('visibilitychange', vis); };
  }, [query]);
  return { dto, error, fetchedAt };
}

export function TrackApp() {
  const parts = location.pathname.split('/').filter(Boolean); // ['track', token?]
  const params = new URLSearchParams(location.search);
  const token = parts[1] && /^[A-Za-z0-9_-]{20,64}$/.test(parts[1]) ? parts[1] : null;
  const code = params.get('code');
  const [query, setQuery] = useState<string | null>(token ? `token=${encodeURIComponent(token)}` : code ? `code=${encodeURIComponent(code)}` : null);
  const { dto, error, fetchedAt } = useTracking(query);
  if (!query || (error === 'invalid' && !dto)) return <CodeForm onSubmit={(c) => { history.replaceState(null, '', `/track?code=${c}`); setQuery(`code=${c}`); }} invalid={error === 'invalid'} />;
  if (error === 'unavailable') return <Message text={t.track.unavailable} onBack={() => { history.replaceState(null, '', '/track'); setQuery(null); }} />;
  if (!dto) return <Message text={error === 'rate' ? t.errors.rateLimited : error === 'network' ? t.errors.network : t.common.loading} />;
  return <TrackView dto={dto} offline={error === 'network'} fetchedAt={fetchedAt} />;
}

function Header({ company, logo }: { company?: string | null; logo?: string | null }) {
  return (
    <div className="pointer-events-auto mx-3 mt-3 flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-md">
      <span className="flex items-center gap-2 font-bold"><span className="rounded-lg bg-primary p-1.5 text-white"><Truck className="h-4 w-4" /></span>insight<span className="text-primary">Frota</span></span>
      {(company || logo) && <span className="flex items-center gap-2 text-sm text-muted">{logo && <img src={logo} alt="" className="h-6 w-auto" />}{company}</span>}
    </div>
  );
}

function CodeForm({ onSubmit, invalid }: { onSubmit: (c: string) => void; invalid: boolean }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState(invalid);
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <form className="card mx-3 mt-6 space-y-3 p-5 sm:mx-auto sm:max-w-md" onSubmit={(e) => { e.preventDefault(); const c = normalizeTripCode(v); if (!c) setErr(true); else onSubmit(c); }}>
        <h1 className="text-xl font-bold">{t.track.title}</h1>
        <label className="label" htmlFor="code">{t.track.enterCode}</label>
        <input id="code" className="input font-mono text-lg uppercase tracking-wider" placeholder={t.track.codePh} value={v} autoComplete="off" autoCapitalize="characters"
          onChange={(e) => { setV(e.target.value); setErr(false); }} />
        {err && <p className="text-sm text-danger" role="alert">{t.track.invalidCode}</p>}
        <button className="w-full rounded-lg bg-primary py-3 font-medium text-white">{t.track.go}</button>
      </form>
    </div>
  );
}

const Message = ({ text, onBack }: { text: string; onBack?: () => void }) => (
  <div className="min-h-screen bg-background"><Header /><div className="card mx-3 mt-6 p-5 text-center sm:mx-auto sm:max-w-md"><p>{text}</p>
    {onBack && <button className="mt-3 text-sm font-medium text-primary" onClick={onBack}>{t.track.enterCode}</button>}</div></div>
);

function TrackView({ dto, offline, fetchedAt }: { dto: Dto; offline: boolean; fetchedAt: number }) {
  const now = Date.parse(dto.server_time) + (Date.now() - fetchedAt);
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(h); }, []);
  const active = dto.status === 'em_viagem' || dto.status === 'pausada';
  const fresh = freshnessOf(dto.position?.device_time, now);
  const tok = location.pathname.split('/')[2];
  const logo = dto.logo_file_id ? `/api/track/logo?${tok ? `token=${encodeURIComponent(tok)}` : `code=${encodeURIComponent(dto.code)}`}` : null;
  const p = dto.progress;
  const etaOk = active && p?.eta && p.eta_confidence !== 'indisponivel';
  const badge = dto.status === 'concluida' ? ['bg-primary text-white', t.trip.statuses.concluida] : dto.status === 'cancelada' ? ['bg-danger text-white', t.track.cancelled]
    : dto.status === 'pausada' ? ['bg-warning text-white', t.track.paused] : dto.status === 'em_viagem' ? ['bg-success text-white', t.trip.statuses.em_viagem] : ['bg-slate-200 text-navy', t.trip.statuses[dto.status]];
  // última localidade já passada (real: hora em que o camião passou)
  const lastPassed = [...dto.places].reverse().find((x) => x.state === 'passada' && x.km > 0 && x.passed_at) ?? null;
  const totalKm = p ? p.km_done + p.km_left : Math.max(0, ...dto.places.map((x) => x.km));
  return (
    // Telemóvel: cabeçalho, mapa FIXO (rota inteira enquadrada, não se arrasta) e por baixo a informação. Sem sobreposições.
    <div className="min-h-[100dvh] overflow-x-hidden bg-background">
      <Header company={dto.company} logo={logo} />
      <div className="relative mx-auto h-[42dvh] max-w-3xl overflow-hidden sm:rounded-3xl">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-sm text-muted">{t.map.loading}</div>}><TrackMap dto={dto} stale={fresh === 'sem_sinal'} /></Suspense>
      </div>
      <section className="mx-auto -mt-4 max-w-3xl rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-[0_-8px_30px_rgba(16,36,61,0.08)] relative">
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-sm text-muted">{t.track.trip}</p><p className="font-mono text-2xl font-bold tracking-wide">{dto.code}</p></div>
          <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${badge[0]}`}>{badge[1]}</span>
        </div>
        {active && (p?.current_label || lastPassed) && <div className="mt-3 rounded-2xl bg-primary-soft px-4 py-3">
          {p?.current_label && <p className="text-lg font-semibold text-navy">🚚 {fresh === 'sem_sinal' ? t.track.lastSeenAt(p.current_label) : t.track.nowAt(p.current_label)}</p>}
          {lastPassed && <p className="text-sm text-muted">{t.driverApp.passedPlace(lastPassed.name)}{lastPassed.passed_at ? ` · ${formatTime(lastPassed.passed_at)}` : ''}</p>}
        </div>}
        {dto.status === 'concluida' && dto.delivered_at && <p className="mt-3 text-lg font-semibold text-success-text">{t.track.delivered(formatTime(dto.delivered_at))}</p>}
        {(dto.status === 'planeada' || dto.status === 'aguardando_partida') && <p className="mt-3 text-muted">{t.track.notStarted}</p>}
        <div className="mt-3 flex items-center justify-between text-sm"><span className="font-semibold">{active && p ? t.track.pctDone(p.pct) : ''}</span><span className="text-muted">{dto.origin} → {dto.destination}</span></div>
        {active && p && <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-success" style={{ width: `${p.pct}%` }} /></div>}
        {active && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 rounded-2xl bg-background p-3"><MapPin className="h-5 w-5 text-primary" /><div><p className="text-lg font-bold">{p ? formatKm(p.km_left) : totalKm > 0 ? formatKm(totalKm) : '—'}</p><p className="text-xs text-muted">{p || !(totalKm > 0) ? t.track.remaining : t.ownGps.fullRoute}</p></div></div>
            <div className="flex items-center gap-3 rounded-2xl bg-background p-3"><Clock className="h-5 w-5 text-primary" /><div>
              <p className="text-lg font-bold">{etaOk ? formatTime(p!.eta!) : '—'}</p>
              <p className="text-xs text-muted">{etaOk ? `${t.track.eta}${p!.eta_confidence === 'baixa' ? ` (${t.track.etaApprox})` : ''}` : t.track.etaUnavailable}</p></div></div>
          </div>
        )}
        {totalKm > 0 && <div className="mt-4"><RouteStrip origin={dto.origin} destination={dto.destination} totalKm={totalKm}
          kmDone={active && p ? p.km_done : dto.status === 'concluida' ? totalKm : null} showEta={!!etaOk}
          places={dto.places.map((x) => ({ name: x.name, km: x.km, state: x.state, passedAt: x.passed_at, eta: x.eta_confidence !== 'indisponivel' ? x.eta : null }))} /></div>}
        {active && <p className={`mt-4 flex items-center justify-center gap-2 text-sm ${fresh === 'atual' ? 'text-muted' : 'text-warning'}`}>
          <span className={`h-2 w-2 rounded-full ${fresh === 'atual' ? 'bg-success' : fresh === 'desatualizada' ? 'bg-warning' : 'bg-danger'}`} />
          {!dto.position ? t.track.noPosition : fresh === 'atual' ? t.track.updated(formatAgo(dto.position.device_time, now)) : t.track.stale(formatAgo(dto.position.device_time, now))}</p>}
        {offline && <p className="mt-2 text-center text-xs text-warning">{t.states.offline}</p>}
        <p className="mt-4 text-center text-xs text-muted">{t.track.poweredBy} · © OpenStreetMap</p>
      </section>
    </div>
  );
}
