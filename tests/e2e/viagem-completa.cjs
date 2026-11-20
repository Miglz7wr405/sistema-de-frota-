// Teste completo, como um utilizador real: um senhor regista-se, regista o camião, cria a viagem Quelimane → Beira
// (rota REAL do Valhalla, localidades OSM reais), parte com o GPS do telemóvel, o dono acompanha no computador, o cliente
// acompanha pelo link, e a viagem conclui-se sozinha ao chegar. Depois o essencial para Quelimane → Nampula.
// O GPS é EMULADO pelo navegador ao longo da estrada real (não há camião a andar). Os ~650 km do meio são enviados pela mesma
// porta de ingestão com as horas da viagem (como a fila offline do telemóvel); o início e o fim são em tempo real.
const { chromium } = require('playwright');
const pg = require('pg');
const fs = require('fs');
const B = process.env.E2E_BASE ?? 'http://localhost:4173';
const SHOT = 'test-results/viagem/';
fs.mkdirSync(SHOT, { recursive: true });
const fx = JSON.parse(fs.readFileSync('tests/e2e/fixtures/rotas-reais.json', 'utf8'));

const decode = (s) => { let i = 0, lat = 0, lng = 0; const out = []; while (i < s.length) { for (const k of [0, 1]) { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) lat += d; else lng += d; } out.push([lng / 1e5, lat / 1e5]); } return out; };
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const line = (coords) => { const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + hav(coords[i - 1], coords[i])); return { coords, cum, L: cum[cum.length - 1] }; };
const at = (ln, m) => { m = Math.max(0, Math.min(ln.L, m)); let i = 1; while (i < ln.cum.length - 1 && ln.cum[i] < m) i++; const f = (m - ln.cum[i - 1]) / Math.max(1e-9, ln.cum[i] - ln.cum[i - 1]); const a = ln.coords[i - 1], b = ln.coords[i]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const noisy = ([lng, lat], m) => [lng + ((rnd() - 0.5) * 2 * m) / 111320 / Math.cos((lat * Math.PI) / 180), lat + ((rnd() - 0.5) * 2 * m) / 110540];

const BEIRA = line(decode(fx.rotas[0].polyline));
const NAMPULA = line(decode(fx.rotas[1].polyline));

(async () => {
  const db = new pg.Client({ connectionString: process.env.SYSTEM_DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch();
  const errs = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errs.push(`[${tag} pageerror] ${e.message.slice(0, 300)}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(401|404|409)/.test(m.text())) errs.push(`[${tag} console] ${m.text().slice(0, 200)}`); });
    p.on('response', (r) => { if (r.status() >= 500) errs.push(`[${tag} http ${r.status()}] ${r.url()}`); });
  };
  let failures = 0; const results = [];
  const step = async (name, page, fn) => {
    const t0 = Date.now();
    try { const info = await fn(); results.push(['OK  ', name, info ?? '']); console.log('OK  ', name, info ?? ''); }
    catch (e) { failures++; results.push(['FAIL', name, e.message.split('\n')[0]]); console.log('FAIL', name, e.message.split('\n')[0]); }
    if (page) await page.screenshot({ path: SHOT + name + '.png' }).catch(() => {});
    console.log(`      (${Math.round((Date.now() - t0) / 1000)} s)`);
  };
  const email = `senhor${Date.now()}@teste.mz`;
  const start = BEIRA.coords[0];

  // ── 1. O senhor, no telemóvel ──────────────────────────────────────────────────────────────────────────────
  const phoneA = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: start[1], longitude: start[0], accuracy: 8 }, permissions: ['geolocation'] });
  const pa = await phoneA.newPage(); watch(pa, 'telemóvel');
  let tripId = null;
  await step('01-registo-no-telemovel', pa, async () => {
    await pa.goto(B + '/register');
    await pa.getByLabel('Nome completo').fill('Joaquim Mussa');
    await pa.getByLabel('E-mail').fill(email);
    await pa.getByLabel('Palavra-passe').fill('segredo-123');
    await pa.getByLabel('Nome da empresa').fill('Transportes Mussa');
    await pa.getByRole('button', { name: 'Criar conta' }).click();
    await pa.waitForURL('**/app/dashboard', { timeout: 15000 });
    await pa.getByRole('button', { name: 'Nova viagem' }).first().waitFor();
  });
  await step('02-nova-viagem-quelimane-beira', pa, async () => {
    await pa.getByRole('button', { name: 'Nova viagem' }).first().click();
    const pick = async (idx, txt, opt) => { const i = pa.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await pa.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
    await pick(0, 'Quel', 'Quelimane');
    await pick(1, 'Beir', 'Beira');
    await pa.getByRole('button', { name: '+ Novo' }).nth(0).click();
    const dlg = pa.getByRole('dialog');
    await dlg.getByLabel('Matrícula').fill('ADM 219 P'); await dlg.getByLabel('Marca').fill('Mercedes'); await dlg.getByLabel('Modelo').fill('Actros');
    await dlg.getByRole('button', { name: 'Guardar' }).click(); await dlg.waitFor({ state: 'detached' });
    await pa.getByLabel('Motorista').selectOption({ label: 'Eu próprio (sou o motorista)' });
    await pa.waitForFunction(() => document.querySelector('select[aria-label="Motorista"]').selectedOptions[0]?.textContent.includes('(eu)'), null, { timeout: 10000 });
    await pa.getByLabel(/^Carga/).fill('30 t de cimento');
    await pa.getByLabel(/^Responsável da carga/).fill('Sr. Tembe');
    await pa.getByLabel('Telefone do responsável').fill('841230000');
    await pa.getByRole('button', { name: 'Iniciar viagem agora' }).click();
    // motorista = o próprio → abre sozinho o ecrã do motorista
    await pa.waitForURL(/\/driver\/?$/, { timeout: 25000 });
  });
  await step('03-gps-liga-sozinho', pa, async () => {
    await pa.getByText(/GPS a enviar/).first().waitFor({ timeout: 20000 });
    for (const n of ['Iniciar viagem', 'Aceito', 'Ligar GPS', 'Terminar teste', 'Falar']) if (await pa.getByRole('button', { name: n, exact: true }).count()) throw new Error(`pergunta/botão a mais: "${n}"`);
    await pa.getByText('30 t de cimento').first().waitFor();
    tripId = (await db.query(`select t.id from trips t join organizations o on o.id = t.organization_id where o.name = 'Transportes Mussa' and t.status = 'em_viagem'`)).rows[0]?.id;
    if (!tripId) throw new Error('viagem não está em viagem');
    // a 1.ª posição real chegou?
    for (let i = 0; i < 20; i++) { const n = (await db.query('select count(*)::int n from vehicle_positions where trip_id = $1', [tripId])).rows[0].n; if (n) return `${n} posição(ões) recebidas`; await pa.waitForTimeout(1000); }
    throw new Error('nenhuma posição chegou ao servidor');
  });
  // primeiros ~2 km em tempo real, a ~72 km/h (40 m a cada 2 s)
  await step('04-a-andar-quelimane', pa, async () => {
    for (let m = 40; m <= 2000; m += 40) { const [lng, lat] = noisy(at(BEIRA, m), 4); await phoneA.setGeolocation({ latitude: lat, longitude: lng, accuracy: 8 }); await pa.waitForTimeout(2000); }
    await pa.waitForTimeout(6000);
    const sp = await pa.locator('p.text-5xl').first().innerText();
    const km = await pa.getByText(/km feitos/).first().innerText();
    const kmv = Number((km.match(/([\d,]+)\s*km feitos/) ?? [])[1]?.replace(',', '.'));
    if (!/^\d+/.test(sp) || Number(sp.match(/\d+/)[0]) < 40) throw new Error('velocidade não realista: ' + sp);
    if (!(kmv > 1)) throw new Error('km feitos não avançam: ' + km);
    await pa.getByRole('tab', { name: 'Mapa' }).click(); await pa.waitForSelector('.maplibregl-marker', { timeout: 15000 }); await pa.waitForTimeout(1500);
    await pa.screenshot({ path: SHOT + '04b-mapa-no-telemovel.png' });
    await pa.getByRole('tab', { name: 'Percurso' }).click();
    return `velocidade ${sp.replace(/\s+/g, ' ')}, ${km.trim()}`;
  });
  const storage = await phoneA.storageState();
  await phoneA.close(); // o senhor fecha a app (sai sem querer)

  // ── 2. Comprimir o tempo (SÓ nesta cópia local de teste): a viagem passa a ter partido há 11 h; as posições já
  //       recebidas recuam o mesmo. Depois, ~640 km de GPS ao longo da estrada real com as horas da viagem.
  const H = 11 * 3600e3;
  await db.query(`update trips set actual_departure = actual_departure - interval '11 hours' where id = $1`, [tripId]);
  await db.query(`update vehicle_positions set device_time = device_time - interval '11 hours', received_at = received_at - interval '11 hours' where trip_id = $1`, [tripId]);
  await db.query(`update vehicle_latest_positions set device_time = device_time - interval '11 hours' where trip_id = $1`, [tripId]);
  await db.query(`update trip_progress set engine_state = '{}'::jsonb, last_position_at = null where trip_id = $1`, [tripId]);
  await db.query(`update trip_events set occurred_at = occurred_at - interval '11 hours' where trip_id = $1`, [tripId]);

  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState: storage });
  const dp = await desk.newPage(); watch(dp, 'computador');
  await dp.goto(B + '/app/dashboard');
  const tok = await dp.evaluate(async (id) => (await (await fetch(`/api/trips/${id}/my-driver-session`, { method: 'POST' })).json()).driverToken, tripId);
  const t0 = Date.now() - H + 60_000;
  const END_BULK = BEIRA.L - 7000; // os últimos 7 km fazem-se em tempo real
  await step('05-viagem-ate-perto-da-beira', null, async () => {
    const pts = []; let t = t0 + 70_000, m = 2000, stopped = false;
    while (m < END_BULK) {
      const v = (60 + rnd() * 30) / 3.6; // 60–90 km/h
      if (!stopped && m > 210_000) { t += 25 * 60_000; stopped = true; } // paragem de 25 min perto de Caia
      m = Math.min(END_BULK, m + v * 60); t += 60_000;
      const [lng, lat] = noisy(at(BEIRA, m), 6);
      pts.push({ lat, lng, device_time: new Date(t).toISOString(), speed_kmh: Math.round(v * 3.6), accuracy_m: 8 });
    }
    if (t > Date.now() - 120_000) throw new Error('simulação passou do presente');
    let accepted = 0;
    for (let i = 0; i < pts.length; i += 50) {
      const r = await dp.evaluate(async ([tk, body]) => { const x = await fetch('/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { s: x.status, j: await x.json() }; },
        [tok, { sent_at: new Date().toISOString(), positions: pts.slice(i, i + 50) }]);
      if (r.s !== 200) throw new Error('ingestão ' + r.s + ' ' + JSON.stringify(r.j));
      accepted += r.j.accepted;
    }
    const p = (await db.query('select km_done, km_left from trip_progress where trip_id = $1', [tripId])).rows[0];
    const sum = p.km_done + p.km_left, L = BEIRA.L / 1000;
    if (Math.abs(sum - L) / L > 0.01) throw new Error(`km feitos + restantes = ${sum.toFixed(1)} ≠ ${L.toFixed(1)}`);
    if (Math.abs(p.km_done - END_BULK / 1000) > 3) throw new Error(`km feitos ${p.km_done.toFixed(1)} ≠ ${(END_BULK / 1000).toFixed(1)}`);
    return `${accepted} posições aceites; ${p.km_done.toFixed(1)} km feitos + ${p.km_left.toFixed(1)} restantes = ${sum.toFixed(1)} (rota ${L.toFixed(1)} km)`;
  });
  await step('06-localidades-passadas-por-ordem', null, async () => {
    const rows = (await db.query(`select p.name, rp.km_from_origin km, rp.passed_at from trip_route_places rp join places p on p.id = rp.place_id
      join trip_routes r on r.id = rp.trip_route_id and r.is_current where r.trip_id = $1 order by rp.seq`, [tripId])).rows;
    const passed = rows.filter((r) => r.passed_at);
    for (let i = 1; i < passed.length; i++) if (passed[i].passed_at < passed[i - 1].passed_at) throw new Error(`fora de ordem: ${passed[i - 1].name} → ${passed[i].name}`);
    const port = rows.filter((r) => r.name === 'Portagem').length;
    if (port > 3) throw new Error(`"Portagem" repetida ${port} vezes`);
    const need = ['Nicoadala', 'Caia', 'Gorongosa', 'Inchope', 'Dondo'];
    for (const n of need) if (!passed.some((r) => r.name === n)) throw new Error(`não passou por ${n}`);
    return `${passed.length}/${rows.length} passadas por ordem: ${passed.filter((r) => need.includes(r.name)).map((r) => `${r.name} (km ${Math.round(r.km)})`).join(' → ')}; Portagem ×${port}`;
  });
  let shareLink = null;
  await step('07-dono-no-computador', dp, async () => {
    await dp.goto(`${B}/app/trips/${tripId}`);
    await dp.getByText(/km feitos/).first().waitFor({ timeout: 15000 });
    await dp.getByRole('button', { name: 'Criar link para o cliente' }).click();
    shareLink = await dp.locator('span.truncate').first().innerText();
    await dp.goto(B + '/app/live-map');
    await dp.getByText('ADM 219 P').first().waitFor({ timeout: 15000 }); await dp.waitForTimeout(2500);
    const v = (await dp.evaluate(() => fetch('/api/fleet/live').then((r) => r.json()))).vehicles.find((x) => x.plate === 'ADM 219 P');
    const res = await dp.evaluate(([lng, lat]) => {
      const host = [...document.querySelectorAll('*')].find((h) => h.__project); const p = host.__project([lng, lat]); const c = host.getBoundingClientRect();
      const mk = [...host.querySelectorAll('.maplibregl-marker')].find((m) => m.textContent.includes('ADM 219 P')); const b = mk.getBoundingClientRect();
      return { dx: b.left + 17 - (c.left + p.x), dy: b.top + 17 - (c.top + p.y) };
    }, [v.lng, v.lat]);
    if (Math.abs(res.dx) > 3 || Math.abs(res.dy) > 3) throw new Error('camião fora da coordenada ' + JSON.stringify(res));
    return `camião desenhado a ${Math.hypot(res.dx, res.dy).toFixed(1)} px da coordenada; link ${shareLink.replace(/^https?:\/\/[^/]+/, '')}`;
  });

  // ── 3. Os últimos 7 km em tempo real: o senhor volta a abrir a app (GPS liga sozinho) e chega à Beira ─────────
  const lastBulk = at(BEIRA, END_BULK);
  const phoneB = await browser.newContext({ viewport: { width: 400, height: 860 }, storageState: storage, geolocation: { latitude: lastBulk[1], longitude: lastBulk[0], accuracy: 8 }, permissions: ['geolocation'] });
  const pb = await phoneB.newPage(); watch(pb, 'telemóvel-2');
  const client = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage(); watch(client, 'cliente');
  await step('08-volta-a-abrir-gps-sozinho', pb, async () => {
    await pb.goto(`${B}/app/dashboard`); // entrar na app: com a viagem em curso, abre sozinho o ecrã do motorista e liga o GPS
    await pb.waitForURL(/\/driver\/?$/, { timeout: 25000 });
    await pb.getByText(/GPS a enviar/).first().waitFor({ timeout: 20000 });
    // logo ao entrar: onde está e o que já passou (do servidor, antes de andar)
    await pb.getByText(/Agora: /).first().waitFor({ timeout: 15000 });
    const passou = await pb.getByText(/Já passou por /).first().innerText();
    const kmTxt = await pb.getByText(/km feitos/).first().innerText();
    if (!/6[45]\d/.test(kmTxt.replace(/\s/g, ''))) throw new Error('não retomou no km certo: ' + kmTxt);
    return `${passou}; ${kmTxt.trim()}`;
  });
  let clientChecked = false;
  // escala do mapa do motorista: distância no ecrã entre Quelimane e a Beira (grande = aproximado)
  const scale = () => pb.evaluate(([a, b]) => { const h = [...document.querySelectorAll('*')].find((x) => x.__project); if (!h) return null;
    const p = h.__project(a), q = h.__project(b); return Math.hypot(p.x - q.x, p.y - q.y); }, [BEIRA.coords[0], BEIRA.coords[BEIRA.coords.length - 1]]);
  let zoomInfo = '';
  await step('09-ultimos-km-ate-a-beira', pb, async () => {
    await pb.getByRole('tab', { name: 'Mapa' }).click();
    await pb.waitForSelector('.maplibregl-canvas', { timeout: 15000 }); await pb.waitForTimeout(3000);
    const overview = await scale(); await pb.screenshot({ path: SHOT + '09a-mapa-rota-inteira.png' });
    let zoomed = null;
    for (let m = END_BULK + 40, i = 0; m <= BEIRA.L + 40; m += 40, i++) {
      const [lng, lat] = noisy(at(BEIRA, m), 3); await phoneB.setGeolocation({ latitude: lat, longitude: lng, accuracy: 6 }); await pb.waitForTimeout(2000);
      if (zoomed == null && m > BEIRA.L - 2500) { const sc = await scale(); if (sc && overview && sc > overview * 3) { zoomed = sc; await pb.waitForTimeout(3000); await pb.screenshot({ path: SHOT + '09c-mapa-aproximado-na-beira.png' }); } }
      if (!clientChecked && m > END_BULK + 3000) { // a meio: o cliente abre o link
        clientChecked = true;
        await client.goto(shareLink.replace(/^https?:\/\/[^/]+/, B)); await client.getByText(/Agora:/).first().waitFor({ timeout: 15000 }); await client.getByText(/Já passou por /).first().waitFor(); await client.waitForTimeout(1500);
        await client.screenshot({ path: SHOT + '09b-cliente-a-meio.png', fullPage: true });
        const proj = () => client.evaluate(() => { const h = [...document.querySelectorAll('*')].find((x) => x.__project); return h.__project([34.84, -19.8]); });
        const before = await proj(); const bx = await client.locator('.maplibregl-canvas').boundingBox();
        await client.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await client.mouse.down(); await client.mouse.move(bx.x + 50, bx.y + 40, { steps: 6 }); await client.mouse.up();
        const after = await proj();
        if (Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1) throw new Error('o mapa do cliente mexeu');
      }
    }
    for (let i = 0; i < 30; i++) { const s = (await db.query('select status from trips where id = $1', [tripId])).rows[0].status; if (s === 'concluida') break; await pb.waitForTimeout(1000); }
    const t = (await db.query(`select t.status, (select count(*)::int from trip_events e where e.trip_id = t.id and e.kind = 'chegada' and e.actor_type = 'system') auto from trips t where t.id = $1`, [tripId])).rows[0];
    if (t.status !== 'concluida' || t.auto !== 1) throw new Error('não concluiu sozinha: ' + JSON.stringify(t));
    if (!(overview > 50 && overview < 400)) throw new Error('ao entrar o mapa não mostra a rota inteira (escala ' + overview + ')');
    if (!zoomed) throw new Error('ao chegar à Beira o mapa não aproximou');
    return `chegou à Beira → "Concluída" automaticamente; mapa: rota inteira (${Math.round(overview)} px) → aproximado ao chegar (${Math.round(zoomed)} px)`;
  });
  await step('10-depois-da-chegada', client, async () => {
    await client.reload(); await client.getByText(/Entregue|Concluída/).first().waitFor({ timeout: 20000 });
    const dto = await client.evaluate(async () => { const tok = location.pathname.split('/')[2]; return (await fetch(`/api/track?token=${tok}`)).json(); }).catch(() => null);
    if (dto && dto.position) throw new Error('o cliente ainda vê a posição depois da entrega');
    await dp.goto(`${B}/app/trips/${tripId}`); await dp.getByText('Concluída').first().waitFor({ timeout: 15000 }); await dp.screenshot({ path: SHOT + '10b-computador-concluida.png' });
  });

  // ── 4. Quelimane → Nampula (2.ª rota real), o essencial ─────────────────────────────────────────────────────
  let trip2 = null;
  await step('11-quelimane-nampula', pb, async () => {
    // o camião volta a Quelimane para a viagem seguinte (o telemóvel está lá)
    const q = NAMPULA.coords[0]; await phoneB.setGeolocation({ latitude: q[1], longitude: q[0], accuracy: 8 });
    await pb.goto(B + '/app/trips/new');
    const pick = async (idx, txt, opt) => { const i = pb.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await pb.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
    await pick(0, 'Quel', 'Quelimane'); await pick(1, 'Namp', 'Nampula');
    await pb.getByRole('button', { name: 'Iniciar viagem agora' }).click(); // camião e motorista (eu) já escolhidos
    await pb.waitForURL(/\/driver\/?$/, { timeout: 25000 });
    trip2 = (await db.query(`select t.id from trips t join places d on d.id = t.destination_place_id where d.name = 'Nampula' and t.status = 'em_viagem' order by t.created_at desc limit 1`)).rows[0]?.id;
    if (!trip2) throw new Error('viagem Nampula não iniciou');
    await phoneB.close();
    // um camião não está em duas estradas ao mesmo tempo: a viagem da Beira (já concluída) passa a ter sido 12 h antes
    await db.query(`update trips set actual_departure = actual_departure - interval '12 hours', actual_arrival = actual_arrival - interval '12 hours' where id = $1`, [tripId]);
    await db.query(`update vehicle_positions set device_time = device_time - interval '12 hours', received_at = received_at - interval '12 hours' where trip_id = $1`, [tripId]);
    await db.query(`update vehicle_latest_positions set device_time = device_time - interval '12 hours' where trip_id = $1`, [tripId]);
    await db.query(`update trips set actual_departure = actual_departure - interval '11 hours' where id = $1`, [trip2]);
    await db.query(`update vehicle_positions set device_time = device_time - interval '11 hours', received_at = received_at - interval '11 hours' where trip_id = $1`, [trip2]);
    await db.query(`update vehicle_latest_positions set device_time = device_time - interval '11 hours' where trip_id = $1`, [trip2]);
    await db.query(`update trip_progress set engine_state = '{}'::jsonb, last_position_at = null where trip_id = $1`, [trip2]);
    const tk = await dp.evaluate(async (id) => (await (await fetch(`/api/trips/${id}/my-driver-session`, { method: 'POST' })).json()).driverToken, trip2);
    const pts = []; let t = Date.now() - H + 120_000, m = 0;
    while (m < NAMPULA.L) { const v = (60 + rnd() * 30) / 3.6; m = Math.min(NAMPULA.L + 30, m + v * 60); t += 60_000; const [lng, lat] = noisy(at(NAMPULA, m), 6);
      pts.push({ lat, lng, device_time: new Date(t).toISOString(), speed_kmh: Math.round(v * 3.6), accuracy_m: 8 }); }
    for (let i = 0; i < pts.length; i += 50) {
      const r = await dp.evaluate(async ([tk2, body]) => (await fetch('/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${tk2}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status,
        [tk, { sent_at: new Date().toISOString(), positions: pts.slice(i, i + 50) }]);
      if (r !== 200) throw new Error('ingestão ' + r);
    }
    const s = (await db.query('select status from trips where id = $1', [trip2])).rows[0].status;
    const passed = (await db.query(`select p.name from trip_route_places rp join places p on p.id = rp.place_id join trip_routes r on r.id = rp.trip_route_id and r.is_current
      where r.trip_id = $1 and rp.passed_at is not null order by rp.passed_at`, [trip2])).rows.map((r) => r.name);
    const all = (await db.query(`select p.name, rp.passed_at is not null passed from trip_route_places rp join places p on p.id = rp.place_id
      join trip_routes r on r.id = rp.trip_route_id and r.is_current where r.trip_id = $1 order by rp.seq`, [trip2])).rows;
    const prov = (await db.query(`select provider, round(length_m/1000) km, version from trip_routes where trip_id = $1 order by version`, [trip2])).rows;
    for (const n of ['Mocuba', 'Alto Molócue', 'Murrupula']) if (!passed.includes(n)) throw new Error(`não passou por ${n}; rotas ${JSON.stringify(prov)}; localidades ${all.map((x) => x.name + (x.passed ? '✓' : '')).join(', ')}`);
    if (s !== 'concluida') throw new Error('não concluiu sozinha: ' + s);
    return `${(NAMPULA.L / 1000).toFixed(1)} km; passou por ${passed.filter((n) => ['Namacurra', 'Mocuba', 'Alto Molócue', 'Murrupula'].includes(n)).join(' → ')}; concluída sozinha`;
  });

  const real = [...new Set(errs)];
  console.log('\n--- erros (consola / páginas / respostas 5xx) ---\n' + (real.join('\n') || '(nenhum)'));
  fs.writeFileSync(SHOT + 'resultado.json', JSON.stringify({ results, errors: real }, null, 2));
  await browser.close(); await db.end();
  if (failures || real.length) { console.log(`\n${failures} passo(s) falharam, ${real.length} erro(s)`); process.exit(1); }
  console.log('\nVIAGEM COMPLETA: todos os passos passaram, sem erros');
})();
