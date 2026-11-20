// Percurso na app do motorista: esquema (linha com as cidades reais da rota e o camião nos km feitos) ou mapa
// (rota feita/por fazer e o camião em cima da estrada quando o servidor ajustou a última posição; senão o GPS).
import { lazy, Suspense, useState } from 'react';
import { t } from '@/i18n/pt-MZ';
import { RouteStrip } from '@/features/tracking/RouteStrip';
import type { Me, Pos, Road } from './useDriverRuntime';
import type { RouteModel } from '@/lib/geo/progress';

const DriverMap = lazy(() => import('./DriverMap'));

export function DriverRoute({ me, model, kmDone, pos, road, arrived }: { me: Me; model: RouteModel | null; kmDone: number | null; pos: Pos | null; road: Road | null; arrived?: { placeId: string; name: string; kmFromOrigin: number } | null }) {
  // primeiro o Mapa (por omissão), depois o Percurso
  const [view, setView] = useState<'strip' | 'map'>(() => (localStorage.getItem('if_driver_view') === 'strip' ? 'strip' : 'map'));
  if (!me.trip || !me.route) return null;
  const set = (v: 'strip' | 'map') => { setView(v); try { localStorage.setItem('if_driver_view', v); } catch { /* */ } };
  const totalKm = me.route.lengthM / 1000;
  return (
    <div className="card overflow-hidden">
      <div className="flex border-b border-border text-sm font-semibold" role="tablist">
        {(['map', 'strip'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => set(v)}
            className={`flex-1 py-2.5 ${view === v ? 'border-b-2 border-primary text-primary' : 'text-muted'}`}>{v === 'strip' ? t.driverApp.viewStrip : t.driverApp.viewMap}</button>))}
      </div>
      {view === 'strip'
        ? <div className="p-3"><RouteStrip origin={me.trip.origin} destination={me.trip.destination} totalKm={totalKm} kmDone={kmDone} showEta={false}
            places={me.route.places.map((p) => ({ name: p.name, km: p.kmFromOrigin, importance: p.importance }))} /></div>
        : <Suspense fallback={<div className="flex h-[340px] items-center justify-center text-sm text-muted">{t.map.loading}</div>}>
            <DriverMap model={model} kmDoneModel={kmDone != null && model ? kmDone * (model.lengthM / 1000 / totalKm) : null} pos={pos} road={road}
              origin={me.route.coords[0]!} destination={me.route.coords[me.route.coords.length - 1]!} fitKey={me.route.routeId} arrived={arrived} />
          </Suspense>}
    </div>
  );
}
