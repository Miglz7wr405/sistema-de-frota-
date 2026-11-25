import { useEffect, useRef, useState } from 'react';
import type { MapHandle, MapProvider, MapState, LngLat } from './types';
import { maplibreProvider } from './maplibre';
import { tt as t } from '@/i18n/pt-MZ.track';
import { MapPinOff } from 'lucide-react';

let provider: MapProvider = maplibreProvider;
export const setMapProvider = (p: MapProvider) => { provider = p; };

/** Mapa declarativo. `fitKey` muda → volta a enquadrar `fitTo`. */
export function MapView({ state, fitTo, fitKey, className, onClick, onVehicleClick, interactive = true, controls = true, fitDurationMs = 0 }: {
  state: MapState; fitTo?: LngLat[]; fitKey?: string; className?: string; onClick?: (p: LngLat) => void; onVehicleClick?: (id: string) => void; interactive?: boolean; controls?: boolean; fitDurationMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<MapHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const cbs = useRef({ onClick, onVehicleClick });
  cbs.current = { onClick, onVehicleClick };
  const fitRef = useRef(fitTo);
  fitRef.current = fitTo;

  useEffect(() => {
    let handle: MapHandle | null = null;
    let dead = false;
    provider.create(ref.current!, { interactive, controls }).then((m) => {
      if (dead) { m.destroy(); return; }
      handle = m;
      m.resize(); // o contentor pode ter mudado de tamanho enquanto o mapa carregava
      requestAnimationFrame(() => m.resize());
      m.onClick((p) => cbs.current.onClick?.(p));
      m.onVehicleClick((id) => cbs.current.onVehicleClick?.(id));
      setH(m);
    }).catch((e) => { console.warn('[mapa]', e?.message ?? e); setFailed(true); });
    // mapa fixo (não interativo): volta a enquadrar quando o ecrã muda de tamanho
    const ro = new ResizeObserver(() => { handle?.resize(); if (!interactive && handle && fitRef.current?.length) handle.fit(fitRef.current); });
    ro.observe(ref.current!);
    return () => { dead = true; ro.disconnect(); handle?.destroy(); };
  }, [interactive]);

  useEffect(() => { h?.update(state); }, [h, state]);
  const lastFit = useRef<string | undefined>();
  useEffect(() => {
    if (!h || !fitTo?.length) return;
    if (lastFit.current === fitKey && fitKey !== undefined) return;
    const first = lastFit.current === undefined;
    lastFit.current = fitKey;
    h.resize();
    h.fit(fitTo, undefined, first ? 0 : fitDurationMs);
  }, [h, fitTo, fitKey]);

  return (
    <div className={className} style={/\b(absolute|fixed)\b/.test(className ?? '') ? undefined : { position: 'relative' }}>
      {/* posição em estilo direto: o CSS do MapLibre (.maplibregl-map { position: relative }) anularia a classe e o mapa ficaria com ~34 px */}
      <div ref={ref} className="overflow-hidden rounded-[inherit]" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      {!h && !failed && <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm text-muted">{t.map.loading}</div>}
      {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-100 text-sm text-muted"><MapPinOff className="h-6 w-6" />{t.map.unavailable}</div>}
    </div>
  );
}
