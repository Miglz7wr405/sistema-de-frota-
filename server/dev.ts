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
const testStyle = JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8eef3' } }] });
createServer((req, res) => {
  if (process.env.E2E_ROUTING_STUB === '1' && req.url === '/__test/style.json') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(testStyle); return; }
  handle(req, res).catch((e) => { console.error(e); res.writeHead(500); res.end(); }); })
  .listen(port, () => console.log(`API em http://localhost:${port}`));
