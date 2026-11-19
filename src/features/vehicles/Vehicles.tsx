import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Input, Modal, PageHeader, QueryState } from '@/components/ui';
import { useRole } from '@/app/session';
import { formatKm, formatMoney, formatDate, freshnessOf } from '@/lib/format';
import { FreshnessLine } from '../shared';
import { VehicleForm } from './VehicleForm';
import { cn } from '@/lib/cn';

type V = { id: string; plate: string; make: string | null; model: string | null; year: number | null; capacity_t: number | null; odometer_km: number | null; main_status: string;
  freshness: string; last_position_at: string | null; last_source: string | null; has_device: boolean; active_driver: string | null; active_route: string | null; last_maintenance: string | null };

export default function Vehicles() {
  const qc = useQueryClient();
  const { canWrite } = useRole();
  const q = useQuery({ queryKey: ['vehicles'], queryFn: () => api<V[]>('/api/vehicles'), refetchInterval: 30_000 });
  const [filter, setFilter] = useState('todos');
  const [s, setS] = useState('');
  const [open, setOpen] = useState(false);
  const all = q.data ?? [];
  const counts = (k: string) => all.filter((v) => v.main_status === k).length;
  const list = all.filter((v) => (filter === 'todos' || v.main_status === filter) && (!s || `${v.plate} ${v.make ?? ''} ${v.model ?? ''} ${v.active_driver ?? ''}`.toLowerCase().includes(s.toLowerCase())));
  return (
    <div>
      <PageHeader title={t.vehicle.title} subtitle={t.vehicle.registered(all.length)} actions={canWrite && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t.vehicle.add}</Button>} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <label className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><Input className="pl-9" placeholder={t.vehicle.searchPh} value={s} onChange={(e) => setS(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">{[['todos', `${t.common.all} · ${all.length}`], ['em_viagem', `${t.vehicle.mainStatus.em_viagem} · ${counts('em_viagem')}`],
          ['disponivel', `${t.dashboard.available} · ${counts('disponivel')}`], ['em_manutencao', `${t.vehicle.mainStatus.em_manutencao} · ${counts('em_manutencao')}`]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k!)} className={cn('rounded-full border px-4 py-2 text-sm', filter === k ? 'border-navy bg-navy text-white' : 'border-border bg-white')}>{l}</button>))}</div>
      </div>
      <QueryState q={q}>{() => (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((v) => {
            const f = freshnessOf(v.last_position_at);
            const [mk, mWorkshop, mDate, mAmount] = (v.last_maintenance ?? '').split('|');
            return (
              <Link key={v.id} to={`/app/vehicles/${v.id}`} className="card block p-5 hover:border-primary">
                <div className="flex items-start justify-between"><div><p className="text-lg font-bold">{v.plate}</p><p className="text-sm text-muted">{[v.make, v.model, v.year, v.capacity_t ? `${v.capacity_t} t` : null].filter(Boolean).join(' · ')}</p></div>
                  <Badge tone={v.main_status === 'em_viagem' ? (f === 'sem_sinal' ? 'danger' : 'success') : v.main_status === 'disponivel' ? 'primary' : v.main_status === 'em_manutencao' ? 'warning' : 'muted'}>
                    {v.main_status === 'em_viagem' && f === 'sem_sinal' ? t.freshness.sem_sinal : t.vehicle.mainStatus[v.main_status]}</Badge></div>
                <dl className="mt-4 space-y-1.5 text-sm">
                  {v.main_status === 'em_manutencao' && mk ? <>
                    <div className="flex justify-between"><dt className="text-muted">{t.costs.kind}</dt><dd className="font-medium">{mk}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t.costs.workshop}</dt><dd className="font-medium">{mWorkshop || '—'} · {formatDate(mDate)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t.costs.amount}</dt><dd className="font-medium">{formatMoney(mAmount)}</dd></div></> : <>
                    <div className="flex justify-between"><dt className="text-muted">{t.vehicle.driver}</dt><dd className="font-medium">{v.active_driver ?? '—'}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t.vehicle.trip}</dt><dd className="font-medium">{v.active_route ?? '—'}</dd></div></>}
                  <div className="flex justify-between"><dt className="text-muted">{t.vehicle.mileage}</dt><dd className="font-medium">{formatKm(v.odometer_km != null ? Number(v.odometer_km) : null)}</dd></div>
                </dl>
                <div className="mt-4 border-t border-border pt-3">{!v.has_device && !v.last_position_at ? <span className="text-sm text-muted">● {t.vehicle.noDevice}</span> : <FreshnessLine at={v.last_position_at} source={v.last_source} />}</div>
              </Link>);
          })}
          {canWrite && <button onClick={() => setOpen(true)} className="flex min-h-[220px] flex-col items-center justify-center rounded-card border-2 border-dashed border-border p-5 text-center hover:border-primary">
            <span className="rounded-lg bg-primary-soft p-3 text-primary"><Plus className="h-6 w-6" /></span><p className="mt-3 font-semibold">{t.vehicle.add}</p><p className="mt-1 text-sm text-muted">{t.vehicle.addHint}</p></button>}
        </div>
      )}</QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title={t.vehicle.add} wide><VehicleForm onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['vehicles'] }); }} /></Modal>
    </div>
  );
}
