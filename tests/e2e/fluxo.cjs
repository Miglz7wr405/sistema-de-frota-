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
  await step('01b-landing-telemovel', async () => {
    // página inicial no telemóvel: fotografia no topo, faixa do código que abre o acompanhamento, sem scroll lateral
    const lp = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
    await lp.goto(B + '/'); await lp.getByText('Acompanhe a sua carga').waitFor(); await lp.waitForTimeout(800);
    await lp.screenshot({ path: SHOT + '01d-landing-telemovel.png', fullPage: true });
    const w = await lp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (w[0] > w[1] + 1) throw new Error('página inicial mais larga que o ecrã: ' + w.join('/'));
    await lp.getByPlaceholder('FT-XXXX-XXXX').fill('ft-abcd-1234'); await lp.getByRole('button', { name: 'Acompanhar' }).click();
    await lp.waitForURL(/\/track\?code=FT-ABCD-1234/, { timeout: 10000 });
    await page.screenshot({ path: SHOT + '01c-landing-computador.png', fullPage: true });
    await lp.context().close();
  });
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
    // o BI é obrigatório (12 números + 1 letra)
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByText(/BI inválido/).first().waitFor({ timeout: 5000 });
    await page.getByLabel('N.º do BI').fill('110100123456a');
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
    await page.getByRole('dialog').getByLabel('Nome completo (como no BI)').fill('Ana Cossa');
    await page.getByRole('dialog').getByLabel('Telefone').fill('847654321');
    await page.getByRole('dialog').getByLabel('N.º do BI').fill('110200765432B');
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
    // (a câmara automática pode aproximar no mesmo instante: repete, longe dessa mudança)
    let before, after, moved = true;
    for (let k = 0; k < 3 && moved; k++) {
      if (k) await page.waitForTimeout(6000);
      before = await proj();
      const box = await page.locator('.maplibregl-canvas').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 80, { steps: 8 }); await page.mouse.up();
      await page.mouse.wheel(0, -500); await page.waitForTimeout(800);
      after = await proj();
      moved = Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1;
    }
    if (moved) throw new Error('o mapa mexeu: ' + JSON.stringify({ before, after }));
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
  await step('11b-track-distrito', async () => {
    // página pública: distrito e província da última posição; camião sem etiqueta grande por cima dos nomes do mapa
    const dt = await cp.getByTestId('track-distrito').innerText({ timeout: 10000 });
    if (!/Cidade de Quelimane|Distrito de /.test(dt)) throw new Error('distrito inesperado: ' + dt);
    if (await cp.locator('.maplibregl-marker', { hasText: 'Faltam' }).count()) throw new Error('etiqueta do camião ainda por cima do mapa');
    // o mapa mostra os nomes dos distritos atravessados
    await cp.locator('.if-area-label').first().waitFor({ state: 'attached', timeout: 10000 });
    await cp.screenshot({ path: SHOT + '11c-track-publico.png', fullPage: true });
    return dt;
  });
  await step('12-mapa-ao-vivo', async () => { await page.goto(B + '/app/live-map'); await page.waitForSelector('.maplibregl-canvas'); await page.getByText('ADF 512 MP').first().waitFor(); });
  // 13 — "Testar com o meu telemóvel": tudo a partir do GPS (emulado aqui) do próprio telemóvel do dono
  const tctx = await browser.newContext({ viewport: { width: 400, height: 860 }, storageState: await ctx.storageState(), geolocation: { latitude: -17.8600, longitude: 36.8800, accuracy: 9 }, permissions: ['geolocation'] });
  const tp = await tctx.newPage();
  tp.on('pageerror', (e) => errs.push(`[selftest pageerror] ${e.message.slice(0, 300)}`));
  const tstep = async (name, fn) => { try { const info = await fn(); console.log('OK  ', name, info ?? ''); } catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); } await tp.screenshot({ path: SHOT + name + '.png' }); };
  await tstep('13-teste-telemovel', async () => {
    // UM toque no painel: sem perguntas (a permissão de GPS já foi dada a este site)
    // o cartão de teste saiu do painel; no lugar estão "Registar camião" e "Registar motorista"
    await tp.goto(B + '/app/dashboard');
    await tp.getByRole('button', { name: 'Registar camião' }).waitFor(); await tp.waitForTimeout(800);
    await tp.screenshot({ path: SHOT + '13-painel-atalhos.png' });
    await tp.getByRole('button', { name: 'Registar motorista' }).click();
    await tp.getByRole('dialog').getByText(/Nome/).first().waitFor(); await tp.keyboard.press('Escape');
    if (await tp.getByRole('button', { name: 'Testar agora' }).count()) throw new Error('o cartão de teste ainda aparece');
    // o teste continua disponível pelo endereço direto
    await tp.goto(B + '/app/self-test');
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
    if (await tp.getByRole('button', { name: 'Despesa' }).count()) throw new Error('botão "Despesa" ainda existe');
    // esquema do percurso com o camião
    // primeiro o Mapa (por omissão), depois o Percurso
    const tabs = await tp.getByRole('tab').allInnerTexts();
    if (tabs[0] !== 'Mapa' || tabs[1] !== 'Percurso') throw new Error('ordem das abas: ' + tabs.join(','));
    await tp.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
    // mapa fixo: arrastar não muda nada
    await tp.waitForTimeout(3000);
    const proj = () => tp.evaluate(() => { const h = [...document.querySelectorAll('*')].find((x) => x.__project); return h.__project([36.88, -17.86]); });
    // (o zoom automático do sistema pode coincidir com o arrastar: repete uma vez, longe dessa mudança)
    let moved = true;
    for (let k = 0; k < 2 && moved; k++) {
      if (k) await tp.waitForTimeout(5000);
      const before = await proj(); const bx = await tp.locator('.maplibregl-canvas').boundingBox();
      await tp.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await tp.mouse.down(); await tp.mouse.move(bx.x + 40, bx.y + 40, { steps: 6 }); await tp.mouse.up();
      const after = await proj();
      moved = Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1;
    }
    if (moved) throw new Error('o mapa do motorista mexeu');
    await tp.getByRole('tab', { name: 'Percurso' }).click();
    if (!(await tp.locator('svg[role=img]').count())) throw new Error('sem esquema do percurso');
  });
  await tstep('13b-motorista-mapa', async () => {
    await tp.getByRole('tab', { name: 'Mapa' }).click();
    await tp.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
    await tp.locator('.maplibregl-marker').first().waitFor({ timeout: 10000 });
    // o mapa não fica parado: de 30 em 30 s aproxima sozinho (animação) e volta à rota inteira
    const span = () => tp.evaluate(() => { const h = [...document.querySelectorAll('*')].find((x) => x.__project); const a = h.__project([36.88, -17.86]), b = h.__project([36.81, -17.6]); return Math.hypot(a.x - b.x, a.y - b.y); });
    const s0 = await span(); let maxS = s0, minS = s0;
    // ciclo: 15 s com a rota inteira + 30 s aproximado
    // aproximado (zoom ≥ 8): camião pequeno sem círculo; afastado: alfinete
    const look = () => tp.evaluate(() => { const h = [...document.querySelectorAll('*')].find((x) => x.__zoom); const z = h.__zoom();
      const pin = h.querySelector('.if-truck-pin'), mini = h.querySelector('.if-truck-mini');
      return { z, pin: pin && getComputedStyle(pin).display !== 'none', mini: mini && getComputedStyle(mini).display !== 'none' }; });
    const modes = new Set();
    for (let i = 0; i < 55; i++) { await tp.waitForTimeout(1000); const v = await span(); maxS = Math.max(maxS, v); minS = Math.min(minS, v);
      const l = await look(); if (l.pin === l.mini || (l.z >= 8) !== l.mini) throw new Error('camião errado para o zoom: ' + JSON.stringify(l)); modes.add(l.mini ? 'pequeno' : 'alfinete');
      if (maxS > minS * 2.5 && i > 20) break; }
    console.log('     camião visto como:', [...modes].join(', '));
    // camião sempre direito: o ícone não tem rotação
    const rot = await tp.evaluate(() => [...document.querySelectorAll('.maplibregl-marker div')].some((d) => /rotate/.test(d.getAttribute('style') ?? '')));
    if (rot) throw new Error('o ícone do camião está a rodar');
    if (!(maxS > minS * 2.5)) throw new Error(`o mapa não aproximou/afastou sozinho (${minS.toFixed(0)}–${maxS.toFixed(0)} px)`);
    return `zoom automático: ${minS.toFixed(0)} px ↔ ${maxS.toFixed(0)} px`;
  });
  await tstep('13g-percurso-automatico', async () => {
    // o ecrã do motorista passa sozinho para o Percurso e volta ao Mapa (ciclo encurtado só neste teste)
    await tp.evaluate(() => localStorage.setItem('if_tab_cycle', '5000,3000'));
    await tp.reload(); await tp.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
    const sel = () => tp.getByRole('tab', { selected: true }).innerText();
    if ((await sel()) !== 'Mapa') throw new Error('não começou no Mapa');
    await tp.getByRole('tab', { name: 'Percurso', selected: true }).waitFor({ timeout: 9000 });
    await tp.getByText(/km feitos/).first().waitFor();
    await tp.getByRole('tab', { name: 'Mapa', selected: true }).waitFor({ timeout: 6000 });
    await tp.evaluate(() => localStorage.removeItem('if_tab_cycle'));
    // parado: no lugar do antigo "Despesa" aparece o quadro com os km feitos
    await tp.getByTestId('km-feitos').getByText(/Feitos/).waitFor({ timeout: 20000 });
    // "Ocorrência" saiu; no lugar, "ID da viagem" abre o código para dar ao cliente
    if (await tp.getByRole('button', { name: 'Ocorrência' }).count()) throw new Error('botão "Ocorrência" ainda existe');
    await tp.getByRole('button', { name: 'ID da viagem' }).click();
    await tp.getByTestId('motorista-codigo').getByText(/FT-/).first().waitFor();
    await tp.waitForTimeout(800); await tp.screenshot({ path: SHOT + '13h-id-da-viagem.png' });
    if (await tp.getByRole('button', { name: 'Despesa' }).count()) throw new Error('botão "Despesa" ainda existe');
  });
  await tstep('13c-viagem-real-motorista-sou-eu', async () => {
    // viagem REAL com o motorista = o próprio utilizador → "Iniciar viagem agora" abre logo o ecrã do motorista com o GPS.
    // Com o teste ainda em curso, entrar na app abre o ecrã do motorista; "Voltar ao painel" deixa ficar no painel.
    // "Voltar ao painel": fica no painel (não volta a abrir o ecrã do motorista)
    await tp.getByText('Voltar ao painel').click();
    await tp.waitForURL(/\/app\/dashboard/, { timeout: 15000 });
    await tp.waitForTimeout(4000);
    if (!/\/app\/dashboard/.test(tp.url())) throw new Error('voltar ao painel não ficou no painel: ' + tp.url());
    await tp.goto(B + '/app/trips/new');
    const pick = async (idx, txt, opt) => { const i = tp.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await tp.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
    await pick(0, 'Quel', 'Quelimane');
    await pick(1, 'Beir', 'Beira');
    await tp.getByRole('button', { name: '+ Novo' }).nth(0).click();
    await tp.getByRole('dialog').getByLabel('Matrícula').fill('ADM 219 P');
    await tp.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await tp.getByRole('dialog').waitFor({ state: 'detached' });
    await tp.getByLabel('Motorista').selectOption({ label: 'Miguel Teste (eu)' });
    await tp.getByRole('button', { name: 'Iniciar viagem agora' }).click();
    await tp.waitForURL(/\/driver\/?$/, { timeout: 25000 });
    await tp.getByText(/Quelimane → Beira/).first().waitFor({ timeout: 15000 });
    await tp.getByText(/GPS a enviar/).first().waitFor({ timeout: 15000 });
    // viagem real: "Voltar ao painel" sim; botões de teste não
    await tp.getByText('Voltar ao painel').waitFor();
    if (await tp.getByRole('button', { name: 'Terminar teste' }).count()) throw new Error('"Terminar teste" numa viagem real');
  });
  await tstep('13e-voltar-e-voltar-a-entrar', async () => {
    // seta "voltar" do telemóvel: regressa ao formulário e FICA (não prende no ecrã do motorista)
    await tp.goBack(); await tp.waitForTimeout(4000);
    if (/\/driver/.test(tp.url())) throw new Error('voltar ficou preso no ecrã do motorista');
    // tocar na viagem em curso (lista de viagens) → direto ao ecrã do motorista
    await tp.goto(B + '/app/trips'); const row = tp.locator('tr', { hasText: 'Quelimane' }).filter({ hasText: 'Beira' }).filter({ hasText: 'Em viagem' }).first();
    await row.locator('a').first().click();
    await tp.waitForURL(/\/driver\/?$/, { timeout: 20000 });
    await tp.getByText(/GPS a enviar/).first().waitFor({ timeout: 15000 });
    // fechar a app e abrir de novo (sessão nova): abre sozinho o ecrã do motorista com o GPS
    const t2 = await (await browser.newContext({ viewport: { width: 400, height: 860 }, storageState: await tctx.storageState(), geolocation: { latitude: -17.86, longitude: 36.88, accuracy: 9 }, permissions: ['geolocation'] })).newPage();
    await t2.goto(B + '/app/dashboard'); await t2.waitForURL(/\/driver\/?$/, { timeout: 20000 }); await t2.getByText(/GPS a enviar/).first().waitFor({ timeout: 15000 });
    await t2.close();
  });
  await tstep('13d-telemovel-sem-scroll-lateral', async () => {
    // detalhe de uma viagem (motorista João) no telemóvel: nada pode alargar a página
    await tp.goto(tripUrl + '?painel=1'); // o dono escolheu ficar no painel
    await tp.getByText(/Rastreamento do cliente/).first().waitFor({ timeout: 15000 });
    // nenhum cartão pode passar da margem direita do ecrã (nem escondido)
    const over = await tp.evaluate(() => [...document.querySelectorAll('.card, main > div > div')].map((e) => e.getBoundingClientRect().right).filter((r) => r > window.innerWidth + 1).length);
    const w = await tp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (over || w[0] > w[1] + 1) throw new Error('conteúdo mais largo que o ecrã: ' + JSON.stringify({ over, w }));
  });
  await tstep('13f-painel-viagem-em-curso', async () => {
    // painel no telemóvel com viagem própria: cartão com fotografia e camiões a andar; atalhos de registo
    await tp.goto(B + '/app/dashboard');
    await tp.getByRole('button', { name: 'Abrir o ecrã do motorista' }).waitFor({ timeout: 15000 });
    await tp.getByRole('button', { name: 'Registar motorista' }).waitFor();
    const img = await tp.evaluate(() => fetch('/img/camiao-fundo.webp').then((r) => [r.status, r.headers.get('content-type')]));
    if (img[0] !== 200) throw new Error('fotografia de fundo não carrega: ' + img.join(' '));
    // frase com a viagem: "Tem uma viagem de X até Y"
    if (!(await tp.getByText(/Tem uma viagem de .+ até .+/).count())) throw new Error('o cartão não diz de onde até onde');
    // os camiões andam sempre, mesmo com "reduzir movimento" ligado no telemóvel
    await tp.emulateMedia({ reducedMotion: 'reduce' });
    const x = () => tp.evaluate(() => document.querySelector('.hero-truck').getBoundingClientRect().left);
    const a = await x(); await tp.waitForTimeout(1200); const b = await x();
    if (Math.abs(b - a) < 5) throw new Error('o camião está parado: ' + JSON.stringify({ a, b }));
    await tp.emulateMedia({ reducedMotion: 'no-preference' });
    await tp.waitForTimeout(2500);
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
      return { dx: b.left + b.width / 2 - (c.left + p.x), dy: b.bottom - (c.top + p.y) };
    }, [v.lng, v.lat, 'TESTE TELEMOVEL']);
    console.log('     desvio do marcador (px):', JSON.stringify(res));
    if (Math.abs(res.dx) > 3 || Math.abs(res.dy) > 3) throw new Error('camião desenhado fora da coordenada: ' + JSON.stringify(res));
  });
  await step('15-computador-igual-ao-telemovel', async () => {
    // painel no computador: cartão "Tem uma viagem de X até Y" e registos existentes; clicar abre a página da viagem
    await page.goto(B + '/app/dashboard');
    await page.getByText(/Tem uma viagem de .+ até .+/).first().waitFor({ timeout: 15000 });
    await page.getByTestId('registo-vehicle').getByText(/camiões? registados?/).waitFor();
    await page.getByTestId('registo-driver').getByText(/motoristas? registados?/).waitFor();
    await page.screenshot({ path: SHOT + '15-painel-computador.png' });
    await page.getByRole('button', { name: 'Abrir o ecrã do motorista' }).click();
    await page.waitForURL(/\/app\/trips\/[0-9a-f-]+$/, { timeout: 10000 });
    // zoom automático numa viagem com GPS a chegar agora (motorista João, telemóvel dele a continuar o caminho)
    for (let i = 7; i <= 9; i++) { await dctx.setGeolocation({ latitude: -17.8775 + i * 0.0012, longitude: 36.8902 - i * 0.0016, accuracy: 10 }); await dp.waitForTimeout(16000); }
    await page.goto(tripUrl); await page.waitForSelector('.maplibregl-canvas');
    // o mapa da viagem aproxima sozinho (mesma câmara do telemóvel)
    const z = () => page.evaluate(() => [...document.querySelectorAll('*')].find((x) => x.__zoom)?.__zoom());
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 50 && !(hi - lo > 1.5); i++) { await page.waitForTimeout(1000); const v = await z(); if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (!(hi - lo > 1.5)) throw new Error('o mapa da viagem no computador não aproximou: ' + JSON.stringify({ lo, hi, pill: await page.locator('span.rounded-full.bg-white').first().innerText().catch(() => '?') }));
    await page.screenshot({ path: SHOT + '15-viagem-computador.png' });
    return `zoom ${lo.toFixed(1)} ↔ ${hi.toFixed(1)}`;
  });
  await step('16-checkout-pagamento', async () => {
    // sem viagens grátis: "Iniciar viagem agora" abre o checkout; comprovativo + código; o SMS do proprietário aprova e a viagem começa
    const pg = require('pg'); const db = new pg.Client({ connectionString: process.env.SYSTEM_DATABASE_URL }); await db.connect();
    await db.query('update billing_settings set free_trips = 0');
    try {
      await page.evaluate(async () => {
        const j = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        await j('/api/vehicles', { plate: 'PAG 250 MP', make: 'Volvo', model: 'FH' });
        await j('/api/drivers', { full_name: 'Paulo Pagamento', phone: '+258841119988', id_number: '110100999999P' });
      });
      await page.goto(B + '/app/trips/new');
      const pick = async (idx, txt, opt) => { const i = page.getByPlaceholder('Escreva o nome da localidade').nth(idx); await i.fill(txt); await page.getByRole('button', { name: new RegExp('^' + opt) }).first().click(); };
      await pick(0, 'Quel', 'Quelimane'); await pick(1, 'Beir', 'Beira');
      await page.getByLabel('Camião').selectOption({ label: 'PAG 250 MP' });
      await page.getByLabel('Motorista').selectOption({ label: 'Paulo Pagamento' });
      await page.getByRole('button', { name: 'Iniciar viagem agora' }).click();
      const ck = page.getByTestId('checkout'); await ck.waitFor({ timeout: 15000 });
      await page.getByRole('dialog', { name: 'Ativar rastreio GPS' }).waitFor();
      await page.screenshot({ path: SHOT + '16-checkout.png' });
      await page.setViewportSize({ width: 400, height: 860 }); await page.waitForTimeout(500);
      await page.screenshot({ path: SHOT + '16-checkout-telemovel.png' });
      await page.getByTestId('checkout-foto').setInputFiles(require('path').join(__dirname, '../../public/img/landing-cliente.webp'));
      await page.getByTestId('checkout-codigo').waitFor({ timeout: 60000 });
      await page.getByTestId('checkout-codigo').fill('E2E45H7GT2');
      await page.getByTestId('checkout-pagador').fill('849990000');
      await page.waitForTimeout(400); await page.screenshot({ path: SHOT + '16-checkout-telemovel-comprovativo.png' });
      await page.getByRole('button', { name: /^Ativar rastreio · 250/ }).click();
      await page.getByTestId('checkout-pendente').waitFor({ timeout: 15000 });
      await page.screenshot({ path: SHOT + '16-checkout-telemovel-a-ativar.png' });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.screenshot({ path: SHOT + '16b-checkout-a-confirmar.png' });
      // o telemóvel do proprietário reencaminha o SMS do M-Pesa
      const r = await page.evaluate(() => fetch('/api/payments/sms?key=e2e-sms-segredo-123', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'M-Pesa', text: 'E2E45H7GT2 Confirmado. Recebeste 250.00MT de 258849990000 - PAULO aos 23/11/26' }) }).then((x) => x.json()));
      if (!r.matched) throw new Error('SMS não confirmou o pagamento: ' + JSON.stringify(r));
      await page.getByTestId('checkout-aprovado').waitFor({ timeout: 15000 });
      await page.screenshot({ path: SHOT + '16-checkout-ativado.png' });
      await page.waitForURL(/\/app\/trips\/[0-9a-f-]+$/, { timeout: 20000 });
      await page.getByText('Viagem iniciada').first().waitFor({ timeout: 15000 });
      await page.screenshot({ path: SHOT + '16c-viagem-paga-iniciada.png' });
    } finally { await db.query('update billing_settings set free_trips = 1000'); await db.end(); }
  });
  const real = [...new Set(errs)].filter((e) => !/Future Flag|GL Driver|GPU stall/.test(e));
  console.log('--- erros da consola/rede ---\n' + (real.join('\n') || '(nenhum)'));
  await browser.close();
  if (failures || real.some((e) => /pageerror|http 5/.test(e))) { console.log(`\n${failures} passo(s) falharam`); process.exit(1); }
  console.log('\nE2E: todos os passos passaram');
})();
