import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, PageHeader, QueryState, Select } from '@/components/ui';
import { useRole } from '@/app/session';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function Alerts() {
  const qc = useQueryClient();
  const { canWrite, canAdmin } = useRole();
  const [status, setStatus] = useState('aberto');
  const q = useQuery({ queryKey: ['alerts', status], queryFn: () => api<any[]>(`/api/alerts?status=${status}`), refetchInterval: 20_000 });
  const rules = useQuery({ queryKey: ['alert-rules'], queryFn: () => api<any[]>('/api/alert-rules') });
  const act = useMutation({ mutationFn: (v: { id: string; a: string }) => api(`/api/alerts/${v.id}/${v.a}`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }) });
  const rule = useMutation({ mutationFn: (v: { id: string; body: unknown }) => api(`/api/alert-rules/${v.id}`, { method: 'PATCH', body: v.body }), onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }) });
  const markRead = useMutation({ mutationFn: () => api('/api/notifications/read', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <div>
      <PageHeader title={t.alerts.title} actions={<><PushToggle /><Button variant="secondary" onClick={() => markRead.mutate()}>✓</Button></>} />
      <div className="mb-4 flex gap-2">{(['aberto', 'reconhecido', 'resolvido', 'todos'] as const).map((s) => (
        <button key={s} onClick={() => setStatus(s)} className={cn('rounded-full border px-4 py-1.5 text-sm', status === s ? 'border-navy bg-navy text-white' : 'border-border bg-white')}>{s === 'todos' ? t.common.all : t.alerts.statuses[s]}</button>))}</div>
      <QueryState q={q} empty={(d) => d.length === 0}>{(rows) => (
        <ul className="space-y-2">{rows.map((a) => (
          <li key={a.id} className={cn('card flex flex-col gap-2 p-4 sm:flex-row sm:items-center', a.severity === 'alta' && a.status === 'aberto' && 'border-danger/40')}>
            <div className="flex-1">
              <p className="font-semibold">{a.title} <Badge tone={a.severity === 'alta' ? 'danger' : a.severity === 'media' ? 'warning' : 'muted'}>{t.alerts.kinds[a.kind] ?? a.kind}</Badge></p>
              {a.detail && <p className="text-sm text-muted">{a.detail}</p>}
              <p className="text-xs text-muted">{formatDateTime(a.opened_at)} · {t.alerts.statuses[a.status]}{a.trip_code && <> · <Link className="text-primary" to={`/app/trips/${a.trip_id}`}>{a.trip_code}</Link></>}</p>
            </div>
            {canWrite && a.status !== 'resolvido' && <div className="flex gap-2">
              {a.status === 'aberto' && <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: a.id, a: 'ack' })}>{t.alerts.ack}</Button>}
              <Button size="sm" onClick={() => act.mutate({ id: a.id, a: 'resolve' })}>{t.alerts.resolve}</Button></div>}
          </li>))}</ul>
      )}</QueryState>
      <Card className="mt-6" title={t.alerts.rules}>
        <QueryState q={rules}>{(rs) => (
          <ul className="divide-y divide-border">{rs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <label className="flex flex-1 items-center gap-2"><input type="checkbox" disabled={!canAdmin} checked={r.enabled} onChange={(e) => rule.mutate({ id: r.id, body: { enabled: e.target.checked } })} />{t.alerts.kinds[r.kind]}</label>
              <span className="text-xs text-muted">{Object.entries(r.params).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`).join(' · ')}</span>
              <Select className="w-28" disabled={!canAdmin} value={r.severity} onChange={(e) => rule.mutate({ id: r.id, body: { severity: e.target.value } })}>{Object.entries(t.alerts.severity).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            </li>))}</ul>
        )}</QueryState>
      </Card>
    </div>
  );
}

function PushToggle() {
  const cfg = useQuery({ queryKey: ['push-config'], queryFn: () => api<{ configured: boolean; publicKey: string | null }>('/api/push/config') });
  const [state, setState] = useState<'idle' | 'on' | 'err'>('idle');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return <span className="text-xs text-muted">{t.alerts.pushUnsupported}</span>;
  if (cfg.data && !cfg.data.configured) return <span className="text-xs text-muted">{t.alerts.pushUnconfigured}</span>;
  const enable = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: '/app/' });
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('perm');
      const key = Uint8Array.from(atob(cfg.data!.publicKey!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/api/push/subscribe', { body: sub.toJSON() });
      setState('on');
    } catch { setState('err'); }
  };
  return state === 'on' ? <Badge tone="success">{t.alerts.pushOn}</Badge> : <Button variant="secondary" onClick={enable}>{t.alerts.pushEnable}</Button>;
}
