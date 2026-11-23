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
// distritos REAIS (geoBoundaries ADM2, CC BY 4.0) do centro/norte, para a página pública e a voz mostrarem o distrito
const fc = JSON.parse(readFileSync(new URL('./fixtures/distritos-teste.geojson', import.meta.url)));
const dd = (await c.query(`insert into geo_datasets (name, source_url, license, retrieved_at) values ('geoBoundaries ADM2 (amostra)', 'https://www.geoboundaries.org', 'CC BY 4.0', now()) returning id`)).rows[0].id;
for (const f of fc.features) {
  const name = f.properties.shapeName.replace(/\s+(De|Da|Do)(?=\s)/g, (m) => m.toLowerCase());
  await c.query(`insert into admin_areas (level, name, code, geom, dataset_id) values (2, $1, $2, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)), 3))::geography, $4) on conflict do nothing`,
    [name, f.properties.shapeID, JSON.stringify(f.geometry), dd]);
}
await c.end();
console.log(`${rows.length} localidades`);
