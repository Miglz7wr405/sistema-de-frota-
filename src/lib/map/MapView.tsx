import { useEffect, useRef, useState } from 'react';
import type { MapHandle, MapProvider, MapState, LngLat } from './types';
import { maplibreProvider } from './maplibre';
import { t } from '@/i18n/pt-MZ';
import { MapPinOff } from 'lucide-react';

let provider: MapProvider = maplibreProvider;
export const setMapProvider = (p: MapProvider) => { provider = p; };

/** Mapa declarativo. `fitKey` muda → volta a enquadrar `fitTo`. */
export function MapView({ state, fitTo, fitKey, className, onClick, onVehicleClick, interactive = true }: {
  state: MapState; fitTo?: LngLat[]; fitKey?: string; className?: string; onClick?: (p: LngLat) => void; onVehicleClick?: (id: string) => void; interactive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<MapHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const cbs = useRef({ onClick, onVehicleClick });
  cbs.current = { onClick, onVehicleClick };

  useEffect(() => {
    let handle: MapHandle | null = null;
    let dead = false;
    provider.create(ref.current!, { interactive }).then((m) => {
      if (dead) { m.destroy(); return; }
      handle = m;
      m.onClick((p) => cbs.current.onClick?.(p));
      m.onVehicleClick((id) => cbs.current.onVehicleClick?.(id));
      setH(m);
    }).catch(() => setFailed(true));
    const ro = new ResizeObserver(() => handle?.resize());
    ro.observe(ref.current!);
    return () => { dead = true; ro.disconnect(); handle?.destroy(); };
  }, [interactive]);

  useEffect(() => { h?.update(state); }, [h, state]);
  const lastFit = useRef<string | undefined>();
  useEffect(() => {
    if (!h || !fitTo?.length) return;
    if (lastFit.current === fitKey && fitKey !== undefined) return;
    lastFit.current = fitKey;
    h.fit(fitTo);
  }, [h, fitTo, fitKey]);

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div ref={ref} className="absolute inset-0 overflow-hidden rounded-[inherit]" />
      {!h && !failed && <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm text-muted">{t.map.loading}</div>}
      {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-100 text-sm text-muted"><MapPinOff className="h-6 w-6" />{t.map.unavailable}</div>}
    </div>
  );
}
