import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, FileText, PlayCircle, Plus, Search, Truck, Wrench } from 'lucide-react';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card, Modal, ProgressBar, QueryState, Badge } from '@/components/ui';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VehicleForm } from '../vehicles/VehicleForm';
import { DriverForm } from '../drivers/DriverForm';
import { DriverIcon, TruckIcon } from '@/components/ui/icons';
import { MapView } from '@/lib/map/MapView';
import { useMe, useRole } from '@/app/session';
import { formatDate, formatDateTime, formatKm, formatTime, freshnessOf } from '@/lib/format';
import { Eta, TripStatus, vehicleTone } from '../shared';
import type { LngLat } from '@/lib/map/types';
import { RouteStrip, stripFromLive, type LiveTrip } from '../tracking/RouteStrip';
import { OpenDriverCard } from '../trips/OpenDriverCard';
import { TripLink } from '../trips/TripLink';
import { isPhone } from '../trips/ownDriver';

type Dash = {
  counts: { total: number; em_viagem: number; disponiveis: number; manutencao: number; sem_sinal: number };
  tripCounts: { ativas: number; concluidas_30d: number; planeadas: number };
  alerts: { id: string; kind: string; severity: string; title: string; detail: string | null; opened_at: string }[];
  openAlerts: number; upcoming: { id: string; code: string; planned_departure: string | null; origin: string; destination: string }[];
  docs: { id: string; doc_type: string; owner_label: string; days_left: number; expires_on: string }[];
  maint: { id: string; kind: string; plate: string; next_due_at: string | null; next_due_km: number | null }[];
  recent: { kind: string; occurred_at: string; code: string; trip_id: string; payload: Record<string, string> }[];
  placesCount: number; devices: { total: number; online: number }; serverTime: string;
};
type Live = { vehicles: (LiveTrip & { active_trip_id: string | null; active_trip_code: string | null; driver_user_id?: string | null; id: string; plate: string; main_status: string; freshness: string; lng: number | null; lat: number | null; heading: number | null; speed_kmh: number | null; last_position_at: string | null })[] };
type TripRow = { id: string; code: string; status: string; driver_user_id?: string | null; origin: string; destination: string; plate: string | null; driver: string | null; pct: number | null; eta_destination: string | null; eta_confidence: string | null; is_late: boolean; last_position_at: string | null };

export default function Dashboard() {
  const me = useMe();
  const { canWrite } = useRole();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dash>('/api/dashboard'), refetchInterval: 15_000 });
  const ownTrip = useQuery({ queryKey: ['own-active-trip'], queryFn: () => api<{ id: string } | null>('/api/own-active-trip'), refetchInterval: 30_000 });
  const live = useQuery({ queryKey: ['fleet-live'], queryFn: () => api<Live>('/api/fleet/live'), refetchInterval: 10_000 });
  const trips = useQuery({ queryKey: ['trips', 'active'], queryFn: () => api<TripRow[]>('/api/trips?status=em_viagem,pausada'), refetchInterval: 15_000 });
  const now = Date.now();
  const qc = useQueryClient();
  const [add, setAdd] = useState<'vehicle' | 'driver' | null>(null);
  const added = (k: string) => { setAdd(null); void qc.invalidateQueries({ queryKey: [k] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const located = (live.data?.vehicles ?? []).filter((v) => v.lng != null && v.lat != null);

  return (
    <div>
      <Modal open={add === 'vehicle'} onClose={() => setAdd(null)} title={t.vehicle.add} wide><VehicleForm onDone={() => added('vehicles')} /></Modal>
      <Modal open={add === 'driver'} onClose={() => setAdd(null)} title={t.driver.add}><DriverForm onDone={() => added('drivers')} /></Modal>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-3xl font-bold">{t.dashboard.hello(me.data?.user?.fullName ?? '')}</h1><p className="text-muted">{t.dashboard.subtitle}</p></div>
        <div className="flex gap-2">
          {canWrite && <Link to="/app/trips/new" className="flex-1 sm:flex-none"><Button size="lg" className="w-full whitespace-nowrap px-3"><Plus className="h-5 w-5" />{t.dashboard.newTrip}</Button></Link>}
          {/* página de acompanhamento por código (a mesma que o cliente usa) */}
          <a href="/track" className="flex-1 sm:flex-none"><Button size="lg" variant="secondary" className="w-full whitespace-nowrap px-3"><Search className="h-5 w-5" />{t.dashboard.trackTrip}</Button></a>
        </div>
      </div>
      <QueryState q={q}>{(d) => (
        <>
          {ownTrip.data?.id && isPhone() && <div className="mb-4"><OpenDriverCard tripId={ownTrip.data.id} /></div>}
          {/* atalhos: registar camião / registar motorista (abrem o formulário aqui mesmo) */}
          {canWrite && <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {([['vehicle', TruckIcon, t.dashboard.addVehicle, t.dashboard.addVehicleHint, 'bg-primary text-white'],
               ['driver', DriverIcon, t.dashboard.addDriver, t.dashboard.addDriverHint, 'bg-success text-white']] as const).map(([k, Icon, title, hint, tone]) => (
              <button key={k} type="button" onClick={() => setAdd(k)}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-white p-3 text-left shadow-sm transition-colors hover:border-primary/40 active:bg-background">
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-7 w-7" /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-navy">{title}</span><span className="block truncate text-sm text-muted">{hint}</span></span>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background text-primary transition-colors group-hover:bg-primary-soft"><Plus className="h-4 w-4" /></span>
              </button>))}
          </div>}
          {d.placesCount === 0 && <p className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">{t.dashboard.noPlaces}</p>}
          {d.counts.total === 0 && (
            <Card title={t.dashboard.onboarding} className="mb-4">
              <ol className="grid gap-2 sm:grid-cols-4">
                {[[t.dashboard.ob1, '/app/vehicles'], [t.dashboard.ob2, '/app/drivers'], [t.dashboard.ob3, '/app/trips/new'], [t.dashboard.ob4, '/app/trips']].map(([l, h], i) => (
                  <li key={h}><Link to={h!} className="block rounded-lg border border-border p-3 hover:border-primary"><span className="font-bold text-primary">{i + 1}.</span> {l}</Link></li>))}
              </ol>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { icon: Truck, n: d.counts.total, l: t.dashboard.trucks, c: 'text-primary bg-primary-soft' },
              { icon: PlayCircle, n: d.counts.em_viagem, l: t.dashboard.onTrip, c: 'text-success-text bg-success-soft' },
              { icon: CheckCircle2, n: d.counts.disponiveis, l: t.dashboard.available, c: 'text-success-text bg-success-soft' },
              { icon: Wrench, n: d.counts.manutencao, l: t.dashboard.maintenance, c: 'text-warning bg-warning-soft' },
              { icon: AlertTriangle, n: d.counts.sem_sinal, l: t.dashboard.noSignal, c: 'text-danger bg-danger-soft', alert: d.counts.sem_sinal > 0 },
            ].map((x) => (
              <div key={x.l} className={`card p-4 ${x.alert ? 'border-danger/40' : ''}`}>
                <span className={`inline-flex rounded-lg p-2 ${x.c}`}><x.icon className="h-5 w-5" /></span>
                <p className="mt-3 text-3xl font-bold tabular-nums">{x.n}</p><p className="text-sm text-muted">{x.l}</p>
              </div>
            ))}
          </div>
          {(() => {
            const act = (live.data?.vehicles ?? []).map((v) => ({ v, st: stripFromLive(v) })).filter((x) => x.st && x.v.active_trip_id).slice(0, 6);
            return act.length > 0 && <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{act.map(({ v, st }) => (
              <Card key={v.id} title={<TripLink className="hover:text-primary" id={v.active_trip_id!} status="em_viagem" driverUserId={v.driver_user_id}>{v.plate} · {v.active_trip_code}</TripLink>}
                action={v.speed_kmh != null && freshnessOf(v.last_position_at, now) === 'atual' ? <Badge tone="success">{Math.round(v.speed_kmh)} km/h</Badge> : undefined}>
                <RouteStrip {...st!} showEta={false} /></Card>))}</div>;
          })()}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title={t.dashboard.fleetLocation} action={<Link className="text-sm font-medium text-primary" to="/app/live-map">{t.dashboard.openLiveMap} →</Link>}>
              <MapView className="h-[340px] rounded-xl" fitKey={String(located.length)} fitTo={located.map((v) => [v.lng!, v.lat!] as LngLat)}
                state={{ vehicles: located.map((v) => {
                  const f = freshnessOf(v.last_position_at, now);
                  return { id: v.id, lng: v.lng!, lat: v.lat!, heading: v.heading, tone: vehicleTone(v.main_status, f), label: v.plate,
                    sublabel: v.main_status === 'em_viagem' ? (f === 'sem_sinal' ? t.freshness.sem_sinal : `${t.map.inTrip}${v.speed_kmh != null ? ` · ${Math.round(v.speed_kmh)} km/h` : ''}`) : undefined };
                }) }} />
              <div className="mt-2 flex gap-4 text-xs text-muted"><span>● <span className="text-primary">{t.map.inTrip}</span></span><span>● <span className="text-success-text">{t.map.stopped}</span></span><span>● {t.map.noSignal}</span></div>
            </Card>
            <Card title={t.dashboard.alerts} action={d.openAlerts > 0 && <Badge tone="danger">{t.dashboard.openAlerts(d.openAlerts)}</Badge>}>
              {d.alerts.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t.alerts.none}</p> : (
                <ul className="space-y-2">{d.alerts.map((a) => (
                  <li key={a.id} className={`rounded-lg p-3 ${a.severity === 'alta' ? 'bg-danger-soft' : a.severity === 'media' ? 'bg-warning-soft' : 'bg-slate-50'}`}>
                    <p className="text-sm font-semibold">{a.title}</p>{a.detail && <p className="text-xs text-muted">{a.detail}</p>}</li>))}</ul>
              )}
              <Link to="/app/alerts" className="mt-3 inline-block text-sm font-medium text-primary">{t.dashboard.seeAllAlerts} →</Link>
            </Card>
          </div>
          <Card className="mt-4" title={t.dashboard.activeTrips} action={<Link className="text-sm font-medium text-primary" to="/app/trips">{t.dashboard.seeAllTrips} →</Link>}>
            <QueryState q={trips}>{(rows) => rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t.dashboard.noActiveTrips}</p> : (
              <div className="-mx-4 overflow-x-auto sm:mx-0"><table className="w-full min-w-[720px]">
                <thead><tr><th className="table-th">{t.trip.code}</th><th className="table-th">{t.trip.route}</th><th className="table-th">{t.trip.vehicleDriver}</th><th className="table-th">{t.trip.progress}</th><th className="table-th">{t.trip.arrival}</th><th className="table-th">{t.trip.status}</th></tr></thead>
                <tbody>{rows.map((r) => {
                  const noSig = freshnessOf(r.last_position_at, now) === 'sem_sinal' || !r.last_position_at;
                  return (
                    <tr key={r.id}>
                      <td className="table-td"><TripLink className="font-semibold text-primary" id={r.id} status={r.status} driverUserId={r.driver_user_id}>{r.code}</TripLink></td>
                      <td className="table-td">{r.origin} → {r.destination}</td>
                      <td className="table-td">{r.plate ?? '—'} · {r.driver?.split(' ').slice(0, 2).join(' ') ?? '—'}</td>
                      <td className="table-td">{r.pct != null && !noSig ? <div className="flex items-center gap-2"><div className="w-28"><ProgressBar pct={r.pct} /></div><span className="text-xs tabular-nums">{Math.round(r.pct)}%</span></div> : <span className="text-muted">{t.common.noData}</span>}</td>
                      <td className="table-td">{noSig ? <span className="text-muted">{t.trip.etaUnavailable}</span> : <Eta eta={r.eta_destination} confidence={r.eta_confidence} />}</td>
                      <td className="table-td"><TripStatus status={r.status} late={r.is_late} noSignal={noSig} /></td>
                    </tr>);
                })}</tbody></table></div>
            )}</QueryState>
          </Card>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Card title={t.dashboard.upcoming}>{d.upcoming.length === 0 ? <p className="text-sm text-muted">{t.common.none}</p> :
              <ul className="space-y-2 text-sm">{d.upcoming.map((u) => <li key={u.id}><Link className="font-medium text-primary" to={`/app/trips/${u.id}`}>{u.code}</Link> · {u.origin} → {u.destination}<br /><span className="text-muted">{formatDateTime(u.planned_departure)}</span></li>)}</ul>}</Card>
            <Card title={t.dashboard.expiringDocs}>{d.docs.length === 0 ? <p className="text-sm text-muted">{t.common.none}</p> :
              <ul className="space-y-2 text-sm">{d.docs.map((x) => <li key={x.id} className="flex gap-2"><FileText className="h-4 w-4 shrink-0 text-muted" /><span>{t.docs.types[x.doc_type]} · {x.owner_label}<br /><span className={x.days_left < 0 ? 'text-danger' : 'text-warning'}>{t.docs.expiresIn(x.days_left)} ({formatDate(x.expires_on)})</span></span></li>)}</ul>}</Card>
            <Card title={t.dashboard.maintenanceDue}>{d.maint.length === 0 ? <p className="text-sm text-muted">{t.common.none}</p> :
              <ul className="space-y-2 text-sm">{d.maint.map((x) => <li key={x.id} className="flex gap-2"><Clock className="h-4 w-4 shrink-0 text-muted" /><span>{x.plate} · {x.kind}<br /><span className="text-muted">{x.next_due_at ? formatDate(x.next_due_at) : ''}{x.next_due_km ? ` · ${formatKm(Number(x.next_due_km))}` : ''}</span></span></li>)}</ul>}</Card>
          </div>
          {d.recent.length > 0 && <Card className="mt-4" title={t.trip.timeline}>
            <ul className="space-y-1 text-sm">{d.recent.map((e, i) => <li key={i}><span className="text-muted tabular-nums">{formatTime(e.occurred_at)}</span> · <Link to={`/app/trips/${e.trip_id}`} className="text-primary">{e.code}</Link> · {t.trip.events[e.kind] ?? e.kind} {e.payload?.place ?? e.payload?.province ?? ''}</li>)}</ul></Card>}
        </>
      )}</QueryState>
    </div>
  );
}
