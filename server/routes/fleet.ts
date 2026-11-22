import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { many, one } from '../db.js';
import { requireMember, asMember, WRITE, ADMIN, audit } from '../auth.js';
import { hashPassword, randomToken, sha256 } from '../crypto.js';
import { publicBase } from './auth.js';

const num = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();
const VehicleSchema = z.object({
  plate: z.string().trim().min(3).max(15), make: z.string().max(60).nullable().optional(), model: z.string().max(60).nullable().optional(),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  body_type: z.enum(['rigido', 'trator', 'basculante', 'cisterna', 'frigorifico', 'outro']).optional(),
  capacity_t: num(0.1, 200), gross_weight_t: num(0.1, 200), length_m: num(1, 40), width_m: num(1, 5), height_m: num(1, 6),
  axles: z.number().int().min(2).max(12).nullable().optional(), odometer_km: num(0, 5_000_000),
  photo_file_id: z.string().uuid().nullable().optional(),
  admin_status: z.enum(['ativo', 'em_manutencao', 'inativo']).optional(),
  gps_source_priority: z.enum(['device', 'phone']).optional(), notes: z.string().max(2000).nullable().optional(),
});
const VCOLS = ['plate', 'make', 'model', 'year', 'body_type', 'capacity_t', 'gross_weight_t', 'length_m', 'width_m', 'height_m', 'axles',
  'odometer_km', 'photo_file_id', 'admin_status', 'gps_source_priority', 'notes'] as const;

/** UPDATE dinâmico só com colunas da lista branca. */
export function updateSet(b: Record<string, unknown>, cols: readonly string[], start = 2) {
  const keys = cols.filter((k) => b[k] !== undefined);
  return { sql: keys.map((k, i) => `${k} = $${i + start}`).join(', '), values: keys.map((k) => b[k]), empty: keys.length === 0 };
}

route('GET', '/api/vehicles', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, (c) => many(c, `
    select s.*, v.body_type, v.photo_file_id, v.gross_weight_t, v.axles,
      (select d.full_name from trips t join drivers d on d.id = t.driver_id where t.id = s.active_trip_id) as active_driver,
      (select po.name || ' → ' || pd.name from trips t join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id where t.id = s.active_trip_id) as active_route,
      (select r.kind || '|' || coalesce(r.workshop, '') || '|' || r.done_at || '|' || r.amount from maintenance_records r where r.vehicle_id = s.id order by r.done_at desc limit 1) as last_maintenance
    from vehicle_status_v s join vehicles v on v.id = s.id where s.organization_id = $1 order by s.plate`, [m.orgId])));
});

route('POST', '/api/vehicles', async (req) => {
  const m = await requireMember(req, WRITE);
  const b = parse(VehicleSchema, req.body);
  return ok(await asMember(m, async (c) => {
    const cols = VCOLS.filter((k) => b[k] !== undefined);
    const r = await one<{ id: string }>(c, `insert into vehicles (organization_id, ${cols.join(',')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}) returning id`,
      [m.orgId, ...cols.map((k) => b[k])]);
    await audit(c, m, 'camiao.criar', 'vehicles', r!.id, { plate: b.plate });
    return r;
  }), 201);
});

route('GET', '/api/vehicles/:id', async (req, p) => {
  const m = await requireMember(req);
  const id = assertUuid(p.id);
  return ok(await asMember(m, async (c) => {
    const v = await one(c, 'select v.*, s.main_status, s.freshness, s.last_position_at, s.last_source, s.lng, s.lat, s.speed_kmh, s.active_trip_id, s.active_trip_code from vehicles v join vehicle_status_v s on s.id = v.id where v.id = $1', [id]);
    if (!v) throw new HttpError(404, 'nao_encontrado');
    const trips = await many(c, `select t.id, t.code, t.status, t.actual_departure, t.actual_arrival, t.planned_departure, po.name as origin, pd.name as destination, d.full_name as driver
      from trips t join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id left join drivers d on d.id = t.driver_id
      where t.vehicle_id = $1 and t.deleted_at is null order by t.created_at desc limit 30`, [id]);
    const usualDriver = await one(c, `select d.id, d.full_name, count(*) n from trips t join drivers d on d.id = t.driver_id
      where t.vehicle_id = $1 and t.deleted_at is null group by d.id, d.full_name order by n desc limit 1`, [id]);
    const devices = await many(c, `select g.id, g.imei, g.model, da.valid_from from device_assignments da join gps_devices g on g.id = da.device_id
      where da.vehicle_id = $1 and da.valid_to is null`, [id]);
    const costs = m.role === 'viewer' ? null : await one(c, `select
        (select coalesce(sum(amount),0) from fuel_records where vehicle_id = $1) as fuel,
        (select coalesce(sum(amount),0) from maintenance_records where vehicle_id = $1) as maintenance,
        (select coalesce(sum(e.amount),0) from trip_expenses e join trips t on t.id = e.trip_id where t.vehicle_id = $1) as expenses`, [id]);
    return { vehicle: v, trips, usualDriver, devices, costs };
  }));
});

route('PATCH', '/api/vehicles/:id', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const b = parse(VehicleSchema.partial(), req.body);
  const u = updateSet(b, VCOLS);
  if (u.empty) throw new HttpError(400, 'sem_alteracoes');
  return ok(await asMember(m, async (c) => {
    const r = await one(c, `update vehicles set ${u.sql} where id = $1 and deleted_at is null returning id`, [assertUuid(p.id), ...u.values]);
    if (!r) throw new HttpError(404, 'nao_encontrado');
    await audit(c, m, 'camiao.editar', 'vehicles', p.id!, b);
    return r;
  }));
});

route('DELETE', '/api/vehicles/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, async (c) => {
    const r = await c.query('update vehicles set deleted_at = now() where id = $1 and deleted_at is null', [assertUuid(p.id)]);
    if (!r.rowCount) throw new HttpError(404, 'nao_encontrado');
    await c.query('update device_assignments set valid_to = now() where vehicle_id = $1 and valid_to is null', [p.id]);
    await audit(c, m, 'camiao.eliminar', 'vehicles', p.id!);
  });
  return ok({ ok: true });
});

// ── Motoristas ──
const DriverSchema = z.object({
  full_name: z.string().trim().min(2).max(120), phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  license_number: z.string().max(40).nullable().optional(), license_category: z.string().max(20).nullable().optional(),
  photo_file_id: z.string().uuid().nullable().optional(), status: z.enum(['ativo', 'inativo']).optional(),
  // BI de Moçambique: 12 algarismos + 1 letra (espaços retirados, maiúsculas)
  id_number: z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v), z.string().regex(/^\d{12}[A-Z]$/)).nullable().optional(),
});
const DCOLS = ['full_name', 'phone', 'license_number', 'license_category', 'photo_file_id', 'status', 'id_number'] as const;

route('GET', '/api/drivers', async (req) => {
  const m = await requireMember(req);
  return ok(await asMember(m, (c) => many(c, `
    select d.id, d.full_name, d.phone, d.id_number, d.license_number, d.license_category, d.status, d.photo_file_id, d.user_id,
      (select min(expires_on) from documents doc where doc.driver_id = d.id and doc.doc_type = 'carta_conducao') as license_expires,
      (select t.code from trips t where t.driver_id = d.id and t.status in ('em_viagem','pausada') limit 1) as active_trip_code,
      (select a.last_used_at from driver_access a where a.driver_id = d.id and a.revoked_at is null) as access_last_used,
      exists (select 1 from driver_access a where a.driver_id = d.id and a.revoked_at is null) as has_access
    from drivers d where d.organization_id = $1 and d.deleted_at is null order by d.full_name`, [m.orgId])));
});

// "Eu próprio (sou o motorista)": o motorista ligado à conta do utilizador (criado na 1.ª vez). Assim o GPS deste telemóvel
// liga-se sozinho quando ele inicia a viagem.
route('POST', '/api/drivers/me', async (req) => {
  const m = await requireMember(req, WRITE);
  return ok(await asMember(m, async (c) => {
    const ex = await one<{ id: string }>(c, 'select id from drivers where organization_id = $1 and user_id = $2 and deleted_at is null', [m.orgId, m.userId]);
    if (ex) { await c.query(`update drivers set status = 'ativo' where id = $1`, [ex.id]); return ex; }
    const r = await one<{ id: string }>(c, 'insert into drivers (organization_id, full_name, user_id) values ($1, $2, $3) returning id', [m.orgId, m.fullName, m.userId]);
    await audit(c, m, 'motorista.criar', 'drivers', r!.id, { proprio: true });
    return r;
  }), 201);
});

route('POST', '/api/drivers', async (req) => {
  const m = await requireMember(req, WRITE);
  const b = parse(DriverSchema, req.body);
  return ok(await asMember(m, async (c) => {
    const cols = DCOLS.filter((k) => b[k] !== undefined);
    const r = await one<{ id: string }>(c, `insert into drivers (organization_id, ${cols.join(',')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}) returning id`,
      [m.orgId, ...cols.map((k) => b[k])]);
    await audit(c, m, 'motorista.criar', 'drivers', r!.id);
    return r;
  }), 201);
});

route('GET', '/api/drivers/:id', async (req, p) => {
  const m = await requireMember(req);
  const id = assertUuid(p.id);
  return ok(await asMember(m, async (c) => {
    const d = await one(c, 'select * from drivers where id = $1 and deleted_at is null', [id]);
    if (!d) throw new HttpError(404, 'nao_encontrado');
    const access = await one(c, 'select id, failed_attempts, locked_until, last_used_at, created_at from driver_access where driver_id = $1 and revoked_at is null', [id]);
    const trips = await many(c, `select t.id, t.code, t.status, t.actual_departure, t.actual_arrival, po.name as origin, pd.name as destination, v.plate_normalized as plate
      from trips t join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id left join vehicles v on v.id = t.vehicle_id
      where t.driver_id = $1 and t.deleted_at is null order by t.created_at desc limit 30`, [id]);
    return { driver: d, access, trips };
  }));
});

route('PATCH', '/api/drivers/:id', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const b = parse(DriverSchema.partial(), req.body);
  const u = updateSet(b, DCOLS);
  if (u.empty) throw new HttpError(400, 'sem_alteracoes');
  return ok(await asMember(m, async (c) => {
    const r = await one(c, `update drivers set ${u.sql} where id = $1 and deleted_at is null returning id`, [assertUuid(p.id), ...u.values]);
    if (!r) throw new HttpError(404, 'nao_encontrado');
    await audit(c, m, 'motorista.editar', 'drivers', p.id!);
    return r;
  }));
});

route('DELETE', '/api/drivers/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, async (c) => {
    await c.query('select driver_access_revoke($1)', [assertUuid(p.id)]);
    const r = await c.query('update drivers set deleted_at = now(), status = $2 where id = $1 and deleted_at is null', [p.id, 'inativo']);
    if (!r.rowCount) throw new HttpError(404, 'nao_encontrado');
    await audit(c, m, 'motorista.eliminar', 'drivers', p.id!);
  });
  return ok({ ok: true });
});

// Acesso à PWA: link com token de 256 bits (no fragmento #, não vai para logs) + PIN definido pelo dono.
route('POST', '/api/drivers/:id/access', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  const b = parse(z.object({ pin: z.string().regex(/^\d{4,6}$/) }), req.body);
  const token = randomToken(32);
  const pinHash = await hashPassword(b.pin);
  await asMember(m, (c) => c.query('select driver_access_issue($1, $2, $3)', [assertUuid(p.id), sha256(token), pinHash]));
  return ok({ link: `${publicBase(req)}/driver/entrar#${token}` }, 201);
});

route('DELETE', '/api/drivers/:id/access', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, (c) => c.query('select driver_access_revoke($1)', [assertUuid(p.id)]));
  return ok({ ok: true });
});

// ── Documentos ──
const DocSchema = z.object({
  vehicle_id: z.string().uuid().nullable().optional(), driver_id: z.string().uuid().nullable().optional(),
  doc_type: z.enum(['carta_conducao', 'seguro', 'inspecao', 'licenca_transporte', 'manifesto', 'livrete', 'outro']),
  number: z.string().max(60).nullable().optional(), issued_on: z.string().date().nullable().optional(),
  expires_on: z.string().date().nullable().optional(), file_id: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional(),
});
const DOCCOLS = ['vehicle_id', 'driver_id', 'doc_type', 'number', 'issued_on', 'expires_on', 'file_id', 'notes'] as const;

route('GET', '/api/documents', async (req) => {
  const m = await requireMember(req);
  const vid = req.query.get('vehicleId'), did = req.query.get('driverId'), expiring = req.query.get('expiring');
  return ok(await asMember(m, (c) => many(c, `
    select doc.*, (doc.expires_on - (now() at time zone 'Africa/Maputo')::date) as days_left,
      case when doc.expires_on is null then 'sem_validade' when doc.expires_on < (now() at time zone 'Africa/Maputo')::date then 'expirado'
           when doc.expires_on <= (now() at time zone 'Africa/Maputo')::date + 30 then 'a_expirar' else 'valido' end as state,
      coalesce(v.plate_normalized, d.full_name) as owner_label
    from documents doc left join vehicles v on v.id = doc.vehicle_id left join drivers d on d.id = doc.driver_id
    where doc.organization_id = $1 and ($2::uuid is null or doc.vehicle_id = $2) and ($3::uuid is null or doc.driver_id = $3)
      and ($4::boolean is not true or doc.expires_on <= (now() at time zone 'Africa/Maputo')::date + 30)
      and coalesce(v.deleted_at, d.deleted_at) is null
    order by doc.expires_on nulls last`, [m.orgId, vid || null, did || null, expiring === '1'])));
});

route('POST', '/api/documents', async (req) => {
  const m = await requireMember(req, WRITE);
  const b = parse(DocSchema, req.body);
  return ok(await asMember(m, async (c) => {
    const cols = DOCCOLS.filter((k) => b[k] !== undefined);
    const r = await one<{ id: string }>(c, `insert into documents (organization_id, ${cols.join(',')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}) returning id`,
      [m.orgId, ...cols.map((k) => b[k])]);
    await audit(c, m, 'documento.criar', 'documents', r!.id);
    return r;
  }), 201);
});

route('PATCH', '/api/documents/:id', async (req, p) => {
  const m = await requireMember(req, WRITE);
  const b = parse(DocSchema.partial(), req.body);
  const u = updateSet(b, DOCCOLS);
  if (u.empty) throw new HttpError(400, 'sem_alteracoes');
  return ok(await asMember(m, async (c) => {
    const r = await one(c, `update documents set ${u.sql} where id = $1 returning id`, [assertUuid(p.id), ...u.values]);
    if (!r) throw new HttpError(404, 'nao_encontrado');
    return r;
  }));
});

route('DELETE', '/api/documents/:id', async (req, p) => {
  const m = await requireMember(req, ADMIN);
  await asMember(m, async (c) => {
    const r = await c.query('delete from documents where id = $1', [assertUuid(p.id)]);
    if (!r.rowCount) throw new HttpError(404, 'nao_encontrado');
    await audit(c, m, 'documento.eliminar', 'documents', p.id!);
  });
  return ok({ ok: true });
});
