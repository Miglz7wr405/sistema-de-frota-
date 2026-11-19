// Custos e relatórios (Fase 8). Montantes em numeric(14,2) + moeda (MZN por omissão).
import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { many, one } from '../db.js';
import { requireMember, asMember, WRITE, ADMIN } from '../auth.js';
import { updateSet } from './fleet.js';

const COST_ROLES = ['owner', 'admin', 'dispatcher'];
const money = z.number().min(0).max(1e11);
const date = z.string().date();
const ts = z.string().datetime({ offset: true });

type Def = { table: string; schema: z.ZodObject<z.ZodRawShape>; cols: string[]; list: string };
const defs: Record<string, Def> = {
  fuel: {
    table: 'fuel_records', cols: ['vehicle_id', 'trip_id', 'filled_at', 'liters', 'amount', 'currency', 'odometer_km', 'station', 'full_tank', 'receipt_file_id'],
    schema: z.object({ vehicle_id: z.string().uuid(), trip_id: z.string().uuid().nullable().optional(), filled_at: ts, liters: z.number().positive().max(5000),
      amount: money, currency: z.string().length(3).optional(), odometer_km: z.number().min(0).nullable().optional(), station: z.string().max(120).nullable().optional(),
      full_tank: z.boolean().optional(), receipt_file_id: z.string().uuid().nullable().optional() }),
    list: `select f.*, v.plate_normalized plate, c.l_per_100km from fuel_records f join vehicles v on v.id = f.vehicle_id
           left join fuel_consumption_v c on c.id = f.id where f.organization_id = $1 and ($2::uuid is null or f.vehicle_id = $2) order by f.filled_at desc limit 500`,
  },
  'maintenance-schedules': {
    table: 'maintenance_schedules', cols: ['vehicle_id', 'kind', 'every_km', 'every_days', 'last_done_at', 'last_done_km'],
    schema: z.object({ vehicle_id: z.string().uuid(), kind: z.string().min(2).max(120), every_km: z.number().positive().nullable().optional(),
      every_days: z.number().int().positive().nullable().optional(), last_done_at: date.nullable().optional(), last_done_km: z.number().min(0).nullable().optional() }),
    list: `select s.*, v.plate_normalized plate, v.odometer_km from maintenance_schedules s join vehicles v on v.id = s.vehicle_id
           where s.organization_id = $1 and ($2::uuid is null or s.vehicle_id = $2) order by s.next_due_at nulls last`,
  },
  'maintenance-records': {
    table: 'maintenance_records', cols: ['vehicle_id', 'schedule_id', 'kind', 'done_at', 'odometer_km', 'workshop', 'amount', 'currency', 'notes', 'receipt_file_id'],
    schema: z.object({ vehicle_id: z.string().uuid(), schedule_id: z.string().uuid().nullable().optional(), kind: z.string().min(2).max(120), done_at: date,
      odometer_km: z.number().min(0).nullable().optional(), workshop: z.string().max(120).nullable().optional(), amount: money, currency: z.string().length(3).optional(),
      notes: z.string().max(1000).nullable().optional(), receipt_file_id: z.string().uuid().nullable().optional() }),
    list: `select r.*, v.plate_normalized plate from maintenance_records r join vehicles v on v.id = r.vehicle_id
           where r.organization_id = $1 and ($2::uuid is null or r.vehicle_id = $2) order by r.done_at desc limit 500`,
  },
  expenses: {
    table: 'trip_expenses', cols: ['trip_id', 'category', 'amount', 'currency', 'spent_at', 'note', 'receipt_file_id'],
    schema: z.object({ trip_id: z.string().uuid(), category: z.enum(['portagem', 'alimentacao', 'alojamento', 'reparacao', 'outra']), amount: money,
      currency: z.string().length(3).optional(), spent_at: ts.optional(), note: z.string().max(500).nullable().optional(), receipt_file_id: z.string().uuid().nullable().optional() }),
    list: `select e.*, t.code trip_code, d.full_name driver_name from trip_expenses e join trips t on t.id = e.trip_id left join drivers d on d.id = e.created_by_driver_id
           where e.organization_id = $1 and ($2::uuid is null or t.vehicle_id = $2) order by e.spent_at desc limit 500`,
  },
};

for (const [name, d] of Object.entries(defs)) {
  route('GET', `/api/${name}`, async (req) => {
    const m = await requireMember(req, COST_ROLES);
    return ok(await asMember(m, (c) => many(c, d.list, [m.orgId, req.query.get('vehicleId') || null])));
  });
  route('POST', `/api/${name}`, async (req) => {
    const m = await requireMember(req, WRITE);
    const b = parse(d.schema, req.body) as Record<string, unknown>;
    const cols = d.cols.filter((k) => b[k] !== undefined);
    return ok(await asMember(m, async (c) => {
      const r = await one(c, `insert into ${d.table} (organization_id, ${cols.join(',')}${name === 'expenses' ? ', created_by_user_id' : ''})
        values ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}${name === 'expenses' ? `, $${cols.length + 2}` : ''}) returning id`,
        [m.orgId, ...cols.map((k) => b[k]), ...(name === 'expenses' ? [m.userId] : [])]);
      if (name === 'fuel' && b.odometer_km != null) await c.query('update vehicles set odometer_km = greatest(coalesce(odometer_km, 0), $2) where id = $1', [b.vehicle_id, b.odometer_km]);
      if (name === 'maintenance-records' && b.odometer_km != null) await c.query('update vehicles set odometer_km = greatest(coalesce(odometer_km, 0), $2) where id = $1', [b.vehicle_id, b.odometer_km]);
      return r;
    }), 201);
  });
  route('PATCH', `/api/${name}/:id`, async (req, p) => {
    const m = await requireMember(req, WRITE);
    const b = parse(d.schema.partial(), req.body) as Record<string, unknown>;
    const u = updateSet(b, d.cols);
    if (u.empty) throw new HttpError(400, 'sem_alteracoes');
    const r = await asMember(m, (c) => one(c, `update ${d.table} set ${u.sql} where id = $1 returning id`, [assertUuid(p.id), ...u.values]));
    if (!r) throw new HttpError(404, 'nao_encontrado');
    return ok(r);
  });
  route('DELETE', `/api/${name}/:id`, async (req, p) => {
    const m = await requireMember(req, ADMIN);
    const r = await asMember(m, (c) => c.query(`delete from ${d.table} where id = $1`, [assertUuid(p.id)]));
    if (!r.rowCount) throw new HttpError(404, 'nao_encontrado');
    return ok({ ok: true });
  });
}

// Relatório por camião/viagem num período. Km = km percorridos medidos ao longo da rota (trip_progress), nunca estimados.
const REPORT_SQL = {
  vehicle: `select v.id, v.plate_normalized label,
      (select count(*) from trips t where t.vehicle_id = v.id and t.deleted_at is null and coalesce(t.actual_departure, t.created_at) between $2 and $3)::int trips,
      (select coalesce(sum(p.km_done),0) from trips t join trip_progress p on p.trip_id = t.id where t.vehicle_id = v.id and coalesce(t.actual_departure, t.created_at) between $2 and $3) km,
      (select coalesce(sum(amount),0) from fuel_records f where f.vehicle_id = v.id and f.filled_at between $2 and $3) fuel,
      (select coalesce(sum(liters),0) from fuel_records f where f.vehicle_id = v.id and f.filled_at between $2 and $3) liters,
      (select coalesce(sum(amount),0) from maintenance_records r where r.vehicle_id = v.id and r.done_at between $2::date and $3::date) maintenance,
      (select coalesce(sum(e.amount),0) from trip_expenses e join trips t on t.id = e.trip_id where t.vehicle_id = v.id and e.spent_at between $2 and $3) expenses
    from vehicles v where v.organization_id = $1 and v.deleted_at is null order by v.plate_normalized`,
  trip: `select t.id, t.code label, po.name || ' → ' || pd.name route, t.status, t.actual_departure, t.actual_arrival, v.plate_normalized plate,
      coalesce(p.km_done, 0) km,
      (select coalesce(sum(amount),0) from fuel_records f where f.trip_id = t.id) fuel,
      0::numeric maintenance,
      (select coalesce(sum(amount),0) from trip_expenses e where e.trip_id = t.id) expenses
    from trips t join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id
      left join vehicles v on v.id = t.vehicle_id left join trip_progress p on p.trip_id = t.id
    where t.organization_id = $1 and t.deleted_at is null and coalesce(t.actual_departure, t.created_at) between $2 and $3
    order by coalesce(t.actual_departure, t.created_at) desc`,
};

async function report(req: Parameters<typeof requireMember>[0]) {
  const m = await requireMember(req, COST_ROLES);
  const by = req.query.get('by') === 'trip' ? 'trip' : 'vehicle';
  const from = req.query.get('from') ?? new Date(Date.now() - 30 * 864e5).toISOString();
  const to = req.query.get('to') ?? new Date().toISOString();
  const rows = await asMember(m, (c) => many<Record<string, string | number>>(c, REPORT_SQL[by], [m.orgId, from, to]));
  const out = rows.map((r) => ({ ...r, total: Number(r.fuel) + Number(r.maintenance) + Number(r.expenses) }) as Record<string, string | number> & { total: number });
  const totals = { km: 0, fuel: 0, maintenance: 0, expenses: 0, total: 0 };
  for (const r of out) {
    totals.km += Number(r.km); totals.fuel += Number(r.fuel); totals.maintenance += Number(r.maintenance);
    totals.expenses += Number(r.expenses); totals.total += r.total;
  }
  return { by, from, to, rows: out, totals };
}

route('GET', '/api/reports/summary', async (req) => ok(await report(req)));

route('GET', '/api/reports/export.csv', async (req) => {
  const r = await report(req);
  const cols = ['label', 'km', 'fuel', 'maintenance', 'expenses', 'total'];
  const head = r.by === 'trip' ? ['Viagem', 'Km', 'Combustível (MZN)', 'Manutenção (MZN)', 'Despesas (MZN)', 'Total (MZN)'] : ['Camião', 'Km', 'Combustível (MZN)', 'Manutenção (MZN)', 'Despesas (MZN)', 'Total (MZN)'];
  const cell = (v: unknown) => { const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [head.join(';'), ...r.rows.map((row) => cols.map((k) => cell(k === 'label' ? row[k] : Number(row[k as keyof typeof row]))).join(';'))].join('\r\n');
  return { status: 200, raw: csv, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="relatorio-${r.by}.csv"` } };
});
