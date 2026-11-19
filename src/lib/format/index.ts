// Formatos de Moçambique: MZN, Africa/Maputo, E.164, distâncias e tempos relativos.
export const TZ = 'Africa/Maputo';

/** 1250 → "1 250,00 MT" (espaço fino de milhares; vírgula decimal). */
export function formatMoney(amount: number | string | null | undefined, currency = 'MZN'): string {
  if (amount == null || amount === '') return '—';
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sym = currency === 'MZN' ? 'MT' : currency;
  return `${n < 0 ? '-' : ''}${grouped},${dec} ${sym}`;
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const [int, dec] = Math.abs(n).toFixed(decimals).split('.');
  return `${n < 0 ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${dec ? ',' + dec : ''}`;
}

export function formatKm(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '—';
  return `${formatNumber(km, km < 10 ? 1 : 0)} km`;
}

const timeFmt = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
const dtFmt = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });

const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));
export const formatTime = (d: Date | string | number | null | undefined) => (d == null ? '—' : timeFmt.format(toDate(d)));
export const formatDate = (d: Date | string | number | null | undefined) => (d == null ? '—' : dateFmt.format(toDate(d)));
export const formatDateTime = (d: Date | string | number | null | undefined) => (d == null ? '—' : dtFmt.format(toDate(d)).replace(',', ''));

/** "há 40 s", "há 3 min", "há 2 h", "há 3 dias". `now` vem do servidor quando possível (lacuna L3/L8). */
export function formatAgo(d: Date | string | number | null | undefined, now: number = Date.now()): string {
  if (d == null) return '—';
  const s = Math.max(0, Math.round((now - toDate(d).getTime()) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** Normaliza telefone para E.164. Números moçambicanos de 9 dígitos (8x...) recebem +258. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  const d = digits.replace(/^\+/, '');
  if (/^8[2-7]\d{7}$/.test(d)) return '+258' + d;
  if (/^258\d{9}$/.test(d)) return '+' + d;
  if (/^00[1-9]\d{7,14}$/.test(d)) return '+' + d.slice(2);
  return null;
}

export type Freshness = 'atual' | 'desatualizada' | 'sem_sinal' | 'sem_dados';
export function freshnessOf(d: Date | string | number | null | undefined, now: number = Date.now(), currentS = 120, staleS = 900): Freshness {
  if (d == null) return 'sem_dados';
  const age = (now - toDate(d).getTime()) / 1000;
  return age <= currentS ? 'atual' : age <= staleS ? 'desatualizada' : 'sem_sinal';
}

/** Código FT tolerante: minúsculas, sem hífen, espaços. Devolve "FT-XXXX-XXXX" ou null. */
export function normalizeTripCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^FT/, '');
  if (!/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(s)) return null;
  return `FT-${s.slice(0, 4)}-${s.slice(4)}`;
}
