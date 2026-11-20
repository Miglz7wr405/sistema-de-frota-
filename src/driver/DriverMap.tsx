// Mapa do motorista: FIXO (o motorista não arrasta nem faz zoom). Por omissão mostra a rota inteira (origem → destino).
// O sistema aproxima sozinho, com animação suave, para a zona onde o camião está:
//   - ao chegar a uma cidade/vila (localidade importante da rota): durante 5 minutos;
//   - de 10 em 10 minutos: durante 1 minuto (para ver as localidades à frente).
// Depois volta à rota inteira.
import { useEffect, useMemo, useState } from 'react';
import { MapView } from '@/lib/map/MapView';
import { sliceLine, type LngLat } from '@/lib/geo/geometry';
import type { RouteModel } from '@/lib/geo/progress';
import type { Pos, Road } from './useDriverRuntime';

const ARRIVAL_MS = 5 * 60_000;
const CYCLE_MS = 10 * 60_000;
const PEEK_MS = 60_000;
const ZOOM_ANIM_MS = 2500;

export default function DriverMap({ model, kmDoneModel, pos, road, origin, destination, fitKey, arrivedPlaceId }: {
  model: RouteModel | null; kmDoneModel: number | null; pos: Pos | null; road: Road | null; origin: LngLat; destination: LngLat; fitKey: string;
  arrivedPlaceId?: string | null;
}) {
  // camião em cima da estrada só se o ajuste do servidor é recente (≤ 15 s); senão a posição GPS real
  const here = road?.lat != null && road.lng != null && Date.now() - road.at < 15_000 ? { lat: road.lat, lng: road.lng } : pos;
  const doneM = model && kmDoneModel != null ? Math.min(model.lengthM, Math.max(0, kmDoneModel * 1000)) : null;
  const state = useMemo(() => ({
    routeDone: model && doneM ? sliceLine(model.coords, model.cum, 0, doneM) : null,
    routeLeft: model ? (doneM != null ? sliceLine(model.coords, model.cum, doneM, model.lengthM) : model.coords) : null,
    vehicles: here ? [{ id: 'eu', lng: here.lng, lat: here.lat, heading: pos?.heading ?? null, tone: 'primary' as const }] : [],
    points: [{ id: 'o', lng: origin[0], lat: origin[1], kind: 'origin' as const }, { id: 'd', lng: destination[0], lat: destination[1], kind: 'destination' as const }],
  }), [model, doneM, here?.lat, here?.lng, pos?.heading, origin, destination]);

  // relógio de 5 s para mudar de vista no momento certo
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(h); }, []);
  // chegou a uma cidade/vila → aproxima durante 5 min
  const [localUntil, setLocalUntil] = useState(0);
  useEffect(() => { if (arrivedPlaceId) setLocalUntil(Date.now() + ARRIVAL_MS); }, [arrivedPlaceId]);
  const peek = now % CYCLE_MS >= CYCLE_MS - PEEK_MS;
  const local = doneM != null && !!model && (now < localUntil || peek);

  // vista próxima: 5 km para trás e 40 km para a frente na estrada (como a zona Quelimane → Licuare)
  const fit = useMemo<LngLat[]>(() => {
    if (!model) return [origin, destination];
    if (!local || doneM == null) return model.coords;
    const pts = sliceLine(model.coords, model.cum, Math.max(0, doneM - 5_000), Math.min(model.lengthM, doneM + 40_000));
    return here ? [...pts, [here.lng, here.lat]] : pts;
  }, [model, local, fitKey, local ? Math.round((doneM ?? 0) / 5_000) : 0]);

  return <MapView className="h-[360px]" interactive={false} controls={false} fitDurationMs={ZOOM_ANIM_MS}
    fitKey={`${fitKey}-${local ? `perto-${Math.round((doneM ?? 0) / 5_000)}` : 'rota'}`} fitTo={fit} state={state} />;
}
