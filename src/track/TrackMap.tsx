import { MapView } from '@/lib/map/MapView';
import type { Dto } from './TrackApp';
import type { LngLat } from '@/lib/map/types';

export default function TrackMap({ dto, stale }: { dto: Dto; stale: boolean }) {
  const done = dto.route_done?.coordinates ?? null;
  const left = dto.route_left?.coordinates ?? null;
  const fit: LngLat[] = [dto.origin_point, dto.destination_point, ...(dto.position ? [[dto.position.lng, dto.position.lat] as LngLat] : [])];
  return (
    <MapView className="absolute inset-0" fitKey={dto.code} fitTo={fit}
      state={{
        routeDone: done, routeLeft: left,
        vehicles: dto.position ? [{ id: 'truck', lng: dto.position.lng, lat: dto.position.lat, heading: dto.position.heading, tone: stale ? 'muted' : 'primary',
          label: dto.progress?.current_label ?? undefined, sublabel: dto.progress ? `Faltam ${Math.round(dto.progress.km_left)} km` : undefined }] : [],
        points: [{ id: 'o', lng: dto.origin_point[0], lat: dto.origin_point[1], kind: 'origin', label: dto.origin }, { id: 'd', lng: dto.destination_point[0], lat: dto.destination_point[1], kind: 'destination', label: dto.destination }],
      }} />
  );
}
