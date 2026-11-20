import { TripLink } from './TripLink';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card, Input, PageHeader, ProgressBar, QueryState, Select } from '@/components/ui';
import { useRole } from '@/app/session';
import { formatDateTime, freshnessOf } from '@/lib/format';
import { Eta, TripStatus } from '../shared';

type Row = { id: string; code: string; status: string; origin: string; destination: string; plate: string | null; driver: string | null; pct: number | null;
  eta_destination: string | null; eta_confidence: string | null; is_late: boolean; planned_departure: string | null; actual_departure: string | null; actual_arrival: string | null;
  recipient_name: string | null; cargo_description?: string | null; driver_user_id?: string | null; last_position_at: string | null };

export default function TripsList() {
  const { canWrite } = useRole();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(new Date(to).getTime() + 864e5).toISOString());
  const query = useQuery({ queryKey: ['trips', params.toString()], queryFn: () => api<Row[]>(`/api/trips?${params}`), refetchInterval: 20_000 });
  return (
    <div>
      <PageHeader title={t.trip.title} actions={canWrite && <Link to="/app/trips/new"><Button><Plus className="h-4 w-4" />{t.trip.new}</Button></Link>} />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="relative sm:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><Input className="pl-9" placeholder={t.trip.filters.search} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.trip.filters.status}>
            <option value="">{t.common.all}</option>
            {Object.entries(t.trip.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <div className="flex gap-2"><Input type="date" aria-label={t.common.from} value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" aria-label={t.common.to} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </Card>
      <QueryState q={query} empty={(d) => d.length === 0}>{(rows) => (
        <div className="card overflow-x-auto"><table className="w-full min-w-[820px]">
          <thead><tr><th className="table-th">{t.trip.code}</th><th className="table-th">{t.trip.route}</th><th className="table-th">{t.trip.vehicleDriver}</th><th className="table-th">{t.trip.plannedDeparture}</th><th className="table-th">{t.trip.progress}</th><th className="table-th">{t.trip.arrival}</th><th className="table-th">{t.trip.status}</th></tr></thead>
          <tbody>{rows.map((r) => {
            const active = r.status === 'em_viagem' || r.status === 'pausada';
            const noSig = active && freshnessOf(r.last_position_at) === 'sem_sinal';
            return (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="table-td"><TripLink className="font-semibold text-primary" id={r.id} status={r.status} driverUserId={r.driver_user_id}>{r.code}</TripLink></td>
                <td className="table-td">{r.origin} → {r.destination}{(r.cargo_description || r.recipient_name) && <div className="text-xs text-muted">{[r.cargo_description, r.recipient_name].filter(Boolean).join(' · ')}</div>}</td>
                <td className="table-td">{r.plate ?? '—'} · {r.driver ?? '—'}</td>
                <td className="table-td text-sm">{formatDateTime(r.actual_departure ?? r.planned_departure)}</td>
                <td className="table-td">{active && r.pct != null ? <div className="flex items-center gap-2"><div className="w-24"><ProgressBar pct={r.pct} /></div><span className="text-xs">{Math.round(r.pct)}%</span></div> : r.status === 'concluida' ? '100%' : '—'}</td>
                <td className="table-td text-sm">{r.status === 'concluida' ? formatDateTime(r.actual_arrival) : active ? <Eta eta={r.eta_destination} confidence={noSig ? 'indisponivel' : r.eta_confidence} /> : formatDateTime(null)}</td>
                <td className="table-td"><TripStatus status={r.status} late={r.is_late} noSignal={noSig} /></td>
              </tr>);
          })}</tbody></table></div>
      )}</QueryState>
    </div>
  );
}
