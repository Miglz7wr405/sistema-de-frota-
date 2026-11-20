// "Testar com o meu telemóvel": o dono usa o próprio telemóvel como camião. Tudo real: a partida é a posição GPS
// real do telemóvel, a rota vem do motor de rotas, e as posições enviadas são as do GPS real (mesma ingestão).
import { z } from 'zod';
import { route, ok, parse, HttpError } from '../http.js';
import { many, one, withSystem } from '../db.js';
import { requireMember, asMember, WRITE, audit } from '../auth.js';
import { planAndStoreTripRoute } from '../trip-route.js';
import { randomToken, sha256 } from '../crypto.js';

const TEST_PLATE = 'TESTE TELEMOVEL';

// Localidades próximas da posição real (para escolher o destino). Sem distâncias: as distâncias são sempre rodoviárias.
route('GET', '/api/places/near', async (req) => {
  const m = await requireMember(req);
  const lat = Number(req.query.get('lat')), lng = Number(req.query.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'posicao_invalida');
  return ok(await asMember(m, (c) => many(c, `select p.id, p.name, p.kind, a.name province from places p left join admin_areas a on a.id = p.province_id
    where p.deleted_at is null and (p.organization_id is null or p.organization_id = $3) and p.importance >= 3
      and ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, 400000)
      and not ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, 3000)
    order by p.geom <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography limit 12`, [lat, lng, m.orgId])));
});

route('POST', '/api/selftest/start', async (req) => {
  const m = await requireMember(req, WRITE);
  const b = parse(z.object({
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(5000),
    destinationPlaceId: z.string().uuid(), phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  }), req.body);
  if (b.accuracy > 500) throw new HttpError(422, 'precisao_insuficiente');
  const token = randomToken(32);
  const r = await withSystem(async (c) => {
    // camião e motorista de teste (reutilizados); o motorista é o próprio utilizador
    let v = await one<{ id: string }>(c, `select id from vehicles where organization_id = $1 and is_test and deleted_at is null limit 1`, [m.orgId]);
    if (!v) v = await one<{ id: string }>(c, `insert into vehicles (organization_id, plate, make, model, is_test, gps_source_priority, notes)
      values ($1, $2, 'Telemóvel', 'Teste real', true, 'phone', 'Teste com o telemóvel do utilizador (posições GPS reais)') returning id`, [m.orgId, TEST_PLATE]);
    let d = await one<{ id: string }>(c, `select id from drivers where organization_id = $1 and user_id = $2 and deleted_at is null`, [m.orgId, m.userId]);
    if (!d) d = await one<{ id: string }>(c, `select id from drivers where organization_id = $1 and phone = $2 and deleted_at is null`, [m.orgId, b.phone]);
    if (d) await c.query(`update drivers set user_id = $2, status = 'ativo' where id = $1`, [d.id, m.userId]);
    else d = await one<{ id: string }>(c, `insert into drivers (organization_id, full_name, phone, user_id) values ($1, $2, $3, $4) returning id`, [m.orgId, m.fullName, b.phone, m.userId]);
    // termina testes anteriores ainda abertos
    await c.query(`update trips set status = 'concluida', actual_arrival = coalesce(actual_arrival, now())
      where vehicle_id = $1 and status in ('em_viagem','pausada')`, [v!.id]);
    await c.query(`update trips set status = 'cancelada', cancel_reason = 'Substituída por novo teste'
      where vehicle_id = $1 and status in ('planeada','aguardando_partida')`, [v!.id]);
    // partida = posição REAL do telemóvel (local privado da organização)
    // nome = localidade real mais próxima (≤ 30 km); importância 1 → não entra nos avisos de voz nem na lista de destinos
    const nearest = await one<{ name: string }>(c, `select name from places where organization_id is null and deleted_at is null and importance >= 2
      and ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 30000) order by geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography limit 1`, [b.lng, b.lat]);
    const origin = await one<{ id: string }>(c, `insert into places (organization_id, name, kind, importance, geom, province_id)
      values ($1, $2, 'other', 1, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, (select id from province_at($3, $4))) returning id`,
      [m.orgId, nearest ? `${nearest.name} (a minha posição)` : 'A minha posição', b.lng, b.lat]);
    const dest = await one<{ id: string }>(c, `select id from places where id = $1 and deleted_at is null and (organization_id is null or organization_id = $2)`, [b.destinationPlaceId, m.orgId]);
    if (!dest) throw new HttpError(400, 'localidade_invalida');
    const t = await one<{ id: string; code: string }>(c, `insert into trips (organization_id, vehicle_id, driver_id, origin_place_id, destination_place_id, cargo_description, notes, created_by)
      values ($1, $2, $3, $4, $5, 'Teste com o telemóvel', 'Teste real com o telemóvel do utilizador', $6) returning id, code`,
      [m.orgId, v!.id, d!.id, origin!.id, dest.id, m.userId]);
    await c.query(`insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id) values ($1, $2, 'criada', 'member', $3)`, [m.orgId, t!.id, m.userId]);
    const route_ = await planAndStoreTripRoute(c, t!.id, 'plan');
    // sessão de motorista para o próprio telemóvel do dono (sem link/PIN: já está autenticado como membro)
    await c.query(`update driver_access set revoked_at = now() where driver_id = $1 and revoked_at is null`, [d!.id]);
    const acc = await one<{ id: string }>(c, `insert into driver_access (organization_id, driver_id, token_hash, pin_hash, created_by)
      values ($1, $2, $3, '!sem-pin', $4) returning id`, [m.orgId, d!.id, sha256(randomToken(32)), m.userId]);
    await c.query(`insert into driver_sessions (organization_id, driver_id, access_id, token_hash, expires_at) values ($1, $2, $3, $4, now() + interval '12 hours')`,
      [m.orgId, d!.id, acc!.id, sha256(token)]);
    return { tripId: t!.id, code: t!.code, routeKm: route_ ? route_.lengthM / 1000 : null };
  });
  await asMember(m, (c) => audit(c, m, 'teste_telemovel.iniciar', 'trips', r.tripId));
  return ok({ ...r, driverToken: token }, 201);
});
