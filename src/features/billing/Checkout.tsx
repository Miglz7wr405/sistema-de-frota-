// Checkout de uma viagem (ADR-028): resumo → pagar por M-Pesa / e-Mola → fotografia do comprovativo (lida no telemóvel)
// → "A confirmar" até o pagamento ser aprovado (SMS do proprietário ou verificação manual). A fotografia nunca aprova sozinha.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, Check, Copy, Loader2, ShieldCheck, X } from 'lucide-react';
import { api, ApiError, errorMessage, fileToUpload } from '@/lib/api/client';
import { parseReceipt, receiptTooOld, mzPhone, type ReceiptFields } from '@/lib/billing/receipt';
import { t } from '@/i18n/pt-MZ';
import { formatMoney } from '@/lib/format';
import { Button, Modal } from '@/components/ui';

type Billing = { price: number; currency: string; freeTrips: number; freeLeft: number; blocked: boolean;
  mpesa: { number: string; name: string | null } | null; emola: { number: string; name: string | null } | null;
  payment: { id: string; status: 'pendente' | 'aprovado' | 'rejeitado'; transaction_id: string; reason: string | null; auto: boolean } | null };
type Method = 'mpesa' | 'emola';
const C = t.checkout;
const fmtPhone = (n: string) => `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;

async function readReceipt(file: File): Promise<string> {
  // OCR no próprio telemóvel (grátis): o motor e o português descarregam-se só aqui (~2 MB na 1.ª vez)
  // sem rede para o motor (ou falha): cai para o código escrito à mão, sem erro no ecrã
  const { createWorker } = await import('tesseract.js');
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('ocr_tempo')), 45_000));
  const w = await Promise.race([createWorker('por', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/', errorHandler: () => {} }), timeout]);
  try { return (await Promise.race([w.recognize(file), timeout])).data.text; } finally { void w.terminate().catch(() => {}); }
}

export function Checkout({ tripId, trip, open, onClose, onPaid }: {
  tripId: string; trip?: { origin?: string; destination?: string; code?: string } | null; open: boolean; onClose: () => void; onPaid: () => void;
}) {
  const q = useQuery({ queryKey: ['billing', tripId], queryFn: () => api<Billing>(`/api/billing?trip=${tripId}`), enabled: open,
    refetchInterval: (qq) => (qq.state.data?.payment?.status === 'pendente' ? 5000 : false) });
  const b = q.data;
  const [method, setMethod] = useState<Method>('mpesa');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fields, setFields] = useState<ReceiptFields | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrFailed, setOcrFailed] = useState(false);
  const [code, setCode] = useState('');
  const [payer, setPayer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const paidOnce = useRef(false);

  useEffect(() => { if (b && !b.mpesa && b.emola) setMethod('emola'); }, [b?.mpesa, b?.emola]);
  // aprovado → avisa quem abriu (que inicia a viagem)
  useEffect(() => {
    if (b?.payment?.status === 'aprovado' && !paidOnce.current) { paidOnce.current = true; setTimeout(onPaid, 1200); }
  }, [b?.payment?.status]);

  const acct = b ? (method === 'mpesa' ? b.mpesa : b.emola) : null;
  const pick = async (f: File | null) => {
    setFile(f); setFields(null); setOcrText(null); setOcrFailed(false); setErr(null);
    if (!f) { setPreview(null); return; }
    setPreview(URL.createObjectURL(f));
    setReading(true);
    try {
      const txt = await readReceipt(f);
      const r = parseReceipt(txt);
      setOcrText(txt); setFields(r);
      if (r.transactionId) setCode(r.transactionId);
      if (r.method) setMethod(r.method);
      // número de quem pagou: o do comprovativo que não é o do insightFrota
      const ours = [b?.mpesa?.number, b?.emola?.number].map((x) => (x ? mzPhone(x) : null));
      const other = r.phones.find((p) => !ours.includes(p));
      if (other && !payer) setPayer(other);
    } catch { setOcrFailed(true); } finally { setReading(false); }
  };

  // verificações do que foi lido (só ajudam; a confirmação real é o SMS ou o proprietário)
  const checks = fields && b ? [
    { ok: !!fields.transactionId, label: fields.transactionId ? C.readCode(fields.transactionId) : C.noCode },
    { ok: fields.amount != null && Math.abs(fields.amount - b.price) < 0.01, label: fields.amount != null ? C.readAmount(formatMoney(fields.amount, b.currency)) : C.noAmount },
    ...(acct ? [{ ok: fields.phones.includes(mzPhone(acct.number) ?? ''), label: fields.phones.includes(mzPhone(acct.number) ?? '') ? C.readNumberOk : C.readNumberBad(fmtPhone(acct.number)) }] : []),
    { ok: receiptTooOld(fields.date) === false, label: fields.date ? (receiptTooOld(fields.date) ? C.tooOld(fields.date) : C.readDate(fields.date)) : C.noDate },
  ] : [];
  const blocking = !!fields && ((fields.amount != null && b != null && Math.abs(fields.amount - b.price) >= 0.01) || receiptTooOld(fields.date) === true
    || (!fields.transactionId && fields.amount == null));

  const submit = async () => {
    if (!file || !b) return;
    setBusy(true); setErr(null);
    try {
      const up = await api<{ id: string }>('/api/files', { body: { kind: 'receipt', ...(await fileToUpload(file)) } });
      const recipient = acct && fields?.phones.includes(mzPhone(acct.number) ?? '') ? acct.number : fields?.phones[0] ?? null;
      await api(`/api/trips/${tripId}/payments`, { body: { method, transaction_id: code, receipt_file_id: up.id, payer_phone: payer || null,
        ocr: fields ? { text: ocrText?.slice(0, 4000), amount: fields.amount, recipient, date: fields.date } : undefined } });
      await q.refetch();
    } catch (e) { setErr(e instanceof ApiError ? errorMessage(e) : t.errors.network); } finally { setBusy(false); }
  };

  const copy = async (n: string) => { try { await navigator.clipboard.writeText(n); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } };
  const st = b?.payment?.status;

  return (
    <Modal open={open} onClose={onClose} title={C.title}>
      {!b ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
        <div className="space-y-4" data-testid="checkout">
          {/* 1. resumo */}
          <div className="rounded-2xl bg-navy p-4 text-white">
            <p className="text-sm text-white/70">{trip?.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : C.trip}{trip?.code ? ` · ${trip.code}` : ''}</p>
            <p className="mt-1 text-3xl font-bold">{formatMoney(b.price, b.currency)}</p>
            <p className="text-sm text-white/70">{b.freeTrips > 0 ? C.freeUsed(b.freeTrips) : C.perTrip}</p>
          </div>

          {b.blocked ? <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{C.blocked}</p>
          : st === 'aprovado' ? (
            <div className="rounded-2xl bg-success-soft p-5 text-center" data-testid="checkout-aprovado">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success text-white"><Check className="h-7 w-7" /></span>
              <p className="mt-3 text-lg font-bold text-success-text">{C.approved}</p>
              <p className="text-sm text-muted">{C.starting}</p>
            </div>
          ) : st === 'pendente' ? (
            <div className="rounded-2xl bg-primary-soft p-5 text-center" data-testid="checkout-pendente">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-lg font-bold text-navy">{C.pending}</p>
              <p className="text-sm text-muted">{C.pendingHelp(b.payment!.transaction_id)}</p>
            </div>
          ) : (
            <>
              {st === 'rejeitado' && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{C.rejected(b.payment!.reason ?? '')}</p>}
              {/* 2. pagar */}
              <div>
                <p className="mb-2 text-sm font-semibold text-navy">{C.step1}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['mpesa', 'emola'] as const).filter((m) => (m === 'mpesa' ? b.mpesa : b.emola)).map((m) => (
                    <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m}
                      className={`rounded-xl border-2 px-3 py-3 text-left transition-colors ${method === m ? (m === 'mpesa' ? 'border-[#E4002B] bg-[#E4002B]/5' : 'border-[#F37021] bg-[#F37021]/5') : 'border-border'}`}>
                      <span className={`block text-base font-bold ${m === 'mpesa' ? 'text-[#C20025]' : 'text-[#C2530F]'}`}>{m === 'mpesa' ? 'M-Pesa' : 'e-Mola'}</span>
                      <span className="block text-xs text-muted">{m === 'mpesa' ? 'Vodacom' : 'Movitel'}</span>
                    </button>))}
                </div>
                {acct ? (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-background p-3">
                    <div className="min-w-0"><p className="text-xs text-muted">{C.sendTo(formatMoney(b.price, b.currency))}</p>
                      <p className="font-mono text-xl font-bold tracking-wide text-navy">{fmtPhone(acct.number)}</p>
                      {acct.name && <p className="truncate text-sm text-muted">{acct.name}</p>}</div>
                    <Button variant="secondary" onClick={() => copy(acct.number)}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? C.copied : C.copy}</Button>
                  </div>
                ) : <p className="mt-3 rounded-xl bg-warning-soft p-3 text-sm text-warning">{C.noNumbers}</p>}
                <p className="mt-2 text-xs text-muted">{method === 'mpesa' ? C.howMpesa : C.howEmola}</p>
              </div>

              {/* 3. comprovativo */}
              <div>
                <p className="mb-2 text-sm font-semibold text-navy">{C.step2}</p>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary-soft/50 px-4 py-4 font-semibold text-primary">
                  <Camera className="h-5 w-5" />{file ? C.changePhoto : C.takePhoto}
                  <input type="file" accept="image/*" className="sr-only" data-testid="checkout-foto" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
                </label>
                {preview && <div className="mt-3 flex gap-3">
                  <img src={preview} alt="" className="h-28 w-20 shrink-0 rounded-lg border border-border object-cover" />
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    {reading ? <p className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" />{C.reading}</p>
                    : ocrFailed ? <p className="text-muted">{C.ocrFailed}</p>
                    : checks.map((c) => <p key={c.label} className={`flex items-start gap-1.5 ${c.ok ? 'text-success-text' : 'text-warning'}`}>{c.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />}<span>{c.label}</span></p>)}
                  </div>
                </div>}
              </div>
              {file && !reading && <label className="block">
                <span className="label">{C.codeLabel}</span>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DK45H7GT2P" data-testid="checkout-codigo"
                  className="input font-mono uppercase tracking-wider" autoCapitalize="characters" />
                <span className="mt-1 block text-xs text-muted">{C.codeHelp}</span>
              </label>}
              {file && !reading && <label className="block">
                <span className="label">{C.payerLabel}</span>
                <input value={payer} onChange={(e) => setPayer(e.target.value)} type="tel" inputMode="tel" placeholder="84 123 4567" className="input" data-testid="checkout-pagador" />
                <span className="mt-1 block text-xs text-muted">{C.payerHelp}</span>
              </label>}
              {blocking && <p role="alert" className="rounded-xl bg-warning-soft p-3 text-sm text-warning">{C.blockingHelp}</p>}
              {err && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{err}</p>}
              <Button size="lg" className="h-14 w-full" disabled={!file || reading || code.replace(/[^A-Z0-9]/gi, '').length < 6 || blocking || !acct} loading={busy} onClick={submit}>
                <ShieldCheck className="h-5 w-5" />{C.submit}</Button>
              <p className="text-center text-xs text-muted">{C.honesty}</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
