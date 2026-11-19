import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Edit3, Play, RefreshCw, Truck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, Modal, ProgressBar, QueryState, Stat, Textarea } from '@/components/ui';
import { MapView } from '@/lib/map/MapView';
import { cumulative, sliceLine, type LngLat } from '@/lib/geo/geometry';
import { formatAgo, formatDate, formatDateTime, formatDuration, formatKm, formatMoney, formatTime, freshnessOf } from '@/lib/format';
import { useRole } from '@/app/session';
import { TripStatus } from '../shared';
import { ShareCard, type Share } from './ShareCard';

type Detail = {
  trip: Record<string, any>; stops: any[]; events: { id: string; kind: string; occurred_at: string; payload: Record<string, any>; actor_name: string | null }[];
  route: { id: string; base_km: number; length_m: number; duration_s: number; roads: string[]; validated_for_truck: boolean; provider: string; geometry: { coordinates: LngLat[] } } | null;
  places: { place_id: string; name: string; kind: string; importance: number; km_from_origin: number; state: string; eta: string | null; eta_confidence: string | null; passed_at: string | null }[];
  progress: { km_done: number | null; km_left: number | null; pct: number | null; current_label: string | null; eta_destination: string | null; eta_confidence: string | null; speed_kmh_smoothed: number | null; off_route: boolean | null } | null;
  position: { lng: number; lat: number; speed_kmh: number | null; heading: number | null; device_time: string; source: string } | null;
  shares: Share[]; incidents: any[]; proofs: any[]; expenses: any[]; serverTime: string;
};

const NEXT: Record<string, string[]> = {
  planeada: ['aguardando_partida', 'em_viagem', 'cancelada'], aguardando_partida: ['em_viagem', 'cancelada'],
  em_viagem: ['pausada', 'concluida', 'cancelada'], pausada: ['em_viagem', 'concluida', 'cancelada'],
};

export default function TripDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { canWrite, canSeeCosts } = useRole();
  const q = useQuery({ queryKey: ['trip', id], queryFn: () => api<Detail>(`/api/trips/${id}`), refetchInterval: (qq) => (['em_viagem', 'pausada'].includes(qq.state.data?.trip.status) ? 10_000 : 60_000) });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [replay, setReplay] = useState<LngLat[] | null>(null);
  const transition = useMutation({
    mutationFn: (b: { to: string; reason?: string }) => api(`/api/trips/${id}/transition`, { body: b }),
    onSuccess: () => { setErr(null); setCancelOpen(false); qc.invalidateQueries({ queryKey: ['trip', id] }); qc.invalidateQueries({ queryKey: ['trips'] }); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const replan = useMutation({ mutationFn: () => api(`/api/trips/${id}/replan`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['trip', id] }), onError: (e) => setErr(errorMessage(e)) });
  const loadReplay = async () => {
    const r = await api<{ points: { lng: number; lat: number }[]; track?: { geometry: { coordinates: LngLat[] } } }>(`/api/trips/${id}/track`);
    const pts = r.points.length ? r.points.map((p) => [p.lng, p.lat] as LngLat) : r.track?.geometry?.coordinates ?? [];
    if (!pts.length) { setErr(t.trip.replayNone); return; }
    // reprodução progressiva do percurso real
    let i = 0;
    const step = Math.max(1, Math.floor(pts.length / 120));
    const h = setInterval(() => { i += step; setReplay(pts.slice(0, Math.min(i, pts.length))); if (i >= pts.length) clearInterval(h); }, 50);
  };

  const view = useMemo(() => {
    const d = q.data;
    if (!d?.route) return null;
    const coords = d.route.geometry.coordinates;
    const cum = cumulative(coords);
    const total = cum[cum.length - 1]!;
    // km feitos ao longo da rota ATUAL (descontando os km antes de um recálculo), na escala da geometria simplificada
    const along = d.progress?.km_done != null ? Math.max(0, d.progress.km_done - (d.route.base_km ?? 0)) * 1000 * (total / d.route.length_m) : null;
    const doneM = along != null ? Math.min(total, along) : null;
    return { coords, done: doneM != null && doneM > 0 ? sliceLine(coords, cum, 0, doneM) : null, left: doneM != null ? sliceLine(coords, cum, doneM, total) : coords };
  }, [q.data]);

  return (
    <QueryState q={q}>{(d) => {
      const tr = d.trip;
      const now = Date.parse(d.serverTime) + (Date.now() - q.dataUpdatedAt);
      const active = tr.status === 'em_viagem' || tr.status === 'pausada';
      const fresh = freshnessOf(d.position?.device_time, now, tr.freshness_current_s, tr.freshness_stale_s);
      const noSig = active && (fresh === 'sem_sinal' || fresh === 'sem_dados');
      const late = !!(d.progress?.eta_destination && tr.planned_arrival && ['alta', 'media'].includes(d.progress.eta_confidence ?? '') &&
        Date.parse(d.progress.eta_destination) > Date.parse(tr.planned_arrival) + tr.late_tolerance_min * 60000);
      const fit = [[tr.origin_lng, tr.origin_lat], [tr.dest_lng, tr.dest_lat], ...(d.route?.geometry.coordinates ?? [])] as LngLat[];
      return (
        <div>
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm text-muted"><Link to="/app/trips" className="hover:text-primary">{t.trip.title}</Link> / {tr.code}</p>
              <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold sm:text-3xl">{tr.origin} → {tr.destination}<TripStatus status={tr.status} late={late} noSignal={noSig} /></h1>
            </div>
            {canWrite && <div className="flex flex-wrap gap-2">
              {(NEXT[tr.status] ?? []).filter((s) => s !== 'cancelada').map((s) => (
                <Button key={s} variant={s === 'em_viagem' ? 'primary' : 'secondary'} onClick={() => transition.mutate({ to: s })} loading={transition.isPending}>
                  {s === 'em_viagem' && <Play className="h-4 w-4" />}{s === 'em_viagem' && tr.status === 'pausada' ? t.trip.actions.retomar : t.trip.actions[s]}</Button>))}
              {!['concluida', 'cancelada'].includes(tr.status) && <Link to={`/app/trips/${id}/edit`}><Button variant="secondary"><Edit3 className="h-4 w-4" />{t.common.edit}</Button></Link>}
              {NEXT[tr.status]?.includes('cancelada') && <Button variant="danger" onClick={() => setCancelOpen(true)}>{t.trip.actions.cancelada}</Button>}
            </div>}
          </div>
          {err && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="relative">
                <MapView className="h-[420px] rounded-2xl border border-border" fitKey={d.route?.id ?? 'no-route'} fitTo={fit}
                  state={{
                    routeDone: view?.done ?? null, routeLeft: view?.left ?? null, extraLine: replay,
                    vehicles: active && d.position ? [{ id: 'v', lng: d.position.lng, lat: d.position.lat, heading: d.position.heading, tone: noSig ? 'danger' : 'primary',
                      label: d.progress?.current_label ?? undefined, sublabel: d.progress?.km_left != null ? `faltam ${formatKm(d.progress.km_left)}${d.position.speed_kmh != null ? ` · ${Math.round(d.position.speed_kmh)} km/h` : ''}` : undefined }] : [],
                    points: [
                      { id: 'o', lng: tr.origin_lng, lat: tr.origin_lat, kind: 'origin', label: tr.origin },
                      { id: 'd', lng: tr.dest_lng, lat: tr.dest_lat, kind: 'destination', label: tr.destination },
                    ],
                  }} />
                {active && <span className="absolute left-3 top-3 rounded-full bg-white px-3 py-1 text-sm font-medium shadow">
                  {d.position ? <>{fresh === 'atual' ? '🟢' : fresh === 'desatualizada' ? '🟠' : '🔴'} {fresh === 'atual' ? t.freshness.atual : fresh === 'desatualizada' ? t.freshness.desatualizada : t.freshness.sem_sinal} · {formatAgo(d.position.device_time, now)}</> : t.trip.noPosition}</span>}
                {d.route && !d.route.validated_for_truck && <span className="absolute right-12 top-3 max-w-[220px] rounded-lg bg-white px-3 py-1.5 text-xs text-warning shadow"><AlertTriangle className="mr-1 inline h-3 w-3" />{t.trip.routeNotValidated}</span>}
              </div>
              {!d.route && <Card><p className="text-sm text-warning">{t.trip.routeNone}</p>{canWrite && <Button className="mt-2" size="sm" variant="secondary" onClick={() => replan.mutate()} loading={replan.isPending}><RefreshCw className="h-4 w-4" />{t.trip.replan}</Button>}</Card>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label={t.trip.progress} value={d.progress?.pct != null && active ? `${Math.round(d.progress.pct)}%` : tr.status === 'concluida' ? '100%' : '—'}><div className="mt-2"><ProgressBar pct={tr.status === 'concluida' ? 100 : d.progress?.pct} /></div></Stat>
                <Stat label={t.trip.remaining} value={active && d.progress?.km_left != null ? formatKm(d.progress.km_left) : d.route && !active && tr.status !== 'concluida' ? formatKm(d.route.length_m / 1000) : '—'}
                  sub={d.progress?.km_done != null ? t.trip.done(formatKm(d.progress.km_done)) : d.route ? `${t.trip.distance}: ${formatKm(d.route.length_m / 1000)}` : undefined} />
                <Stat label={t.trip.eta} value={active && !noSig && d.progress?.eta_destination && d.progress.eta_confidence !== 'indisponivel' ? formatTime(d.progress.eta_destination) : '—'}
                  sub={active ? (noSig || !d.progress?.eta_destination || d.progress.eta_confidence === 'indisponivel' ? t.trip.etaUnavailable : late ? t.trip.late : d.progress.eta_confidence === 'baixa' ? t.trip.etaApprox : t.trip.onTime) : d.route ? `${t.trip.duration}: ${formatDuration(d.route.duration_s)}` : undefined}
                  subTone={late ? 'warning' : 'success'} />
                <Stat label={t.trip.speed} value={active && !noSig && d.position?.speed_kmh != null ? `${Math.round(d.position.speed_kmh)} km/h` : '—'} sub={d.position ? t.vehicle.sources[d.position.source] : undefined} />
              </div>
              {d.route && (
                <Card title={t.trip.places} action={<span className="text-xs text-muted">{formatKm(d.route.length_m / 1000)} · {formatDuration(d.route.duration_s)}{d.route.roads.length ? ` · ${d.route.roads.join(', ')}` : ''}</span>}>
                  <ol className="space-y-2">{d.places.filter((p) => p.importance >= 2 || p.km_from_origin === 0).map((p) => (
                    <li key={p.place_id} className="flex items-center gap-3 text-sm">
                      <span className={`h-3 w-3 shrink-0 rounded-full border-2 ${p.state === 'passada' ? 'border-success bg-success' : p.state === 'atual' ? 'border-primary bg-primary' : 'border-primary bg-white'}`} />
                      <span className="w-16 shrink-0 tabular-nums text-muted">km {Math.round(p.km_from_origin)}</span>
                      <span className={`flex-1 ${p.importance >= 4 ? 'font-semibold' : ''}`}>{p.name}</span>
                      <span className="tabular-nums text-muted">{p.passed_at ? `✓ ${formatTime(p.passed_at)}` : p.eta && p.eta_confidence !== 'indisponivel' && active && !noSig ? `~${formatTime(p.eta)}` : ''}</span>
                    </li>))}</ol>
                </Card>
              )}
              {(d.incidents.length > 0 || d.proofs.length > 0 || (canSeeCosts && d.expenses.length > 0)) && (
                <Card title={`${t.trip.events.ocorrencia} · ${t.trip.events.entrega}`}>
                  <ul className="space-y-2 text-sm">
                    {d.incidents.map((i) => <li key={i.id}><Badge tone="warning">{t.driverApp.incidentKinds[i.kind]}</Badge> {formatDateTime(i.occurred_at)} {i.note}{i.photo_file_id && <> · <a className="text-primary" href={`/api/files/${i.photo_file_id}`} target="_blank" rel="noreferrer">{t.driverApp.photo}</a></>}</li>)}
                    {d.proofs.map((p) => <li key={p.id}><Badge tone="success">{t.trip.events.entrega}</Badge> {formatDateTime(p.delivered_at)} · {p.received_by_name}
                      {p.signature_file_id && <> · <a className="text-primary" href={`/api/files/${p.signature_file_id}`} target="_blank" rel="noreferrer">{t.driverApp.signature}</a></>}
                      {p.photo_file_id && <> · <a className="text-primary" href={`/api/files/${p.photo_file_id}`} target="_blank" rel="noreferrer">{t.driverApp.photo}</a></>}</li>)}
                    {canSeeCosts && d.expenses.map((e) => <li key={e.id}><Badge>{t.costs.categories[e.category]}</Badge> {formatMoney(e.amount, e.currency)} · {formatDate(e.spent_at)} {e.note}</li>)}
                  </ul>
                </Card>
              )}
            </div>
            <div className="space-y-4">
              <ShareCard tripId={id!} shares={d.shares} origin={tr.origin} destination={tr.destination} company={null} canWrite={canWrite} />
              <Card title={`${t.trip.vehicle} · ${t.trip.driver}`}>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-3"><span className="rounded-lg bg-primary-soft p-2 text-primary"><Truck className="h-5 w-5" /></span>
                    <div>{tr.vehicle_id ? <Link className="font-semibold" to={`/app/vehicles/${tr.vehicle_id}`}>{tr.plate}</Link> : '—'}<p className="text-muted">{[tr.make, tr.model].filter(Boolean).join(' ')}</p></div></div>
                  <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary">{(tr.driver_name ?? '?').split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</span>
                    <div>{tr.driver_id ? <Link className="font-semibold" to={`/app/drivers/${tr.driver_id}`}>{tr.driver_name}</Link> : '—'}<p className="text-muted">{tr.license_expires ? `${t.driver.license} · ${formatDate(tr.license_expires)}` : tr.driver_phone ?? ''}</p></div></div>
                  {(tr.cargo_description || tr.recipient_name) && <div className="border-t border-border pt-3">{tr.cargo_description && <p>{t.trip.cargo}: {tr.cargo_description}{tr.cargo_weight_t ? ` · ${tr.cargo_weight_t} t` : ''}</p>}{tr.recipient_name && <p className="text-muted">{t.trip.recipient}: {tr.recipient_name} {tr.recipient_phone}</p>}</div>}
                </div>
              </Card>
              <Card title={t.trip.timeline} action={<Button size="sm" variant="ghost" onClick={loadReplay}>{t.trip.replay}</Button>}>
                <ol className="space-y-3">{d.events.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${['desvio', 'ocorrencia', 'cancelamento'].includes(e.kind) ? 'bg-danger' : e.kind.startsWith('paragem') ? 'bg-warning' : e.kind === 'partida' ? 'bg-success' : 'bg-primary'}`} />
                    <div><p className="font-medium">{t.trip.events[e.kind] ?? e.kind} {e.payload?.place ?? e.payload?.province ?? ''}{e.kind === 'paragem_fim' && e.payload?.minutes ? ` (${e.payload.minutes} min)` : ''}{e.kind === 'ocorrencia' ? `: ${t.driverApp.incidentKinds[e.payload?.kind] ?? ''}` : ''}{e.kind === 'nota' ? `: ${e.payload?.text}` : ''}</p>
                      <p className="text-xs text-muted">{formatDateTime(e.occurred_at)}{e.actor_name ? ` · ${e.actor_name}` : ''}</p></div>
                  </li>))}</ol>
              </Card>
            </div>
          </div>
          <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t.trip.actions.cancelada ?? ""}>
            <label className="label" htmlFor="reason">{t.trip.cancelReason}</label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setCancelOpen(false)}>{t.common.cancel}</Button>
              <Button variant="danger" disabled={reason.trim().length < 3} loading={transition.isPending} onClick={() => transition.mutate({ to: 'cancelada', reason })}>{t.common.confirm}</Button></div>
          </Modal>
        </div>
      );
    }}</QueryState>
  );
}
