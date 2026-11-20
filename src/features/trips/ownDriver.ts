// Abre a app do motorista NESTE telemóvel, para a viagem cujo motorista é o próprio utilizador (GPS deste telemóvel).
import { api } from '@/lib/api/client';

export async function openOwnDriverApp(tripId: string) {
  const r = await api<{ driverToken: string }>(`/api/trips/${tripId}/my-driver-session`, { method: 'POST' });
  try { localStorage.setItem('if_driver_token', r.driverToken); localStorage.removeItem('if_driver_me'); sessionStorage.setItem('if_auto_driver', tripId); } catch { /* sem armazenamento */ }
  location.href = '/driver/';
}

/** É um telemóvel (o aparelho que pode fazer de "camião")? No computador o dono acompanha; nunca abre o ecrã do motorista. */
export const isPhone = () => window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768;

/** O utilizador tocou em "Voltar ao painel" nesta sessão: não o mandar de volta para o ecrã do motorista. */
export const stayOnPanel = () => { try { return sessionStorage.getItem('if_painel') === '1'; } catch { return false; } };

/** Abre sozinho o ecrã do motorista UMA vez por sessão (por viagem). Voltar ao painel (seta do telemóvel ou botão) fica no painel;
 *  fechar a app e abrir de novo (sessão nova) volta a abrir sozinho com o GPS. Devolve false se já abriu nesta sessão. */
export function autoOpenOnce(tripId: string): boolean {
  if (stayOnPanel()) return false;
  try { if (sessionStorage.getItem('if_auto_driver') === tripId) return false; sessionStorage.setItem('if_auto_driver', tripId); } catch { /* sem armazenamento */ }
  void openOwnDriverApp(tripId).catch(() => {});
  return true;
}
