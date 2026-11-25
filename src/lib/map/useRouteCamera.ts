// Câmara automática dos mapas de viagem (motorista, página da viagem no painel e página pública):
//   - por omissão a rota inteira (origem → destino);
//   - ciclo: 15 s com a rota inteira → aproxima (animação) → 30 s aproximado à volta do camião → volta, sucessivamente;
//   - ao chegar a uma localidade da rota: aproxima 15 s e mostra "📍 Agora em X"; ao sair, "Já passou por X" durante 15 s.
// Só usa dados reais: rota planeada (coordenadas + distâncias acumuladas), km feitos do motor de percurso e a posição GPS.
import { useEffect, useMemo, useState } from 'react';
import { sliceLine, type LngLat } from '@/lib/geo/geometry';
import { tt as t } from '@/i18n/pt-MZ.track';

export const ARRIVAL_MS = 15_000;
export const CYCLE_MS = 45_000; // 15 s rota inteira + 30 s aproximado
export const PEEK_MS = 30_000;
export const ZOOM_ANIM_MS = 3500;

export type CameraRoute = { coords: LngLat[]; cum: number[]; lengthM: number };
export type CameraPlace = { placeId: string; name: string; kmFromOrigin: number };

/** Está na fase "aproximado" do ciclo neste instante? */
export const inPeek = (now: number) => now % CYCLE_MS >= CYCLE_MS - PEEK_MS;

/** Janela aproximada: proporcional à rota (longas: 15 km atrás e 40 km à frente; curtas: uns km). */
export function localWindow(route: CameraRoute, atM: number): LngLat[] {
  const ahead = Math.min(40_000, Math.max(3_000, route.lengthM * 0.15)), back = Math.min(15_000, Math.max(1_000, route.lengthM * 0.05));
  return sliceLine(route.coords, route.cum, Math.max(0, atM - back), Math.min(route.lengthM, atM + ahead));
}

export function useRouteCamera({ route, doneM, here, arrived, ends, baseKey, enabled = true }: {
  route: CameraRoute | null; doneM: number | null; here: { lng: number; lat: number } | null;
  arrived?: CameraPlace | null; ends: [LngLat, LngLat]; baseKey: string; enabled?: boolean;
}) {
  const arrivedId = arrived?.placeId ?? null;
  const [passed, setPassed] = useState<{ name: string; until: number } | null>(null);
  const [last, setLast] = useState<CameraPlace | null>(null);
  useEffect(() => {
    if (arrived) setLast(arrived);
    else if (last) { setPassed({ name: last.name, until: Date.now() + ARRIVAL_MS }); setLast(null); }
  }, [arrivedId]);
  // relógio de 1 s para mudar de vista no momento certo
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(h); }, []);
  const [localUntil, setLocalUntil] = useState(0);
  useEffect(() => { if (arrivedId) setLocalUntil(Date.now() + ARRIVAL_MS); }, [arrivedId]);

  // só aproxima quando há posição real ao longo da rota
  const at = doneM ?? 0;
  const local = enabled && !!route && doneM != null && (now < localUntil || inPeek(now));
  const fitTo = useMemo<LngLat[]>(() => {
    if (!route) return [ends[0], ends[1]];
    if (!local) return route.coords;
    const pts = localWindow(route, at);
    return here ? [...pts, [here.lng, here.lat]] : pts;
  }, [route, local, baseKey, local ? Math.round(at / 5_000) : 0]);
  const fitKey = `${baseKey}-${local ? `perto-${Math.round(at / 5_000)}` : 'rota'}`;
  const banner = arrived ? t.driverApp.nowIn(arrived.name) : passed && now < passed.until ? t.driverApp.passedPlace(passed.name) : null;
  return { fitTo, fitKey, banner, local };
}
