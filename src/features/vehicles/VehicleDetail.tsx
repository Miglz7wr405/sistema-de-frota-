import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, Modal, PageHeader, QueryState, Stat } from '@/components/ui';
import { MapView } from '@/lib/map/MapView';
import { formatDateTime, formatKm, formatMoney } from '@/lib/format';
import { useRole } from '@/app/session';
import { FreshnessLine, TripStatus } from '../shared';
import { VehicleForm } from './VehicleForm';
import { Documents } from './Documents';

export default function VehicleDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { canWrite, canAdmin } = useRole();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['vehicle', id], queryFn: () => api<any>(`/api/vehicles/${id}`), refetchInterval: 20_000 });
  const del = async () => { if (!confirm(t.vehicle.deleteConfirm)) return; try { await api(`/api/vehicles/${id}`, { method: 'DELETE' }); nav('/app/vehicles'); } catch (e) { alert(errorMessage(e)); } };
  return (
    <QueryState q={q}>{(d) => {
      const v = d.vehicle;
      return (
        <div>
          <PageHeader back={<Link to="/app/vehicles" className="text-sm text-primary">← {t.vehicle.title}</Link>} title={<span className="flex items-center gap-3">{v.plate_normalized}<Badge tone={v.main_status === 'em_viagem' ? 'success' : v.main_status === 'em_manutencao' ? 'warning' : 'primary'}>{t.vehicle.mainStatus[v.main_status]}</Badge></span>}
            subtitle={[v.make, v.model, v.year].filter(Boolean).join(' · ')}
            actions={<>{canWrite && <Button variant="secondary" onClick={() => setEdit(true)}><Edit3 className="h-4 w-4" />{t.common.edit}</Button>}{canAdmin && <Button variant="danger" onClick={del}><Trash2 className="h-4 w-4" />{t.common.delete}</Button>}</>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card title={t.vehicle.lastPosition} action={<FreshnessLine at={v.last_position_at} source={v.last_source} />}>
                {v.lng != null ? <MapView className="h-72 rounded-xl" fitKey={id} fitTo={[[v.lng, v.lat]]} state={{ vehicles: [{ id: v.id, lng: v.lng, lat: v.lat, tone: 'primary', label: v.plate_normalized }] }} />
                  : <p className="text-sm text-muted">{t.vehicle.noPosition}</p>}
                {v.active_trip_id && <p className="mt-2 text-sm">{t.vehicle.trip}: <Link className="font-medium text-primary" to={`/app/trips/${v.active_trip_id}`}>{v.active_trip_code}</Link></p>}
              </Card>
              <Card title={t.trip.title}>
                {d.trips.length === 0 ? <p className="text-sm text-muted">{t.trip.noTrips}</p> : <ul className="divide-y divide-border">{d.trips.map((tr: any) => (
                  <li key={tr.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span><Link className="font-medium text-primary" to={`/app/trips/${tr.id}`}>{tr.code}</Link> · {tr.origin} → {tr.destination} · {tr.driver ?? '—'}<br /><span className="text-muted">{formatDateTime(tr.actual_departure ?? tr.planned_departure)}</span></span><TripStatus status={tr.status} /></li>))}</ul>}
              </Card>
              <Documents vehicleId={id} />
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label={t.vehicle.mileage} value={formatKm(v.odometer_km != null ? Number(v.odometer_km) : null)} />
                <Stat label={t.vehicle.capacity} value={v.capacity_t ? `${v.capacity_t} t` : '—'} />
              </div>
              <Card title={t.vehicle.usualDriver}>{d.usualDriver ? <Link className="font-medium text-primary" to={`/app/drivers/${d.usualDriver.id}`}>{d.usualDriver.full_name}</Link> : <p className="text-sm text-muted">—</p>}</Card>
              <Card title={t.devices.title}>{d.devices.length === 0 ? <p className="text-sm text-muted">{t.vehicle.noDevice}</p> : d.devices.map((x: any) => <p key={x.id} className="text-sm">IMEI {x.imei} {x.model ? `· ${x.model}` : ''}</p>)}</Card>
              {d.costs && <Card title={t.costs.title}><dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">{t.costs.fuel}</dt><dd>{formatMoney(d.costs.fuel)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{t.costs.maintenance}</dt><dd>{formatMoney(d.costs.maintenance)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{t.costs.expenses}</dt><dd>{formatMoney(d.costs.expenses)}</dd></div></dl></Card>}
            </div>
          </div>
          <Modal open={edit} onClose={() => setEdit(false)} title={t.common.edit} wide><VehicleForm initial={{ ...v, plate: v.plate }} onDone={() => { setEdit(false); qc.invalidateQueries({ queryKey: ['vehicle', id] }); }} /></Modal>
        </div>
      );
    }}</QueryState>
  );
}
