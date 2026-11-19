// Ponto de entrada da Vercel Function (empacotado por scripts/build-vercel.mjs para .vercel/output).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './node-adapter.js';
export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handle(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end('{"error":"erro_interno"}'); });
}
