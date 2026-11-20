import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, errorMessage, fileToUpload } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';

const num = z.string().optional().refine((v) => !v || Number.isFinite(Number(v.replace(',', '.'))), t.validation.positive);
const Schema = z.object({ plate: z.string().trim().min(3, t.validation.plate), make: z.string().optional(), model: z.string().optional(), year: num,
  body_type: z.string(), capacity_t: num, gross_weight_t: num, length_m: num, width_m: num, height_m: num, axles: num, odometer_km: num,
  admin_status: z.string(), gps_source_priority: z.string(), notes: z.string().optional() });
type F = z.infer<typeof Schema>;
const N = (v?: string) => (v ? Number(v.replace(',', '.')) : null);

export function VehicleForm({ initial, onDone }: { initial?: Record<string, any>; onDone: (id: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const s = (k: string) => (initial?.[k] != null ? String(initial[k]) : '');
  const f = useForm<F>({ resolver: zodResolver(Schema), defaultValues: { plate: s('plate'), make: s('make'), model: s('model'), year: s('year'), body_type: initial?.body_type ?? 'rigido',
    capacity_t: s('capacity_t'), gross_weight_t: s('gross_weight_t'), length_m: s('length_m'), width_m: s('width_m'), height_m: s('height_m'), axles: s('axles'),
    odometer_km: s('odometer_km'), admin_status: initial?.admin_status ?? 'ativo', gps_source_priority: initial?.gps_source_priority ?? 'phone', notes: s('notes') } });
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const photo_file_id = photo ? (await api<{ id: string }>('/api/files', { body: { kind: 'vehicle_photo', ...(await fileToUpload(photo)) } })).id : undefined;
      const body = { plate: v.plate, make: v.make || null, model: v.model || null, year: N(v.year), body_type: v.body_type, capacity_t: N(v.capacity_t), gross_weight_t: N(v.gross_weight_t),
        length_m: N(v.length_m), width_m: N(v.width_m), height_m: N(v.height_m), axles: N(v.axles), odometer_km: N(v.odometer_km), admin_status: v.admin_status,
        gps_source_priority: v.gps_source_priority, notes: v.notes || null, ...(photo_file_id ? { photo_file_id } : {}) };
      const r = initial ? await api<{ id: string }>(`/api/vehicles/${initial.id}`, { method: 'PATCH', body }) : await api<{ id: string }>('/api/vehicles', { body });
      onDone(r.id);
    } catch (e) { setErr(errorMessage(e)); }
  });
  const e = f.formState.errors;
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t.vehicle.plate} error={e.plate?.message}><Input {...f.register('plate')} placeholder="ADF 512 MP" /></Field>
        <Field label={t.vehicle.make}><Input {...f.register('make')} /></Field>
        <Field label={t.vehicle.model}><Input {...f.register('model')} /></Field>
      </div>
      {/* Só a matrícula é obrigatória; o resto é opcional e fica fechado (direto ao ponto). */}
      <details className="rounded-xl border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-primary">{t.common.moreDetails}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label={t.vehicle.year} error={e.year?.message}><Input inputMode="numeric" {...f.register('year')} /></Field>
        <Field label={t.vehicle.bodyType}><Select {...f.register('body_type')}>{Object.entries(t.vehicle.bodyTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label={t.vehicle.axles} error={e.axles?.message}><Input inputMode="numeric" {...f.register('axles')} /></Field>
        <Field label={t.vehicle.capacity} error={e.capacity_t?.message}><Input inputMode="decimal" {...f.register('capacity_t')} /></Field>
        <Field label={t.vehicle.grossWeight} error={e.gross_weight_t?.message}><Input inputMode="decimal" {...f.register('gross_weight_t')} /></Field>
        <Field label={t.vehicle.odometer} error={e.odometer_km?.message}><Input inputMode="decimal" {...f.register('odometer_km')} /></Field>
        <Field label={t.vehicle.length}><Input inputMode="decimal" {...f.register('length_m')} /></Field>
        <Field label={t.vehicle.width}><Input inputMode="decimal" {...f.register('width_m')} /></Field>
        <Field label={t.vehicle.height}><Input inputMode="decimal" {...f.register('height_m')} /></Field>
        <Field label={t.vehicle.adminStatus}><Select {...f.register('admin_status')}>{Object.entries(t.vehicle.adminStatuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label={t.vehicle.gpsPriority}><Select {...f.register('gps_source_priority')}><option value="device">{t.vehicle.sources.device}</option><option value="phone">{t.vehicle.sources.phone}</option></Select></Field>
        <Field label={t.vehicle.photo}><Input type="file" accept="image/*" onChange={(ev) => setPhoto(ev.target.files?.[0] ?? null)} /></Field>
      </div>
      <Field label={t.common.notes}><Textarea {...f.register('notes')} /></Field>
      </details>
      <div className="flex justify-end"><Button type="submit" loading={f.formState.isSubmitting}>{t.common.save}</Button></div>
    </form>
  );
}
