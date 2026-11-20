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
  const id = Math.trunc(relId);
  // 1) etiquetas da relação (leve); 2) só as linhas, sem etiquetas (out skel geom) — resposta muito menor.
  const meta = (await overpass(`[out:json][timeout:25];rel(${id});out tags;`)).elements.find((e) => e.type === 'relation');
  if (!meta) return { provinces: 0 };
  const q = `[out:json][timeout:55];rel(${id});way(r);out skel geom;`;
  const ways = (await overpass(q)).elements.filter((e) => e.type === 'way' && e.geometry);
  if (!ways.length) return { provinces: 0 };
  const ds = await dataset(c, `OSM — província (relação ${id}, admin_level=4)`, q);
  const lines = ways.map((w: any) => ({ type: 'LineString', coordinates: w.geometry.map((p: any) => [p.lon, p.lat]) }));
  const name = meta.tags?.['name:pt'] ?? meta.tags?.name;
  const code = meta.tags?.['ISO3166-2'] ?? `osm-r${id}`;
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

// ── Províncias completas a partir do geoBoundaries (ADM1, simplificado) ─────────────────────────────────
// ⚠️ DEPENDÊNCIA EXTERNA: geoboundaries.org / GitHub (gratuito). Licença CC BY 4.0; origem OCHA COD-AB.
// Um único GeoJSON pequeno: evita os pedidos pesados ao Overpass que eram recusados.
const GB_API = 'https://www.geoboundaries.org/api/current/gbOpen/MOZ/ADM1/';
const GB_RAW = 'https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/MOZ/ADM1/geoBoundaries-MOZ-ADM1_simplified.geojson';
// Nomes em português de Moçambique para os nomes ingleses/sem acento do geoBoundaries.
const PT_NAMES: Record<string, string> = { 'maputo city': 'Cidade de Maputo', 'cidade de maputo': 'Cidade de Maputo', 'maputo cidade': 'Cidade de Maputo',
  zambezia: 'Zambézia', 'zambézia': 'Zambézia' };
const ptName = (n: string) => PT_NAMES[n.trim().toLowerCase()] ?? n.trim();
const norm = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { 'user-agent': 'insightFrota/0.1' }, signal: AbortSignal.timeout(40_000), redirect: 'follow' });
  if (!r.ok) throw new Error(`geoboundaries_${r.status}`);
  return r.json() as Promise<any>;
}

export async function importProvincesGeoBoundaries(c: pg.ClientBase, override?: { features: any[] }) {
  let fc: { features: any[] } | null = override ?? null;
  let source = 'override';
  if (!fc) {
    try {
      const meta = await fetchJson(GB_API);
      source = meta.simplifiedGeometryGeoJSON;
      fc = await fetchJson(source);
    } catch {
      source = GB_RAW;
      fc = await fetchJson(GB_RAW);
    }
  }
  const ds = (await c.query(`insert into geo_datasets (name, source_url, license, retrieved_at, version) values ($1, $2, 'CC BY 4.0 (geoBoundaries / OCHA COD-AB)', now(), 'ADM1 simplificado') returning id`,
    ['geoBoundaries — províncias de Moçambique (ADM1)', source])).rows[0].id;
  const existing = (await c.query(`select id, name, code from admin_areas where level = 1`)).rows as { id: string; name: string; code: string }[];
  let n = 0;
  for (const f of fc!.features) {
    const raw = String(f.properties?.shapeName ?? f.properties?.name ?? '').trim();
    if (!raw || !f.geometry) continue;
    const name = ptName(raw);
    const match = existing.find((e) => norm(e.name) === norm(name));
    const code = match?.code ?? String(f.properties?.shapeISO || f.properties?.shapeID || `gb-${norm(name)}`);
    await c.query(`insert into admin_areas (level, name, code, geom, dataset_id)
      values (1, $1, $2, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)), 3))::geography, $4)
      on conflict (level, code) do update set name = excluded.name, geom = excluded.geom, dataset_id = excluded.dataset_id, updated_at = now()`,
      [match?.name ?? name, code, JSON.stringify(f.geometry), ds]);
    n++;
  }
  // Liga cada localidade à província que a contém; no litoral (polígono simplificado) usa a província mais próxima até 10 km.
  await c.query(`update places p set province_id = a.id from admin_areas a where a.level = 1 and ST_Covers(a.geom, p.geom) and p.province_id is distinct from a.id`);
  await c.query(`update places p set province_id = (select a.id from admin_areas a where a.level = 1 and ST_DWithin(a.geom, p.geom, 10000) order by ST_Distance(a.geom, p.geom) limit 1)
    where p.province_id is null`);
  return { provinces: n, source };
}
