// Plataforma → Pagamentos: aprovar/rejeitar comprovativos, definir preço e números, e ligar o telemóvel que recebe
// os SMS do M-Pesa/e-Mola (o "conector"): cada SMS reencaminhado confirma sozinho o pagamento com o mesmo código
// ou o mesmo número + valor. As Mensagens Google não têm forma de outro sistema ler os SMS; por isso usa-se uma app
// gratuita de reencaminhar SMS no Android.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Smartphone, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge, Button, Card, Field, Input, Modal, QueryState } from '@/components/ui';

type Pay = { id: string; status: string; amount: string; currency: string; method: string; transaction_id: string; payer_phone: string | null; auto: boolean;
  reason: string | null; created_at: string; ocr_amount: string | null; ocr_recipient: string | null; ocr_date: string | null; receipt_file_id: string | null;
  org: string; organization_id: string; payments_blocked: boolean; trip_code: string; origin: string; destination: string; sms: { raw: string; amount: string; received_at: string }[] | null };
type Data = { payments: Pay[]; sms: { id: string; raw: string; transaction_id: string | null; amount: string | null; payer: string | null; method: string | null; received_at: string; matched_payment_id: string | null }[];
  billing: { price_per_trip: string; free_trips: number; mpesa_number: string | null; mpesa_name: string | null; emola_number: string | null; emola_name: string | null };
  smsConfigured: boolean; smsLast: { at: string | null; n: number } | null; smsUrl: string | null };
const P = t.payments;

export function PaymentsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-payments'], queryFn: () => api<Data>('/api/platform/payments'), refetchInterval: 15_000 });
  const [rej, setRej] = useState<{ id: string; reason: string } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const decide = useMutation({ mutationFn: (v: { id: string; approve: boolean; reason?: string }) => api(`/api/platform/payments/${v.id}/decide`, { body: { approve: v.approve, reason: v.reason } }),
    onSuccess: () => { setRej(null); void qc.invalidateQueries({ queryKey: ['platform-payments'] }); } });
  const unblock = useMutation({ mutationFn: (org: string) => api(`/api/platform/orgs/${org}/unblock-payments`, { body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-payments'] }) });
  return (
    <QueryState q={q}>{(d) => (
      <div className="space-y-5">
        <Connector d={d} />
        <SmsTest d={d} onPoll={() => void q.refetch()} />
        <BillingForm d={d} />
        <Card title={P.title}>
          {!d.payments.length ? <p className="text-sm text-muted">{P.none}</p> : (
            <div className="divide-y divide-border">
              {d.payments.map((p) => (
                <div key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start" data-testid="pagamento">
                  {p.receipt_file_id && <button type="button" onClick={() => setPhoto(p.id)} className="shrink-0">
                    <img src={`/api/platform/payments/${p.id}/receipt`} alt={P.receipt} className="h-24 w-16 rounded-lg border border-border object-cover" loading="lazy" /></button>}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <b className="text-base text-navy">{formatMoney(p.amount, p.currency)}</b>
                      <Badge tone={p.status === 'aprovado' ? 'success' : p.status === 'rejeitado' ? 'danger' : 'warning'}>{P.status[p.status as 'pendente']}{p.auto ? ` · ${P.auto}` : ''}</Badge>
                      <span className="text-muted">{p.method === 'mpesa' ? 'M-Pesa' : 'e-Mola'} · {formatDateTime(p.created_at)}</span>
                    </p>
                    <p className="mt-1 text-navy">{p.org} · {p.trip_code} · {p.origin} → {p.destination}</p>
                    <p className="mt-1 font-mono">{P.code}: <b>{p.transaction_id}</b>{p.payer_phone ? ` · ${P.payer}: ${p.payer_phone}` : ''}</p>
                    <p className="text-muted">{P.read}: {p.ocr_amount ? formatMoney(p.ocr_amount, p.currency) : '—'} · {p.ocr_recipient ?? '—'} · {p.ocr_date ?? '—'}</p>
                    {p.sms?.length ? <p className="mt-1 rounded-lg bg-success-soft px-2 py-1 text-success-text">✓ {P.smsFound}: “{p.sms[0]!.raw.slice(0, 140)}”</p>
                      : p.status === 'pendente' ? <p className="mt-1 text-warning">{P.smsMissing}</p> : null}
                    {p.reason && <p className="mt-1 text-danger">{p.reason}</p>}
                    {p.payments_blocked && <p className="mt-1 text-danger">{P.blocked} <button className="underline" onClick={() => unblock.mutate(p.organization_id)}>{P.unblock}</button></p>}
                  </div>
                  {p.status === 'pendente' && <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="success" loading={decide.isPending} onClick={() => decide.mutate({ id: p.id, approve: true })}><Check className="h-4 w-4" />{P.approve}</Button>
                    <Button size="sm" variant="danger" onClick={() => setRej({ id: p.id, reason: '' })}><X className="h-4 w-4" />{P.reject}</Button>
                  </div>}
                </div>))}
            </div>)}
        </Card>
        <Modal open={!!rej} onClose={() => setRej(null)} title={P.reject}>
          {rej && <div className="space-y-3">
            <Field label={P.reason}><Input value={rej.reason} placeholder={P.reasonPh} onChange={(e) => setRej({ ...rej, reason: e.target.value })} /></Field>
            {decide.error && <p className="text-sm text-danger">{errorMessage(decide.error)}</p>}
            <Button variant="danger" className="w-full" disabled={rej.reason.trim().length < 3} loading={decide.isPending} onClick={() => decide.mutate({ id: rej.id, approve: false, reason: rej.reason })}>{P.reject}</Button>
          </div>}
        </Modal>
        <Modal open={!!photo} onClose={() => setPhoto(null)} title={P.receipt} wide>
          {photo && <img src={`/api/platform/payments/${photo}/receipt`} alt={P.receipt} className="mx-auto max-h-[75vh] rounded-lg" />}
        </Modal>
      </div>
    )}</QueryState>
  );
}

// "Ligar o telemóvel": endereço + passos para a app de reencaminhar SMS; mostra se os SMS estão a chegar.
function Connector({ d }: { d: Data }) {
  const [copied, setCopied] = useState(false);
  const ok = !!d.smsLast?.at;
  return (
    <Card title={P.connTitle}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${ok ? 'bg-success-soft text-success-text' : 'bg-warning-soft text-warning'}`}><Smartphone className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-navy" data-testid="conector-estado">{!d.smsConfigured ? P.connOff : ok ? P.connOk(formatDateTime(d.smsLast!.at!), d.smsLast!.n) : P.connWaiting}</p>
          <p className="mt-1 text-muted">{P.connWhy}</p>
        </div>
      </div>
      {d.smsUrl && <>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-background p-3">
          <code className="min-w-0 flex-1 truncate text-xs">{d.smsUrl}</code>
          <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(d.smsUrl!); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } }}>
            <Copy className="h-4 w-4" />{copied ? P.copied : P.copy}</Button>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-navy">{P.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </>}
      {d.sms.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer text-primary">{P.lastSms(d.sms.length)}</summary>
        <ul className="mt-2 space-y-1">{d.sms.map((s) => <li key={s.id} className="rounded-lg bg-background p-2"><span className="text-muted">{formatDateTime(s.received_at)} · </span>{s.raw.slice(0, 160)}
          {s.matched_payment_id ? <span className="text-success-text"> · ✓ {P.matched}</span> : null}</li>)}</ul></details>}
    </Card>
  );
}

function BillingForm({ d }: { d: Data }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ price_per_trip: String(Number(d.billing.price_per_trip)), free_trips: String(d.billing.free_trips), mpesa_number: d.billing.mpesa_number ?? '',
    mpesa_name: d.billing.mpesa_name ?? '', emola_number: d.billing.emola_number ?? '', emola_name: d.billing.emola_name ?? '' });
  useEffect(() => { /* valores do servidor só no início */ }, []);
  const save = useMutation({ mutationFn: () => api('/api/platform/billing', { method: 'PUT', body: { price_per_trip: Number(v.price_per_trip), free_trips: Number(v.free_trips),
    mpesa_number: v.mpesa_number || null, mpesa_name: v.mpesa_name || null, emola_number: v.emola_number || null, emola_name: v.emola_name || null } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-payments'] }) });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Card title={P.settings}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={P.price}><Input inputMode="decimal" value={v.price_per_trip} onChange={set('price_per_trip')} /></Field>
        <Field label={P.free}><Input inputMode="numeric" value={v.free_trips} onChange={set('free_trips')} /></Field>
        <Field label={P.mpesaNumber}><Input type="tel" value={v.mpesa_number} placeholder="84 123 4567" onChange={set('mpesa_number')} /></Field>
        <Field label={P.mpesaName}><Input value={v.mpesa_name} onChange={set('mpesa_name')} /></Field>
        <Field label={P.emolaNumber}><Input type="tel" value={v.emola_number} placeholder="86 123 4567" onChange={set('emola_number')} /></Field>
        <Field label={P.emolaName}><Input value={v.emola_name} onChange={set('emola_name')} /></Field>
      </div>
      {save.error && <p className="mt-2 text-sm text-danger">{errorMessage(save.error)}</p>}
      <Button className="mt-3" loading={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? P.saved : t.common.save}</Button>
    </Card>
  );
}

// Teste de 1 MT: confirma a ligação do telemóvel (app de reencaminhar SMS) e a leitura do SMS, sem mexer no preço.
function SmsTest({ d, onPoll }: { d: Data; onPoll: () => void }) {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const h = setInterval(() => { onPoll(); setNow(Date.now()); }, 4000);
    return () => clearInterval(h);
  }, [since]);
  const got = since ? d.sms.find((s) => Date.parse(s.received_at) >= since - 5000) ?? null : null;
  const readOk = !!got && !!got.transaction_id && got.amount != null;
  const timedOut = !!since && !got && now - since > 180_000;
  return (
    <Card title={P.testTitle}>
      <p className="text-sm text-muted">{P.testHelp}</p>
      {!since ? <Button className="mt-3" onClick={() => { setSince(Date.now()); setNow(Date.now()); }} data-testid="teste-1mt">{P.testStart}</Button>
      : !got ? (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-navy" data-testid="teste-1mt-espera">
          {timedOut ? <span className="text-warning">{P.testTimeout}</span> : <><Loader2 className="h-4 w-4 animate-spin text-primary" />{P.testWaiting}</>}</p>
      ) : (
        <div className={`mt-3 rounded-xl p-3 text-sm ${readOk ? 'bg-success-soft' : 'bg-warning-soft'}`} data-testid="teste-1mt-resultado">
          <p className={`flex items-center gap-1.5 font-semibold ${readOk ? 'text-success-text' : 'text-warning'}`}>{readOk ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}{readOk ? P.testOk : P.testBadRead}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-navy">
            <dt className="text-muted">{P.code}</dt><dd className="font-mono">{got.transaction_id ?? '—'}</dd>
            <dt className="text-muted">{P.testAmount}</dt><dd>{got.amount != null ? formatMoney(got.amount, 'MZN') : '—'}</dd>
            <dt className="text-muted">{P.payer}</dt><dd>{got.payer ?? '—'}</dd>
            <dt className="text-muted">{P.testOperator}</dt><dd>{got.method === 'mpesa' ? 'M-Pesa' : got.method === 'emola' ? 'e-Mola' : '—'}</dd>
          </dl>
          <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs text-muted">“{got.raw.slice(0, 300)}”</p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => setSince(Date.now())}>{P.testAgain}</Button>
        </div>
      )}
    </Card>
  );
}
