import { RouteStrip, stripFromLive, type LiveTrip } from './RouteStrip';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Card, PageHeader, QueryState, Badge } from '@/components/ui';
import { MapView } from '@/lib/map/MapView';
import { formatKm, freshnessOf } from '@/lib/format';
import { Eta, FreshnessLine, vehicleTone } from '../shared';
import type { LngLat } from '@/lib/map/types';
import { cn } from '@/lib/cn';

type V = LiveTrip & { id: string; plate: string; main_status: string; freshness: string; last_position_at: string | null; last_source: string | null; speed_kmh: number | null;
  heading: number | null; lng: number | null; lat: number | null; active_trip_id: string | null; active_trip_code: string | null; current_label: string | null; road_name: string | null; speed_limit_kmh: number | null;
  km_left: number | null; eta_destination: string | null; eta_confidence: string | null; driver: string | null };

const FILTERS = ['todos', 'em_viagem', 'disponivel', 'sem_sinal'] as const;

export default function LiveMap() {
  const q = useQuery({ queryKey: ['fleet-live'], queryFn: () => api<{ vehicles: V[]; serverTime: string }>('/api/fleet/live'), refetchInterval: 10_000 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('todos');
  const [sel, setSel] = useState<string | null>(null);
  const now = q.data ? Date.parse(q.data.serverTime) + (Date.now() - q.dataUpdatedAt) : Date.now();
  const list = useMemo(() => (q.data?.vehicles ?? []).filter((v) => {
    const f = freshnessOf(v.last_position_at, now);
    return filter === 'todos' || (filter === 'sem_sinal' ? f === 'sem_sinal' : v.main_status === filter);
  }), [q.data, filter, now]);
  const located = list.filter((v) => v.lng != null);
  const selected = list.find((v) => v.id === sel);
  return (
    <div>
      <PageHeader title={t.liveMap.title} />
      <div className="mb-3 flex flex-wrap gap-2">{FILTERS.map((f) => (
        <button key={f} onClick={() => setFilter(f)} className={cn('rounded-full border px-4 py-1.5 text-sm', filter === f ? 'border-navy bg-navy text-white' : 'border-border bg-white')}>
          {f === 'todos' ? t.liveMap.filterAll : f === 'sem_sinal' ? t.freshness.sem_sinal : t.vehicle.mainStatus[f]}</button>))}</div>
      <QueryState q={q}>{() => (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <MapView className="h-[60vh] rounded-2xl border border-border lg:col-span-2" fitKey={filter + located.length} fitTo={located.map((v) => [v.lng!, v.lat!] as LngLat)}
            onVehicleClick={setSel}
            state={{ vehicles: located.map((v) => { const f = freshnessOf(v.last_position_at, now); return { id: v.id, lng: v.lng!, lat: v.lat!, heading: v.heading, tone: vehicleTone(v.main_status, f), label: v.plate,
              sublabel: f === 'sem_sinal' ? t.freshness.sem_sinal : v.speed_kmh != null && v.main_status === 'em_viagem' ? `${Math.round(v.speed_kmh)} km/h` : undefined }; }) }} />
          <div className="space-y-3">
            {selected ? (
              <Card title={selected.plate} action={<Badge tone={selected.main_status === 'em_viagem' ? 'success' : 'muted'}>{t.vehicle.mainStatus[selected.main_status]}</Badge>}>
                <FreshnessLine at={selected.last_position_at} source={selected.last_source} now={now} />
                {selected.active_trip_id && <div className="mt-3 space-y-1 text-sm">
                  <p><Link className="font-semibold text-primary" to={`/app/trips/${selected.active_trip_id}`}>{selected.active_trip_code}</Link> · {selected.driver}</p>
                  <p>{selected.current_label ?? t.common.noData}</p>
                  <p>{t.trip.remaining}: {formatKm(selected.km_left)}</p>
                  <p>{t.trip.eta}: <Eta eta={selected.eta_destination} confidence={selected.eta_confidence} /></p>
                  {selected.speed_kmh != null && <p>{t.strip.speed}: <b>{Math.round(selected.speed_kmh)} km/h</b>{selected.road_name ? ` · ${selected.road_name}` : ''} · {selected.speed_limit_kmh != null ? t.strip.limit(selected.speed_limit_kmh) : t.strip.limitUnknown}</p>}
                  {(() => { const st = stripFromLive(selected); return st ? <div className="pt-2"><RouteStrip {...st} showEta={false} /></div> : null; })()}</div>}
              </Card>
            ) : <Card><p className="text-sm text-muted">{t.liveMap.select}</p></Card>}
            <Card className="max-h-[40vh] overflow-y-auto p-0">
              {list.length === 0 ? <p className="p-4 text-sm text-muted">{t.liveMap.noVehicles}</p> : <ul>{list.map((v) => (
                <li key={v.id}><button onClick={() => setSel(v.id)} className={cn('w-full border-b border-border px-4 py-3 text-left hover:bg-slate-50', sel === v.id && 'bg-primary-soft')}>
                  <p className="font-semibold">{v.plate}</p><FreshnessLine at={v.last_position_at} source={v.last_source} now={now} /></button></li>))}</ul>}
            </Card>
          </div>
        </div>
      )}</QueryState>
    </div>
  );
}
