import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, QueryState, Select } from '@/components/ui';
import { useRole } from '@/app/session';
import { formatAgo, formatDateTime } from '@/lib/format';
import { toE164 } from '@/lib/format';

export default function Devices() {
  const qc = useQueryClient();
  const { canAdmin } = useRole();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<any[]>('/api/devices') });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => api<{ id: string; plate: string }[]>('/api/vehicles') });
  const keys = useQuery({ queryKey: ['ingest-keys'], queryFn: () => api<any[]>('/api/ingest-keys'), enabled: canAdmin });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ imei: '', model: '', protocol: '', sim_phone: '' });
  const [keyForm, setKeyForm] = useState({ name: '', scope: 'traccar' });
  const [newKey, setNewKey] = useState<string | null>(null);
  const inv = () => { qc.invalidateQueries({ queryKey: ['devices'] }); qc.invalidateQueries({ queryKey: ['ingest-keys'] }); };
  const add = useMutation({ mutationFn: () => api('/api/devices', { body: { imei: form.imei, model: form.model || null, protocol: form.protocol || null, sim_phone: form.sim_phone ? toE164(form.sim_phone) : null } }), onSuccess: () => { setOpen(false); inv(); } });
  const assign = useMutation({ mutationFn: (v: { id: string; vehicleId: string | null }) => api(`/api/devices/${v.id}/assign`, { body: { vehicleId: v.vehicleId } }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/devices/${id}`, { method: 'DELETE' }), onSuccess: inv });
  const mkKey = useMutation({ mutationFn: () => api<{ key: string }>('/api/ingest-keys', { body: keyForm }), onSuccess: (r) => { setNewKey(r.key); inv(); } });
  const revokeKey = useMutation({ mutationFn: (id: string) => api(`/api/ingest-keys/${id}`, { method: 'DELETE' }), onSuccess: inv });
  return (
    <div>
      <PageHeader title={t.devices.title} actions={canAdmin && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t.devices.add}</Button>} />
      <p className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">{t.devices.untested}</p>
      <QueryState q={devices} empty={(d) => d.length === 0}>{(rows) => (
        <div className="card overflow-x-auto"><table className="w-full min-w-[720px]">
          <thead><tr><th className="table-th">{t.devices.imei}</th><th className="table-th">{t.devices.model}</th><th className="table-th">{t.devices.lastContact}</th><th className="table-th">{t.devices.vehicle}</th><th className="table-th" /></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}>
              <td className="table-td font-mono">{d.imei}</td><td className="table-td">{[d.model, d.protocol].filter(Boolean).join(' · ') || '—'}</td>
              <td className="table-td">{d.last_contact_at ? formatAgo(d.last_contact_at) : <span className="text-muted">{t.common.noData}</span>}</td>
              <td className="table-td">{canAdmin ? <Select value={d.vehicle_id ?? ''} onChange={(e) => assign.mutate({ id: d.id, vehicleId: e.target.value || null })}>
                <option value="">—</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}</Select> : d.plate ?? '—'}</td>
              <td className="table-td">{canAdmin && <button aria-label={t.common.delete} onClick={() => confirm(t.common.delete + '?') && del.mutate(d.id)}><Trash2 className="h-4 w-4 text-muted" /></button>}</td>
            </tr>))}</tbody></table></div>
      )}</QueryState>
      {canAdmin && <Card className="mt-6" title={t.devices.keys}>
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_auto]">
          <Input placeholder={t.devices.keyName} value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} />
          <Select value={keyForm.scope} onChange={(e) => setKeyForm({ ...keyForm, scope: e.target.value })}>{Object.entries(t.devices.scopes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Button disabled={keyForm.name.length < 2} loading={mkKey.isPending} onClick={() => mkKey.mutate()}>{t.devices.keyCreate}</Button>
        </div>
        {newKey && <div className="mb-4 rounded-lg bg-success-soft p-3 text-sm"><p className="mb-1 text-success-text">{t.devices.keyOnce}</p><div className="flex gap-2"><code className="flex-1 break-all">{newKey}</code><Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(newKey)}><Copy className="h-4 w-4" /></Button></div></div>}
        <ul className="divide-y divide-border text-sm">{keys.data?.map((k) => (
          <li key={k.id} className="flex items-center justify-between py-2"><span>{k.name} · {t.devices.scopes[k.scope]} · {k.last_used_at ? formatAgo(k.last_used_at) : '—'}</span>
            {k.revoked_at ? <Badge>{t.share.revoked} {formatDateTime(k.revoked_at)}</Badge> : <Button size="sm" variant="danger" onClick={() => revokeKey.mutate(k.id)}>{t.share.revoke}</Button>}</li>))}</ul>
      </Card>}
      <Modal open={open} onClose={() => setOpen(false)} title={t.devices.add}>
        <div className="space-y-3">
          {add.isError && <p className="text-sm text-danger">{errorMessage(add.error)}</p>}
          <Field label={t.devices.imei}><Input inputMode="numeric" value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value.replace(/\D/g, '') })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label={t.devices.model}><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
            <Field label={t.devices.protocol}><Input value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} placeholder="teltonika, gt06…" /></Field></div>
          <Field label={t.devices.sim}><Input type="tel" value={form.sim_phone} onChange={(e) => setForm({ ...form, sim_phone: e.target.value })} /></Field>
          <div className="flex justify-end"><Button disabled={!/^\d{10,20}$/.test(form.imei)} loading={add.isPending} onClick={() => add.mutate()}>{t.common.save}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
