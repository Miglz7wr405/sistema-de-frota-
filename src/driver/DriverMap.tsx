// Mapa do motorista: FIXO (o motorista não arrasta nem faz zoom). Por omissão mostra a rota inteira (origem → destino).
// O sistema aproxima sozinho, com animação suave, para a zona onde o camião está:
//   - ao chegar a uma localidade da rota: durante 15 segundos, com o nome por cima ("Agora em X" / "Já passou por X");
//   - sempre: 15 s com a rota inteira → aproxima (animação) → 30 s aproximado → volta, sucessivamente (o mapa não fica parado).
// Depois volta à rota inteira.
import { useEffect, useMemo, useState } from 'react';
import { MapView } from '@/lib/map/MapView';
import { sliceLine, type LngLat } from '@/lib/geo/geometry';
import type { RouteModel } from '@/lib/geo/progress';
import type { Pos, Road } from './useDriverRuntime';
import { t } from '@/i18n/pt-MZ';

const ARRIVAL_MS = 15_000; // ao chegar a uma localidade: aproxima 15 s e volta
const CYCLE_MS = 45_000; // 15 s com a rota inteira + 30 s aproximado
const PEEK_MS = 30_000;
const ZOOM_ANIM_MS = 3500;

export type ArrivedPlace = { placeId: string; name: string; kmFromOrigin: number };
export default function DriverMap({ model, kmDoneModel, pos, road, origin, destination, fitKey, arrived }: {
  model: RouteModel | null; kmDoneModel: number | null; pos: Pos | null; road: Road | null; origin: LngLat; destination: LngLat; fitKey: string;
  arrived?: ArrivedPlace | null;
}) {
  const arrivedPlaceId = arrived?.placeId ?? null;
  // "Já passou por X" fica 15 s depois de sair da localidade
  const [passed, setPassed] = useState<{ name: string; until: number } | null>(null);
  const [lastArrived, setLastArrived] = useState<ArrivedPlace | null>(null);
  useEffect(() => {
    if (arrived) setLastArrived(arrived);
    else if (lastArrived) { setPassed({ name: lastArrived.name, until: Date.now() + 15_000 }); setLastArrived(null); }
  }, [arrivedPlaceId]);
  // camião em cima da estrada só se o ajuste do servidor é recente (≤ 15 s); senão a posição GPS real
  const here = road?.lat != null && road.lng != null && Date.now() - road.at < 15_000 ? { lat: road.lat, lng: road.lng } : pos;
  const doneM = model && kmDoneModel != null ? Math.min(model.lengthM, Math.max(0, kmDoneModel * 1000)) : null;
  const state = useMemo(() => ({
    routeDone: model && doneM ? sliceLine(model.coords, model.cum, 0, doneM) : null,
    routeLeft: model ? (doneM != null ? sliceLine(model.coords, model.cum, doneM, model.lengthM) : model.coords) : null,
    vehicles: here ? [{ id: 'eu', lng: here.lng, lat: here.lat, heading: pos?.heading ?? null, tone: 'primary' as const }] : [],
    points: [{ id: 'o', lng: origin[0], lat: origin[1], kind: 'origin' as const }, { id: 'd', lng: destination[0], lat: destination[1], kind: 'destination' as const },
      // o nome da localidade onde o camião está, em cima da estrada
      ...(arrived && model ? (() => { const m = Math.min(model.lengthM, arrived.kmFromOrigin * 1000); const p = sliceLine(model.coords, model.cum, m, Math.min(model.lengthM, m + 1))[0];
        return p ? [{ id: 'aqui', lng: p[0], lat: p[1], kind: 'place' as const, label: arrived.name }] : []; })() : [])],
  }), [model, doneM, here?.lat, here?.lng, pos?.heading, origin, destination, arrivedPlaceId]);

  // relógio de 1 s para mudar de vista no momento certo
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(h); }, []);
  // chegou a uma cidade/vila → aproxima durante 5 min
  const [localUntil, setLocalUntil] = useState(0);
  useEffect(() => { if (arrivedPlaceId) setLocalUntil(Date.now() + ARRIVAL_MS); }, [arrivedPlaceId]);
  const peek = now % CYCLE_MS >= CYCLE_MS - PEEK_MS;
  const at = doneM ?? 0; // antes da 1.ª posição: o início da rota
  const local = !!model && (now < localUntil || peek);

  // vista próxima: 15 km para trás e 40 km para a frente na estrada (como a zona Quelimane → Licuare)
  const fit = useMemo<LngLat[]>(() => {
    if (!model) return [origin, destination];
    if (!local) return model.coords;
    // janela proporcional à rota: viagens longas 15 km para trás e 40 km para a frente; curtas, uns km (para se notar o zoom)
    const ahead = Math.min(40_000, Math.max(3_000, model.lengthM * 0.15)), back = Math.min(15_000, Math.max(1_000, model.lengthM * 0.05));
    const pts = sliceLine(model.coords, model.cum, Math.max(0, at - back), Math.min(model.lengthM, at + ahead));
    return here ? [...pts, [here.lng, here.lat]] : pts;
  }, [model, local, fitKey, local ? Math.round(at / 5_000) : 0]);

  const banner = arrived ? t.driverApp.nowIn(arrived.name) : passed && now < passed.until ? t.driverApp.passedPlace(passed.name) : null;
  return (
    <div className="relative">
      <MapView className="h-[360px]" interactive={false} controls={false} fitDurationMs={ZOOM_ANIM_MS}
        fitKey={`${fitKey}-${local ? `perto-${Math.round(at / 5_000)}` : 'rota'}`} fitTo={fit} state={state} />
      {banner && <div key={banner} className="map-banner pointer-events-none absolute inset-x-3 top-3 rounded-2xl bg-white/95 px-4 py-2 text-center text-base font-bold text-navy shadow">{banner}</div>}
    </div>
  );
}
