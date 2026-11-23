// Camada de mapas (regra do projeto): nenhum componente importa o SDK do mapa diretamente; só esta interface.
export type LngLat = [number, number];
export type VehicleMarker = { id: string; lng: number; lat: number; heading?: number | null; tone: 'primary' | 'success' | 'muted' | 'danger'; label?: string; sublabel?: string };
export type PointMarker = { id: string; lng: number; lat: number; kind: 'origin' | 'destination' | 'waypoint' | 'place' | 'passed'; label?: string };
/** Distrito atravessado pela rota: limite (GeoJSON LineString/MultiLineString) e ponto para o nome. */
export type AreaOverlay = { name: string; province?: string | null; boundary: { type: string; coordinates: unknown } | null; label: LngLat };
export type MapState = {
  areas?: AreaOverlay[] | null; // limites e nomes dos distritos (por baixo da rota)
  vehicles?: VehicleMarker[];
  routeDone?: LngLat[] | null;
  routeLeft?: LngLat[] | null;
  extraLine?: LngLat[] | null; // ex.: replay
  points?: PointMarker[];
};
export interface MapHandle {
  update(state: MapState): void;
  fit(coords: LngLat[], padding?: number, durationMs?: number): void;
  onClick(cb: (p: LngLat) => void): void;
  onVehicleClick(cb: (id: string) => void): void;
  resize(): void;
  destroy(): void;
}
export interface MapProvider {
  create(container: HTMLElement, opts: { center?: LngLat; zoom?: number; interactive?: boolean; controls?: boolean }): Promise<MapHandle>;
}
