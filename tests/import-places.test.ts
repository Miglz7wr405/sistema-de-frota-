// Testa a importação com uma resposta Overpass SINTÉTICA servida localmente (formato real do Overpass, dados fictícios).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { migrate } from '../db/migrate';

const ADMIN = process.env.TEST_DATABASE_ADMIN_URL;
const d = ADMIN ? describe : describe.skip;
const dbName = `frota_imp_${randomBytes(3).toString('hex')}`;
let srv: Server; let c: pg.Client;

const square = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([lon, lat]) => ({ lon, lat }));
const provinces = { elements: [
  { type: 'relation', id: 1, tags: { name: 'Província Norte Teste', 'ISO3166-2': 'MZ-T1' }, members: [
    { type: 'way', role: 'outer', geometry: square(36, -18, 37, -17).slice(0, 3) }, { type: 'way', role: 'outer', geometry: square(36, -18, 37, -17).slice(2) }] },
  { type: 'relation', id: 2, tags: { name: 'Província Sul Teste', 'ISO3166-2': 'MZ-T2' }, members: [{ type: 'way', role: 'outer', geometry: square(35, -20, 36, -18) }] },
] };
const places = { elements: [
  { type: 'node', id: 10, lat: -17.5, lon: 36.5, tags: { place: 'city', name: 'Cidade Teste', capital: '4', alt_name: 'Cidade T' } },
  { type: 'node', id: 11, lat: -19, lon: 35.5, tags: { place: 'town', name: 'Vila Teste' } },
  { type: 'node', id: 12, lat: -19.5, lon: 35.2, tags: { barrier: 'toll_booth' } },
] };

beforeAll(async () => {
  if (!ADMIN) return;
  srv = createServer((req, res) => { let b = ''; req.on('data', (x) => (b += x)); req.on('end', () => { const q = decodeURIComponent(b);
    const mt = /rel\((\d+)\);out tags/.exec(q);
    const m = /rel\((\d+)\);way\(r\);out skel geom/.exec(q);
    res.end(JSON.stringify(mt ? { elements: provinces.elements.filter((e) => e.id === Number(mt[1])).map((e) => ({ type: e.type, id: e.id, tags: e.tags })) }
      : m ? { elements: provinces.elements.filter((e) => e.id === Number(m[1])).flatMap((e) => e.members.map((w, i) => ({ type: 'way', id: i, geometry: w.geometry }))) }
      : q.includes('admin_level"="4') ? { elements: provinces.elements.map((e) => ({ type: e.type, id: e.id, tags: e.tags })) } : places)); }); }).listen(4011);
  process.env.OVERPASS_URL = 'http://localhost:4011/api/interpreter';
  const a = new pg.Client({ connectionString: ADMIN }); await a.connect(); await a.query(`create database ${dbName}`); await a.end();
  const url = ADMIN.replace(/\/[^/]*$/, `/${dbName}`);
  await migrate(url, () => {});
  c = new pg.Client({ connectionString: url }); await c.connect();
});
afterAll(async () => {
  if (!ADMIN) return;
  srv.close(); await c.end();
  const a = new pg.Client({ connectionString: ADMIN }); await a.connect(); await a.query(`drop database if exists ${dbName} with (force)`); await a.end();
});

d('importação de localidades (OSM)', () => {
  it('monta províncias, importa localidades com importância e província, regista a fonte, e é idempotente', async () => {
    const { importProvinces, importPlaces } = await import('../tools/import-places/core');
    expect((await importProvinces(c)).provinces).toBe(2);
    const r = await importPlaces(c);
    expect(r.places).toBe(3);
    await importPlaces(c); // 2.ª vez não duplica
    const rows = (await c.query(`select p.name, p.kind, p.importance, p.name_variants, a.name prov from places p left join admin_areas a on a.id = p.province_id order by p.name`)).rows;
    expect(rows).toEqual([
      { name: 'Cidade Teste', kind: 'city', importance: 5, name_variants: ['Cidade T'], prov: 'Província Norte Teste' },
      { name: 'Portagem', kind: 'toll', importance: 2, name_variants: [], prov: 'Província Sul Teste' },
      { name: 'Vila Teste', kind: 'town', importance: 3, name_variants: [], prov: 'Província Sul Teste' },
    ]);
    const ds = (await c.query(`select license from geo_datasets`)).rows;
    expect(ds.every((x) => x.license.includes('ODbL'))).toBe(true);
  });
});

d('províncias do geoBoundaries', () => {
  it('importa, traduz nomes, reutiliza o código existente e liga localidades (inclui as do litoral)', async () => {
    const { importProvincesGeoBoundaries } = await import('../tools/import-places/core');
    const sq = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
    const r = await importProvincesGeoBoundaries(c, { features: [
      { properties: { shapeName: 'Província Norte Teste', shapeISO: 'MZ-XX' }, geometry: sq(36, -18, 37, -17) },
      { properties: { shapeName: 'Zambezia', shapeISO: 'MZ-Q' }, geometry: sq(37, -18, 38, -17) },
    ] });
    expect(r.provinces).toBe(2);
    const names = (await c.query(`select name, code from admin_areas order by name`)).rows;
    expect(names.map((x) => x.name)).toEqual(['Província Norte Teste', 'Província Sul Teste', 'Zambézia']);
    expect(names.find((x) => x.name === 'Província Norte Teste').code).toBe('MZ-T1'); // reutiliza o código já existente
  });
});
