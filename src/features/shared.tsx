import { Badge, Dot, type Tone } from '@/components/ui';
import { t } from '@/i18n/pt-MZ';
import { formatAgo, formatTime, freshnessOf, type Freshness } from '@/lib/format';

export const tripTone = (s: string, late?: boolean): Tone =>
  s === 'em_viagem' ? (late ? 'warning' : 'success') : s === 'pausada' ? 'warning' : s === 'concluida' ? 'primary' : s === 'cancelada' ? 'danger' : 'muted';

export function TripStatus({ status, late, noSignal }: { status: string; late?: boolean; noSignal?: boolean }) {
  if (noSignal && status === 'em_viagem') return <Badge tone="danger">{t.freshness.sem_sinal}</Badge>;
  return <Badge tone={tripTone(status, late)}>{late && status === 'em_viagem' ? t.trip.lateBadge : t.trip.statuses[status] ?? status}</Badge>;
}

export const freshTone = (f: Freshness | string): Tone => (f === 'atual' ? 'success' : f === 'desatualizada' ? 'warning' : f === 'sem_sinal' ? 'danger' : 'muted');

export function FreshnessLine({ at, source, now, currentS, staleS }: { at: string | null | undefined; source?: string | null; now?: number; currentS?: number; staleS?: number }) {
  const f = freshnessOf(at, now, currentS, staleS);
  if (f === 'sem_dados') return <span className="flex items-center gap-2 text-sm text-muted"><Dot tone="muted" />{t.vehicle.noPosition}</span>;
  const src = source ? t.vehicle.sources[source] ?? source : '';
  return (
    <span className={`flex items-center gap-2 text-sm ${f === 'sem_sinal' ? 'text-danger' : f === 'desatualizada' ? 'text-warning' : 'text-navy'}`}>
      <Dot tone={freshTone(f)} />
      {f === 'sem_sinal' ? t.freshness.last(formatAgo(at, now)) : `${src ? src + ' · ' : ''}${t.freshness.updated(formatAgo(at, now))}`}
    </span>
  );
}

/** ETA: só mostra hora quando calculável; senão diz explicitamente. */
export function Eta({ eta, confidence }: { eta: string | null | undefined; confidence: string | null | undefined }) {
  if (!eta || !confidence || confidence === 'indisponivel') return <span className="text-muted">{t.trip.etaUnavailable}</span>;
  return <span>~{formatTime(eta)}{confidence === 'baixa' && <span className="ml-1 text-xs text-warning">({t.trip.etaApprox.toLowerCase()})</span>}</span>;
}

export const vehicleTone = (main: string, fresh: string): 'primary' | 'success' | 'muted' | 'danger' =>
  main === 'em_viagem' ? (fresh === 'sem_sinal' ? 'danger' : 'primary') : fresh === 'atual' || fresh === 'desatualizada' ? 'success' : 'muted';
