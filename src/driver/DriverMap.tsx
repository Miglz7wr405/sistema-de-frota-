// Mapa do motorista: FIXO (o motorista não arrasta nem faz zoom). Por omissão mostra a rota inteira (origem → destino).
// O sistema aproxima sozinho, com animação suave, para a zona onde o camião está:
//   - ao chegar a uma localidade da rota: durante 15 segundos, com o nome por cima ("Agora em X" / "Já passou por X");
//   - sempre: 15 s com a rota inteira → aproxima (animação) → 30 s aproximado → volta, sucessivamente (o mapa não fica parado).
// Depois volta à rota inteira.
import { useEffect, useMemo, useState } from 'react';
import type { AreaOverlay } from '@/lib/map/types';
import { driverApi } from './useDriverRuntime';
import { useRouteCamera, ZOOM_ANIM_MS } from '@/lib/map/useRouteCamera';
import { MapView } from '@/lib/map/MapView';
import { sliceLine, type LngLat } from '@/lib/geo/geometry';
import type { RouteModel } from '@/lib/geo/progress';
import type { Pos, Road } from './useDriverRuntime';

export type ArrivedPlace = { placeId: string; name: string; kmFromOrigin: number };
export default function DriverMap({ model, kmDoneModel, pos, road, origin, destination, fitKey, arrived }: {
  model: RouteModel | null; kmDoneModel: number | null; pos: Pos | null; road: Road | null; origin: LngLat; destination: LngLat; fitKey: string;
  arrived?: ArrivedPlace | null;
}) {
  const arrivedPlaceId = arrived?.placeId ?? null;
  // limites e nomes dos distritos da rota (uma vez por rota; guardados para funcionar sem rede)
  const [areas, setAreas] = useState<AreaOverlay[] | null>(() => { try { return JSON.parse(localStorage.getItem(`if_areas_${fitKey}`) ?? 'null'); } catch { return null; } });
  useEffect(() => {
    driverApi<AreaOverlay[]>('/api/driver/areas').then((a) => { setAreas(a); try { localStorage.setItem(`if_areas_${fitKey}`, JSON.stringify(a)); } catch { /* cheio */ } }).catch(() => {});
  }, [fitKey]);
  // camião em cima da estrada só se o ajuste do servidor é recente (≤ 15 s); senão a posição GPS real
  const here = road?.lat != null && road.lng != null && Date.now() - road.at < 15_000 ? { lat: road.lat, lng: road.lng } : pos;
  const doneM = model && kmDoneModel != null ? Math.min(model.lengthM, Math.max(0, kmDoneModel * 1000)) : null;
  const state = useMemo(() => ({
    areas,
    routeDone: model && doneM ? sliceLine(model.coords, model.cum, 0, doneM) : null,
    routeLeft: model ? (doneM != null ? sliceLine(model.coords, model.cum, doneM, model.lengthM) : model.coords) : null,
    vehicles: here ? [{ id: 'eu', lng: here.lng, lat: here.lat, heading: pos?.heading ?? null, tone: 'primary' as const,
      // o nome da localidade onde está, numa etiqueta ao lado do camião (sem pontos por cima uns dos outros)
      ...(arrived ? { label: arrived.name } : {}) }] : [],
    points: [{ id: 'o', lng: origin[0], lat: origin[1], kind: 'origin' as const }, { id: 'd', lng: destination[0], lat: destination[1], kind: 'destination' as const }],
  }), [model, doneM, here?.lat, here?.lng, pos?.heading, origin, destination, arrivedPlaceId, areas]);

  const cam = useRouteCamera({ route: model, doneM: doneM ?? 0, here, arrived, ends: [origin, destination], baseKey: fitKey });
  return (
    <div className="relative">
      <MapView className="h-[360px]" interactive={false} controls={false} fitDurationMs={ZOOM_ANIM_MS}
        fitKey={cam.fitKey} fitTo={cam.fitTo} state={state} />
      {cam.banner && <div key={cam.banner} className="map-banner pointer-events-none absolute inset-x-3 top-3 rounded-2xl bg-white/95 px-4 py-2 text-center text-base font-bold text-navy shadow">{cam.banner}</div>}
    </div>
  );
}
