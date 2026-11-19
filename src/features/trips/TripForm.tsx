import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { toE164 } from '@/lib/format';
import { PlacePicker, type PlaceOpt } from './PlacePicker';

const place = z.custom<PlaceOpt | null>((v) => !!v && typeof v === 'object', { message: t.validation.place });
const phone = z.string().optional().refine((v) => !v || !!toE164(v), t.validation.phone);
const Schema = z.object({
  origin: place, destination: place, vehicle_id: z.string().optional(), driver_id: z.string().optional(),
  planned_departure: z.string().optional(), planned_arrival: z.string().optional(),
  cargo_description: z.string().max(500).optional(), cargo_weight_t: z.string().optional(), recipient_name: z.string().max(120).optional(), recipient_phone: phone,
  client_reference: z.string().max(80).optional(), notes: z.string().max(2000).optional(),
  stops: z.array(z.object({ place, kind: z.enum(['entrega', 'recolha', 'passagem']), recipient_name: z.string().optional() })),
}).refine((v) => !v.origin || !v.destination || v.origin.id !== v.destination.id, { message: t.validation.samePlace, path: ['destination'] })
  .refine((v) => !v.planned_departure || !v.planned_arrival || v.planned_arrival > v.planned_departure, { message: t.validation.dates, path: ['planned_arrival'] });
type F = z.infer<typeof Schema>;

const toLocalInput = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function TripForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => api<{ id: string; plate: string; main_status: string }[]>('/api/vehicles') });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: () => api<{ id: string; full_name: string; status: string }[]>('/api/drivers') });
  const existing = useQuery({ queryKey: ['trip', id], queryFn: () => api<{ trip: Record<string, any> }>(`/api/trips/${id}`), enabled: !!id });
  const f = useForm<F>({ resolver: zodResolver(Schema), defaultValues: { origin: null, destination: null, stops: [] } });
  const stops = useFieldArray({ control: f.control, name: 'stops' });
  useEffect(() => {
    const tr = existing.data?.trip;
    if (!tr) return;
    f.reset({
      origin: { id: tr.origin_place_id, name: tr.origin, kind: '', province: null, private: false, lng: tr.origin_lng, lat: tr.origin_lat },
      destination: { id: tr.destination_place_id, name: tr.destination, kind: '', province: null, private: false, lng: tr.dest_lng, lat: tr.dest_lat },
      vehicle_id: tr.vehicle_id ?? '', driver_id: tr.driver_id ?? '', planned_departure: toLocalInput(tr.planned_departure), planned_arrival: toLocalInput(tr.planned_arrival),
      cargo_description: tr.cargo_description ?? '', cargo_weight_t: tr.cargo_weight_t ?? '', recipient_name: tr.recipient_name ?? '', recipient_phone: tr.recipient_phone ?? '',
      client_reference: tr.client_reference ?? '', notes: tr.notes ?? '', stops: [],
    });
  }, [existing.data]);

  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    const body = {
      origin_place_id: v.origin!.id, destination_place_id: v.destination!.id, vehicle_id: v.vehicle_id || null, driver_id: v.driver_id || null,
      planned_departure: v.planned_departure ? new Date(v.planned_departure).toISOString() : null, planned_arrival: v.planned_arrival ? new Date(v.planned_arrival).toISOString() : null,
      cargo_description: v.cargo_description || null, cargo_weight_t: v.cargo_weight_t ? Number(v.cargo_weight_t.replace(',', '.')) : null,
      recipient_name: v.recipient_name || null, recipient_phone: v.recipient_phone ? toE164(v.recipient_phone) : null,
      client_reference: v.client_reference || null, notes: v.notes || null,
    };
    try {
      if (id) { await api(`/api/trips/${id}`, { method: 'PATCH', body }); nav(`/app/trips/${id}`); }
      else {
        const r = await api<{ id: string }>('/api/trips', { body: { ...body, stops: v.stops.map((s) => ({ place_id: s.place!.id, kind: s.kind, recipient_name: s.recipient_name || null })) } });
        nav(`/app/trips/${r.id}`);
      }
    } catch (e) { setErr(errorMessage(e)); }
  });
  if (id && existing.isLoading) return <Spinner />;
  const e = f.formState.errors;
  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={id ? t.trip.edit : t.trip.new} back={<Link to={id ? `/app/trips/${id}` : '/app/trips'} className="text-sm text-primary">← {t.common.back}</Link>} />
      {err && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.trip.route}>
          <div className="space-y-4">
            <Field label={t.trip.origin} error={e.origin?.message as string}><Controller control={f.control} name="origin" render={({ field }) => <PlacePicker value={field.value} onChange={field.onChange} invalid={!!e.origin} />} /></Field>
            {!id && <div>
              <span className="label">{t.trip.stops}</span>
              {stops.fields.map((s, i) => (
                <div key={s.id} className="mb-2 grid grid-cols-[1fr_auto_auto] gap-2">
                  <Controller control={f.control} name={`stops.${i}.place`} render={({ field }) => <PlacePicker value={field.value} onChange={field.onChange} />} />
                  <Select {...f.register(`stops.${i}.kind`)} className="w-32"><option value="passagem">Passagem</option><option value="entrega">Entrega</option><option value="recolha">Recolha</option></Select>
                  <Button type="button" variant="ghost" aria-label={t.common.delete} onClick={() => stops.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>))}
              <Button type="button" variant="secondary" size="sm" onClick={() => stops.append({ place: null, kind: 'passagem' })}><Plus className="h-4 w-4" />{t.trip.addStop}</Button>
            </div>}
            <Field label={t.trip.destination} error={e.destination?.message as string}><Controller control={f.control} name="destination" render={({ field }) => <PlacePicker value={field.value} onChange={field.onChange} invalid={!!e.destination} />} /></Field>
          </div>
        </Card>
        <Card title={`${t.trip.vehicle} · ${t.trip.driver}`}>
          <div className="space-y-4">
            <Field label={t.trip.vehicle}><Select {...f.register('vehicle_id')}><option value="">—</option>{vehicles.data?.filter((v) => v.main_status !== 'inativo').map((v) => <option key={v.id} value={v.id}>{v.plate}{v.main_status === 'em_viagem' ? ` (${t.vehicle.mainStatus.em_viagem})` : ''}</option>)}</Select></Field>
            <Field label={t.trip.driver}><Select {...f.register('driver_id')}><option value="">—</option>{drivers.data?.filter((d) => d.status === 'ativo').map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</Select></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.trip.plannedDeparture}><Input type="datetime-local" {...f.register('planned_departure')} /></Field>
              <Field label={t.trip.plannedArrival} error={e.planned_arrival?.message}><Input type="datetime-local" {...f.register('planned_arrival')} /></Field>
            </div>
          </div>
        </Card>
        <Card title={t.trip.cargo}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.trip.cargo} className="sm:col-span-2"><Input {...f.register('cargo_description')} /></Field>
            <Field label={t.trip.cargoWeight}><Input inputMode="decimal" {...f.register('cargo_weight_t')} /></Field>
            <Field label={t.trip.clientRef}><Input {...f.register('client_reference')} /></Field>
          </div>
        </Card>
        <Card title={t.trip.recipient}>
          <div className="space-y-3">
            <Field label={t.trip.recipient}><Input {...f.register('recipient_name')} /></Field>
            <Field label={t.trip.recipientPhone} error={e.recipient_phone?.message} hint={t.trip.privateHint}><Input type="tel" {...f.register('recipient_phone')} /></Field>
            <Field label={t.common.notes}><Textarea {...f.register('notes')} /></Field>
          </div>
        </Card>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Link to="/app/trips"><Button type="button" variant="secondary">{t.common.cancel}</Button></Link><Button type="submit" loading={f.formState.isSubmitting}>{t.common.save}</Button></div>
    </form>
  );
}
