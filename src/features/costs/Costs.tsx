import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, fileToUpload } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Field, Input, Modal, PageHeader, QueryState, Select } from '@/components/ui';
import { useRole } from '@/app/session';
import { formatDate, formatKm, formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';

type Tab = 'fuel' | 'maintenance-records' | 'maintenance-schedules' | 'expenses';
const TABS: [Tab, string][] = [['fuel', t.costs.fuel], ['maintenance-records', t.costs.maintenance], ['maintenance-schedules', t.costs.schedules], ['expenses', t.costs.expenses]];
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function Costs() {
  const qc = useQueryClient();
  const { canWrite, canAdmin } = useRole();
  const [tab, setTab] = useState<Tab>('fuel');
  const [vehicleId, setVehicleId] = useState('');
  const [open, setOpen] = useState(false);
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => api<{ id: string; plate: string }[]>('/api/vehicles') });
  const q = useQuery({ queryKey: ['costs', tab, vehicleId], queryFn: () => api<any[]>(`/api/${tab}${vehicleId ? `?vehicleId=${vehicleId}` : ''}`) });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/${tab}/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['costs'] }) });
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return (
    <div>
      <PageHeader title={t.costs.title} actions={canWrite && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t.common.add}</Button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cn('rounded-full border px-4 py-1.5 text-sm', tab === k ? 'border-navy bg-navy text-white' : 'border-border bg-white')}>{l}</button>)}</div>
        <Select className="sm:w-56" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">{t.common.all}</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}</Select>
      </div>
      <QueryState q={q} empty={(d) => d.length === 0}>{(rows) => (
        <div className="card overflow-x-auto"><table className="w-full min-w-[720px]">
          <thead><tr>{tab === 'fuel' && <><th className="table-th">{t.costs.date}</th><th className="table-th">{t.trip.vehicle}</th><th className="table-th">{t.costs.liters}</th><th className="table-th">{t.costs.odometer}</th><th className="table-th">{t.costs.consumption}</th><th className="table-th">{t.costs.station}</th><th className="table-th">{t.costs.amount}</th></>}
            {tab === 'maintenance-records' && <><th className="table-th">{t.costs.date}</th><th className="table-th">{t.trip.vehicle}</th><th className="table-th">{t.costs.kind}</th><th className="table-th">{t.costs.workshop}</th><th className="table-th">{t.costs.odometer}</th><th className="table-th">{t.costs.amount}</th></>}
            {tab === 'maintenance-schedules' && <><th className="table-th">{t.trip.vehicle}</th><th className="table-th">{t.costs.kind}</th><th className="table-th">{t.costs.everyKm}</th><th className="table-th">{t.costs.everyDays}</th><th className="table-th">{t.costs.lastDone}</th><th className="table-th">{t.costs.nextDue}</th></>}
            {tab === 'expenses' && <><th className="table-th">{t.costs.date}</th><th className="table-th">{t.trip.code}</th><th className="table-th">{t.costs.category}</th><th className="table-th">{t.common.notes}</th><th className="table-th">{t.costs.amount}</th></>}
            <th className="table-th" /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              {tab === 'fuel' && <><td className="table-td">{formatDate(r.filled_at)}</td><td className="table-td">{r.plate}</td><td className="table-td">{Number(r.liters).toFixed(1)} L{r.full_tank ? '' : ' *'}</td><td className="table-td">{formatKm(r.odometer_km != null ? Number(r.odometer_km) : null)}</td>
                <td className="table-td">{r.l_per_100km != null ? `${String(r.l_per_100km).replace('.', ',')} ${t.costs.per100}` : '—'}</td><td className="table-td">{r.station ?? '—'}</td><td className="table-td font-medium">{formatMoney(r.amount, r.currency)}</td></>}
              {tab === 'maintenance-records' && <><td className="table-td">{formatDate(r.done_at)}</td><td className="table-td">{r.plate}</td><td className="table-td">{r.kind}</td><td className="table-td">{r.workshop ?? '—'}</td><td className="table-td">{formatKm(r.odometer_km != null ? Number(r.odometer_km) : null)}</td><td className="table-td font-medium">{formatMoney(r.amount, r.currency)}</td></>}
              {tab === 'maintenance-schedules' && <><td className="table-td">{r.plate}</td><td className="table-td">{r.kind}</td><td className="table-td">{r.every_km ? formatKm(Number(r.every_km)) : '—'}</td><td className="table-td">{r.every_days ?? '—'}</td><td className="table-td">{formatDate(r.last_done_at)}{r.last_done_km ? ` · ${formatKm(Number(r.last_done_km))}` : ''}</td><td className="table-td">{formatDate(r.next_due_at)}{r.next_due_km ? ` · ${formatKm(Number(r.next_due_km))}` : ''}</td></>}
              {tab === 'expenses' && <><td className="table-td">{formatDate(r.spent_at)}</td><td className="table-td">{r.trip_code}</td><td className="table-td">{t.costs.categories[r.category]}{r.driver_name ? ` · ${r.driver_name}` : ''}</td><td className="table-td">{r.note ?? ''}{r.receipt_file_id && <> · <a className="text-primary" href={`/api/files/${r.receipt_file_id}`} target="_blank" rel="noreferrer">{t.costs.receipt}</a></>}</td><td className="table-td font-medium">{formatMoney(r.amount, r.currency)}</td></>}
              <td className="table-td">{canAdmin && <button aria-label={t.common.delete} onClick={() => confirm(t.common.delete + '?') && del.mutate(r.id)}><Trash2 className="h-4 w-4 text-muted" /></button>}</td>
            </tr>))}
            {tab !== 'maintenance-schedules' && <tr><td className="table-td font-semibold" colSpan={tab === 'fuel' ? 6 : tab === 'expenses' ? 4 : 5}>{t.costs.total}</td><td className="table-td font-bold">{formatMoney(total)}</td><td className="table-td" /></tr>}
          </tbody></table></div>
      )}</QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title={TABS.find((x) => x[0] === tab)![1]}><CostForm tab={tab} vehicles={vehicles.data ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['costs'] }); }} /></Modal>
    </div>
  );
}

function CostForm({ tab, vehicles, onDone }: { tab: Tab; vehicles: { id: string; plate: string }[]; onDone: () => void }) {
  const [v, setV] = useState<Record<string, string | boolean>>({ vehicle_id: vehicles[0]?.id ?? '', filled_at: nowLocal(), done_at: nowLocal().slice(0, 10), full_tank: true, category: 'portagem' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const trips = useQuery({ queryKey: ['trips', 'for-expenses'], queryFn: () => api<{ id: string; code: string; origin: string; destination: string }[]>('/api/trips'), enabled: tab === 'expenses' });
  const n = (k: string) => (v[k] ? Number(String(v[k]).replace(',', '.')) : null);
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () => {
      const receipt_file_id = file ? (await api<{ id: string }>('/api/files', { body: { kind: 'receipt', ...(await fileToUpload(file)) } })).id : null;
      const body = tab === 'fuel' ? { vehicle_id: v.vehicle_id, filled_at: new Date(String(v.filled_at)).toISOString(), liters: n('liters'), amount: n('amount'), odometer_km: n('odometer_km'), station: v.station || null, full_tank: !!v.full_tank, receipt_file_id }
        : tab === 'maintenance-records' ? { vehicle_id: v.vehicle_id, kind: v.kind, done_at: v.done_at, amount: n('amount') ?? 0, odometer_km: n('odometer_km'), workshop: v.workshop || null, receipt_file_id }
        : tab === 'maintenance-schedules' ? { vehicle_id: v.vehicle_id, kind: v.kind, every_km: n('every_km'), every_days: n('every_days'), last_done_at: v.done_at || null, last_done_km: n('odometer_km') }
        : { trip_id: v.trip_id, category: v.category, amount: n('amount'), note: v.note || null, receipt_file_id };
      return api(`/api/${tab}`, { body });
    },
    onSuccess: onDone, onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      {err && <p className="text-sm text-danger">{err}</p>}
      {tab !== 'expenses' && <Field label={t.trip.vehicle}><Select value={String(v.vehicle_id)} onChange={set('vehicle_id')}>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.plate}</option>)}</Select></Field>}
      {tab === 'fuel' && <>
        <Field label={t.costs.date}><Input type="datetime-local" value={String(v.filled_at)} onChange={set('filled_at')} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label={t.costs.liters}><Input inputMode="decimal" onChange={set('liters')} /></Field><Field label={`${t.costs.amount} (MZN)`}><Input inputMode="decimal" onChange={set('amount')} /></Field>
          <Field label={t.costs.odometer}><Input inputMode="decimal" onChange={set('odometer_km')} /></Field><Field label={t.costs.station}><Input onChange={set('station')} /></Field></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.full_tank} onChange={(e) => setV({ ...v, full_tank: e.target.checked })} />{t.costs.fullTank}</label></>}
      {(tab === 'maintenance-records' || tab === 'maintenance-schedules') && <>
        <Field label={t.costs.kind}><Input onChange={set('kind')} placeholder="Troca de óleo" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label={tab === 'maintenance-records' ? t.costs.date : t.costs.lastDone}><Input type="date" value={String(v.done_at)} onChange={set('done_at')} /></Field>
          <Field label={t.costs.odometer}><Input inputMode="decimal" onChange={set('odometer_km')} /></Field>
          {tab === 'maintenance-records' ? <><Field label={t.costs.workshop}><Input onChange={set('workshop')} /></Field><Field label={`${t.costs.amount} (MZN)`}><Input inputMode="decimal" onChange={set('amount')} /></Field></>
            : <><Field label={t.costs.everyKm}><Input inputMode="numeric" onChange={set('every_km')} /></Field><Field label={t.costs.everyDays}><Input inputMode="numeric" onChange={set('every_days')} /></Field></>}</div></>}
      {tab === 'expenses' && <>
        <Field label={t.trip.code}><Select value={String(v.trip_id ?? '')} onChange={set('trip_id')}><option value="">—</option>{trips.data?.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.origin} → {x.destination}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label={t.costs.category}><Select value={String(v.category)} onChange={set('category')}>{Object.entries(t.costs.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label={`${t.costs.amount} (MZN)`}><Input inputMode="decimal" onChange={set('amount')} /></Field></div>
        <Field label={t.common.notes}><Input onChange={set('note')} /></Field></>}
      {tab !== 'maintenance-schedules' && <Field label={`${t.costs.receipt} (${t.common.optional})`}><Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></div>
    </div>
  );
}
