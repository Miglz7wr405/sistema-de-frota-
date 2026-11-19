// Simulador GPS (correção 4 do prompt): reproduz uma viagem ao longo da ROTA REAL da viagem ativa (pedida à API),
// com velocidade variável, paragens, perda de sinal e ruído, e envia pela MESMA porta dos dispositivos (POST /api/ingest).
// As posições ficam marcadas com source = 'simulator'.
import { simulate, type SimSegment } from '../../src/lib/geo/simulate.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? 'true']; }));
if (args.help || !args.base || !args.key || !args.vehicle) {
  console.log(`Uso: npm run sim -- --base=https://<app> --key=<chave de simulador> --vehicle=<id do camião> [opções]
  --speed=60         velocidade média (km/h)
  --interval=15      segundos entre posições
  --factor=60        aceleração do tempo (60 = 1 h de viagem em 1 min); 0 = enviar tudo de imediato com horas passadas
  --noise=10         ruído GPS (desvio-padrão em metros)
  --stopAt=0.3       paragem a 30 % da rota (fração; 0 = sem paragem)  --stopMin=20
  --lossFrom=0.5 --lossTo=0.6   troço sem sinal (frações; vazio = sem perda)
  --until=1          até que fração da rota (1 = destino)
Pré-requisitos: a viagem tem de estar "Em viagem" e ter rota calculada. Crie a chave em Dispositivos → Chaves de ingestão (Simulador GPS).`);
  process.exit(args.help ? 0 : 1);
}
const H = { 'x-ingest-key': args.key, 'content-type': 'application/json' };
const r = await fetch(`${args.base}/api/ingest/route?vehicle_id=${args.vehicle}`, { headers: H });
if (!r.ok) { console.error('Rota indisponível:', r.status, await r.text()); process.exit(1); }
const route = (await r.json()) as { code: string; lengthM: number; coordinates: [number, number][] };
const L = route.lengthM / 1000;
const speed = Number(args.speed ?? 60), until = Number(args.until ?? 1), factor = Number(args.factor ?? 60);
const plan: SimSegment[] = [];
const stopAt = Number(args.stopAt ?? 0.3);
const lossFrom = args.lossFrom ? Number(args.lossFrom) : null, lossTo = args.lossTo ? Number(args.lossTo) : null;
const marks = [...new Set([stopAt, lossFrom, lossTo, until].filter((x): x is number => x != null && x > 0 && x <= until))].sort((a, b) => a - b);
for (const m of marks) {
  const inLoss = lossFrom != null && lossTo != null && m > lossFrom && m <= lossTo;
  plan.push({ type: inLoss ? 'signal_loss' : 'drive', untilKm: L * m, speedKmh: speed });
  if (m === stopAt) plan.push({ type: 'stop', minutes: Number(args.stopMin ?? 20) });
}
const totalS = plan.reduce((s, p) => s + (p.type === 'stop' ? p.minutes * 60 : 0), 0) + (L * until / speed) * 3600;
const start = factor > 0 ? Date.now() : Date.now() - totalS * 1000 - 60_000;
const fixes = simulate(route.coordinates, plan, { intervalS: Number(args.interval ?? 15), noiseM: Number(args.noise ?? 10), seed: Date.now() % 100000, startT: start });
console.log(`Viagem ${route.code}: ${L.toFixed(1)} km pela estrada, ${fixes.length} posições, fator ${factor || 'imediato'}`);
const send = async (batch: typeof fixes) => {
  const res = await fetch(`${args.base}/api/ingest`, { method: 'POST', headers: H, body: JSON.stringify({ vehicle_id: args.vehicle, sent_at: new Date().toISOString(),
    positions: batch.map((f) => ({ lat: f.lat, lng: f.lng, device_time: new Date(f.t).toISOString(), speed_kmh: f.speedKmh, heading: f.heading % 360, accuracy_m: f.accuracyM })) }) });
  console.log(new Date(batch[batch.length - 1]!.t).toISOString().slice(11, 19), res.status, await res.text());
};
if (factor <= 0) { for (let i = 0; i < fixes.length; i += 50) await send(fixes.slice(i, i + 50)); }
else {
  // tempo acelerado: as posições são enviadas quando o "relógio simulado" as atinge (em lotes de 10 s reais)
  let i = 0;
  const t0 = Date.now();
  while (i < fixes.length) {
    const simNow = start + (Date.now() - t0) * factor;
    const batch: typeof fixes = [];
    while (i < fixes.length && fixes[i]!.t <= simNow && batch.length < 50) batch.push({ ...fixes[i++]!, t: Date.now() - (simNow - fixes[i - 1]!.t) / factor });
    if (batch.length) await send(batch);
    await new Promise((res) => setTimeout(res, 10_000));
  }
}
console.log('Simulação terminada.');
