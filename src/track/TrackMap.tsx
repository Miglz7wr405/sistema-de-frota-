// Mapa da página pública: fixo, com a mesma câmara automática do ecrã do motorista (rota inteira ↔ aproximado ao camião,
// "Agora em X" ao chegar a uma localidade). A rota é a do DTO público (feita + por fazer); sem posição, fica na rota inteira.
import { useEffect, useMemo, useState } from 'react';
import { MapView } from '@/lib/map/MapView';
import { useRouteCamera, ZOOM_ANIM_MS } from '@/lib/map/useRouteCamera';
import { cumulative } from '@/lib/geo/geometry';
import type { Dto } from './TrackApp';
import type { AreaOverlay, LngLat } from '@/lib/map/types';

export default function TrackMap({ dto, stale, query }: { dto: Dto; stale: boolean; query: string }) {
  // limites e nomes dos distritos atravessados (pedido uma vez; sem rede, o mapa funciona sem eles)
  const [areas, setAreas] = useState<AreaOverlay[] | null>(null);
  useEffect(() => { fetch(`/api/track/areas?${query}`).then((r) => (r.ok ? r.json() : null)).then((a) => a && setAreas(a)).catch(() => {}); }, [query]);
  const done = dto.route_done?.coordinates ?? null;
  const left = dto.route_left?.coordinates ?? null;
  const fit: LngLat[] = [dto.origin_point, dto.destination_point, ...(dto.position ? [[dto.position.lng, dto.position.lat] as LngLat] : [])];
  const route = useMemo(() => {
    const coords = [...(done ?? []), ...(left ?? []).slice(done?.length ? 1 : 0)] as LngLat[];
    if (coords.length < 2) return null;
    const cum = cumulative(coords);
    const doneM = done && done.length > 1 ? cumulative(done as LngLat[]).at(-1)! : 0;
    return { coords, cum, lengthM: cum.at(-1)!, doneM };
  }, [dto.route_done, dto.route_left]);
  const live = !stale && !!dto.position && !!route;
  // a menos de ~3 km de um ponto (aproximação plana, suficiente a esta escala)
  const near = (pt: LngLat) => !!dto.position && Math.hypot((dto.position.lng - pt[0]) * Math.cos((pt[1] * Math.PI) / 180), dto.position.lat - pt[1]) * 111 < 3;
  const here = dto.position ? { lng: dto.position.lng, lat: dto.position.lat } : null;
  const cur = dto.places.find((x) => x.state === 'atual' && x.km > 1);
  const cam = useRouteCamera({ route: live ? route : null, doneM: live ? route!.doneM : null, here, ends: [dto.origin_point, dto.destination_point],
    arrived: live && cur ? { placeId: cur.name, name: cur.name, kmFromOrigin: cur.km } : null, baseKey: dto.code });
  return (
    <>
      <MapView className="absolute inset-0" controls={false} interactive={false} fitKey={live ? cam.fitKey : dto.code} fitTo={live ? cam.fitTo : fit}
        fitDurationMs={ZOOM_ANIM_MS}
        state={{
          areas, routeDone: done, routeLeft: left,
          // sem etiqueta grande no camião: o "Agora: …" já está no cartão por baixo (não tapa os nomes do mapa)
          vehicles: dto.position ? [{ id: 'truck', lng: dto.position.lng, lat: dto.position.lat, heading: dto.position.heading, tone: stale ? 'muted' : 'primary' }] : [],
          // o nome da origem/destino não se repete quando o camião está lá (o mapa já mostra o nome da cidade)
          points: [{ id: 'o', lng: dto.origin_point[0], lat: dto.origin_point[1], kind: 'origin', label: near(dto.origin_point) ? undefined : dto.origin },
            { id: 'd', lng: dto.destination_point[0], lat: dto.destination_point[1], kind: 'destination', label: near(dto.destination_point) ? undefined : dto.destination }],
        }} />
      {cam.banner && <div key={cam.banner} className="map-banner pointer-events-none absolute inset-x-3 top-3 rounded-2xl bg-white/95 px-4 py-2 text-center text-base font-bold text-navy shadow">{cam.banner}</div>}
    </>
  );
}
