// Testes de integração: BD Postgres+PostGIS real (local), migrações reais, papel app_api com RLS, API real (dispatch).
// Requer: TEST_DATABASE_ADMIN_URL (ex.: postgres://postgres:postgres@localhost/postgres). Sem ela, os testes são ignorados.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { migrate } from '../db/migrate';
import { setPoolsForTests } from '../server/db';
import { dispatch } from '../server/app';
import { setRoutingProviderForTests } from '../server/routing';
import { cumulative, type LngLat } from '../src/lib/geo/geometry';
import { simulate } from '../src/lib/geo/simulate';

const ADMIN = process.env.TEST_DATABASE_ADMIN_URL;
const d = ADMIN ? describe : describe.skip;
const dbName = `frota_t_${randomBytes(4).toString('hex')}`;
let sys: pg.Pool, app: pg.Pool;

// ── Rota de teste (sintética, não representa estrada real): linha com curvas entre os pontos pedidos ──
function synthRoute(points: LngLat[]) {
  const coords: LngLat[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [a, b] = [points[k]!, points[k + 1]!];
    for (let i = 0; i <= 200; i++) {
      if (k > 0 && i === 0) continue;
      const f = i / 200;
      coords.push([a[0] + (b[0] - a[0]) * f + Math.sin(f * Math.PI) * 0.02, a[1] + (b[1] - a[1]) * f]);
    }
  }
  const cum = cumulative(coords);
  return { provider: 'teste', coords, cum, lengthM: cum[cum.length - 1]!, durationS: (cum[cum.length - 1]! / 1000 / 60) * 3600, roads: ['EN-TESTE'], validatedForTruck: false };
}

type Session = { cookie?: string; bearer?: string; ingestKey?: string };
async function call(method: string, path: string, s: Session = {}, body?: unknown) {
  const [p, qs] = path.split('?');
  const headers: Record<string, string> = { host: 'localhost:5173', 'user-agent': 'vitest' };
  if (s.cookie) headers.cookie = s.cookie;
  if (s.bearer) headers.authorization = `Bearer ${s.bearer}`;
  if (s.ingestKey) headers['x-ingest-key'] = s.ingestKey;
  const r = await dispatch({ method, path: p!, query: new URLSearchParams(qs ?? ''), headers, body, ip: '10.0.0.1' });
  return r as { status: number; json: any; headers?: Record<string, string>; raw?: unknown };
}
async function register(email: string, org: string): Promise<Session> {
  const r = await call('POST', '/api/auth/register', {}, { email, password: 'segredo-123', fullName: 'Pessoa Teste', orgName: org });
  expect(r.status).toBe(201);
  return { cookie: r.headers!['set-cookie']!.split(';')[0]! };
}

let A: Session, B: Session;
const ids: Record<string, string> = {};

beforeAll(async () => {
  if (!ADMIN) return;
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const sysUrl = ADMIN.replace(/\/[^/]*$/, `/${dbName}`);
  await migrate(sysUrl, () => {});
  sys = new pg.Pool({ connectionString: sysUrl, max: 4 });
  await sys.query(`alter role app_api login password 'app_api_test'`);
  const u = new URL(sysUrl); u.username = 'app_api'; u.password = 'app_api_test';
  app = new pg.Pool({ connectionString: u.toString(), max: 4 });
  setPoolsForTests(app, sys);
  setRoutingProviderForTests(async (pts) => synthRoute(pts));

  // Dados geográficos de TESTE (fictícios) — numa instalação real vêm de tools/import-places (OSM/HDX).
  const ds = (await sys.query(`insert into geo_datasets (name, source_url, license, retrieved_at) values ('teste','https://example.invalid','teste',now()) returning id`)).rows[0].id;
  const prov = async (code: string, name: string, x0: number, x1: number) => (await sys.query(
    `insert into admin_areas (level, name, code, geom, dataset_id) values (1, $1, $2, ST_Multi(ST_MakeEnvelope($3, -20, $4, -16, 4326))::geography, $5) returning id`, [name, code, x0, x1, ds])).rows[0].id;
  const p1 = await prov('T1', 'Província Teste Norte', 36, 38), p2 = await prov('T2', 'Província Teste Sul', 34, 36);
  const place = async (name: string, kind: string, imp: number, lng: number, lat: number, province: string) => (await sys.query(
    `insert into places (name, kind, importance, geom, province_id, dataset_id) values ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6,$7) returning id`,
    [name, kind, imp, lng, lat, province, ds])).rows[0].id;
  ids.origin = await place('Cidade Origem', 'city', 5, 36.9, -17.9, p1);
  ids.mid = await place('Vila Meio', 'town', 4, 36.0 + 0.02 * Math.sin(0.45 * Math.PI) + 0.0, -18.71, p2);
  ids.dest = await place('Cidade Destino', 'city', 5, 35.1, -19.5, p2);

  A = await register('a@teste.mz', 'Transportes A');
  B = await register('b@teste.mz', 'Transportes B');
});

afterAll(async () => {
  if (!ADMIN) return;
  await app?.end(); await sys?.end();
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [dbName]);
  await admin.query(`drop database if exists ${dbName}`);
  await admin.end();
});

d('segurança base', () => {
  it('RLS está ativo em TODAS as tabelas do schema public', async () => {
    const r = await sys.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity and c.relname <> 'spatial_ref_sys'`);
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });
  it('sem sessão não há acesso', async () => {
    expect((await call('GET', '/api/vehicles')).status).toBe(401);
    expect((await call('GET', '/api/auth/me')).json.user).toBeNull();
  });
  it('login com palavra-passe errada falha; certa funciona', async () => {
    expect((await call('POST', '/api/auth/login', {}, { email: 'a@teste.mz', password: 'errada-123' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', {}, { email: 'a@teste.mz', password: 'segredo-123' })).status).toBe(200);
  });
  it('e-mail duplicado é recusado', async () => {
    const r = await call('POST', '/api/auth/register', {}, { email: 'a@teste.mz', password: 'segredo-123', fullName: 'X Y', orgName: 'Outra' });
    expect(r.status).toBe(409);
  });
});

d('frota e isolamento A ↔ B', () => {
  it('A cria camião e motorista', async () => {
    const v = await call('POST', '/api/vehicles', A, { plate: 'ADF 512 MP', make: 'Scania', model: 'R450', year: 2019, capacity_t: 30, height_m: 4 });
    expect(v.status).toBe(201); ids.vehicle = v.json.id;
    const d2 = await call('POST', '/api/drivers', A, { full_name: 'João Teste Matsinhe', phone: '+258841234567' });
    expect(d2.status).toBe(201); ids.driver = d2.json.id;
    const dup = await call('POST', '/api/vehicles', A, { plate: 'adf 512 mp' });
    expect(dup.status).toBe(409); // matrícula única por organização (normalizada)
  });
  it('B não lê, não altera e não apaga dados de A (API)', async () => {
    expect((await call('GET', '/api/vehicles', B)).json).toEqual([]);
    expect((await call('GET', `/api/vehicles/${ids.vehicle}`, B)).status).toBe(404);
    expect((await call('PATCH', `/api/vehicles/${ids.vehicle}`, B, { make: 'Hack' })).status).toBe(404);
    expect((await call('DELETE', `/api/vehicles/${ids.vehicle}`, B)).status).toBe(404);
    expect((await call('GET', `/api/drivers/${ids.driver}`, B)).status).toBe(404);
  });
  it('B não lê, não altera, não apaga e não insere dados de A em NENHUMA tabela com organization_id (SQL direto como app_api)', async () => {
    const orgA = (await sys.query(`select id from organizations where name = 'Transportes A'`)).rows[0].id;
    const userB = (await sys.query(`select id from app_users where email = 'b@teste.mz'`)).rows[0].id;
    const orgB = (await sys.query(`select id from organizations where name = 'Transportes B'`)).rows[0].id;
    const tables = (await sys.query(`select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'organization_id' and t.table_type = 'BASE TABLE' and c.table_name not like 'vehicle_positions_%'`)).rows.map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(30);
    const c = await app.connect();
    try {
      for (const tname of tables) {
        await c.query('begin');
        await c.query(`select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)`, [userB, orgB]);
        let readable = 0;
        await c.query('savepoint r');
        try { readable = (await c.query(`select count(*)::int n from ${tname} where organization_id = $1`, [orgA])).rows[0].n; }
        catch (e) { expect((e as { code: string }).code, tname).toBe('42501'); await c.query('rollback to savepoint r'); }
        expect(readable, `${tname} legível por B`).toBe(0);
        for (const sql of [`update ${tname} set organization_id = organization_id where organization_id = $1`, `delete from ${tname} where organization_id = $1`]) {
          await c.query('savepoint s');
          try { const r = await c.query(sql, [orgA]); expect(r.rowCount, `${tname}: ${sql}`).toBe(0); }
          catch (e) { expect(['42501'], `${tname}: ${(e as Error).message}`).toContain((e as { code: string }).code); }
          await c.query('rollback to savepoint s');
        }
        await c.query('rollback');
      }
      // inserir na organização A com a sessão de B é recusado
      await c.query('begin');
      await c.query(`select set_config('app.user_id', $1, true)`, [userB]);
      await expect(c.query(`insert into vehicles (organization_id, plate) values ($1, 'XXX 000 MP')`, [orgA])).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback');
      // sem contexto (anónimo) não se lê nada
      await c.query('begin');
      expect((await c.query('select count(*)::int n from vehicles')).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from trips')).rows[0].n).toBe(0);
      await c.query('savepoint z');
      await expect(c.query('select * from auth_sessions')).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback to savepoint z');
      await expect(c.query('select password_hash from app_users')).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback');
    } finally { await c.query('rollback').catch(() => {}); c.release(); }
  });
  it('limite do plano é aplicado na BD (trial: 5 camiões)', async () => {
    for (let i = 0; i < 4; i++) expect((await call('POST', '/api/vehicles', B, { plate: `BBB ${100 + i} MP` })).status).toBe(201);
    expect((await call('POST', '/api/vehicles', B, { plate: 'BBB 104 MP' })).status).toBe(201);
    const r = await call('POST', '/api/vehicles', B, { plate: 'BBB 105 MP' });
    expect(r.status).toBe(402);
    expect(r.json.error).toBe('limite_plano');
  });
});

d('viagens e máquina de estados', () => {
  it('cria viagem com rota rodoviária, localidades por ordem e evento', async () => {
    const r = await call('POST', '/api/trips', A, { vehicle_id: ids.vehicle, driver_id: ids.driver, origin_place_id: ids.origin, destination_place_id: ids.dest,
      planned_departure: new Date().toISOString(), planned_arrival: new Date(Date.now() + 8 * 3600e3).toISOString(), recipient_name: 'Cliente Privado', recipient_phone: '+258849999999' });
    expect(r.status).toBe(201);
    expect(r.json.code).toMatch(/^FT-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    expect(r.json.route.lengthKm).toBeGreaterThan(100);
    ids.trip = r.json.id;
    const det = await call('GET', `/api/trips/${ids.trip}`, A);
    expect(det.json.places.map((p: { name: string }) => p.name)).toEqual(['Cidade Origem', 'Vila Meio', 'Cidade Destino']);
    expect(det.json.places[0].km_from_origin).toBe(0);
    expect(Math.abs(det.json.places[2].km_from_origin - r.json.route.lengthKm)).toBeLessThan(0.01);
    expect(det.json.events.map((e: { kind: string }) => e.kind)).toContain('criada');
  });
  it('transições inválidas são bloqueadas no backend', async () => {
    expect((await call('POST', `/api/trips/${ids.trip}/transition`, A, { to: 'concluida' })).status).toBe(422);
    expect((await call('POST', `/api/trips/${ids.trip}/transition`, A, { to: 'pausada' })).status).toBe(422);
    expect((await call('POST', `/api/trips/${ids.trip}/transition`, A, { to: 'cancelada' })).json.error).toBe('motivo_obrigatorio');
    expect((await call('POST', `/api/trips/${ids.trip}/transition`, B, { to: 'aguardando_partida' })).status).toBe(403);
  });
  it('UPDATE direto ao estado é recusado (só via trip_transition)', async () => {
    const userA = (await sys.query(`select id from app_users where email = 'a@teste.mz'`)).rows[0].id;
    const c = await app.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.user_id', $1, true)`, [userA]);
      await expect(c.query(`update trips set status = 'concluida' where id = $1`, [ids.trip])).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback');
    } finally { c.release(); }
  });
});

d('motorista, GPS, progresso e página pública', () => {
  let driverToken = '';
  it('acesso por link + PIN; PIN errado bloqueia após 5 tentativas', async () => {
    const r = await call('POST', `/api/drivers/${ids.driver}/access`, A, { pin: '4321' });
    expect(r.status).toBe(201);
    const token = r.json.link.split('#')[1];
    expect((await call('POST', '/api/driver/session', {}, { token, pin: '0000' })).status).toBe(401);
    const ok = await call('POST', '/api/driver/session', {}, { token, pin: '4321' });
    expect(ok.status).toBe(200);
    driverToken = ok.json.token;
    const me = await call('GET', '/api/driver/me', { bearer: driverToken });
    expect(me.json.trip.id).toBe(ids.trip);
    expect(me.json.route.places.length).toBe(3);
    expect(me.json.consentRequired).toBe(true);
    // Motorista não vê a lista de camiões nem viagens de outros
    expect((await call('GET', '/api/vehicles', { bearer: driverToken })).status).toBe(401);
  });
  it('sem viagem iniciada, o telemóvel não envia posições (privacidade)', async () => {
    const r = await call('POST', '/api/ingest', { bearer: driverToken }, { positions: [{ lat: -17.9, lng: 36.9, device_time: new Date().toISOString() }] });
    expect(r.status).toBe(409);
  });
  it('viagem simulada: km + restantes = rota, localidades passadas, rejeições e duplicados', async () => {
    expect((await call('POST', `/api/driver/trips/${ids.trip}/transition`, { bearer: driverToken }, { to: 'em_viagem' })).status).toBe(200);
    const det = await call('GET', `/api/trips/${ids.trip}`, A);
    const route = det.json.route;
    const coords = (await sys.query(`select ST_AsGeoJSON(geom::geometry) g from trip_routes where id = $1`, [route.id])).rows[0].g;
    const line = JSON.parse(coords).coordinates as LngLat[];
    const L = route.length_m / 1000;
    const start = Date.now() - 6 * 3600e3;
    // depois de iniciar a viagem: a hora de partida real é "agora", por isso as posições começam depois disso
    await sys.query(`update trips set actual_departure = $2 where id = $1`, [ids.trip, new Date(start - 60_000)]);
    const fixes = simulate(line, [{ type: 'drive', untilKm: L * 0.5, speedKmh: 70 }, { type: 'signal_loss', untilKm: L * 0.6, speedKmh: 70 }, { type: 'drive', untilKm: L * 0.97, speedKmh: 70 }],
      { intervalS: 60, noiseM: 8, seed: 3, startT: start });
    const toPt = (f: (typeof fixes)[number]) => ({ lat: f.lat, lng: f.lng, device_time: new Date(f.t).toISOString(), speed_kmh: f.speedKmh, heading: f.heading % 360, accuracy_m: f.accuracyM });
    for (let i = 0; i < fixes.length; i += 40) {
      const r = await call('POST', '/api/ingest', { bearer: driverToken }, { sent_at: new Date().toISOString(), positions: fixes.slice(i, i + 40).map(toPt) });
      expect(r.status).toBe(200);
    }
    // duplicados (fila offline reenviada) não criam linhas novas
    const again = await call('POST', '/api/ingest', { bearer: driverToken }, { positions: fixes.slice(0, 5).map(toPt) });
    expect(again.json.accepted).toBe(0);
    // salto impossível e futuro são rejeitados
    const bad = await call('POST', '/api/ingest', { bearer: driverToken }, { positions: [
      { lat: -10, lng: 40, device_time: new Date(fixes[fixes.length - 1]!.t + 60_000).toISOString(), accuracy_m: 10 },
      { lat: -18, lng: 36, device_time: new Date(Date.now() + 3600e3).toISOString() }] });
    expect(bad.json.rejected).toEqual(expect.arrayContaining(['salto_impossivel', 'futuro']));

    const after = await call('GET', `/api/trips/${ids.trip}`, A);
    const p = after.json.progress;
    expect(Math.abs(p.km_done + p.km_left - L) / L).toBeLessThan(0.01);
    expect(p.pct).toBeGreaterThan(90);
    expect(after.json.places.find((x: { name: string }) => x.name === 'Vila Meio').state).toBe('passada');
    expect(after.json.places.find((x: { name: string }) => x.name === 'Cidade Destino').state).not.toBe('passada');
    expect(after.json.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['partida', 'passou_localidade', 'entrou_provincia']));
    expect(after.json.position).not.toBeNull();
    // posição atrasada (fila offline antiga) não faz o progresso andar para trás
    await call('POST', '/api/ingest', { bearer: driverToken }, { positions: [toPt({ ...fixes[3]!, t: fixes[3]!.t + 1000 })] });
    const after2 = await call('GET', `/api/trips/${ids.trip}`, A);
    expect(after2.json.progress.km_done).toBeCloseTo(p.km_done, 5);
  });

  let shareToken = '', shareCode = '', shareId = '';
  it('partilha: DTO público só com campos da lista branca', async () => {
    const s = await call('POST', `/api/trips/${ids.trip}/shares`, A, {});
    expect(s.status).toBe(201);
    shareToken = s.json.link.split('/t/')[1]; shareCode = s.json.short_code; shareId = s.json.id;
    expect(shareToken.length).toBeGreaterThanOrEqual(22); // 128 bits em base64url
    const r = await call('GET', `/api/track?token=${shareToken}`);
    expect(r.status).toBe(200);
    const allowed = ['code', 'status', 'origin', 'destination', 'origin_point', 'destination_point', 'departed_at', 'delivered_at', 'planned_arrival', 'position', 'progress',
      'route_done', 'route_left', 'route_validated_for_truck', 'places', 'company', 'logo_file_id', 'plate', 'driver_first_name', 'server_time'];
    expect(Object.keys(r.json).sort()).toEqual([...allowed].sort());
    const txt = JSON.stringify(r.json);
    for (const secret of ['+258', 'Cliente Privado', ids.vehicle, ids.driver, ids.trip, 'Matsinhe', 'recipient']) expect(txt).not.toContain(secret);
    expect(r.json.plate).toBeNull(); expect(r.json.driver_first_name).toBeNull();
    expect(r.json.position).not.toBeNull();
    expect(r.json.progress.km_left).toBeGreaterThan(0);
    // por código (tolerante a minúsculas e sem hífen)
    expect((await call('GET', `/api/track?code=${shareCode.toLowerCase().replace(/-/g, '')}`)).status).toBe(200);
    expect((await call('GET', '/api/track?code=FT-2222-2222')).status).toBe(404);
    // pré-visualização Open Graph
    const og = await call('GET', `/api/preview?token=${shareToken}`);
    expect(String(og.raw)).toContain('og:title');
    expect(String(og.raw)).toContain(shareCode);
    expect(String(og.raw)).not.toContain('+258');
  });
  it('depois da entrega: "entregue" e sem posição do camião', async () => {
    expect((await call('POST', `/api/driver/trips/${ids.trip}/delivery`, { bearer: driverToken }, { received_by_name: 'Recebedor' })).status).toBe(201);
    expect((await call('POST', `/api/driver/trips/${ids.trip}/transition`, { bearer: driverToken }, { to: 'concluida' })).status).toBe(200);
    const r = await call('GET', `/api/track?token=${shareToken}`);
    expect(r.json.status).toBe('concluida');
    expect(r.json.delivered_at).not.toBeNull();
    expect(r.json.position).toBeNull();
    expect(r.json.progress).toBeNull();
    expect(r.json.route_done).toBeNull();
  });
  it('revogação: o link deixa de funcionar', async () => {
    expect((await call('POST', `/api/shares/${shareId}/revoke`, A)).status).toBe(200);
    expect((await call('GET', `/api/track?token=${shareToken}`)).status).toBe(404);
    const audit = await sys.query(`select action from audit_logs where entity_id = $1`, [shareId]);
    expect(audit.rows.map((x) => x.action)).toEqual(expect.arrayContaining(['partilha.criar', 'partilha.revogar']));
  });
  it('limitação de taxa da página pública', async () => {
    let limited = false;
    for (let i = 0; i < 70; i++) if ((await call('GET', '/api/track?token=aaaaaaaaaaaaaaaaaaaaaa')).status === 429) { limited = true; break; }
    expect(limited).toBe(true);
  });
  it('PIN errado 5 vezes bloqueia o acesso', async () => {
    const r = await call('POST', `/api/drivers/${ids.driver}/access`, A, { pin: '1111' });
    const token = r.json.link.split('#')[1];
    for (let i = 0; i < 5; i++) await call('POST', '/api/driver/session', {}, { token, pin: '9999' });
    expect((await call('POST', '/api/driver/session', {}, { token, pin: '1111' })).status).toBe(429);
  });
});

d('alertas e jobs', () => {
  it('desvio real gera um alerta (uma vez); "sem sinal" é aberto pelo job', async () => {
    // nova viagem com outro motorista
    const drv = await call('POST', '/api/drivers', A, { full_name: 'Carlos Teste', phone: '+258841111111' });
    const v2 = await call('POST', '/api/vehicles', A, { plate: 'ACN 087 MP' });
    const t = await call('POST', '/api/trips', A, { vehicle_id: v2.json.id, driver_id: drv.json.id, origin_place_id: ids.origin, destination_place_id: ids.dest });
    await call('POST', `/api/trips/${t.json.id}/transition`, A, { to: 'em_viagem' });
    const start = Date.now() - 3600e3;
    await sys.query(`update trips set actual_departure = $2 where id = $1`, [t.json.id, new Date(start - 60_000)]);
    const kr = await call('POST', '/api/ingest-keys', A, { name: 'sim', scope: 'simulator' });
    const det = await call('GET', `/api/trips/${t.json.id}`, A);
    const line = JSON.parse((await sys.query(`select ST_AsGeoJSON(geom::geometry) g from trip_routes where id = $1`, [det.json.route.id])).rows[0].g).coordinates;
    const L = det.json.route.length_m / 1000;
    const fixes = simulate(line, [{ type: 'drive', untilKm: L * 0.2, speedKmh: 60 }, { type: 'detour', untilKm: L * 0.25, speedKmh: 40, offsetM: 3000 }],
      { intervalS: 30, noiseM: 5, seed: 9, startT: start });
    const pts = fixes.map((f) => ({ lat: f.lat, lng: f.lng, device_time: new Date(f.t).toISOString(), speed_kmh: f.speedKmh, accuracy_m: f.accuracyM }));
    for (let i = 0; i < pts.length; i += 50) {
      const r = await call('POST', '/api/ingest', { ingestKey: kr.json.key }, { vehicle_id: v2.json.id, positions: pts.slice(i, i + 50) });
      expect(r.status).toBe(200);
    }
    const alerts = await call('GET', '/api/alerts', A);
    expect(alerts.json.filter((a: { kind: string; trip_id: string }) => a.kind === 'desvio' && a.trip_id === t.json.id)).toHaveLength(1);
    const evs = (await call('GET', `/api/trips/${t.json.id}`, A)).json.events.map((e: { kind: string }) => e.kind);
    expect(evs).toEqual(expect.arrayContaining(['desvio', 'recalculo']));
    // a chave de simulador de A não serve para camiões de B
    const bVeh = (await call('GET', '/api/vehicles', B)).json[0].id;
    expect((await call('POST', '/api/ingest', { ingestKey: kr.json.key }, { vehicle_id: bVeh, positions: pts.slice(0, 1) })).status).toBe(404);

    // job: posição antiga → "sem sinal"
    await sys.query(`update vehicle_latest_positions set device_time = now() - interval '40 minutes' where vehicle_id = $1`, [v2.json.id]);
    const job = (await sys.query('select run_periodic_jobs() j')).rows[0].j;
    expect(job.sem_sinal).toBeGreaterThanOrEqual(1);
    await sys.query('select run_periodic_jobs()');
    const open = (await call('GET', '/api/alerts', A)).json.filter((a: { kind: string; trip_id: string }) => a.kind === 'sem_sinal' && a.trip_id === t.json.id);
    expect(open).toHaveLength(1); // um só alerta por episódio
  });
  it('documento a expirar gera alerta', async () => {
    const exp = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    expect((await call('POST', '/api/documents', A, { driver_id: ids.driver, doc_type: 'carta_conducao', number: 'C-1', expires_on: exp })).status).toBe(201);
    await sys.query('select run_periodic_jobs()');
    const a = (await call('GET', '/api/alerts', A)).json.filter((x: { kind: string }) => x.kind === 'documento_expirar');
    expect(a.length).toBe(1);
  });
});

d('custos e relatórios', () => {
  it('totais por camião corretos e consumo L/100 km', async () => {
    const t0 = new Date(Date.now() - 864e5).toISOString();
    await call('POST', '/api/fuel', A, { vehicle_id: ids.vehicle, filled_at: t0, liters: 200, amount: 18000, odometer_km: 100000, full_tank: true });
    await call('POST', '/api/fuel', A, { vehicle_id: ids.vehicle, filled_at: new Date().toISOString(), liters: 150, amount: 13500.5, odometer_km: 100500, full_tank: true });
    await call('POST', '/api/maintenance-records', A, { vehicle_id: ids.vehicle, kind: 'Troca de óleo', done_at: new Date().toISOString().slice(0, 10), amount: 4500 });
    await call('POST', '/api/expenses', A, { trip_id: ids.trip, category: 'portagem', amount: 250 });
    const fuel = await call('GET', `/api/fuel?vehicleId=${ids.vehicle}`, A);
    expect(Number(fuel.json[0].l_per_100km)).toBeCloseTo(30, 2); // 150 L em 500 km
    const r = await call('GET', `/api/reports/summary?by=vehicle&from=${new Date(Date.now() - 3 * 864e5).toISOString()}&to=${new Date(Date.now() + 864e5).toISOString()}`, A);
    const row = r.json.rows.find((x: { id: string }) => x.id === ids.vehicle);
    expect(Number(row.fuel)).toBeCloseTo(31500.5, 2);
    expect(Number(row.maintenance)).toBeCloseTo(4500, 2);
    expect(Number(row.expenses)).toBeCloseTo(250, 2);
    expect(row.total).toBeCloseTo(36250.5, 2);
    const csv = await call('GET', '/api/reports/export.csv?by=vehicle', A);
    expect(String(csv.raw)).toContain('36250,50');
    // B não vê custos de A
    expect((await call('GET', '/api/fuel', B)).json).toEqual([]);
  });
});

d('plataforma', () => {
  it('só o admin da plataforma acede; acesso de suporte é auditado e limitado', async () => {
    expect((await call('GET', '/api/platform/orgs', A)).status).toBe(403);
    await sys.query(`update app_users set is_platform_admin = true where email = 'b@teste.mz'`);
    const r = await call('GET', '/api/platform/orgs', B);
    expect(r.status).toBe(200);
    const orgA = r.json.find((o: { name: string }) => o.name === 'Transportes A');
    expect((await call('POST', `/api/platform/orgs/${orgA.id}/support`, B, { reason: 'curto', hours: 5 })).status).toBe(400);
    expect((await call('POST', `/api/platform/orgs/${orgA.id}/support`, B, { reason: 'Pedido de ajuda do cliente', hours: 1 })).status).toBe(201);
    const aud = await sys.query(`select action from audit_logs where organization_id = $1 and action = 'plataforma.acesso_suporte'`, [orgA.id]);
    expect(aud.rowCount).toBe(1);
    await sys.query(`update app_users set is_platform_admin = false where email = 'b@teste.mz'`);
  });
});

d('testar com o meu telemóvel (dados reais)', () => {
  it('cria a viagem a partir da posição real, sessão do motorista sem PIN, ajuste à estrada guardado só se perto do GPS', async () => {
    const { setMatcherForTests } = await import('../server/matching');
    // posição "real" do telemóvel (nos testes: perto da Cidade Origem de teste)
    const near = await call('GET', '/api/places/near?lat=-17.95&lng=36.88', A);
    expect(near.status).toBe(200);
    expect(near.json.map((p: { id: string }) => p.id)).toContain(ids.dest);
    expect((await call('GET', '/api/places/near?lat=-17.95&lng=36.88', {})).status).toBe(401);

    expect((await call('POST', '/api/selftest/start', A, { lat: -17.95, lng: 36.88, accuracy: 900 })).status).toBe(422);
    // UM pedido: só a posição real. Sem telefone, sem destino (automático), sem consentimento extra, já em viagem.
    const r = await call('POST', '/api/selftest/start', A, { lat: -17.95, lng: 36.88, accuracy: 12 });
    expect(r.status).toBe(201);
    expect(r.json.destination).toBe('Vila Meio'); // a localidade importante (≥4) mais próxima entre 15 e 150 km
    const tok = r.json.driverToken as string;
    // a partida é exatamente a posição enviada
    const o = (await sys.query(`select ST_X(p.geom::geometry) x, ST_Y(p.geom::geometry) y, p.organization_id is not null priv
      from trips t join places p on p.id = t.origin_place_id where t.id = $1`, [r.json.tripId])).rows[0];
    expect([o.x, o.y, o.priv]).toEqual([36.88, -17.95, true]);
    // camião de teste não conta para o limite do plano (A já tem 5 camiões no plano experimental)
    expect((await sys.query(`select count(*)::int n from vehicles v join trips t on t.vehicle_id = v.id where t.id = $1 and v.is_test`, [r.json.tripId])).rows[0].n).toBe(1);
    const tr = (await sys.query(`select t.status, t.actual_departure, d.phone, d.user_id from trips t join drivers d on d.id = t.driver_id where t.id = $1`, [r.json.tripId])).rows[0];
    expect(tr.status).toBe('em_viagem');
    expect(tr.actual_departure).not.toBeNull();
    expect(tr.phone).toBeNull();
    expect(tr.user_id).not.toBeNull();
    expect((await sys.query(`select count(*)::int n from trip_events where trip_id = $1 and kind = 'partida'`, [r.json.tripId])).rows[0].n).toBe(1);

    const me = await call('GET', '/api/driver/me', { bearer: tok });
    expect(me.status).toBe(200);
    expect(me.json.testMode).toBe(true);
    expect(me.json.trip.id).toBe(r.json.tripId);
    expect(me.json.trip.status).toBe('em_viagem');
    expect(me.json.consentRequired).toBe(false); // consentimento dado no botão "Testar agora"

    // motoristas normais continuam a precisar de telefone
    expect((await sys.query(`select count(*)::int n from drivers where phone is null and user_id is null`)).rows[0].n).toBe(0);
    await expect(sys.query(`insert into drivers (organization_id, full_name) select organization_id, 'Sem Telefone' from drivers limit 1`)).rejects.toThrow(/drivers_phone_required/);

    // B não vê a viagem de teste de A
    expect((await call('GET', `/api/trips/${r.json.tripId}`, B)).status).toBe(404);

    // ajuste à estrada: resposta de teste perto do GPS (20 m) → aceite
    setMatcherForTests(async (fx) => ({ lat: fx[fx.length - 1]!.lat + 0.00018, lng: fx[fx.length - 1]!.lng, roadName: 'EN1', speedLimitKmh: 80, roadClass: 'trunk' }));
    const t1 = new Date().toISOString();
    const ing = await call('POST', '/api/ingest', { bearer: tok }, { positions: [{ lat: -17.95, lng: 36.88, device_time: t1, speed_kmh: 42, accuracy_m: 8 }] });
    expect(ing.status).toBe(200);
    expect(ing.json.road).toMatchObject({ roadName: 'EN1', speedLimitKmh: 80 });
    let det = await call('GET', `/api/trips/${r.json.tripId}`, A);
    expect(det.json.position.road_name).toBe('EN1');
    expect(det.json.position.speed_limit_kmh).toBe(80);
    expect(det.json.position.matched_lat).toBeCloseTo(-17.94982, 5);
    expect(Date.parse(det.json.position.matched_at)).toBe(Date.parse(det.json.position.device_time)); // o ajuste corresponde a ESTA posição

    // resposta longe do GPS (≈ 1 km) → recusada: nunca arrasta o camião para outra estrada
    await sys.query(`delete from rate_limits where bucket_key like 'match:%'`);
    setMatcherForTests(async (fx) => ({ lat: fx[fx.length - 1]!.lat + 0.01, lng: fx[fx.length - 1]!.lng, roadName: 'Outra', speedLimitKmh: 120, roadClass: 'trunk' }));
    const t2 = new Date(Date.now() + 1000).toISOString();
    const ing2 = await call('POST', '/api/ingest', { bearer: tok }, { positions: [{ lat: -17.9497, lng: 36.88, device_time: t2, speed_kmh: 45, accuracy_m: 8 }] });
    expect(ing2.json.road).toBeNull();
    det = await call('GET', `/api/trips/${r.json.tripId}`, A);
    expect(det.json.position.road_name).toBe('EN1'); // mantém a última estrada válida…
    expect(Date.parse(det.json.position.matched_at)).toBeLessThan(Date.parse(det.json.position.device_time)); // …mas o desenho usa o GPS bruto
    setMatcherForTests(async () => null);

    // novo teste termina o anterior
    const r2 = await call('POST', '/api/selftest/start', A, { lat: -17.95, lng: 36.88, accuracy: 12, destinationPlaceId: ids.dest });
    expect(r2.status).toBe(201);
    expect(r2.json.destination).toBe('Cidade Destino'); // "Mudar destino": o escolhido
    expect((await call('POST', '/api/selftest/start', B, { lat: -17.95, lng: 36.88, accuracy: 12, destinationPlaceId: r.json.tripId })).status).toBe(400);
    expect((await sys.query('select status from trips where id = $1', [r.json.tripId])).rows[0].status).toBe('concluida');
    expect((await call('GET', '/api/driver/me', { bearer: tok })).status).toBe(401);
  }, 20_000);
});

d('iniciar viagem real com o motorista ainda num teste do telemóvel', () => {
  it('o teste aberto é terminado; criar+iniciar é uma só operação; conflito real dá mensagem clara e não deixa viagem a mais', async () => {
    const st = await call('POST', '/api/selftest/start', A, { lat: -17.95, lng: 36.88, accuracy: 10 });
    expect(st.status).toBe(201);
    const drv = (await sys.query('select driver_id from trips where id = $1', [st.json.tripId])).rows[0].driver_id;
    await sys.query(`update plans set limits = limits || '{"max_vehicles": 50}' where code = 'trial'`);
    const v1 = await call('POST', '/api/vehicles', A, { plate: 'ADM 219 P' });
    const v2 = await call('POST', '/api/vehicles', A, { plate: 'ADM 220 P' });
    expect([v1.status, v2.status]).toEqual([201, 201]);
    const body = { origin_place_id: ids.origin, destination_place_id: ids.dest, driver_id: drv, start: true };
    // 1) motorista ainda no teste do telemóvel → o teste termina e a viagem real começa
    const r = await call('POST', '/api/trips', A, { ...body, vehicle_id: v1.json.id });
    expect(r.status).toBe(201);
    expect((await sys.query('select status from trips where id = $1', [st.json.tripId])).rows[0].status).toBe('concluida');
    expect((await sys.query('select status from trips where id = $1', [r.json.id])).rows[0].status).toBe('em_viagem');
    // 2) motorista numa viagem REAL em curso → 409 claro e nenhuma viagem "planeada" criada
    const before = (await sys.query(`select count(*)::int n from trips where status = 'planeada'`)).rows[0].n;
    const r2 = await call('POST', '/api/trips', A, { ...body, vehicle_id: v2.json.id });
    expect(r2.status).toBe(409);
    expect(r2.json.error).toBe('ja_em_viagem');
    // o aviso traz a viagem em conflito (código, origem → destino, o motorista em comum)
    expect(r2.json.details.trips).toHaveLength(1);
    expect(r2.json.details.trips[0]).toMatchObject({ id: r.json.id, origin: 'Cidade Origem', destination: 'Cidade Destino', same_driver: true, same_vehicle: false });
    expect((await sys.query(`select count(*)::int n from trips where status = 'planeada'`)).rows[0].n).toBe(before);
    expect((await sys.query('select status from trips where id = $1', [r.json.id])).rows[0].status).toBe('em_viagem');
    // B não consegue usar a escolha com uma viagem de A (não a vê: continua o aviso só com as dele, aqui nenhuma → nada muda em A)
    const bv = await call('POST', '/api/vehicles', B, { plate: 'BBB 111 MC' });
    const bd = await call('POST', '/api/drivers', B, { full_name: 'Motorista B', phone: '+258841119999' });
    const bp = await call('POST', '/api/trips', B, { origin_place_id: ids.origin, destination_place_id: ids.dest, vehicle_id: bv.json.id, driver_id: bd.json.id, start: true,
      replace: { tripIds: [r.json.id], action: 'cancelar' } });
    expect(bp.status).toBe(201);
    expect((await sys.query('select status from trips where id = $1', [r.json.id])).rows[0].status).toBe('em_viagem');
    // escolha "Cancelar essa viagem e iniciar esta"
    const r3 = await call('POST', '/api/trips', A, { ...body, vehicle_id: v2.json.id, replace: { tripIds: [r.json.id], action: 'cancelar' } });
    expect(r3.status).toBe(201);
    const old1 = (await sys.query('select status, cancel_reason from trips where id = $1', [r.json.id])).rows[0];
    expect(old1.status).toBe('cancelada');
    expect(old1.cancel_reason).toMatch(/^Substituída pela viagem FT-/);
    expect((await sys.query('select status from trips where id = $1', [r3.json.id])).rows[0].status).toBe('em_viagem');
    // escolha "Essa viagem já chegou — concluir e iniciar esta" (pelo botão Iniciar de uma viagem planeada)
    const p4 = await call('POST', '/api/trips', A, { origin_place_id: ids.origin, destination_place_id: ids.dest, vehicle_id: v2.json.id, driver_id: drv });
    expect((await call('POST', `/api/trips/${p4.json.id}/transition`, A, { to: 'em_viagem' })).json.error).toBe('ja_em_viagem');
    const t4 = await call('POST', `/api/trips/${p4.json.id}/transition`, A, { to: 'em_viagem', replace: { tripIds: [r3.json.id], action: 'concluir' } });
    expect(t4.status).toBe(200);
    expect((await sys.query('select status from trips where id = $1', [r3.json.id])).rows[0].status).toBe('concluida');
    expect((await sys.query('select status from trips where id = $1', [p4.json.id])).rows[0].status).toBe('em_viagem');
  });
});

d('carga e responsável da carga', () => {
  it('guarda e devolve a carga e o responsável; telefone inválido recusado indicando o campo; B não vê', async () => {
    const base = { origin_place_id: ids.origin, destination_place_id: ids.dest };
    const bad = await call('POST', '/api/trips', A, { ...base, cargo_description: 'Cimento', recipient_phone: '12345' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.details.fieldErrors)).toEqual(['recipient_phone']);
    const r = await call('POST', '/api/trips', A, { ...base, cargo_description: '30 t de cimento', recipient_name: 'Sr. João Mucavele', recipient_phone: '+258841230000' });
    expect(r.status).toBe(201);
    const det = await call('GET', `/api/trips/${r.json.id}`, A);
    expect(det.json.trip).toMatchObject({ cargo_description: '30 t de cimento', recipient_name: 'Sr. João Mucavele', recipient_phone: '+258841230000' });
    const list = await call('GET', '/api/trips', A);
    expect(list.json.find((x: { id: string }) => x.id === r.json.id)).toMatchObject({ cargo_description: '30 t de cimento' });
    expect((await call('GET', `/api/trips/${r.json.id}`, B)).status).toBe(404);
  });
});

