import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card, Field, PageHeader, Stat } from '@/components/ui';
import { MapView } from '@/lib/map/MapView';
import { formatDuration, formatKm } from '@/lib/format';
import { PlacePicker, type PlaceOpt } from './PlacePicker';
import type { LngLat } from '@/lib/map/types';

type R = { from: string; to: string; lengthKm: number; durationS: number; roads: string[]; provider: string; validatedForTruck: boolean; places: { name: string; km: number }[]; geometry: { coordinates: LngLat[] } };

export default function Distances() {
  const [a, setA] = useState<PlaceOpt | null>(null);
  const [b, setB] = useState<PlaceOpt | null>(null);
  const m = useMutation({ mutationFn: () => api<R>('/api/routes/plan', { body: { from: a!.id, to: b!.id } }) });
  return (
    <div>
      <PageHeader title={t.distances.title} subtitle={t.distances.subtitle} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t.trip.origin}><PlacePicker value={a} onChange={setA} /></Field>
          <Field label={t.trip.destination}><PlacePicker value={b} onChange={setB} /></Field>
          <Button disabled={!a || !b || a.id === b.id} loading={m.isPending} onClick={() => m.mutate()}>{t.distances.calc}</Button>
        </div>
        {m.isError && <p className="mt-3 text-sm text-danger">{errorMessage(m.error)}</p>}
      </Card>
      {m.data && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="space-y-3">
            <Stat label={t.trip.distance} value={formatKm(m.data.lengthKm)} sub={m.data.roads.length ? `${t.distances.viaRoads}: ${m.data.roads.join(', ')}` : undefined} />
            <Stat label={t.trip.duration} value={formatDuration(m.data.durationS)} />
            {!m.data.validatedForTruck && <p className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"><AlertTriangle className="h-4 w-4 shrink-0" />{t.trip.routeNotValidated}</p>}
            <Card title={t.trip.places}><ol className="space-y-1 text-sm">{m.data.places.map((p, i) => <li key={i} className="flex gap-3"><span className="w-16 tabular-nums text-muted">km {Math.round(p.km)}</span>{p.name}</li>)}</ol></Card>
          </div>
          <MapView className="h-[480px] rounded-2xl border border-border lg:col-span-2" fitKey={`${a?.id}-${b?.id}`} fitTo={m.data.geometry.coordinates}
            state={{ routeLeft: m.data.geometry.coordinates, points: [{ id: 'a', lng: a!.lng, lat: a!.lat, kind: 'origin', label: a!.name }, { id: 'b', lng: b!.lng, lat: b!.lat, kind: 'destination', label: b!.name }] }} />
        </div>
      )}
    </div>
  );
}
