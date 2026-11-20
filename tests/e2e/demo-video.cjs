// Vídeo de demonstração do ecrã do motorista (para o proprietário ver a animação sem ter um camião a andar).
// Rota REAL Quelimane → Beira; GPS EMULADO a ~100 km/h pela estrada real; gravado em tempo real.
const { chromium } = require('playwright');
const fs = require('fs');
const B = process.env.E2E_BASE ?? 'http://localhost:4173';
const OUT = 'test-results/demo/';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(fs.readFileSync('tests/e2e/fixtures/rotas-reais.json', 'utf8'));
const decode = (s) => { let i = 0, lat = 0, lng = 0; const out = []; while (i < s.length) { for (const k of [0, 1]) { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) lat += d; else lng += d; } out.push([lng / 1e5, lat / 1e5]); } return out; };
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const coords = decode(fx.rotas[0].polyline); const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + hav(coords[i - 1], coords[i]));
const at = (m) => { let i = 1; while (i < cum.length - 1 && cum[i] < m) i++; const f = (m - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]); const a = coords[i - 1], b = coords[i]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
const START_M = 2400, END_M = 7600, V = 100 / 3.6; // ~100 km/h, passa por Uachave (km 5)

(async () => {
  const browser = await chromium.launch();
  const [lng0, lat0] = at(START_M);
  const setup = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: lat0, longitude: lng0, accuracy: 6 }, permissions: ['geolocation'] });
  const p = await setup.newPage();
  await p.goto(B + '/register');
  await p.getByLabel('Nome completo').fill('Miguel'); await p.getByLabel('E-mail').fill(`demo${Date.now()}@teste.mz`);
  await p.getByLabel('Palavra-passe').fill('segredo-123'); await p.getByLabel('Nome da empresa').fill('Transportes Demo');
  await p.getByRole('button', { name: 'Criar conta' }).click(); await p.waitForURL('**/app/dashboard');
  await p.goto(B + '/app/trips/new');
  const pick = async (idx, txt, opt) => { const i = p.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await p.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
  await pick(0, 'Quel', 'Quelimane'); await pick(1, 'Beir', 'Beira');
  await p.getByRole('button', { name: '+ Novo' }).nth(0).click();
  await p.getByRole('dialog').getByLabel('Matrícula').fill('ADM 219 P'); await p.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await p.getByRole('dialog').waitFor({ state: 'detached' });
  await p.getByLabel('Motorista').selectOption({ label: 'Eu próprio (sou o motorista)' });
  await p.waitForFunction(() => document.querySelector('select[aria-label="Motorista"]').selectedOptions[0]?.textContent.includes('(eu)'));
  await p.getByLabel(/^Carga/).fill('30 t de cimento');
  await p.getByRole('button', { name: 'Iniciar viagem agora' }).click();
  await p.waitForURL(/\/driver\/?$/); await p.getByText(/GPS a enviar/).first().waitFor({ timeout: 20000 });
  const storage = await setup.storageState(); await setup.close();

  // gravação: telemóvel com o ecrã do motorista, o mapa à vista
  const rec = await browser.newContext({ viewport: { width: 400, height: 720 }, storageState: storage, geolocation: { latitude: lat0, longitude: lng0, accuracy: 6 }, permissions: ['geolocation'],
    recordVideo: { dir: OUT, size: { width: 400, height: 720 } } });
  const v = await rec.newPage();
  await v.goto(B + '/driver/'); await v.getByText(/GPS a enviar/).first().waitFor({ timeout: 20000 });
  await v.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  await v.evaluate(() => { const m = document.querySelector('.maplibregl-canvas').closest('.card'); window.scrollTo(0, m.getBoundingClientRect().top + window.scrollY - 150); });
  await v.waitForTimeout(3000);
  const t0 = Date.now(); let m = START_M; const log = [];
  while (m < END_M) {
    m += V; const [lng, lat] = at(m); await rec.setGeolocation({ latitude: lat, longitude: lng, accuracy: 6 }); await v.waitForTimeout(1000);
    const banner = (await v.locator('.map-banner').count()) ? await v.locator('.map-banner').first().innerText({ timeout: 500 }).catch(() => null) : null;
    if (banner && log.at(-1)?.banner !== banner) log.push({ s: Math.round((Date.now() - t0) / 1000), km: (m / 1000).toFixed(1), banner });
  }
  await v.waitForTimeout(4000);
  const video = v.video(); await rec.close(); const path = await video.path();
  fs.renameSync(path, OUT + 'motorista.webm');
  console.log(JSON.stringify(log));
  await browser.close();
})();
