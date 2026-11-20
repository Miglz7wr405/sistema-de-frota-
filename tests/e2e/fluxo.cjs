const { chromium } = require('playwright');
// Teste E2E (navegador real): registo → camião → motorista (link + PIN) → viagem → GPS do telemóvel → mapas → partilha → página pública → teste com o telemóvel → camião na coordenada certa.
// Uso: npm run e2e (scripts/e2e.sh arranca a BD local, a API e o Vite preview).
const SHOT = process.env.E2E_SHOTS ?? 'test-results/e2e/';
require('node:fs').mkdirSync(SHOT, { recursive: true });
let failures = 0;
const B = process.env.E2E_BASE ?? 'http://localhost:4173';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message.slice(0, 300)}`));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errs.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`); });
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); } await page.screenshot({ path: SHOT + name + '.png' }); };
  const email = `e2e${Date.now()}@teste.mz`;
  await step('01-landing', async () => { await page.goto(B + '/'); await page.getByText('Criar conta grátis').first().waitFor(); });
  await step('02-registo', async () => {
    await page.goto(B + '/register');
    await page.getByLabel('Nome completo').fill('Miguel Teste');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Palavra-passe').fill('segredo-123');
    await page.getByLabel('Nome da empresa').fill('Transportes E2E');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await page.getByText('Camiões').first().waitFor();
  });
  await step('03-dashboard-mapa', async () => {
    await page.getByRole('link', { name: 'Rastrear viagem' }).waitFor(); await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 }); const bb = await page.locator('.maplibregl-canvas').first().boundingBox(); if (bb.height < 200) throw new Error('mapa com altura ' + bb.height); });
  await step('04-camiao', async () => {
    await page.goto(B + '/app/vehicles');
    await page.getByRole('button', { name: 'Adicionar camião' }).first().click();
    await page.getByLabel('Matrícula').fill('ADF 512 MP');
    await page.getByLabel('Marca').fill('Scania');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByText('ADF 512 MP').first().waitFor({ timeout: 10000 });
  });
  let link = null;
  await step('05-motorista', async () => {
    await page.goto(B + '/app/drivers');
    await page.getByRole('button', { name: 'Adicionar motorista' }).first().click();
    await page.getByLabel('Nome').first().fill('João Matsinhe');
    await page.getByLabel('Telefone').fill('841234567');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByText('João Matsinhe').first().click();
    await page.getByRole('button', { name: 'Gerar link e PIN' }).click();
    await page.getByLabel('PIN (4 a 6 dígitos)').fill('4321');
    await page.getByRole('button', { name: 'Gerar link e PIN' }).last().click();
    link = await page.locator('input[readonly]').inputValue();
  });
  console.log('link', link);
  let tripUrl = null;
  await step('06-viagem', async () => {
    await page.goto(B + '/app/trips/new');
    const pick = async (idx, txt, opt) => { const i = page.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await page.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
    await pick(0, 'Quel', 'Quelimane');
    await pick(1, 'Beir', 'Beira');
    // só há 1 camião e 1 motorista: já vêm escolhidos
    if (!(await page.getByLabel('Camião').inputValue())) throw new Error('camião não pré-escolhido');
    if (!(await page.getByLabel('Motorista').inputValue())) throw new Error('motorista não pré-escolhido');
    // formulário curto: só origem, destino, camião, motorista
    if (await page.getByText(/Partida prevista|Peso|Destinatário|Observações|Pontos de passagem/).count()) throw new Error('campos a mais no formulário');
    await page.getByRole('button', { name: 'Só guardar' }).click();
    await page.waitForURL(/\/app\/trips\/[0-9a-f-]{36}$/, { timeout: 20000 });
    tripUrl = page.url();
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  });
  await step('06b-viagem-com-novo-camiao-e-motorista', async () => {
    // "+ Novo" dentro do formulário da viagem: 3 campos (camião) e 2 campos (motorista), sem sair
    await page.goto(B + '/app/trips/new');
    const pick = async (idx, txt, opt) => { const i = page.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await page.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
    await pick(0, 'Beir', 'Beira');
    await pick(1, 'Quel', 'Quelimane');
    await page.getByRole('button', { name: '+ Novo' }).nth(0).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Matrícula').fill('AAB 123 MC');
    await dlg.getByLabel('Marca').fill('Mercedes');
    await dlg.getByLabel('Modelo').fill('Actros');
    await dlg.getByRole('button', { name: 'Guardar' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '+ Novo' }).nth(1).click();
    await page.getByRole('dialog').getByLabel('Nome').fill('Ana Cossa');
    await page.getByRole('dialog').getByLabel('Telefone').fill('847654321');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    if (!page.url().endsWith('/app/trips/new')) throw new Error('saiu do formulário');
    await page.getByLabel(/^Carga/).fill('30 t de cimento');
    await page.getByLabel(/^Responsável da carga/).fill('Sr. João');
    await page.getByLabel('Telefone do responsável').fill('841230000');
    const vsel = page.getByLabel('Camião');
    if ((await vsel.locator('option:checked').innerText()) !== 'AAB 123 MC') throw new Error('novo camião não escolhido');
    if ((await page.getByLabel('Motorista').locator('option:checked').innerText()) !== 'Ana Cossa') throw new Error('novo motorista não escolhido');
    await page.getByRole('button', { name: 'Iniciar viagem agora' }).click();
    await page.waitForURL(/\/app\/trips\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await page.getByText('AAB 123 MC').first().waitFor();
    await page.getByText('Viagem iniciada').first().waitFor({ timeout: 10000 });
    await page.getByText('30 t de cimento').first().waitFor();
    await page.getByText('+258841230000').first().waitFor();
  });
  await step('06c-aviso-ja-em-viagem', async () => {
    // AAB 123 MC já está em viagem (06b): nova viagem com o mesmo camião → aviso → cancelar essa e iniciar esta
    await page.goto(B + '/app/trips/new');
    const pick = async (idx, txt, opt) => { const i = page.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await page.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
    await pick(0, 'Quel', 'Quelimane');
    await pick(1, 'Beir', 'Beira');
    await page.getByLabel('Camião').selectOption({ label: 'AAB 123 MC (Em viagem)' });
    await page.getByLabel('Motorista').selectOption({ label: 'Ana Cossa' });
    await page.getByRole('button', { name: 'Iniciar viagem agora' }).click();
    const dlg = page.getByRole('dialog', { name: 'Já tem uma viagem em curso' });
    await dlg.waitFor({ timeout: 10000 });
    await dlg.getByText(/Beira → Quelimane/).waitFor();
    await page.screenshot({ path: SHOT + '06c-aviso.png' });
    await dlg.getByRole('button', { name: 'Cancelar essa viagem e iniciar esta' }).click();
    await page.waitForURL(/\/app\/trips\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await page.getByText('Viagem iniciada').first().waitFor({ timeout: 10000 });
  });
  // Motorista
  const dctx = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: -17.8775, longitude: 36.8902 }, permissions: ['geolocation'] });
  const dp = await dctx.newPage();
  dp.on('pageerror', (e) => errs.push(`[driver pageerror] ${e.message.slice(0, 300)}`));
  dp.on('console', (m) => { if (m.type() === 'error') errs.push(`[driver console] ${m.text().slice(0, 200)}`); });
  const dstep = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); } await dp.screenshot({ path: SHOT + name + '.png' }); };
  await dstep('07-motorista-pin', async () => {
    await dp.goto(link.replace(/^https?:\/\/[^/]+/, B));
    await dp.getByLabel('Introduza o seu PIN').fill('4321');
    await dp.getByRole('button', { name: 'Entrar' }).click();
    // o consentimento está no ecrã do PIN: não há ecrã "Aceito"
    await dp.getByRole('button', { name: 'Iniciar viagem' }).click();
    if (await dp.getByRole('button', { name: 'Aceito' }).count()) throw new Error('ecrã de consentimento extra');
    await dp.getByText(/GPS a enviar|Sem sinal GPS/).first().waitFor({ timeout: 15000 });
  });
  // mover o camião ao longo do caminho
  // movimento realista: ~0,002° (~220 m) a cada 16 s ≈ 50 km/h, saindo de Quelimane para oeste/sul
  for (let i = 1; i <= 6; i++) { await dctx.setGeolocation({ latitude: -17.8775 + i * 0.0012, longitude: 36.8902 - i * 0.0016, accuracy: 10 }); await dp.waitForTimeout(16000); }
  await dstep('08-motorista-em-viagem', async () => {
    await dp.getByText(/Falta para o destino/).waitFor();
    // viagem REAL: sem botões de teste e sem "Falar"
    for (const n of ['Falar', 'Mudar destino', 'Terminar teste', 'Voltar ao painel']) if (await dp.getByText(n, { exact: false }).count()) throw new Error(`"${n}" numa viagem real`);
  });
  await step('09-detalhe-com-gps', async () => {
    await page.goto(tripUrl); await page.waitForSelector('.maplibregl-canvas'); await page.getByText(/percorridos/).first().waitFor({ timeout: 15000 });
    // sem a mensagem "não validada" e sem os créditos por cima do mapa (ficam só no botão "i")
    if (await page.getByText(/não validada/).count()) throw new Error('mensagem "não validada" ainda aparece');
    await page.waitForTimeout(1600);
    if (await page.getByText(/OpenFreeMap|OpenStreetMap/).first().isVisible().catch(() => false)) throw new Error('créditos do mapa visíveis por cima do mapa');
    // esquema: camião a avançar com km feitos
    await page.getByText(/km feitos/).first().waitFor({ timeout: 10000 });
    // mapa fixo: arrastar não muda o enquadramento
    await page.waitForTimeout(1500);
    const proj = () => page.evaluate(() => { const h = [...document.querySelectorAll('*')].find((x) => x.__project); return h.__project([36.89, -17.88]); });
    const before = await proj();
    const box = await page.locator('.maplibregl-canvas').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 80, { steps: 8 }); await page.mouse.up();
    await page.mouse.wheel(0, -500); await page.waitForTimeout(800);
    const after = await proj();
    if (Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1) throw new Error('o mapa mexeu: ' + JSON.stringify({ before, after }));
  });
  let shareLink = null;
  await step('10-partilha', async () => {
    await page.getByRole('button', { name: 'Criar link para o cliente' }).click();
    shareLink = await page.locator('span.truncate').first().innerText();
  });
  console.log('share', shareLink);
  const cp = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  cp.on('pageerror', (e) => errs.push(`[track pageerror] ${e.message.slice(0, 300)}`));
  try { await cp.goto(shareLink.replace(/^https?:\/\/[^/]+/, B)); await cp.waitForSelector('.maplibregl-canvas', { timeout: 15000 }); const box = await cp.locator('.maplibregl-canvas').boundingBox(); console.log('OK   11-track canvas', JSON.stringify(box)); } catch (e) { failures++; console.log('FAIL 11-track', e.message.split('\n')[0]); }
  await cp.waitForTimeout(1500); await cp.screenshot({ path: SHOT + '11-track.png' });
  await step('12-mapa-ao-vivo', async () => { await page.goto(B + '/app/live-map'); await page.waitForSelector('.maplibregl-canvas'); await page.getByText('ADF 512 MP').first().waitFor(); });
  // 13 — "Testar com o meu telemóvel": tudo a partir do GPS (emulado aqui) do próprio telemóvel do dono
  const tctx = await browser.newContext({ viewport: { width: 400, height: 860 }, storageState: await ctx.storageState(), geolocation: { latitude: -17.8600, longitude: 36.8800, accuracy: 9 }, permissions: ['geolocation'] });
  const tp = await tctx.newPage();
  tp.on('pageerror', (e) => errs.push(`[selftest pageerror] ${e.message.slice(0, 300)}`));
  const tstep = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); } await tp.screenshot({ path: SHOT + name + '.png' }); };
  await tstep('13-teste-telemovel', async () => {
    // UM toque no painel: sem perguntas (a permissão de GPS já foi dada a este site)
    await tp.goto(B + '/app/dashboard');
    await tp.getByRole('button', { name: 'Testar agora' }).first().click();
    await tp.waitForURL(/\/driver\/?$/, { timeout: 25000 });
    await tp.getByText(/GPS a enviar/).first().waitFor({ timeout: 15000 });
    if (await tp.getByRole('button', { name: 'Aceito' }).count()) throw new Error('pediu consentimento outra vez');
    if (await tp.getByRole('button', { name: 'Iniciar viagem' }).count()) throw new Error('pediu "Iniciar viagem"');
    // deslocação real emulada: ~110 m a cada 6 s (≈ 66 km/h)
    for (let i = 1; i <= 5; i++) { await tctx.setGeolocation({ latitude: -17.8600 + i * 0.0007, longitude: 36.8800 - i * 0.0008, accuracy: 9 }); await tp.waitForTimeout(6000); }
    await tp.getByText(/EN-E2E \(teste\)/).waitFor({ timeout: 15000 });
    const sp = await tp.locator('p.text-5xl').first().innerText();
    if (!/^\d+/.test(sp)) throw new Error('velocidade não mostrada: ' + sp);
    // modo teste: "Voltar ao painel" e "Terminar teste"; sem "Falar"
    await tp.getByText('Voltar ao painel').waitFor();
    await tp.getByRole('button', { name: 'Terminar teste' }).waitFor();
    if (await tp.getByRole('button', { name: 'Falar' }).count()) throw new Error('botão "Falar" ainda existe');
    // esquema do percurso com o camião
    await tp.getByRole('tab', { name: 'Percurso' }).waitFor();
    if (!(await tp.locator('svg[role=img]').count())) throw new Error('sem esquema do percurso');
  });
  await tstep('13b-motorista-mapa', async () => {
    await tp.getByRole('tab', { name: 'Mapa' }).click();
    await tp.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
    await tp.locator('.maplibregl-marker').first().waitFor({ timeout: 10000 });
    await tp.waitForTimeout(2000);
  });
  await tstep('13c-viagem-real-motorista-sou-eu', async () => {
    // viagem REAL com o motorista = o próprio utilizador → "Iniciar viagem agora" abre logo o ecrã do motorista com o GPS
    await tp.goto(B + '/app/trips/new');
    const pick = async (idx, txt, opt) => { const i = tp.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await tp.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
    await pick(0, 'Quel', 'Quelimane');
    await pick(1, 'Beir', 'Beira');
    await tp.getByRole('button', { name: '+ Novo' }).nth(0).click();
    await tp.getByRole('dialog').getByLabel('Matrícula').fill('ADM 219 P');
    await tp.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await tp.getByRole('dialog').waitFor({ state: 'detached' });
    await tp.getByLabel('Motorista').selectOption({ label: 'Miguel Teste' });
    await tp.getByRole('button', { name: 'Iniciar viagem agora' }).click();
    await tp.waitForURL(/\/driver\/?$/, { timeout: 25000 });
    await tp.getByText(/Quelimane → Beira/).first().waitFor({ timeout: 15000 });
    await tp.getByText(/GPS a enviar/).first().waitFor({ timeout: 15000 });
    // viagem real: "Voltar ao painel" sim; botões de teste não
    await tp.getByText('Voltar ao painel').waitFor();
    if (await tp.getByRole('button', { name: 'Terminar teste' }).count()) throw new Error('"Terminar teste" numa viagem real');
  });
  await tstep('13d-telemovel-sem-scroll-lateral', async () => {
    // detalhe de uma viagem (motorista João) no telemóvel: nada pode alargar a página
    await tp.goto(tripUrl);
    await tp.getByText(/Rastreamento do cliente/).first().waitFor({ timeout: 15000 });
    // nenhum cartão pode passar da margem direita do ecrã (nem escondido)
    const over = await tp.evaluate(() => [...document.querySelectorAll('.card, main > div > div')].map((e) => e.getBoundingClientRect().right).filter((r) => r > window.innerWidth + 1).length);
    const w = await tp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (over || w[0] > w[1] + 1) throw new Error('conteúdo mais largo que o ecrã: ' + JSON.stringify({ over, w }));
  });
  await step('14-camiao-na-coordenada-certa', async () => {
    await page.goto(B + '/app/live-map');
    await page.getByText('TESTE TELEMOVEL').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(2500); // fim da animação suave
    const live = await page.evaluate(() => fetch('/api/fleet/live').then((r) => r.json()));
    const v = live.vehicles.find((x) => x.plate === 'TESTE TELEMOVEL');
    if (v.lat == null) throw new Error('sem posição');
    const res = await page.evaluate(([lng, lat, plate]) => {
      const host = [...document.querySelectorAll('.maplibregl-map')].map((m) => m.parentElement).find((h) => h.__project) || [...document.querySelectorAll('*')].find((h) => h.__project);
      const p = host.__project([lng, lat]);
      const c = host.getBoundingClientRect();
      const mk = [...host.querySelectorAll('.maplibregl-marker')].find((m) => m.textContent.includes(plate));
      const b = mk.getBoundingClientRect();
      return { dx: b.left + 17 - (c.left + p.x), dy: b.top + 17 - (c.top + p.y) };
    }, [v.lng, v.lat, 'TESTE TELEMOVEL']);
    console.log('     desvio do marcador (px):', JSON.stringify(res));
    if (Math.abs(res.dx) > 3 || Math.abs(res.dy) > 3) throw new Error('camião desenhado fora da coordenada: ' + JSON.stringify(res));
  });
  const real = [...new Set(errs)].filter((e) => !/Future Flag|GL Driver|GPU stall/.test(e));
  console.log('--- erros da consola/rede ---\n' + (real.join('\n') || '(nenhum)'));
  await browser.close();
  if (failures || real.some((e) => /pageerror|http 5/.test(e))) { console.log(`\n${failures} passo(s) falharam`); process.exit(1); }
  console.log('\nE2E: todos os passos passaram');
})();
