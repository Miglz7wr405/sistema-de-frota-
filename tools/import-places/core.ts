// Importação reprodutível da base geográfica de Moçambique (prompt 8A.1). NADA é escrito à mão:
// tudo vem do OpenStreetMap via Overpass API, com fonte, licença e data registadas em geo_datasets.
// ⚠️ DEPENDÊNCIA EXTERNA: overpass-api.de (gratuito, uso justo). Dados © OpenStreetMap contributors, ODbL 1.0.
import type pg from 'pg';

// Servidores Overpass públicos (o primeiro que responder). ⚠️ DEPENDÊNCIA EXTERNA: serviços gratuitos, sem SLA.
const MIRRORS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];
let OVERPASS = MIRRORS[0]!;
const AREA = 'area["ISO3166-1"="MZ"][admin_level=2]->.mz;';

async function overpass(query: string): Promise<{ elements: any[] }> {
  const errors: string[] = [];
  const only = process.env.OVERPASS_MIRROR_INDEX;
  for (const url of only != null ? [MIRRORS[Number(only)] ?? MIRRORS[0]!] : MIRRORS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'insightFrota/0.1 (importacao de localidades)' },
        body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(Number(process.env.OVERPASS_TIMEOUT_MS ?? 60_000)) });
      if (!r.ok) { errors.push(`${url}:${r.status}`); console.warn('[overpass]', url, r.status); continue; }
      OVERPASS = url;
      return (await r.json()) as { elements: any[] };
    } catch (e) { errors.push(`${url}:${(e as Error).message}`); console.warn('[overpass]', url, (e as Error).message); }
  }
  throw new Error(`overpass_indisponivel ${errors.join(' | ')}`);
}

async function dataset(c: pg.ClientBase, name: string, query: string) {
  return (await c.query(`insert into geo_datasets (name, source_url, license, retrieved_at, version) values ($1, $2, 'ODbL 1.0 (© OpenStreetMap contributors)', now(), $3) returning id`,
    [name, OVERPASS, query.slice(0, 500)])).rows[0].id as string;
}

/** Lista das províncias (admin_level=4): só ids e etiquetas (consulta leve). */
export async function listProvinces() {
  const q = `[out:json][timeout:55];${AREA}rel(area.mz)["boundary"="administrative"]["admin_level"="4"];out tags;`;
  const data = await overpass(q);
  return data.elements.filter((e) => e.type === 'relation').map((e) => ({ id: e.id as number, name: (e.tags?.['name:pt'] ?? e.tags?.name) as string }));
}

/** Uma província: polígono montado no PostGIS a partir das linhas da relação (uma consulta por relação). */
export async function importProvince(c: pg.ClientBase, relId: number) {
  const q = `[out:json][timeout:55];rel(${Math.trunc(relId)});out geom;`;
  const data = await overpass(q);
  const rel = data.elements.find((e) => e.type === 'relation');
  if (!rel) return { provinces: 0 };
  const ds = await dataset(c, `OSM — província (relação ${relId}, admin_level=4)`, q);
  const lines = (rel.members ?? []).filter((m: any) => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === ''))
    .map((m: any) => ({ type: 'LineString', coordinates: m.geometry.map((p: any) => [p.lon, p.lat]) }));
  if (!lines.length) return { provinces: 0 };
  const name = rel.tags?.['name:pt'] ?? rel.tags?.name;
  const code = rel.tags?.['ISO3166-2'] ?? `osm-r${rel.id}`;
  const r = await c.query(`insert into admin_areas (level, name, code, geom, dataset_id)
    select 1, $1, $2, ST_Multi(ST_CollectionExtract(ST_BuildArea(ST_Collect(ST_GeomFromGeoJSON(g::text))), 3))::geography, $4
    from jsonb_array_elements($3::jsonb) g
    having not ST_IsEmpty(ST_BuildArea(ST_Collect(ST_GeomFromGeoJSON(g::text))))
    on conflict (level, code) do update set name = excluded.name, geom = excluded.geom, dataset_id = excluded.dataset_id, updated_at = now()`,
    [name, code, JSON.stringify(lines), ds]);
  await c.query(`update places p set province_id = a.id from admin_areas a where a.level = 1 and a.code = $1 and ST_Covers(a.geom, p.geom) and p.province_id is distinct from a.id`, [code]);
  return { provinces: r.rowCount ?? 0, name };
}

/** Todas as províncias (CLI): lista + uma consulta por província. */
export async function importProvinces(c: pg.ClientBase) {
  let n = 0;
  for (const p of await listProvinces()) n += (await importProvince(c, p.id)).provinces;
  return { provinces: n };
}

const KIND: Record<string, string> = { city: 'city', town: 'town', village: 'village' };

/** Localidades + pontos de referência (portagens, fronteiras, postos de controlo, balanças). */
export async function importPlaces(c: pg.ClientBase) {
  const q = `[out:json][timeout:55];${AREA}(node(area.mz)["place"~"^(city|town|village)$"]["name"];node(area.mz)["barrier"~"^(toll_booth|border_control)$"];` +
    `node(area.mz)["highway"="checkpoint"];node(area.mz)["amenity"="weighbridge"];);out body;`;
  const data = await overpass(q);
  const ds = await dataset(c, 'OSM — localidades e pontos de referência de Moçambique', q);
  const rows = data.elements.filter((e) => e.type === 'node').map((e) => {
    const tg = e.tags ?? {};
    const kind: string = tg.place ? KIND[tg.place] ?? 'village' : tg.barrier === 'toll_booth' ? 'toll' : tg.barrier === 'border_control' ? 'border' : tg.highway === 'checkpoint' ? 'checkpoint' : 'weighbridge';
    // Importância (1–5) derivada das etiquetas OSM; ajustável depois com registo.
    const importance = tg.place === 'city' ? (tg.capital === '4' || tg.capital === '2' || tg.capital === 'yes' ? 5 : 4) : tg.place === 'town' ? 3 : tg.place === 'village' ? 2 : kind === 'border' ? 3 : 2;
    const name = tg['name:pt'] ?? tg.name ?? (kind === 'toll' ? 'Portagem' : kind === 'border' ? 'Fronteira' : kind === 'checkpoint' ? 'Posto de controlo' : 'Balança');
    const variants = [tg.name, tg.alt_name, tg.old_name, tg.official_name, tg['name:en']].filter((v) => v && v !== name).flatMap((v: string) => v.split(';'));
    return { osm_id: `n${e.id}`, name, kind, importance, lng: e.lon, lat: e.lat, variants };
  });
  let n = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const r = await c.query(`insert into places (name, name_variants, kind, importance, geom, osm_id, dataset_id)
      select x.name, coalesce(array(select jsonb_array_elements_text(x.variants)), '{}'), x.kind, x.importance,
             ST_SetSRID(ST_MakePoint(x.lng, x.lat), 4326)::geography, x.osm_id, $2
      from jsonb_to_recordset($1::jsonb) as x(osm_id text, name text, kind text, importance int, lng float8, lat float8, variants jsonb)
      on conflict (osm_id) where osm_id is not null do update set name = excluded.name, name_variants = excluded.name_variants, kind = excluded.kind,
        importance = excluded.importance, geom = excluded.geom, dataset_id = excluded.dataset_id, updated_at = now()`,
      [JSON.stringify(rows.slice(i, i + 2000)), ds]);
    n += r.rowCount ?? 0;
  }
  await c.query(`update places p set province_id = a.id from admin_areas a where a.level = 1 and ST_Covers(a.geom, p.geom) and p.province_id is distinct from a.id`);
  return { places: n, by_kind: rows.reduce((m: Record<string, number>, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {}) };
}
