// Adaptador Node http (IncomingMessage/ServerResponse) → mini-router. Usado na Vercel e localmente.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatch } from './app.js';

const MAX_BODY = 4 * 1024 * 1024;

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  let path = url.pathname;
  // /t/<token> (link partilhado) → pré-visualização Open Graph
  const share = /^\/t\/([A-Za-z0-9_-]{10,64})\/?$/.exec(path);
  if (share) { path = '/api/preview'; url.searchParams.set('token', share[1]!); }
  let body: unknown = undefined;
  if (req.method && !['GET', 'HEAD'].includes(req.method)) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const ch of req) {
      size += (ch as Buffer).length;
      if (size > MAX_BODY) { res.writeHead(413, { 'content-type': 'application/json' }); res.end('{"error":"corpo_grande"}'); return; }
      chunks.push(ch as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try { body = JSON.parse(raw); } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"json_invalido"}'); return; }
    }
  }
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  const ip = (headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.socket.remoteAddress || '0.0.0.0';
  const out = await dispatch({ method: req.method ?? 'GET', path, query: url.searchParams, headers, body, ip });
  const h: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...out.headers };
  if (out.raw !== undefined) { res.writeHead(out.status, h); res.end(out.raw); return; }
  res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', ...h });
  res.end(JSON.stringify(out.json ?? null));
}
