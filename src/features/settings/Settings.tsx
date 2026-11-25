import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2 } from 'lucide-react';
import { api, errorMessage, fileToUpload } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, Field, Input, PageHeader, QueryState, Select } from '@/components/ui';
import { useRole } from '@/app/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { MapView } from '@/lib/map/MapView';
import type { LngLat } from '@/lib/map/types';

export default function Settings() {
  const qc = useQueryClient();
  const { canAdmin, isOwner, canWrite } = useRole();
  const org = useQuery({ queryKey: ['org'], queryFn: () => api<any>('/api/org') });
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<any>('/api/org/members') });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api<any[]>('/api/org/audit'), enabled: canAdmin });
  const places = useQuery({ queryKey: ['private-places'], queryFn: () => api<any[]>('/api/places/private') });
  const geo = useQuery({ queryKey: ['places-status'], queryFn: () => api<any>('/api/places/status') });
  const [form, setForm] = useState<Record<string, any>>({});
  const [inv, setInv] = useState({ email: '', role: 'dispatcher' });
  const [invLink, setInvLink] = useState<string | null>(null);
  const [pl, setPl] = useState<{ name: string; kind: string; at: LngLat | null }>({ name: '', kind: 'warehouse', at: null });
  useEffect(() => { if (org.data) setForm({ name: org.data.org.name, public_name: org.data.org.public_name ?? '', ...org.data.org.settings }); }, [org.data]);
  const inval = () => qc.invalidateQueries();
  const saveOrg = useMutation({ mutationFn: (logo?: File | null) => (async () => {
    const logo_file_id = logo ? (await api<{ id: string }>('/api/files', { body: { kind: 'logo', ...(await fileToUpload(logo, 400)) } })).id : undefined;
    const s = org.data.org.settings;
    const settings = Object.fromEntries(Object.keys(s).map((k) => [k, Array.isArray(s[k]) ? String(form[k]).split(/[,/ ]+/).filter(Boolean).map(Number) : Number(form[k])]));
    return api('/api/org', { method: 'PATCH', body: { name: form.name, public_name: form.public_name || null, settings, ...(logo_file_id ? { logo_file_id } : {}) } });
  })(), onSuccess: inval });
  const invite = useMutation({ mutationFn: () => api<{ link: string }>('/api/org/invites', { body: inv }), onSuccess: (r) => { setInvLink(r.link); inval(); } });
  const role = useMutation({ mutationFn: (v: { id: string; role: string }) => api(`/api/org/members/${v.id}`, { method: 'PATCH', body: { role: v.role } }), onSuccess: inval, onError: (e) => alert(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/org/members/${id}`, { method: 'DELETE' }), onSuccess: inval, onError: (e) => alert(errorMessage(e)) });
  const addPlace = useMutation({ mutationFn: () => api('/api/places', { body: { name: pl.name, kind: pl.kind, lng: pl.at![0], lat: pl.at![1] } }), onSuccess: () => { setPl({ name: '', kind: 'warehouse', at: null }); inval(); } });
  const delPlace = useMutation({ mutationFn: (id: string) => api(`/api/places/${id}`, { method: 'DELETE' }), onSuccess: inval });
  const LABELS = t.settings.labels;
  return (
    <div className="space-y-4">
      <PageHeader title={t.settings.title} />
      <QueryState q={org}>{(o) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t.settings.org}>
            <div className="space-y-3">
              <Field label={t.auth.orgName}><Input disabled={!canAdmin} value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label={t.settings.publicName}><Input disabled={!canAdmin} value={form.public_name ?? ''} onChange={(e) => setForm({ ...form, public_name: e.target.value })} /></Field>
              {canAdmin && <Field label={t.settings.logo}><Input type="file" accept="image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && saveOrg.mutate(e.target.files[0])} /></Field>}
              <div className="grid grid-cols-2 gap-3">{Object.keys(o.org.settings).map((k) => (
                <Field key={k} label={LABELS[k] ?? k}><Input disabled={!canAdmin} value={Array.isArray(form[k]) ? form[k].join('/') : form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>))}</div>
              {canAdmin && <Button onClick={() => saveOrg.mutate(null)} loading={saveOrg.isPending}>{t.common.save}</Button>}
              {saveOrg.isError && <p className="text-sm text-danger">{errorMessage(saveOrg.error)}</p>}
            </div>
          </Card>
          <div className="space-y-4">
            {o.subscription && <Card title={t.settings.plan}>
              <p className="font-semibold">{o.subscription.name} <Badge>{o.subscription.status}</Badge></p>
              <p className="mt-1 text-sm text-muted">{Object.entries(o.subscription.limits).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
              <p className="mt-3 text-sm font-medium">{t.settings.usage}</p>
              <p className="text-sm text-muted">{t.settings.positions}: {formatNumber(Number(o.usage?.positions_ingested ?? 0))} · {t.settings.views}: {formatNumber(Number(o.usage?.public_views ?? 0))}</p>
            </Card>}
            <Card title={t.settings.members}>
              <QueryState q={members}>{(m) => (
                <>
                  <ul className="divide-y divide-border">{m.members.map((x: any) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="flex-1">{x.full_name}<br /><span className="text-muted">{x.email}</span></span>
                      {canAdmin ? <Select className="w-48" value={x.role} onChange={(e) => role.mutate({ id: x.id, role: e.target.value })}>{Object.entries(t.roles).filter(([k]) => k !== 'owner' || isOwner).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select> : <Badge>{t.roles[x.role as keyof typeof t.roles]}</Badge>}
                      {canAdmin && <button aria-label={t.settings.remove} onClick={() => confirm(t.settings.remove + '?') && remove.mutate(x.id)}><Trash2 className="h-4 w-4 text-muted" /></button>}</li>))}</ul>
                  {canAdmin && <div className="mt-4 space-y-2 border-t border-border pt-4"><p className="label">{t.settings.invite}</p>
                    <div className="flex flex-wrap gap-2"><Input className="flex-1" type="email" placeholder={t.auth.email} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
                      <Select className="w-48" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{(['admin', 'dispatcher', 'viewer'] as const).map((k) => <option key={k} value={k}>{t.roles[k]}</option>)}</Select>
                      <Button onClick={() => invite.mutate()} loading={invite.isPending}>{t.settings.invite}</Button></div>
                    {invLink && <div className="rounded-lg bg-success-soft p-3 text-sm"><p className="mb-1">{t.settings.inviteHelp}</p><div className="flex gap-2"><code className="flex-1 break-all">{invLink}</code><Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(invLink)}><Copy className="h-4 w-4" /></Button></div></div>}
                    {m.invites.length > 0 && <ul className="text-xs text-muted">{m.invites.map((i: any) => <li key={i.id}>{i.email} · {t.roles[i.role as keyof typeof t.roles]} · {formatDateTime(i.expires_at)}</li>)}</ul>}
                  </div>}
                </>
              )}</QueryState>
            </Card>
          </div>
        </div>
      )}</QueryState>
      <Card title={t.settings.privatePlaces}>
        <p className="mb-2 text-sm text-muted">{geo.data ? t.settings.geoBase(geo.data.public_places, geo.data.provinces) : ''}{geo.data?.datasets?.map((d: any) => t.settings.geoSource(d.name, d.license, formatDateTime(d.retrieved_at)))}</p>
        {canWrite && <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
          <div className="space-y-2"><Input placeholder={t.driver.fullName} value={pl.name} onChange={(e) => setPl({ ...pl, name: e.target.value })} />
            <Select value={pl.kind} onChange={(e) => setPl({ ...pl, kind: e.target.value })}>{Object.entries(t.settings.placeKinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            <p className="text-xs text-muted">{pl.at ? `${pl.at[1].toFixed(5)}, ${pl.at[0].toFixed(5)}` : t.trip.pointOnMap}</p>
            <Button disabled={pl.name.length < 2 || !pl.at} onClick={() => addPlace.mutate()}>{t.common.add}</Button></div>
          <MapView className="h-64 rounded-xl" onClick={(p) => setPl((x) => ({ ...x, at: p }))} state={{ points: [...(pl.at ? [{ id: 'new', lng: pl.at[0], lat: pl.at[1], kind: 'waypoint' as const, label: pl.name }] : []),
            ...(places.data ?? []).map((p) => ({ id: p.id, lng: p.lng, lat: p.lat, kind: 'place' as const, label: p.name }))] }} />
        </div>}
        <ul className="mt-3 divide-y divide-border text-sm">{places.data?.map((p) => <li key={p.id} className="flex justify-between py-1.5">{p.name}{canWrite && <button onClick={() => delPlace.mutate(p.id)}><Trash2 className="h-4 w-4 text-muted" /></button>}</li>)}</ul>
      </Card>
      {canAdmin && <Card title={t.settings.audit}><QueryState q={audit}>{(rows) => (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">{rows.map((a) => <li key={a.id} className="py-1.5"><span className="text-muted">{formatDateTime(a.at)}</span> · {a.actor_name ?? a.actor_type} · {a.action}</li>)}</ul>)}</QueryState></Card>}
    </div>
  );
}
