import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card, Input, PageHeader, QueryState, Stat } from '@/components/ui';
import { formatKm, formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function Reports() {
  const [by, setBy] = useState<'vehicle' | 'trip'>('vehicle');
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const qs = `by=${by}&from=${new Date(from).toISOString()}&to=${new Date(new Date(to).getTime() + 864e5 - 1).toISOString()}`;
  const q = useQuery({ queryKey: ['report', qs], queryFn: () => api<any>(`/api/reports/summary?${qs}`) });
  return (
    <div>
      <PageHeader title={t.reports.title} actions={<a href={`/api/reports/export.csv?${qs}`}><Button variant="secondary"><Download className="h-4 w-4" />{t.reports.export}</Button></a>} />
      <Card className="mb-4"><div className="flex flex-wrap items-center gap-3">
        {(['vehicle', 'trip'] as const).map((b) => <button key={b} onClick={() => setBy(b)} className={cn('rounded-full border px-4 py-1.5 text-sm', by === b ? 'border-navy bg-navy text-white' : 'border-border bg-white')}>{b === 'vehicle' ? t.reports.byVehicle : t.reports.byTrip}</button>)}
        <span className="ml-auto text-sm text-muted">{t.reports.period}</span><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </div></Card>
      <QueryState q={q}>{(r) => (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={t.reports.km} value={formatKm(r.totals.km)} /><Stat label={t.costs.fuel} value={formatMoney(r.totals.fuel)} /><Stat label={t.costs.maintenance} value={formatMoney(r.totals.maintenance)} />
            <Stat label={t.costs.expenses} value={formatMoney(r.totals.expenses)} /><Stat label={t.costs.total} value={formatMoney(r.totals.total)} />
          </div>
          <div className="card overflow-x-auto"><table className="w-full min-w-[720px]">
            <thead><tr><th className="table-th">{by === 'vehicle' ? t.trip.vehicle : t.trip.code}</th>{by === 'vehicle' ? <th className="table-th">{t.reports.trips}</th> : <th className="table-th">{t.trip.route}</th>}<th className="table-th">{t.reports.km}</th><th className="table-th">{t.costs.fuel}</th><th className="table-th">{t.costs.maintenance}</th><th className="table-th">{t.costs.expenses}</th><th className="table-th">{t.costs.total}</th></tr></thead>
            <tbody>{r.rows.map((x: any) => (
              <tr key={x.id}><td className="table-td font-medium">{by === 'trip' ? <Link className="text-primary" to={`/app/trips/${x.id}`}>{x.label}</Link> : <Link className="text-primary" to={`/app/vehicles/${x.id}`}>{x.label}</Link>}</td>
                <td className="table-td">{by === 'vehicle' ? x.trips : x.route}</td><td className="table-td">{formatKm(Number(x.km))}</td><td className="table-td">{formatMoney(x.fuel)}</td><td className="table-td">{formatMoney(x.maintenance)}</td><td className="table-td">{formatMoney(x.expenses)}</td><td className="table-td font-semibold">{formatMoney(x.total)}</td></tr>))}</tbody></table></div>
        </>
      )}</QueryState>
    </div>
  );
}
