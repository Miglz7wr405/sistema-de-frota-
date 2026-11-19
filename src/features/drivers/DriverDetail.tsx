import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit3, KeyRound, MessageCircle, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, QueryState } from '@/components/ui';
import { formatAgo, formatDateTime } from '@/lib/format';
import { useRole } from '@/app/session';
import { TripStatus } from '../shared';
import { DriverForm } from './DriverForm';
import { Documents } from '../vehicles/Documents';

export default function DriverDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { canWrite, canAdmin } = useRole();
  const [edit, setEdit] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['driver', id], queryFn: () => api<any>(`/api/drivers/${id}`) });
  const issue = useMutation({ mutationFn: () => api<{ link: string }>(`/api/drivers/${id}/access`, { body: { pin } }), onSuccess: (r) => { setLink(r.link); setPin(''); qc.invalidateQueries({ queryKey: ['driver', id] }); } });
  const revoke = useMutation({ mutationFn: () => api(`/api/drivers/${id}/access`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['driver', id] }) });
  const del = async () => { if (!confirm(t.driver.deleteConfirm)) return; try { await api(`/api/drivers/${id}`, { method: 'DELETE' }); nav('/app/drivers'); } catch (e) { alert(errorMessage(e)); } };
  return (
    <QueryState q={q}>{(d) => (
      <div>
        <PageHeader back={<Link to="/app/drivers" className="text-sm text-primary">← {t.driver.title}</Link>} title={d.driver.full_name} subtitle={d.driver.phone}
          actions={<>{canWrite && <Button variant="secondary" onClick={() => setEdit(true)}><Edit3 className="h-4 w-4" />{t.common.edit}</Button>}{canAdmin && <Button variant="danger" onClick={del}><Trash2 className="h-4 w-4" /></Button>}</>} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title={t.trip.title}>{d.trips.length === 0 ? <p className="text-sm text-muted">{t.trip.noTrips}</p> : <ul className="divide-y divide-border">{d.trips.map((tr: any) => (
              <li key={tr.id} className="flex items-center justify-between py-2 text-sm"><span><Link className="font-medium text-primary" to={`/app/trips/${tr.id}`}>{tr.code}</Link> · {tr.origin} → {tr.destination} · {tr.plate ?? '—'}<br /><span className="text-muted">{formatDateTime(tr.actual_departure)}</span></span><TripStatus status={tr.status} /></li>))}</ul>}</Card>
            <Documents driverId={id} />
          </div>
          <Card title={t.driver.access}>
            {d.access ? <div className="space-y-1 text-sm"><Badge tone="success">{t.driver.accessActive}</Badge>
              {d.access.last_used_at && <p className="text-muted">{t.driver.accessLastUsed(formatAgo(d.access.last_used_at))}</p>}
              {d.access.locked_until && new Date(d.access.locked_until) > new Date() && <p className="text-danger">{t.driver.locked}</p>}</div>
              : <p className="text-sm text-muted">{t.driver.accessNone}</p>}
            {canAdmin && <div className="mt-4 space-y-2">
              <Button className="w-full" onClick={() => { setLink(null); setPinOpen(true); }}><KeyRound className="h-4 w-4" />{d.access ? t.driver.accessReissue : t.driver.accessIssue}</Button>
              {d.access && <Button variant="danger" className="w-full" onClick={() => revoke.mutate()} loading={revoke.isPending}>{t.driver.accessRevoke}</Button>}</div>}
            <p className="mt-3 text-xs text-muted">{t.driverApp.honesty}</p>
          </Card>
        </div>
        <Modal open={edit} onClose={() => setEdit(false)} title={t.common.edit}><DriverForm initial={d.driver} onDone={() => { setEdit(false); qc.invalidateQueries({ queryKey: ['driver', id] }); }} /></Modal>
        <Modal open={pinOpen} onClose={() => setPinOpen(false)} title={t.driver.accessLinkTitle}>
          {link ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t.driver.accessLinkHelp}</p>
              <div className="flex gap-2"><Input readOnly value={link} /><Button variant="secondary" onClick={() => navigator.clipboard.writeText(link)} aria-label={t.common.copy}><Copy className="h-4 w-4" /></Button></div>
              <a href={`https://wa.me/${d.driver.phone.replace('+', '')}?text=${encodeURIComponent(t.driver.accessWhatsapp(d.driver.full_name, link))}`} target="_blank" rel="noreferrer">
                <Button variant="success" className="w-full"><MessageCircle className="h-4 w-4" />{t.share.whatsapp}</Button></a>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label={t.driver.accessPin} error={pin && !/^\d{4,6}$/.test(pin) ? t.validation.pin : undefined}><Input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
              {issue.isError && <p className="text-sm text-danger">{errorMessage(issue.error)}</p>}
              <Button className="w-full" disabled={!/^\d{4,6}$/.test(pin)} loading={issue.isPending} onClick={() => issue.mutate()}>{t.driver.accessIssue}</Button>
            </div>
          )}
        </Modal>
      </div>
    )}</QueryState>
  );
}
