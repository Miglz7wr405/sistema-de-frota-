import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, errorMessage, fileToUpload } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Field, Input, Select } from '@/components/ui';
import { toE164 } from '@/lib/format';

const Schema = z.object({ full_name: z.string().trim().min(2, t.validation.name), phone: z.string().refine((v) => !!toE164(v), t.validation.phone),
  license_number: z.string().optional(), license_category: z.string().optional(), status: z.string() });

export function DriverForm({ initial, onDone }: { initial?: Record<string, any>; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const f = useForm<z.infer<typeof Schema>>({ resolver: zodResolver(Schema), defaultValues: { full_name: initial?.full_name ?? '', phone: initial?.phone ?? '',
    license_number: initial?.license_number ?? '', license_category: initial?.license_category ?? '', status: initial?.status ?? 'ativo' } });
  const submit = f.handleSubmit(async (v) => {
    try {
      const photo_file_id = photo ? (await api<{ id: string }>('/api/files', { body: { kind: 'driver_photo', ...(await fileToUpload(photo)) } })).id : undefined;
      const body = { full_name: v.full_name, phone: toE164(v.phone), license_number: v.license_number || null, license_category: v.license_category || null, status: v.status, ...(photo_file_id ? { photo_file_id } : {}) };
      if (initial) await api(`/api/drivers/${initial.id}`, { method: 'PATCH', body }); else await api('/api/drivers', { body });
      onDone();
    } catch (e) { setErr(errorMessage(e)); }
  });
  const e = f.formState.errors;
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <Field label={t.driver.fullName} error={e.full_name?.message}><Input {...f.register('full_name')} /></Field>
      <Field label={t.driver.phone} error={e.phone?.message}><Input type="tel" placeholder="+258 84 123 4567" {...f.register('phone')} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label={t.driver.licenseNumber}><Input {...f.register('license_number')} /></Field><Field label={t.driver.licenseCategory}><Input {...f.register('license_category')} /></Field></div>
      <Field label={t.driver.status}><Select {...f.register('status')}><option value="ativo">{t.driver.statuses.ativo}</option><option value="inativo">{t.driver.statuses.inativo}</option></Select></Field>
      <Field label={t.vehicle.photo}><Input type="file" accept="image/*" onChange={(ev) => setPhoto(ev.target.files?.[0] ?? null)} /></Field>
      <div className="flex justify-end"><Button type="submit" loading={f.formState.isSubmitting}>{t.common.save}</Button></div>
    </form>
  );
}
