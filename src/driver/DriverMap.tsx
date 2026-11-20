import { useMemo } from 'react';
import { MapView } from '@/lib/map/MapView';
import { sliceLine, type LngLat } from '@/lib/geo/geometry';
import type { RouteModel } from '@/lib/geo/progress';
import type { Pos, Road } from './useDriverRuntime';

export default function DriverMap({ model, kmDoneModel, pos, road, origin, destination, fitKey }: {
  model: RouteModel | null; kmDoneModel: number | null; pos: Pos | null; road: Road | null; origin: LngLat; destination: LngLat; fitKey: string;
}) {
  // camião em cima da estrada só se o ajuste do servidor é recente (≤ 15 s); senão a posição GPS real
  const here = road?.lat != null && road.lng != null && Date.now() - road.at < 15_000 ? { lat: road.lat, lng: road.lng } : pos;
  const state = useMemo(() => {
    const doneM = model && kmDoneModel != null ? Math.min(model.lengthM, Math.max(0, kmDoneModel * 1000)) : null;
    return {
      routeDone: model && doneM ? sliceLine(model.coords, model.cum, 0, doneM) : null,
      routeLeft: model ? (doneM != null ? sliceLine(model.coords, model.cum, doneM, model.lengthM) : model.coords) : null,
      vehicles: here ? [{ id: 'eu', lng: here.lng, lat: here.lat, heading: pos?.heading ?? null, tone: 'primary' as const }] : [],
      points: [{ id: 'o', lng: origin[0], lat: origin[1], kind: 'origin' as const }, { id: 'd', lng: destination[0], lat: destination[1], kind: 'destination' as const }],
    };
  }, [model, kmDoneModel, here?.lat, here?.lng, pos?.heading, origin, destination]);
  // segue o camião: volta a centrar quando ele se desloca ~2 km
  const cell = here ? `${Math.round(here.lat * 50)}:${Math.round(here.lng * 50)}` : 'rota';
  const fit = useMemo(() => (here ? [[here.lng, here.lat] as LngLat] : model?.coords ?? [origin, destination]), [fitKey, cell]);
  return <MapView className="h-[340px]" fitKey={`${fitKey}-${cell}`} fitTo={fit} state={state} controls={false} />;
}
