// Semeia a BD local de E2E com localidades REAIS (extraídas da base OSM importada em produção; ODbL).
import pg from 'pg';
import { readFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(process.env.E2E_PLACES_FILE ?? new URL('./fixtures/places-corredor.json', import.meta.url)));
const rows = Array.isArray(raw) ? raw : raw.localidades;
const c = new pg.Client({ connectionString: process.env.SYSTEM_DATABASE_URL });
await c.connect();
const ds = (await c.query(`insert into geo_datasets (name, source_url, license, retrieved_at) values ('OSM (amostra do corredor Quelimane–Beira)', 'https://overpass-api.de', 'ODbL 1.0', now()) returning id`)).rows[0].id;
for (const [osm, name, kind, imp, lng, lat] of rows)
  await c.query(`insert into places (osm_id, name, kind, importance, geom, dataset_id) values ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, $7) on conflict do nothing`, [osm, name, kind, imp, lng, lat, ds]);
await c.end();
console.log(`${rows.length} localidades`);
