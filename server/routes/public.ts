// Rastreamento público (diferencial). O visitante NUNCA lê tabelas: só recebe o DTO de lista branca (public_trip_dto).
import { route, ok, HttpError, type Req } from '../http.js';
import { withSystem, one } from '../db.js';
import { hit } from '../auth.js';
import { ipHash, sha256 } from '../crypto.js';
import { normalizeTripCode } from '../../src/lib/format/index.js';
import { t } from '../../src/i18n/pt-MZ.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function resolve(req: Req, via: 'code' | 'link' | 'preview') {
  const ip = ipHash(req.ip);
  if (!(await hit(`pub:${ip}`, 60, 60))) throw new HttpError(429, 'demasiados_pedidos');
  const token = req.query.get('token');
  const rawCode = req.query.get('code');
  let tokenHash: string | null = null;
  let code: string | null = null;
  if (token) {
    if (!TOKEN_RE.test(token)) throw new HttpError(404, 'indisponivel');
    tokenHash = sha256(token);
  } else if (rawCode) {
    // Tentativas por código são mais limitadas (contra adivinhação): 10 erros por 15 min por IP.
    if (!(await hit(`pubcode-try:${ip}`, 900, 60))) throw new HttpError(429, 'demasiados_pedidos');
    code = normalizeTripCode(rawCode);
    if (!code) throw new HttpError(400, 'codigo_invalido');
  } else throw new HttpError(400, 'falta_token');
  const s = await withSystem((c) => one<{ share_id: string }>(c, 'select * from public_share_resolve($1, $2)', [tokenHash ?? '-', code]));
  if (!s) {
    if (code && !(await hit(`pubcode-fail:${ip}`, 900, 10))) throw new HttpError(429, 'demasiados_pedidos');
    throw new HttpError(404, 'indisponivel');
  }
  return { shareId: s.share_id, ip, via };
}

route('GET', '/api/track', async (req) => {
  const r = await resolve(req, req.query.get('token') ? 'link' : 'code');
  const dto = await withSystem(async (c) => {
    await c.query('select public_share_log($1, $2, $3, $4)', [r.shareId, r.ip, req.headers['user-agent'] ?? '', r.via]);
    await c.query(`select bump_usage(organization_id, 'public_views') from tracking_shares where id = $1`, [r.shareId]);
    return (await one<{ dto: unknown }>(c, 'select public_trip_dto($1) as dto', [r.shareId]))!.dto;
  });
  return ok(dto, 200, { 'cache-control': 'no-store' });
});

route('GET', '/api/track/logo', async (req) => {
  const r = await resolve(req, 'link');
  const f = await withSystem((c) => one<{ content_type: string; data: Buffer }>(c, 'select * from public_share_logo($1)', [r.shareId]));
  if (!f) throw new HttpError(404, 'sem_logo');
  return { status: 200, raw: f.data, headers: { 'content-type': f.content_type, 'cache-control': 'public, max-age=3600' } };
});

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// Pré-visualização Open Graph para o WhatsApp (ADR-011): /t/<token> → HTML mínimo com metatags + redireção para a SPA.
route('GET', '/api/preview', async (req) => {
  const token = req.query.get('token') ?? '';
  const target = `/track/${encodeURIComponent(token)}`;
  let title = t.track.title;
  let desc = t.track.unavailable;
  try {
    const r = await resolve(req, 'preview');
    const dto = await withSystem(async (c) => {
      await c.query('select public_share_log($1, $2, $3, $4)', [r.shareId, r.ip, req.headers['user-agent'] ?? '', 'preview']);
      return (await one<{ dto: { code: string; status: string; origin: string; destination: string; progress?: { pct: number } | null; company?: string | null } }>(c,
        'select public_trip_dto($1) as dto', [r.shareId]))!.dto;
    });
    title = `${dto.company ? dto.company + ' · ' : ''}${t.track.trip} ${dto.code} · ${t.trip.statuses[dto.status] ?? dto.status}`;
    desc = `${dto.origin} → ${dto.destination}${dto.progress ? ` · ${t.track.pctDone(dto.progress.pct)}` : ''}`;
  } catch { /* link inválido: pré-visualização genérica, sem revelar se existe */ }
  const html = `<!doctype html><html lang="pt-MZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="/og-image.png"><meta property="og:site_name" content="insightFrota"><meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body><p><a href="${esc(target)}">${esc(t.track.title)}</a></p><script>location.replace(${JSON.stringify(target)})</script></body></html>`;
  return { status: 200, raw: html, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } };
});
