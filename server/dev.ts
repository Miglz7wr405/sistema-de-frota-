// Servidor local da API (npm run dev:api). Em produção a mesma lógica corre numa Vercel Function.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}
const { handle } = await import('./node-adapter.js');
const port = Number(process.env.API_PORT ?? 3001);
// E2E local: estilo de mapa mínimo (o contentor de testes não chega aos tiles reais).
// Com E2E_DEMO_PROVINCES: fundo simples com as províncias reais (para vídeos de demonstração sem internet).
const demoProv = process.env.E2E_DEMO_PROVINCES && existsSync(process.env.E2E_DEMO_PROVINCES) ? JSON.parse(readFileSync(process.env.E2E_DEMO_PROVINCES, 'utf8')) : null;
const testStyle = JSON.stringify(demoProv
  ? { version: 8, sources: { prov: { type: 'geojson', data: demoProv } }, layers: [
      { id: 'mar', type: 'background', paint: { 'background-color': '#a9cdf0' } },
      { id: 'terra', type: 'fill', source: 'prov', paint: { 'fill-color': '#f2efe6' } },
      { id: 'limites', type: 'line', source: 'prov', paint: { 'line-color': '#b8b2a3', 'line-width': 1, 'line-dasharray': [3, 2] } }] }
  : { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8eef3' } }] });
createServer((req, res) => {
  if (process.env.E2E_ROUTING_STUB === '1' && req.url === '/__test/style.json') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(testStyle); return; }
  handle(req, res).catch((e) => { console.error(e); res.writeHead(500); res.end(); }); })
  .listen(port, () => console.log(`API em http://localhost:${port}`));
