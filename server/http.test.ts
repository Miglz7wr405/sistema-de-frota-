import { describe, expect, it } from 'vitest';
import { dispatch, route, ok } from './http';

route('POST', '/api/__csrf_test', async () => ok({ ok: true }));
const call = (h: Record<string, string>) => dispatch({ method: 'POST', path: '/api/__csrf_test', query: new URLSearchParams(), headers: { cookie: 'if_session=x', ...h }, body: {}, ip: '1.1.1.1' });

describe('proteção CSRF', () => {
  it('aceita pedidos do mesmo site mesmo quando o proxy muda o host (caso da Vercel)', async () => {
    expect((await call({ origin: 'https://insightfrota.vercel.app', host: 'interno.vercel', 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await call({ origin: 'https://insightfrota.vercel.app', host: 'interno', 'x-forwarded-host': 'insightfrota.vercel.app' })).status).toBe(200);
  });
  it('recusa pedidos de outro site', async () => {
    expect((await call({ origin: 'https://mau.example', host: 'insightfrota.vercel.app', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call({ origin: 'https://mau.example', host: 'insightfrota.vercel.app' })).status).toBe(403);
  });
});
