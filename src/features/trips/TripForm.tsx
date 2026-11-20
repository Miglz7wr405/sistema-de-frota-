// Nova viagem / editar: só o essencial — Origem, Destino, Camião, Motorista. A partida é "agora".
// Os outros campos da viagem (datas previstas, carga, destinatário, notas, paragens) continuam na API e na BD,
// mas saíram do formulário a pedido do proprietário (ver DECISOES.md, ADR-023).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Play } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card, Field, PageHeader, Spinner } from '@/components/ui';
import { PlacePicker, type PlaceOpt } from './PlacePicker';
import { DriverPicker, VehiclePicker, useAssets } from './AssetPickers';

const place = z.custom<PlaceOpt | null>((v) => !!v && typeof v === 'object', { message: t.validation.place });
const Schema = z.object({ origin: place, destination: place, vehicle_id: z.string().optional(), driver_id: z.string().optional() })
  .refine((v) => !v.origin || !v.destination || v.origin.id !== v.destination.id, { message: t.validation.samePlace, path: ['destination'] });
type F = z.infer<typeof Schema>;

export default function TripForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'start' | 'save' | null>(null);
  const { vehicles, drivers } = useAssets();
  const existing = useQuery({ queryKey: ['trip', id], queryFn: () => api<{ trip: Record<string, any> }>(`/api/trips/${id}`), enabled: !!id });
  const f = useForm<F>({ resolver: zodResolver(Schema), defaultValues: { origin: null, destination: null, vehicle_id: '', driver_id: '' } });

  useEffect(() => {
    const tr = existing.data?.trip;
    if (!tr) return;
    f.reset({
      origin: { id: tr.origin_place_id, name: tr.origin, kind: '', province: null, private: false, lng: tr.origin_lng, lat: tr.origin_lat },
      destination: { id: tr.destination_place_id, name: tr.destination, kind: '', province: null, private: false, lng: tr.dest_lng, lat: tr.dest_lat },
      vehicle_id: tr.vehicle_id ?? '', driver_id: tr.driver_id ?? '',
    });
  }, [existing.data]);

  // só 1 camião / 1 motorista: ficam já escolhidos (viagem nova)
  useEffect(() => {
    if (id) return;
    const vs = vehicles.data?.filter((v) => v.main_status !== 'inativo' && !v.is_test) ?? [];
    if (vs.length === 1 && !f.getValues('vehicle_id')) f.setValue('vehicle_id', vs[0]!.id);
    const ds = drivers.data?.filter((d) => d.status === 'ativo') ?? [];
    if (ds.length === 1 && !f.getValues('driver_id')) f.setValue('driver_id', ds[0]!.id);
  }, [id, vehicles.data, drivers.data]);

  const save = (start: boolean) => f.handleSubmit(async (v) => {
    setErr(null); setBusy(start ? 'start' : 'save');
    const body = { origin_place_id: v.origin!.id, destination_place_id: v.destination!.id, vehicle_id: v.vehicle_id || null, driver_id: v.driver_id || null };
    try {
      let tripId = id;
      if (id) await api(`/api/trips/${id}`, { method: 'PATCH', body });
      else tripId = (await api<{ id: string }>('/api/trips', { body: { ...body, planned_departure: new Date().toISOString() } })).id;
      if (start) await api(`/api/trips/${tripId}/transition`, { body: { to: 'em_viagem' } });
      nav(`/app/trips/${tripId}`);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  })();

  if (id && existing.isLoading) return <Spinner />;
  const e = f.formState.errors;
  const ready = !!f.watch('vehicle_id') && !!f.watch('driver_id');
  const canStart = !id || ['planeada', 'aguardando_partida'].includes(existing.data?.trip.status);
  return (
    <form onSubmit={(ev) => { ev.preventDefault(); void save(ready && canStart); }} noValidate className="mx-auto max-w-xl">
      <PageHeader title={id ? t.trip.edit : t.trip.new} back={<Link to={id ? `/app/trips/${id}` : '/app/trips'} className="text-sm text-primary">← {t.common.back}</Link>} />
      {err && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <Card>
        <div className="space-y-4">
          <Field label={t.trip.origin} error={e.origin?.message as string}><Controller control={f.control} name="origin" render={({ field }) => <PlacePicker value={field.value} onChange={field.onChange} invalid={!!e.origin} />} /></Field>
          <Field label={t.trip.destination} error={e.destination?.message as string}><Controller control={f.control} name="destination" render={({ field }) => <PlacePicker value={field.value} onChange={field.onChange} invalid={!!e.destination} />} /></Field>
          <Controller control={f.control} name="vehicle_id" render={({ field }) => <VehiclePicker value={field.value ?? ''} onChange={field.onChange} vehicles={vehicles.data} />} />
          <Controller control={f.control} name="driver_id" render={({ field }) => <DriverPicker value={field.value ?? ''} onChange={field.onChange} drivers={drivers.data} />} />
        </div>
      </Card>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
        {canStart && <Button type="button" size="lg" className="h-14 sm:flex-1" disabled={!ready} loading={busy === 'start'} onClick={() => save(true)}><Play className="h-5 w-5" />{t.trip.startNow}</Button>}
        <Button type="button" variant="secondary" size="lg" className="h-14 sm:flex-1" loading={busy === 'save'} onClick={() => save(false)}>{t.trip.saveOnly}</Button>
      </div>
    </form>
  );
}
