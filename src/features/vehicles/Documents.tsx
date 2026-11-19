import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, fileToUpload } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, Field, Input, Modal, QueryState, Select } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useRole } from '@/app/session';

type Doc = { id: string; doc_type: string; number: string | null; expires_on: string | null; issued_on: string | null; file_id: string | null; days_left: number | null; state: string };

export function Documents({ vehicleId, driverId }: { vehicleId?: string; driverId?: string }) {
  const qc = useQueryClient();
  const { canWrite, canAdmin } = useRole();
  const key = ['documents', vehicleId ?? driverId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Doc[]>(`/api/documents?${vehicleId ? `vehicleId=${vehicleId}` : `driverId=${driverId}`}`) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ doc_type: driverId ? 'carta_conducao' : 'seguro', number: '', issued_on: '', expires_on: '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let file_id: string | null = null;
      if (file) file_id = (await api<{ id: string }>('/api/files', { body: { kind: 'document', ...(await fileToUpload(file)) } })).id;
      return api('/api/documents', { body: { vehicle_id: vehicleId ?? null, driver_id: driverId ?? null, doc_type: form.doc_type, number: form.number || null,
        issued_on: form.issued_on || null, expires_on: form.expires_on || null, file_id } });
    },
    onSuccess: () => { setOpen(false); setFile(null); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/documents/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  return (
    <Card title={t.docs.title} action={canWrite && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t.docs.add}</Button>}>
      <QueryState q={q}>{(docs) => docs.length === 0 ? <p className="text-sm text-muted">{t.docs.none}</p> : (
        <ul className="divide-y divide-border">{docs.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
            <FileText className="h-4 w-4 text-muted" />
            <div className="flex-1"><p className="font-medium">{t.docs.types[d.doc_type]}{d.number ? ` · ${d.number}` : ''}</p>
              <p className="text-muted">{d.expires_on ? `${t.docs.expires}: ${formatDate(d.expires_on)} (${t.docs.expiresIn(d.days_left!)})` : t.docs.state.sem_validade}</p></div>
            <Badge tone={d.state === 'expirado' ? 'danger' : d.state === 'a_expirar' ? 'warning' : d.state === 'valido' ? 'success' : 'muted'}>{t.docs.state[d.state]}</Badge>
            {d.file_id && <a className="text-primary" href={`/api/files/${d.file_id}`} target="_blank" rel="noreferrer">{t.common.open}</a>}
            {canAdmin && <button aria-label={t.common.delete} onClick={() => confirm(t.common.delete + '?') && del.mutate(d.id)}><Trash2 className="h-4 w-4 text-muted" /></button>}
          </li>))}</ul>
      )}</QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title={t.docs.add}>
        <div className="space-y-3">
          {err && <p className="text-sm text-danger">{err}</p>}
          <Field label={t.docs.type}><Select value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>{Object.entries(t.docs.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label={t.docs.number}><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label={t.docs.issued}><Input type="date" value={form.issued_on} onChange={(e) => setForm({ ...form, issued_on: e.target.value })} /></Field>
            <Field label={t.docs.expires}><Input type="date" value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></Field></div>
          <Field label={`${t.docs.file} (${t.common.optional})`}><Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></div>
        </div>
      </Modal>
    </Card>
  );
}
