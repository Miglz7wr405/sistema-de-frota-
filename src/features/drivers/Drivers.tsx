import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Modal, PageHeader, QueryState } from '@/components/ui';
import { useRole } from '@/app/session';
import { formatAgo, formatDate } from '@/lib/format';
import { DriverForm } from './DriverForm';

type D = { id: string; full_name: string; phone: string; license_number: string | null; license_category: string | null; status: string; license_expires: string | null;
  active_trip_code: string | null; access_last_used: string | null; has_access: boolean };

export default function Drivers() {
  const qc = useQueryClient();
  const { canWrite } = useRole();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['drivers'], queryFn: () => api<D[]>('/api/drivers') });
  return (
    <div>
      <PageHeader title={t.driver.title} actions={canWrite && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t.driver.add}</Button>} />
      <QueryState q={q} empty={(d) => d.length === 0}>{(rows) => (
        <div className="card overflow-x-auto"><table className="w-full min-w-[720px]">
          <thead><tr><th className="table-th">{t.driver.fullName}</th><th className="table-th">{t.driver.phone}</th><th className="table-th">{t.driver.license}</th><th className="table-th">{t.vehicle.trip}</th><th className="table-th">{t.driver.access}</th><th className="table-th">{t.common.status}</th></tr></thead>
          <tbody>{rows.map((d) => {
            const days = d.license_expires ? Math.round((Date.parse(d.license_expires) - Date.now()) / 864e5) : null;
            return (
              <tr key={d.id}>
                <td className="table-td"><Link className="font-semibold text-primary" to={`/app/drivers/${d.id}`}>{d.full_name}</Link></td>
                <td className="table-td">{d.phone}</td>
                <td className="table-td">{d.license_category ?? '—'}{d.license_expires && <span className={`ml-2 text-xs ${days! < 0 ? 'text-danger' : days! <= 30 ? 'text-warning' : 'text-muted'}`}>{formatDate(d.license_expires)}</span>}</td>
                <td className="table-td">{d.active_trip_code ?? '—'}</td>
                <td className="table-td text-sm">{d.has_access ? (d.access_last_used ? t.driver.accessLastUsed(formatAgo(d.access_last_used)) : t.driver.accessActive) : <span className="text-muted">{t.driver.accessNone}</span>}</td>
                <td className="table-td"><Badge tone={d.status === 'ativo' ? 'success' : 'muted'}>{t.driver.statuses[d.status]}</Badge></td>
              </tr>);
          })}</tbody></table></div>
      )}</QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title={t.driver.add}><DriverForm onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['drivers'] }); }} /></Modal>
    </div>
  );
}
