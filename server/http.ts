// Mini-router independente da plataforma: usado pela Vercel Function (api/[...path].ts) e pelo servidor local.
import type { ZodSchema } from 'zod';

export type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
  ip: string;
};
export type Res = { status: number; headers?: Record<string, string>; json?: unknown; raw?: Buffer | string };

export class HttpError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) { super(code); }
}

export type Handler = (req: Req, params: Record<string, string>) => Promise<Res>;
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };
const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
}

export const ok = (json: unknown, status = 200, headers?: Record<string, string>): Res => ({ status, json, headers });

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'validacao', r.error.flatten());
  return r.data;
}

/** Traduz erros do Postgres para HTTP (sem expor detalhes internos). */
export function mapError(e: unknown): Res {
  if (e instanceof HttpError) return { status: e.status, json: { error: e.code, details: e.details } };
  const pe = e as { code?: string; message?: string; constraint?: string };
  const msg = pe.message ?? '';
  if (pe.code === 'P0001') {
    const code = msg.split(':')[0] ?? 'erro';
    return { status: code === 'limite_plano' ? 402 : 422, json: { error: code, details: msg } };
  }
  if (pe.code === 'P0002') return { status: 404, json: { error: msg || 'nao_encontrado' } };
  if (pe.code === '42501') return { status: 403, json: { error: 'sem_permissao' } };
  if (pe.code === '23505') return { status: 409, json: { error: 'duplicado', details: pe.constraint } };
  if (pe.code === '23503') return { status: 409, json: { error: 'referencia', details: pe.constraint } };
  if (pe.code && ['23514', '22P02', '22007', '22008', '23502', '22003', '23P01'].includes(pe.code))
    return { status: 400, json: { error: 'dados_invalidos', details: pe.constraint ?? pe.code } };
  console.error('[api] erro interno', e);
  return { status: 500, json: { error: 'erro_interno' } };
}

export async function dispatch(req: Req): Promise<Res> {
  // Proteção CSRF (pedidos que alteram dados com cookie). O cookie já é SameSite=Lax; além disso:
  // 1) se o navegador indicar Sec-Fetch-Site, só se recusa 'cross-site';
  // 2) sem esse cabeçalho, a Origin tem de coincidir com um dos anfitriões conhecidos (x-forwarded-host, host, PUBLIC_BASE_URL).
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.cookie) {
    const site = req.headers['sec-fetch-site'];
    if (site) {
      if (site === 'cross-site') return { status: 403, json: { error: 'origem_invalida' } };
    } else if (req.headers.origin) {
      const allowed = new Set([req.headers['x-forwarded-host'], req.headers.host,
        process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).host : undefined].filter(Boolean) as string[]);
      let originHost = '';
      try { originHost = new URL(req.headers.origin).host; } catch { /* inválida */ }
      if (!allowed.has(originHost)) return { status: 403, json: { error: 'origem_invalida' } };
    }
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(req.path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    try {
      const res = await r.handler(req, params);
      return { ...res, headers: { 'cache-control': 'no-store', ...res.headers } };
    } catch (e) {
      return mapError(e);
    }
  }
  return { status: 404, json: { error: 'rota_inexistente' } };
}

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(v: string | undefined | null, name = 'id'): string {
  if (!v || !uuid.test(v)) throw new HttpError(400, `${name}_invalido`);
  return v;
}

export function cookie(req: Req, name: string): string | null {
  const c = req.headers.cookie;
  if (!c) return null;
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
