// Plataforma → Pagamentos (ADR-030): cada comprovativo é analisado pela IA + regras duras (valor, número, hora, código,
// imagem repetida). Aprovados sozinhos, "em análise" (decidir aqui) ou rejeitados. Um aprovado pode ser anulado ("era burla"):
// a viagem é cancelada e a empresa bloqueada. Também se define o preço e os números que recebem.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge, Button, Card, Field, Input, Modal, QueryState } from '@/components/ui';

type Ai = { ai: { valor: number | null; destinatario_numero: string | null; destinatario_nome: string | null; codigo: string | null; data_hora: string | null;
  sinais_edicao: string[]; risco: number; motivo: string } | null } | null;
type Pay = { id: string; status: string; amount: string; currency: string; method: string; transaction_id: string; payer_phone: string | null; auto: boolean;
  reason: string | null; created_at: string; ocr_amount: string | null; ocr_recipient: string | null; ocr_date: string | null; receipt_file_id: string | null;
  ai_risk: number | null; ai_result: Ai; decided_by_ai: boolean;
  org: string; organization_id: string; payments_blocked: boolean; trip_code: string; origin: string; destination: string; sms: { raw: string; amount: string; received_at: string }[] | null };
type Data = { payments: Pay[]; aiConfigured: boolean;
  billing: { price_per_trip: string; free_trips: number; mpesa_number: string | null; mpesa_name: string | null; emola_number: string | null; emola_name: string | null } };
const P = t.payments;
const tone = (s: string) => (s === 'aprovado' ? 'success' : s === 'rejeitado' || s === 'anulado' ? 'danger' : 'warning') as 'success' | 'danger' | 'warning';

export function PaymentsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-payments'], queryFn: () => api<Data>('/api/platform/payments'), refetchInterval: 15_000 });
  const [rej, setRej] = useState<{ id: string; reason: string; revoke: boolean } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const inval = () => { setRej(null); void qc.invalidateQueries({ queryKey: ['platform-payments'] }); };
  const decide = useMutation({ mutationFn: (v: { id: string; approve: boolean; reason?: string }) => api(`/api/platform/payments/${v.id}/decide`, { body: { approve: v.approve, reason: v.reason } }), onSuccess: inval });
  const revoke = useMutation({ mutationFn: (v: { id: string; reason: string }) => api(`/api/platform/payments/${v.id}/revoke`, { body: { reason: v.reason } }), onSuccess: inval });
  const unblock = useMutation({ mutationFn: (org: string) => api(`/api/platform/orgs/${org}/unblock-payments`, { body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-payments'] }) });
  const busy = rej?.revoke ? revoke : decide;
  return (
    <QueryState q={q}>{(d) => (
      <div className="space-y-5">
        <Card title={P.aiTitle}>
          <p className={`flex items-start gap-2 text-sm font-medium ${d.aiConfigured ? 'text-success-text' : 'text-warning'}`} data-testid="ia-estado">
            {d.aiConfigured ? <ShieldCheck className="h-5 w-5 shrink-0" /> : <ShieldAlert className="h-5 w-5 shrink-0" />}{d.aiConfigured ? P.aiOn : P.aiOff}</p>
          <p className="mt-2 text-sm text-muted">{P.aiHonesty}</p>
        </Card>
        <BillingForm d={d} />
        <Card title={P.title}>
          {!d.payments.length ? <p className="text-sm text-muted">{P.none}</p> : (
            <div className="divide-y divide-border">
              {d.payments.map((p) => {
                const ai = p.ai_result?.ai ?? null;
                return (
                <div key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start" data-testid="pagamento">
                  {p.receipt_file_id && <button type="button" onClick={() => setPhoto(p.id)} className="shrink-0">
                    <img src={`/api/platform/payments/${p.id}/receipt`} alt={P.receipt} className="h-24 w-16 rounded-lg border border-border object-cover" loading="lazy" /></button>}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <b className="text-base text-navy">{formatMoney(p.amount, p.currency)}</b>
                      <Badge tone={tone(p.status)}>{P.status[p.status] ?? p.status}{p.auto ? ` · ${p.decided_by_ai ? P.auto : P.autoSms}` : ''}</Badge>
                      {p.ai_risk != null && <Badge tone={p.ai_risk >= 70 ? 'danger' : p.ai_risk >= 30 ? 'warning' : 'success'}>{P.aiRisk(p.ai_risk)}</Badge>}
                      <span className="text-muted">{p.method === 'mpesa' ? 'M-Pesa' : 'e-Mola'} · {formatDateTime(p.created_at)}</span>
                    </p>
                    <p className="mt-1 text-navy">{p.org} · {p.trip_code} · {p.origin} → {p.destination}</p>
                    <p className="mt-1 font-mono">{P.code}: <b>{p.transaction_id}</b>{p.payer_phone ? ` · ${P.payer}: ${p.payer_phone}` : ''}</p>
                    {ai ? <>
                      <p className="text-muted">{P.aiRead}: {ai.valor != null ? formatMoney(ai.valor, p.currency) : '—'} · {ai.destinatario_numero ?? '—'} {ai.destinatario_nome ?? ''} · {ai.codigo ?? '—'} · {ai.data_hora ?? '—'}</p>
                      {(ai.sinais_edicao.length > 0 || ai.motivo) && <p className="text-muted">{ai.sinais_edicao.length ? `${P.aiSigns}: ${ai.sinais_edicao.join('; ')}` : ai.motivo}</p>}
                    </> : <p className="text-muted">{P.read}: {p.ocr_amount ? formatMoney(p.ocr_amount, p.currency) : '—'} · {p.ocr_recipient ?? '—'} · {p.ocr_date ?? '—'}{p.status !== 'aprovado' ? ` · ${P.aiNone}` : ''}</p>}
                    {p.sms?.length ? <p className="mt-1 rounded-lg bg-success-soft px-2 py-1 text-success-text">✓ {P.smsFound}: “{p.sms[0]!.raw.slice(0, 140)}”</p> : null}
                    {p.reason && <p className={`mt-1 ${p.status === 'pendente' ? 'text-warning' : 'text-danger'}`}>{p.reason}</p>}
                    {p.payments_blocked && <p className="mt-1 text-danger">{P.blocked} <button className="underline" onClick={() => unblock.mutate(p.organization_id)}>{P.unblock}</button></p>}
                  </div>
                  {p.status === 'pendente' && <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="success" loading={decide.isPending} onClick={() => decide.mutate({ id: p.id, approve: true })}><Check className="h-4 w-4" />{P.approve}</Button>
                    <Button size="sm" variant="danger" onClick={() => setRej({ id: p.id, reason: '', revoke: false })}><X className="h-4 w-4" />{P.reject}</Button>
                  </div>}
                  {p.status === 'aprovado' && <Button size="sm" variant="danger" className="shrink-0" data-testid="anular" onClick={() => setRej({ id: p.id, reason: '', revoke: true })}><Ban className="h-4 w-4" />{P.revoke}</Button>}
                </div>); })}
            </div>)}
        </Card>
        <Modal open={!!rej} onClose={() => setRej(null)} title={rej?.revoke ? P.revoke : P.reject}>
          {rej && <div className="space-y-3">
            {rej.revoke && <p className="text-sm text-muted">{P.revokeHelp}</p>}
            <Field label={P.reason}><Input value={rej.reason} placeholder={P.reasonPh} onChange={(e) => setRej({ ...rej, reason: e.target.value })} data-testid="motivo" /></Field>
            {busy.error && <p className="text-sm text-danger">{errorMessage(busy.error)}</p>}
            <Button variant="danger" className="w-full" disabled={rej.reason.trim().length < 3} loading={busy.isPending} data-testid="confirmar-motivo"
              onClick={() => (rej.revoke ? revoke.mutate({ id: rej.id, reason: rej.reason }) : decide.mutate({ id: rej.id, approve: false, reason: rej.reason }))}>{rej.revoke ? P.revoke : P.reject}</Button>
          </div>}
        </Modal>
        <Modal open={!!photo} onClose={() => setPhoto(null)} title={P.receipt} wide>
          {photo && <img src={`/api/platform/payments/${photo}/receipt`} alt={P.receipt} className="mx-auto max-h-[75vh] rounded-lg" />}
        </Modal>
      </div>
    )}</QueryState>
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
