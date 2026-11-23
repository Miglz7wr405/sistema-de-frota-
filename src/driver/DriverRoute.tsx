// Percurso na app do motorista: esquema (linha com as cidades reais da rota e o camião nos km feitos) ou mapa
// (rota feita/por fazer e o camião em cima da estrada quando o servidor ajustou a última posição; senão o GPS).
import { lazy, Suspense, useEffect, useState } from 'react';
import { t } from '@/i18n/pt-MZ';
import { RouteStrip } from '@/features/tracking/RouteStrip';
import type { Me, Pos, Road } from './useDriverRuntime';
import type { RouteModel } from '@/lib/geo/progress';

const DriverMap = lazy(() => import('./DriverMap'));

// Alterna sozinho: 105 s no Mapa (2 ciclos de zoom e um pouco), depois 15 s no Percurso, e volta ao Mapa.
// Tocar num separador recomeça a contagem a partir daí. (Os testes podem encurtar com localStorage "if_tab_cycle" = "mapa,percurso" em ms.)
function cycleMs(): [number, number] {
  try { const v = localStorage.getItem('if_tab_cycle')?.split(',').map(Number); if (v && v.length === 2 && v.every((n) => n > 0)) return [v[0]!, v[1]!]; } catch { /* */ }
  return [105_000, 15_000];
}

export function DriverRoute({ me, model, kmDone, pos, road, arrived }: { me: Me; model: RouteModel | null; kmDone: number | null; pos: Pos | null; road: Road | null; arrived?: { placeId: string; name: string; kmFromOrigin: number } | null }) {
  // começa sempre no Mapa; o Percurso entra sozinho de vez em quando
  const [view, setView] = useState<'strip' | 'map'>('map');
  const [tick, setTick] = useState(0); // muda quando o motorista toca num separador (recomeça a contagem)
  useEffect(() => {
    const [mapMs, stripMs] = cycleMs();
    const h = setTimeout(() => { setView((v) => (v === 'map' ? 'strip' : 'map')); setTick((n) => n + 1); }, view === 'map' ? mapMs : stripMs);
    return () => clearTimeout(h);
  }, [view, tick]);
  if (!me.trip || !me.route) return null;
  const set = (v: 'strip' | 'map') => { setView(v); setTick((n) => n + 1); };
  const totalKm = me.route.lengthM / 1000;
  return (
    <div className="card overflow-hidden">
      <div className="flex border-b border-border text-sm font-semibold" role="tablist">
        {(['map', 'strip'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => set(v)}
            className={`flex-1 border-b-2 py-2.5 transition-colors duration-300 ${view === v ? 'border-primary text-primary' : 'border-transparent text-muted'}`}>{v === 'strip' ? t.driverApp.viewStrip : t.driverApp.viewMap}</button>))}
      </div>
      {/* os dois ficam montados (o mapa não recarrega); só se mostra um de cada vez, com uma transição suave */}
      <div className={view === 'strip' ? 'tab-fade p-3' : 'hidden'} role="tabpanel">
        <RouteStrip origin={me.trip.origin} destination={me.trip.destination} totalKm={totalKm} kmDone={kmDone} showEta={false}
          places={me.route.places.map((p) => ({ name: p.name, km: p.kmFromOrigin, importance: p.importance }))} districts={me.route.districts} /></div>
      <div className={view === 'map' ? 'tab-fade' : 'hidden'} role="tabpanel">
        <Suspense fallback={<div className="flex h-[340px] items-center justify-center text-sm text-muted">{t.map.loading}</div>}>
          <DriverMap model={model} kmDoneModel={kmDone != null && model ? kmDone * (model.lengthM / 1000 / totalKm) : null} pos={pos} road={road}
            origin={me.route.coords[0]!} destination={me.route.coords[me.route.coords.length - 1]!} fitKey={me.route.routeId} arrived={arrived} />
        </Suspense></div>
    </div>
  );
}
