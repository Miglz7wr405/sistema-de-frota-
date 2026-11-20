// Escolher camião / motorista numa viagem, com "+ Novo" no próprio sítio (matrícula·marca·modelo ou nome·telefone).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Field, Modal, Select } from '@/components/ui';
import { VehicleForm } from '../vehicles/VehicleForm';
import { DriverForm } from '../drivers/DriverForm';

type Veh = { id: string; plate: string; main_status: string; is_test?: boolean };
type Drv = { id: string; full_name: string; status: string; user_id?: string | null };

export const useAssets = () => ({
  vehicles: useQuery({ queryKey: ['vehicles'], queryFn: () => api<Veh[]>('/api/vehicles') }),
  drivers: useQuery({ queryKey: ['drivers'], queryFn: () => api<Drv[]>('/api/drivers') }),
});

export function VehiclePicker({ value, onChange, vehicles }: { value: string; onChange: (id: string) => void; vehicles: Veh[] | undefined }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  return (
    <Field label={t.trip.vehicle}>
      <div className="flex gap-2">
        <Select aria-label={t.trip.vehicle} value={value} onChange={(e) => onChange(e.target.value)}><option value="">—</option>
          {vehicles?.filter((v) => v.main_status !== 'inativo').map((v) => <option key={v.id} value={v.id}>{v.plate}{v.main_status === 'em_viagem' ? ` (${t.vehicle.mainStatus.em_viagem})` : ''}</option>)}</Select>
        <Button type="button" variant="secondary" className="shrink-0" onClick={() => setOpen(true)}>{t.common.addNew}</Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t.vehicle.add}>
        <div onSubmit={(e) => e.stopPropagation()}>
          <VehicleForm onDone={async (id) => { await qc.invalidateQueries({ queryKey: ['vehicles'] }); onChange(id); setOpen(false); }} />
        </div>
      </Modal>
    </Field>
  );
}

export function DriverPicker({ value, onChange, drivers }: { value: string; onChange: (id: string) => void; drivers: Drv[] | undefined }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  return (
    <Field label={t.trip.driver}>
      <div className="flex gap-2">
        <Select aria-label={t.trip.driver} value={value} onChange={(e) => onChange(e.target.value)}><option value="">—</option>
          {drivers?.filter((d) => d.status === 'ativo').map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</Select>
        <Button type="button" variant="secondary" className="shrink-0" onClick={() => setOpen(true)}>{t.common.addNew}</Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t.driver.add}>
        <div onSubmit={(e) => e.stopPropagation()}>
          <DriverForm onDone={async (id) => { await qc.invalidateQueries({ queryKey: ['drivers'] }); if (id) onChange(id); setOpen(false); }} />
        </div>
      </Modal>
    </Field>
  );
}
