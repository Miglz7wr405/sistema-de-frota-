// Componentes base (estilo shadcn/ui, escritos à mão: o registo do shadcn não está acessível neste ambiente).
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Inbox, Loader2, WifiOff, X, Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/pt-MZ';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md' | 'lg'; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'primary', size = 'md', loading, className, children, disabled, ...p }, ref) => (
  <button ref={ref} disabled={disabled || loading} className={cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
    size === 'sm' && 'px-3 py-1.5 text-sm', size === 'md' && 'px-4 py-2 text-sm', size === 'lg' && 'px-5 py-3 text-base',
    variant === 'primary' && 'bg-primary text-white hover:bg-[#125BCB]',
    variant === 'secondary' && 'bg-white border border-border text-navy hover:bg-slate-50',
    variant === 'ghost' && 'text-primary hover:bg-primary-soft',
    variant === 'danger' && 'bg-white border border-danger/30 text-danger hover:bg-danger-soft',
    variant === 'success' && 'bg-success text-white hover:bg-[#12895A]', className)} {...p}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
  </button>
));

export const Card = ({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) => (
  <section className={cn('card p-4 sm:p-5', className)}>
    {(title || action) && <div className="mb-3 flex items-center justify-between gap-2">{title && <h2 className="text-base font-semibold">{title}</h2>}{action}</div>}
    {children}
  </section>
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn('input', className)} {...p} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn('input min-h-[80px]', className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => <select ref={ref} className={cn('input', className)} {...p}>{children}</select>);

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger" role="alert">{error}</span>}
    </label>
  );
}

export type Tone = 'success' | 'warning' | 'danger' | 'primary' | 'muted' | 'navy';
export const Badge = ({ tone = 'muted', children, className }: { tone?: Tone; children: ReactNode; className?: string }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
    tone === 'success' && 'bg-success-soft text-success-text', tone === 'warning' && 'bg-warning-soft text-warning',
    tone === 'danger' && 'bg-danger-soft text-danger', tone === 'primary' && 'bg-primary-soft text-primary',
    tone === 'muted' && 'bg-slate-100 text-muted', tone === 'navy' && 'bg-navy text-white', className)}>{children}</span>
);

export const Dot = ({ tone }: { tone: Tone }) => (
  <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', tone === 'success' && 'bg-success', tone === 'warning' && 'bg-warning',
    tone === 'danger' && 'bg-danger', tone === 'primary' && 'bg-primary', (tone === 'muted' || tone === 'navy') && 'bg-slate-400')} />
);

export const Spinner = ({ label = t.common.loading }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-muted" role="status"><Loader2 className="h-5 w-5 animate-spin" />{label}</div>
);

export function StateView({ kind, title, detail, action }: { kind: 'empty' | 'error' | 'offline' | 'stale'; title?: string; detail?: string; action?: ReactNode }) {
  const Icon = kind === 'empty' ? Inbox : kind === 'offline' ? WifiOff : kind === 'stale' ? Clock : AlertTriangle;
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Icon className={cn('h-8 w-8', kind === 'error' ? 'text-danger' : kind === 'stale' ? 'text-warning' : 'text-muted')} aria-hidden />
      <p className="font-medium">{title ?? (kind === 'empty' ? t.states.empty : kind === 'offline' ? t.states.offline : kind === 'stale' ? t.states.stale : t.states.error)}</p>
      {detail && <p className="max-w-md text-sm text-muted">{detail}</p>}
      {action}
    </div>
  );
}

/** Envolve uma consulta e mostra os estados a carregar / erro / sem ligação / vazio. */
export function QueryState<T>({ q, empty, children }: { q: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; empty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.isError && q.data === undefined) {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return <StateView kind={offline ? 'offline' : 'error'} detail={offline ? t.states.offlineDetail : t.states.errorDetail}
      action={<Button variant="secondary" size="sm" onClick={() => q.refetch()}>{t.common.retry}</Button>} />;
  }
  if (q.data === undefined) return null;
  if (empty?.(q.data)) return <StateView kind="empty" />;
  return <>{q.isError && <OfflineBanner />}{children(q.data)}</>;
}

export const OfflineBanner = () => (
  <div className="mb-3 flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning" role="status"><WifiOff className="h-4 w-4" />{t.states.offlineDetail}</div>
);

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t.common.close} className="rounded-lg p-1 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        {children}
      </div>
    </div>
  );
}

export const Stat = ({ label, value, sub, subTone, children }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: 'success' | 'muted' | 'warning' | 'danger'; children?: ReactNode }) => (
  <div className="card p-4">
    <p className="text-sm text-muted">{label}</p>
    <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    {children}
    {sub && <p className={cn('mt-1 text-sm', subTone === 'success' ? 'text-success-text' : subTone === 'warning' ? 'text-warning' : subTone === 'danger' ? 'text-danger' : 'text-muted')}>{sub}</p>}
  </div>
);

export const ProgressBar = ({ pct }: { pct: number | null | undefined }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
  </div>
);

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>{back}<h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-muted">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
