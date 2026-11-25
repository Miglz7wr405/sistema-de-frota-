// "Ativar rastreio GPS" — checkout de uma viagem (ADR-028/030): resumo → pagar por M-Pesa / e-Mola → fotografia do comprovativo
// (lida no telemóvel) → o servidor analisa (IA + valor, número, hora, código, imagem repetida) → aprovado / em análise / rejeitado com o motivo.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { AlertCircle, Camera, Check, Copy, Loader2, Satellite, ShieldCheck, X } from 'lucide-react';
import { api, ApiError, errorMessage, fileToUpload } from '@/lib/api/client';
import { parseReceipt, receiptTooOld, mzPhone, type ReceiptFields } from '@/lib/billing/receipt';
import { dHash } from '@/lib/billing/imageHash';
import { t } from '@/i18n/pt-MZ';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui';

type Billing = { price: number; currency: string; freeTrips: number; freeLeft: number; blocked: boolean;
  mpesa: { number: string; name: string | null } | null; emola: { number: string; name: string | null } | null;
  payment: { id: string; status: 'pendente' | 'aprovado' | 'rejeitado' | 'anulado'; transaction_id: string; reason: string | null; auto: boolean } | null };
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
  const [hash, setHash] = useState<string | null>(null);
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
    void dHash(f).then(setHash);
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
      await api(`/api/trips/${tripId}/payments`, { body: { method, transaction_id: code, receipt_file_id: up.id, payer_phone: payer || null, image_hash: hash,
        ocr: fields ? { text: ocrText?.slice(0, 4000), amount: fields.amount, recipient, date: fields.date } : undefined } });
      await q.refetch();
    } catch (e) { setErr(e instanceof ApiError ? errorMessage(e) : t.errors.network); } finally { setBusy(false); }
  };

  const copy = async (n: string) => { try { await navigator.clipboard.writeText(n); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } };
  const st = b?.payment?.status;

  // fechar com Esc; sem scroll da página por trás
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  const step = st === 'aprovado' || st === 'pendente' ? 3 : file ? 2 : 1;
  const canSubmit = !!file && !reading && code.replace(/[^A-Z0-9]/gi, '').length >= 6 && !blocking && !!acct;
  const showForm = b && !b.blocked && st !== 'aprovado' && st !== 'pendente' && st !== 'anulado';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={C.title}>
      <div className="ck-fade absolute inset-0 bg-navy/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="ck-sheet relative flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_24px_80px_rgba(16,36,61,0.35)] sm:max-w-[480px] sm:rounded-[28px]">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true" />
        {/* cabeçalho */}
        <header className="flex items-start gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-6">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary"><Satellite className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight text-navy">{C.title}</h2>
            <p className="truncate text-sm text-muted">{trip?.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : C.trip}{trip?.code ? ` · ${trip.code}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.common.close}
            className="group grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition-all duration-200 hover:rotate-90 hover:bg-slate-200 hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <X className="h-[18px] w-[18px]" strokeWidth={1.75} /></button>
        </header>
        {/* passos */}
        <ol className="flex items-center gap-2 px-5 pb-4 sm:px-6" aria-label={C.stepsLabel}>
          {C.steps.map((label, i) => {
            const n = i + 1; const done = n < step || st === 'aprovado'; const cur = n === step && st !== 'aprovado';
            return (
              <li key={label} className="flex flex-1 flex-col gap-1.5">
                <span className={`h-1 rounded-full transition-colors duration-300 ${done || cur ? 'bg-primary' : 'bg-slate-200'}`} />
                <span className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${cur ? 'text-primary' : done ? 'text-navy' : 'text-slate-400'}`}>
                  {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <span>{n}</span>}{label}</span>
              </li>);
          })}
        </ol>

        <div className="flex-1 overflow-y-auto px-5 pb-4 sm:px-6" data-testid="checkout">
          {!b ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
            <div className="space-y-5">
              {/* resumo premium */}
              <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B30] via-navy to-[#173A63] p-5 text-white">
                <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden="true">
                  <defs><pattern id="ck-road" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
                    <path d="M0 28h56" stroke="#fff" strokeWidth="1.5" strokeDasharray="10 8" /></pattern></defs>
                  <rect width="100%" height="100%" fill="url(#ck-road)" /></svg>
                <div className="relative">
                  <div className="flex items-center gap-2 text-sm text-white/80">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success" /><span className="truncate">{trip?.origin ?? C.trip}</span>
                    <span className="h-px min-w-6 flex-1 border-t border-dashed border-white/40" />
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#FF6B6B]" /><span className="truncate">{trip?.destination ?? ''}</span>
                  </div>
                  <p className="mt-4 flex items-baseline gap-1.5"><span className="text-5xl font-bold tracking-tight">{new Intl.NumberFormat('pt-MZ').format(b.price)}</span>
                    <span className="text-lg font-semibold text-white/70">MT</span></p>
                  <p className="text-sm text-white/60">{b.freeTrips > 0 ? C.freeUsed(b.freeTrips) : C.perTrip}</p>
                  <ul className="mt-4 grid grid-cols-1 gap-1.5 text-sm text-white/90 min-[400px]:grid-cols-2">
                    {C.includes.map((x) => <li key={x} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#7FE3B4]" strokeWidth={2.5} />{x}</li>)}
                  </ul>
                </div>
              </section>

              {b.blocked ? <p role="alert" className="flex gap-2 rounded-2xl bg-danger-soft p-4 text-sm text-danger"><AlertCircle className="h-5 w-5 shrink-0" />{C.blocked}</p>
              : st === 'aprovado' ? (
                <div className="py-6 text-center" data-testid="checkout-aprovado">
                  <span className="ck-pop mx-auto grid h-16 w-16 place-items-center rounded-full bg-success text-white shadow-[0_8px_24px_rgba(22,163,106,0.35)]"><Check className="h-9 w-9" strokeWidth={2.5} /></span>
                  <p className="mt-4 text-xl font-bold text-navy">{C.approved}</p>
                  <p className="text-sm text-muted">{C.starting}</p>
                </div>
              ) : st === 'pendente' ? (
                <div className="py-6 text-center" data-testid="checkout-pendente">
                  <span className="relative mx-auto grid h-20 w-20 place-items-center">
                    <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-primary/15 border-t-primary" style={{ animationDuration: '1.4s' }} />
                    <Satellite className="h-8 w-8 text-primary" /></span>
                  <p className="mt-4 text-xl font-bold text-navy">{C.pending}</p>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{C.pendingHelp(b.payment!.transaction_id)}</p>
                </div>
              ) : (
                <>
                  {st === 'rejeitado' && <p role="alert" className="flex gap-2 rounded-2xl bg-danger-soft p-4 text-sm text-danger"><AlertCircle className="h-5 w-5 shrink-0" />{C.rejected(b.payment!.reason ?? '')}</p>}
                  {/* 1. pagar */}
                  <section>
                    <h3 className="mb-2.5 text-sm font-semibold text-navy">{C.step1}</h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(['mpesa', 'emola'] as const).filter((m) => (m === 'mpesa' ? b.mpesa : b.emola)).map((m) => {
                        const on = method === m; const color = m === 'mpesa' ? '#E4002B' : '#F37021';
                        return (
                          <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={on}
                            className={`relative rounded-2xl border-2 px-4 py-3.5 text-left transition-all duration-200 ${on ? 'shadow-sm' : 'border-border hover:border-slate-300'}`}
                            style={on ? { borderColor: color, background: `${color}0D` } : undefined}>
                            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                              <span className="text-base font-bold text-navy">{m === 'mpesa' ? 'M-Pesa' : 'e-Mola'}</span></span>
                            <span className="mt-0.5 block pl-[18px] text-xs text-muted">{m === 'mpesa' ? 'Vodacom' : 'Movitel'}</span>
                            {on && <span className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full text-white" style={{ background: color }}><Check className="h-3 w-3" strokeWidth={3} /></span>}
                          </button>);
                      })}
                    </div>
                    {acct ? (
                      <div className="mt-3 rounded-2xl border border-border bg-background/60 p-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted">{C.sendTo(formatMoney(b.price, b.currency))}</p>
                        <div className="mt-1 flex items-center justify-between gap-3">
                          <p className="font-mono text-[26px] font-bold tracking-[0.08em] text-navy">{fmtPhone(acct.number)}</p>
                          <button type="button" onClick={() => copy(acct.number)}
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${copied ? 'bg-success-soft text-success-text' : 'bg-white text-primary ring-1 ring-border hover:ring-primary/40'}`}>
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? C.copied : C.copy}</button>
                        </div>
                        {acct.name && <p className="text-sm text-muted">{acct.name}</p>}
                        <ol className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted">
                          {(method === 'mpesa' ? C.howMpesa : C.howEmola).map((x, i) => <li key={x} className="flex gap-2"><span className="font-semibold text-navy">{i + 1}.</span>{x}</li>)}
                        </ol>
                      </div>
                    ) : <p className="mt-3 rounded-2xl bg-warning-soft p-4 text-sm text-warning">{C.noNumbers}</p>}
                  </section>

                  {/* 2. comprovativo */}
                  <section>
                    <h3 className="mb-2.5 text-sm font-semibold text-navy">{C.step2}</h3>
                    {!preview ? (
                      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary-soft/40">
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary"><Camera className="h-6 w-6" /></span>
                        <span className="font-semibold text-navy">{C.takePhoto}</span>
                        <span className="text-xs text-muted">{C.photoHint}</span>
                        <input type="file" accept="image/*" className="sr-only" data-testid="checkout-foto" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
                      </label>
                    ) : (
                      <div className="flex gap-3 rounded-2xl border border-border p-3">
                        <img src={preview} alt="" className="h-28 w-20 shrink-0 rounded-xl object-cover ring-1 ring-border" />
                        <div className="min-w-0 flex-1">
                          {reading ? <p className="flex items-center gap-2 pt-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{C.reading}</p>
                          : ocrFailed ? <p className="pt-1 text-sm text-muted">{C.ocrFailed}</p>
                          : <div className="flex flex-wrap gap-1.5">{checks.map((c) => (
                              <span key={c.label} className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${c.ok ? 'bg-success-soft text-success-text' : 'bg-warning-soft text-warning'}`}>
                                {c.ok ? <Check className="h-3 w-3 shrink-0" strokeWidth={3} /> : <AlertCircle className="h-3 w-3 shrink-0" />}<span className="truncate">{c.label}</span></span>))}</div>}
                          <label className="mt-2 inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-primary">
                            <Camera className="h-4 w-4" />{C.changePhoto}
                            <input type="file" accept="image/*" className="sr-only" data-testid="checkout-foto" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
                          </label>
                        </div>
                      </div>
                    )}
                    {file && !reading && <div className="mt-3 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                      <label className="block"><span className="label">{C.codeLabel}</span>
                        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DK45H7GT2P" data-testid="checkout-codigo"
                          className="input h-11 rounded-xl font-mono uppercase tracking-wider" autoCapitalize="characters" /></label>
                      <label className="block"><span className="label">{C.payerLabel}</span>
                        <input value={payer} onChange={(e) => setPayer(e.target.value)} type="tel" inputMode="tel" placeholder="84 123 4567" className="input h-11 rounded-xl" data-testid="checkout-pagador" /></label>
                      <p className="text-xs text-muted min-[400px]:col-span-2">{C.codeHelp}</p>
                    </div>}
                  </section>
                  {blocking && <p role="alert" className="flex gap-2 rounded-2xl bg-warning-soft p-4 text-sm text-warning"><AlertCircle className="h-5 w-5 shrink-0" />{C.blockingHelp}</p>}
                  {err && <p role="alert" className="flex gap-2 rounded-2xl bg-danger-soft p-4 text-sm text-danger"><AlertCircle className="h-5 w-5 shrink-0" />{err}</p>}
                </>
              )}
            </div>
          )}
        </div>

        {/* rodapé fixo */}
        {showForm && <footer className="border-t border-border bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-6">
          <Button size="lg" className="h-14 w-full rounded-2xl text-base shadow-[0_8px_20px_rgba(23,105,232,0.28)]" disabled={!canSubmit} loading={busy} onClick={submit}>
            <ShieldCheck className="h-5 w-5" />{C.submit(formatMoney(b!.price, b!.currency))}</Button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted" data-testid={busy ? 'checkout-a-analisar' : undefined}>
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}{busy ? C.analysing : C.honesty}</p>
        </footer>}
      </div>
    </div>,
    document.body,
  );
}
