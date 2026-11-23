import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Field, Input, Modal, PageHeader, QueryState, Select } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/format';
import { PaymentsPanel } from './Payments';

export default function Platform() {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['platform-orgs'], queryFn: () => api<any[]>('/api/platform/orgs') });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<any[]>('/api/platform/plans') });
  const [sup, setSup] = useState<{ id: string; reason: string; hours: number } | null>(null);
  const setPlan = useMutation({ mutationFn: (v: { id: string; plan: string; status: string }) => api(`/api/platform/orgs/${v.id}/plan`, { body: { plan: v.plan, status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-orgs'] }) });
  const support = useMutation({ mutationFn: () => api(`/api/platform/orgs/${sup!.id}/support`, { body: { reason: sup!.reason, hours: sup!.hours } }), onSuccess: () => setSup(null) });
  return (
    <div>
      <PageHeader title={t.platform.title} subtitle={t.platform.orgs} />
      <div className="mb-6"><PaymentsPanel /></div>
      <QueryState q={orgs}>{(rows) => (
        <div className="card overflow-x-auto"><table className="w-full min-w-[900px]">
          <thead><tr><th className="table-th">{t.auth.orgName}</th><th className="table-th">{t.settings.plan}</th><th className="table-th">{t.settings.members}</th><th className="table-th">{t.vehicle.title}</th><th className="table-th">{t.trip.title} 30d</th><th className="table-th">{t.settings.positions}</th><th className="table-th" /></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}><td className="table-td">{o.name}<br /><span className="text-xs text-muted">{formatDate(o.created_at)}</span></td>
              <td className="table-td"><div className="flex gap-1"><Select className="w-28" value={o.plan_code ?? ''} onChange={(e) => setPlan.mutate({ id: o.id, plan: e.target.value, status: o.sub_status ?? 'trial' })}>{plans.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select>
                <Select className="w-28" value={o.sub_status ?? 'trial'} onChange={(e) => setPlan.mutate({ id: o.id, plan: o.plan_code, status: e.target.value })}>{['trial', 'active', 'past_due', 'canceled'].map((s) => <option key={s}>{s}</option>)}</Select></div></td>
              <td className="table-td">{o.members}</td><td className="table-td">{o.vehicles}</td><td className="table-td">{o.trips_30d}</td><td className="table-td">{formatNumber(Number(o.positions_month))}</td>
              <td className="table-td"><Button size="sm" variant="secondary" onClick={() => setSup({ id: o.id, reason: '', hours: 1 })}>{t.platform.support}</Button></td></tr>))}</tbody></table></div>
      )}</QueryState>
      <Modal open={!!sup} onClose={() => setSup(null)} title={t.platform.support}>
        {sup && <div className="space-y-3">
          <Field label={t.platform.reason}><Input value={sup.reason} onChange={(e) => setSup({ ...sup, reason: e.target.value })} /></Field>
          <Field label={t.platform.hours}><Select value={sup.hours} onChange={(e) => setSup({ ...sup, hours: Number(e.target.value) })}><option value={1}>1</option><option value={2}>2</option></Select></Field>
          {support.isError && <p className="text-sm text-danger">{errorMessage(support.error)}</p>}
          <Button disabled={sup.reason.length < 5} loading={support.isPending} onClick={() => support.mutate()}>{t.common.confirm}</Button></div>}
      </Modal>
    </div>
  );
}
