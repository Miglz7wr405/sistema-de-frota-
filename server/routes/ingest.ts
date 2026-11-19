import { z } from 'zod';
import { route, ok, parse, HttpError, type Req } from '../http.js';
import { ingest, PointSchema, sourceForDevice, sourceForDriver, type Source } from '../ingest.js';
import { getDriver, limitOr429 } from '../auth.js';
import { withSystem, one } from '../db.js';
import { sha256 } from '../crypto.js';

const Batch = z.object({
  sent_at: z.string().datetime({ offset: true }).nullable().optional(),
  vehicle_id: z.string().uuid().optional(), // simulador
  imei: z.string().regex(/^\d{10,20}$/).optional(), // dispositivo (sem Traccar)
  positions: z.array(PointSchema).min(1).max(50),
});

async function keySource(req: Req) {
  const key = req.headers['x-ingest-key'];
  if (!key) return null;
  return withSystem((c) => one<{ key_id: string; organization_id: string; scope: string }>(c, 'select * from ingest_key_resolve($1)', [sha256(key)]));
}

route('POST', '/api/ingest', async (req) => {
  const b = parse(Batch, req.body);
  let src: Source;
  const k = await keySource(req);
  if (k) {
    if (k.scope === 'simulator') {
      if (!b.vehicle_id) throw new HttpError(400, 'vehicle_id_obrigatorio');
      const v = await withSystem((c) => one(c, 'select id from vehicles where id = $1 and organization_id = $2 and deleted_at is null', [b.vehicle_id, k.organization_id]));
      if (!v) throw new HttpError(404, 'camiao_desconhecido');
      src = { orgId: k.organization_id, vehicleId: b.vehicle_id, source: 'simulator', sourceId: `sim:${k.key_id}:${b.vehicle_id}` };
    } else {
      if (!b.imei) throw new HttpError(400, 'imei_obrigatorio');
      src = await sourceForDevice(k.organization_id, b.imei, b.positions[0]!.device_time);
    }
  } else {
    const d = await getDriver(req);
    if (!d) throw new HttpError(401, 'nao_autenticado');
    src = await sourceForDriver(d.driverId, d.orgId, d.revokedAt);
  }
  await limitOr429(`ingest:${src.sourceId}`, 60, 30);
  return ok(await ingest(src, b.positions, b.sent_at ?? null));
});

// Formato de encaminhamento de posições do Traccar ("forward.url" / forward.json).
// ⚠️ NÃO TESTADO com um servidor Traccar real: estrutura conforme a documentação do Traccar, a confirmar na versão instalada.
const TraccarSchema = z.object({
  position: z.object({
    latitude: z.number(), longitude: z.number(), fixTime: z.string(), speed: z.number().nullable().optional(), course: z.number().nullable().optional(),
    accuracy: z.number().nullable().optional(), attributes: z.record(z.unknown()).optional(),
  }),
  device: z.object({ uniqueId: z.string() }),
});

route('POST', '/api/ingest/traccar', async (req) => {
  const k = await keySource(req);
  if (!k || k.scope !== 'traccar') throw new HttpError(401, 'chave_invalida');
  const b = parse(TraccarSchema, req.body);
  const fixTime = new Date(b.position.fixTime).toISOString();
  const src = await sourceForDevice(k.organization_id, b.device.uniqueId, fixTime);
  await limitOr429(`ingest:${src.sourceId}`, 60, 30);
  const attrs = b.position.attributes ?? {};
  const pt = {
    lat: b.position.latitude, lng: b.position.longitude, device_time: fixTime,
    speed_kmh: b.position.speed != null ? b.position.speed * 1.852 : null, // Traccar envia velocidade em nós
    heading: b.position.course ?? null, accuracy_m: b.position.accuracy || null,
    battery_pct: typeof attrs.batteryLevel === 'number' ? Math.round(attrs.batteryLevel) : null,
    ignition: typeof attrs.ignition === 'boolean' ? attrs.ignition : null,
  };
  return ok(await ingest(src, [parse(PointSchema, pt)], null));
});

// Para o simulador GPS: rota atual da viagem ativa de um camião (só com chave de simulador da mesma organização).
route('GET', '/api/ingest/route', async (req) => {
  const k = await keySource(req);
  if (!k || k.scope !== 'simulator') throw new HttpError(401, 'chave_invalida');
  const vehicleId = req.query.get('vehicle_id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) throw new HttpError(400, 'vehicle_id_obrigatorio');
  const r = await withSystem((c) => one<{ trip_id: string; code: string; g: string; length_m: number }>(c, `select t.id trip_id, t.code, ST_AsGeoJSON(r.geom::geometry, 6) g, r.length_m
    from trips t join trip_routes r on r.trip_id = t.id and r.is_current
    where t.vehicle_id = $1 and t.organization_id = $2 and t.status in ('em_viagem','pausada') and t.deleted_at is null limit 1`, [vehicleId, k.organization_id]));
  if (!r) throw new HttpError(404, 'sem_viagem_ativa_com_rota');
  return ok({ tripId: r.trip_id, code: r.code, lengthM: r.length_m, coordinates: JSON.parse(r.g).coordinates });
});
