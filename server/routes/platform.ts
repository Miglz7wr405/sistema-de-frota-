import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { withTx, many } from '../db.js';
import { getMember } from '../auth.js';

async function requirePlatform(req: Parameters<typeof getMember>[0]) {
  const m = await getMember(req);
  if (!m) throw new HttpError(401, 'nao_autenticado');
  if (!m.isPlatformAdmin) throw new HttpError(403, 'sem_permissao');
  return m;
}

route('GET', '/api/platform/orgs', async (req) => {
  const m = await requirePlatform(req);
  return ok(await withTx({ userId: m.userId }, (c) => many(c, 'select * from platform_overview()')));
});
route('GET', '/api/platform/plans', async (req) => {
  const m = await requirePlatform(req);
  return ok(await withTx({ userId: m.userId }, (c) => many(c, 'select id, code, name, limits, price, currency from plans order by price, code')));
});
route('POST', '/api/platform/orgs/:id/plan', async (req, p) => {
  const m = await requirePlatform(req);
  const b = parse(z.object({ plan: z.string().min(2).max(40), status: z.enum(['trial', 'active', 'past_due', 'canceled']) }), req.body);
  await withTx({ userId: m.userId }, (c) => c.query('select platform_set_plan($1, $2, $3)', [assertUuid(p.id), b.plan, b.status]));
  return ok({ ok: true });
});
route('POST', '/api/platform/orgs/:id/support', async (req, p) => {
  const m = await requirePlatform(req);
  const b = parse(z.object({ reason: z.string().min(5).max(500), hours: z.number().int().min(1).max(2) }), req.body);
  const r = await withTx({ userId: m.userId }, (c) => c.query('select platform_grant_support($1, $2, $3) as id', [assertUuid(p.id), b.reason, b.hours]));
  return ok({ id: r.rows[0].id }, 201);
});
