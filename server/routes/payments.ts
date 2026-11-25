// Pagamento por viagem (ADR-028/030): 1.ª viagem real grátis, depois o preço configurado (250 MT) por M-Pesa / e-Mola.
// O cliente transfere e envia a fotografia do comprovativo + o código. Confirmação (ADR-030, sem SMS):
//   verificações duras (valor, quem recebeu, código único, imagem única, hora) + análise da IA (sinais de edição)
//   → aprovado sozinho / "em análise" (o proprietário decide) / rejeitado. Um aprovado pode ser anulado (era burla).
// O SMS reencaminhado (ADR-028) continua a funcionar se um dia for ligado. O bloqueio do início está na BD (trips_payment_gate).
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid } from '../http.js';
import { many, one, withSystem, withTx } from '../db.js';
import { requireMember, asMember, audit, getMember, limitOr429, WRITE } from '../auth.js';
import { ipHash } from '../crypto.js';
import { mzPhone, parseReceipt } from '../../src/lib/billing/receipt.js';
import { analyseReceipt, decide } from '../payments/receiptAi.js';

type Billing = { price_per_trip: string; currency: string; free_trips: number; mpesa_number: string | null; mpesa_name: string | null; emola_number: string | null; emola_name: string | null };
const normTx = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

route('GET', '/api/billing', async (req) => {
  const m = await requireMember(req);
  const tripId = req.query.get('trip');
  return ok(await asMember(m, async (c) => {
    const b = (await one<Billing>(c, 'select * from billing_settings limit 1'))!;
    const used = (await one<{ n: number }>(c, `select count(*)::int n from trips x left join vehicles v on v.id = x.vehicle_id
      where x.organization_id = $1 and x.actual_departure is not null and not coalesce(v.is_test, false)`, [m.orgId]))!.n;
    const blocked = (await one<{ b: boolean }>(c, 'select payments_blocked b from organizations where id = $1', [m.orgId]))?.b ?? false;
    const payment = tripId ? await one(c, `select id, status, transaction_id, method, amount, auto, reason, created_at, decided_at from trip_payments
      where trip_id = $1 order by created_at desc limit 1`, [assertUuid(tripId)]) : null;
    return { price: Number(b.price_per_trip), currency: b.currency, freeTrips: b.free_trips, freeLeft: Math.max(0, b.free_trips - used), blocked,
      mpesa: b.mpesa_number ? { number: b.mpesa_number, name: b.mpesa_name } : null, emola: b.emola_number ? { number: b.emola_number, name: b.emola_name } : null, payment };
  }));
});

const PayBody = z.object({
  method: z.enum(['mpesa', 'emola']),
  transaction_id: z.string().min(6).max(40).transform(normTx).pipe(z.string().regex(/^[A-Z0-9]{6,20}$/)),
  payer_phone: z.string().max(20).optional().nullable(),
  receipt_file_id: z.string().uuid(),
  ocr: z.object({ text: z.string().max(4000).optional(), amount: z.number().nullable().optional(), recipient: z.string().max(20).nullable().optional(),
    date: z.string().max(20).nullable().optional() }).optional(),
  image_hash: z.string().regex(/^[0-9a-f]{16}$/).optional().nullable(), // dHash 64 bits calculado no telemóvel (imagens quase iguais)
});
const AUTO_PER_DAY = 3; // aprovações automáticas por empresa por dia (o resto fica "em análise")

route('POST', '/api/trips/:id/payments', async (req, p) => {
  const m = await requireMember(req, WRITE);
  await limitOr429(`pay:${m.userId}`, 3600, 20);
  const tripId = assertUuid(p.id);
  const b = parse(PayBody, req.body);
  const r = await asMember(m, async (c) => {
    const trip = await one<{ id: string; status: string }>(c, 'select id, status from trips where id = $1 and deleted_at is null', [tripId]);
    if (!trip) throw new HttpError(404, 'nao_encontrado');
    if (!['planeada', 'aguardando_partida'].includes(trip.status)) throw new HttpError(409, 'viagem_ja_iniciada');
    const pend = await one(c, `select id, status from trip_payments where trip_id = $1 and status in ('pendente','aprovado') limit 1`, [tripId]);
    if (pend) throw new HttpError(409, 'pagamento_ja_enviado');
    const file = await one<{ data: Buffer }>(c, `select data from files where id = $1 and kind = 'receipt'`, [b.receipt_file_id]);
    if (!file) throw new HttpError(400, 'comprovativo_em_falta');
    const sha = createHash('sha256').update(file.data).digest('hex');
    const bs = (await one<Billing>(c, 'select * from billing_settings limit 1'))!;
    const price = Number(bs.price_per_trip);
    // verificações da leitura da fotografia (ajudam; a prova real é o SMS ou a verificação manual)
    if (b.ocr?.amount != null && Math.abs(b.ocr.amount - price) > 0.009) throw new HttpError(400, 'comprovativo_valor');
    const ours = [bs.mpesa_number, bs.emola_number].map((x) => (x ? mzPhone(x) : null)).filter(Boolean);
    if (b.ocr?.recipient && ours.length && !ours.includes(mzPhone(b.ocr.recipient))) throw new HttpError(400, 'comprovativo_numero');
    const ins = await one<{ id: string }>(c, `insert into trip_payments (organization_id, trip_id, amount, currency, method, transaction_id, payer_phone, receipt_file_id,
        ocr_text, ocr_amount, ocr_recipient, ocr_date, created_by, image_sha256, image_dhash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [m.orgId, tripId, price, bs.currency, b.method, b.transaction_id, b.payer_phone ? mzPhone(b.payer_phone) : null, b.receipt_file_id,
        b.ocr?.text ?? null, b.ocr?.amount ?? null, b.ocr?.recipient ?? null, b.ocr?.date ?? null, m.userId, sha, b.image_hash ?? null]);
    await audit(c, m, 'pagamento.enviar', 'trip_payments', ins!.id, { codigo: b.transaction_id, metodo: b.method, valor: price });
    return { id: ins!.id, data: file.data, bs, price };
  });
  // o SMS do proprietário já chegou antes? → aprovado já (só se o SMS estiver ligado)
  const sms = await withSystem((c) => one<{ ok: boolean }>(c, 'select payment_match_sms($1) ok', [r.id]));
  if (sms?.ok) return ok({ id: r.id, status: 'aprovado', reason: null }, 201);
  const out = await reviewPayment(r.id, r.data, r.bs, r.price, b);
  return ok({ id: r.id, ...out }, 201);
});

/** Análise do comprovativo (IA + regras duras) e decisão. Nunca aprova sem a IA; limites de risco por empresa. */
async function reviewPayment(id: string, data: Buffer, bs: Billing, price: number, b: z.infer<typeof PayBody>) {
  const ct = (await withSystem((c) => one<{ content_type: string }>(c, 'select f.content_type from trip_payments p join files f on f.id = p.receipt_file_id where p.id = $1', [id])))!.content_type;
  const expected = { price, code: b.transaction_id, method: b.method,
    accounts: b.method === 'mpesa' ? [{ number: bs.mpesa_number, name: bs.mpesa_name }] : [{ number: bs.emola_number, name: bs.emola_name }],
    clientAmount: b.ocr?.amount ?? null };
  const ai = await analyseReceipt({ data, contentType: ct }, expected, { ocrText: b.ocr?.text ?? null });
  let d = decide(ai, expected);
  return withSystem(async (c) => {
    if (d.status === 'aprovado') {
      // imagem quase igual a outro comprovativo (cortada/recomprimida), limite diário, ou empresa com burla anulada → em análise
      const near = b.image_hash ? await one(c, `select 1 from trip_payments where id <> $1 and image_dhash is not null and status <> 'rejeitado'
          and bit_count(('x' || image_dhash)::bit(64) # ('x' || $2)::bit(64)) <= 5 limit 1`, [id, b.image_hash]) : null;
      const st = (await one<{ today: number; revoked: number }>(c, `select count(*) filter (where status = 'aprovado' and decided_by_ai and decided_at > now() - interval '24 hours')::int today,
          count(*) filter (where status = 'anulado')::int revoked from trip_payments where organization_id = (select organization_id from trip_payments where id = $1)`, [id]))!;
      if (near) d = { ...d, status: 'pendente', reason: 'Em análise: imagem muito parecida com outro comprovativo.' };
      else if (st.revoked > 0) d = { ...d, status: 'pendente', reason: 'Em análise: conta com pagamento anulado.' };
      else if (st.today >= AUTO_PER_DAY) d = { ...d, status: 'pendente', reason: 'Em análise: limite diário de aprovações automáticas.' };
    }
    await c.query('select payment_ai_decide($1, $2, $3, $4, $5)', [id, d.status, d.reason,
      JSON.stringify({ ai, checks: d.checks, model: ai ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : null }), ai ? Math.round(ai.risco) : null]);
    return { status: d.status, reason: d.reason };
  });
}

// SMS reencaminhado do telemóvel que recebe os pagamentos (app gratuita de reencaminhar SMS no Android).
// ⚠️ DEPENDÊNCIA EXTERNA: PAYMENTS_SMS_SECRET (Vercel) e a app de reencaminhamento; formatos de SMS por confirmar.
route('POST', '/api/payments/sms', async (req) => {
  const secret = process.env.PAYMENTS_SMS_SECRET ?? '';
  const key = req.query.get('key') ?? String(req.headers['x-sms-key'] ?? '');
  if (!secret || key.length !== secret.length || !timingSafeEqual(Buffer.from(key), Buffer.from(secret))) throw new HttpError(401, 'nao_autenticado');
  await limitOr429(`sms:${ipHash(req.ip)}`, 60, 60);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pick = (...k: string[]) => k.map((x) => body[x]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const raw = (pick('text', 'message', 'body', 'msg', 'content', 'sms') ?? (typeof req.body === 'string' ? req.body : '')).slice(0, 2000);
  if (!raw) throw new HttpError(400, 'sms_vazio');
  const f = parseReceipt(raw);
  const res = await withSystem(async (c) => {
    const s = await one<{ id: string }>(c, `insert into payment_sms (raw, sender, transaction_id, amount, payer, method) values ($1,$2,$3,$4,$5,$6)
      on conflict (transaction_id) where transaction_id is not null do nothing returning id`,
      [raw, pick('from', 'sender', 'number', 'phone') ?? null, f.transactionId ? normTx(f.transactionId) : null, f.amount, f.phones[0] ?? null, f.method ?? parseReceipt(pick('from', 'sender', 'number', 'phone') ?? '').method]);
    if (!s) return { stored: false, matched: false };
    // pagamento pendente com o mesmo código, ou do mesmo número com o valor certo (últimas 24 h)
    const pay = await one<{ id: string }>(c, `select id from trip_payments where status = 'pendente' and (transaction_id = $1
      or ($2::text is not null and payer_phone = $2 and amount <= $3 and created_at > now() - interval '24 hours')) order by created_at desc limit 1`,
      [f.transactionId ? normTx(f.transactionId) : null, f.phones[0] ?? null, f.amount ?? 0]);
    const matched = pay ? (await one<{ ok: boolean }>(c, 'select payment_match_sms($1) ok', [pay.id]))?.ok ?? false : false;
    return { stored: true, matched };
  });
  return ok({ ok: true, ...res, transaction_id: f.transactionId, amount: f.amount });
});

// ── Plataforma (proprietário do insightFrota) ──
async function requirePlatform(req: Parameters<typeof getMember>[0]) {
  const m = await getMember(req);
  if (!m) throw new HttpError(401, 'nao_autenticado');
  if (!m.isPlatformAdmin) throw new HttpError(403, 'sem_permissao');
  return m;
}

route('GET', '/api/platform/payments', async (req) => {
  await requirePlatform(req);
  return ok(await withSystem(async (c) => ({
    payments: await many(c, `select p.id, p.status, p.amount, p.currency, p.method, p.transaction_id, p.payer_phone, p.auto, p.reason, p.created_at, p.decided_at,
        p.ocr_amount, p.ocr_recipient, p.ocr_date, p.receipt_file_id, p.ai_risk, p.ai_result, p.decided_by_ai, o.name org, o.payments_blocked, p.organization_id, t.code trip_code,
        po.name origin, pd.name destination,
        (select jsonb_agg(jsonb_build_object('raw', s.raw, 'amount', s.amount, 'received_at', s.received_at)) from payment_sms s
          where s.transaction_id = p.transaction_id) sms
      from trip_payments p join organizations o on o.id = p.organization_id join trips t on t.id = p.trip_id
      join places po on po.id = t.origin_place_id join places pd on pd.id = t.destination_place_id
      order by (p.status = 'pendente') desc, p.created_at desc limit 200`),
    billing: await one(c, 'select * from billing_settings limit 1'),
    aiConfigured: !!process.env.GEMINI_API_KEY || (process.env.AI_RECEIPT_STUB === '1' && !process.env.VERCEL),
  })));
});

route('GET', '/api/platform/payments/:id/receipt', async (req, p) => {
  await requirePlatform(req);
  const f = await withSystem((c) => one<{ content_type: string; data: Buffer }>(c,
    'select f.content_type, f.data from trip_payments p join files f on f.id = p.receipt_file_id where p.id = $1', [assertUuid(p.id)]));
  if (!f) throw new HttpError(404, 'nao_encontrado');
  return { status: 200, raw: f.data, headers: { 'content-type': f.content_type, 'cache-control': 'private, max-age=300' } };
});

// "Era burla": anula um pagamento aprovado → viagem cancelada, empresa bloqueada (payment_revoke).
route('POST', '/api/platform/payments/:id/revoke', async (req, p) => {
  const m = await requirePlatform(req);
  const b = parse(z.object({ reason: z.string().min(3).max(300) }), req.body);
  await withTx({ userId: m.userId }, (c) => c.query('select payment_revoke($1, $2)', [assertUuid(p.id), b.reason]));
  return ok({ ok: true });
});

route('POST', '/api/platform/payments/:id/decide', async (req, p) => {
  const m = await requirePlatform(req);
  const b = parse(z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }), req.body);
  if (!b.approve && (b.reason ?? '').trim().length < 3) throw new HttpError(400, 'motivo_obrigatorio');
  await withTx({ userId: m.userId }, (c) => c.query('select payment_decide($1, $2, $3)', [assertUuid(p.id), b.approve, b.reason ?? null]));
  return ok({ ok: true });
});

const BillingBody = z.object({
  price_per_trip: z.number().min(0).max(100000), free_trips: z.number().int().min(0).max(100),
  mpesa_number: z.string().max(20).nullable(), mpesa_name: z.string().max(80).nullable(),
  emola_number: z.string().max(20).nullable(), emola_name: z.string().max(80).nullable(),
});
route('PUT', '/api/platform/billing', async (req) => {
  const m = await requirePlatform(req);
  const b = parse(BillingBody, req.body);
  for (const k of ['mpesa_number', 'emola_number'] as const) if (b[k] && !mzPhone(b[k]!)) throw new HttpError(400, 'telefone_invalido');
  await withSystem(async (c) => {
    await c.query(`update billing_settings set price_per_trip = $1, free_trips = $2, mpesa_number = $3, mpesa_name = $4, emola_number = $5, emola_name = $6, updated_at = now()`,
      [b.price_per_trip, b.free_trips, b.mpesa_number ? mzPhone(b.mpesa_number) : null, b.mpesa_name, b.emola_number ? mzPhone(b.emola_number) : null, b.emola_name]);
    await c.query(`insert into audit_logs (actor_type, actor_id, action, entity, after) values ('platform', $1, 'cobranca.definir', 'billing_settings', $2)`, [m.userId, JSON.stringify(b)]);
  });
  return ok({ ok: true });
});

route('POST', '/api/platform/orgs/:id/unblock-payments', async (req, p) => {
  const m = await requirePlatform(req);
  await withSystem(async (c) => {
    await c.query('update organizations set payments_blocked = false where id = $1', [assertUuid(p.id)]);
    await c.query(`insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id) values ($1, 'platform', $2, 'pagamentos.desbloquear', 'organizations', $1)`, [p.id, m.userId]);
  });
  return ok({ ok: true });
});
