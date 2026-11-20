// Abre a app do motorista NESTE telemóvel, para a viagem cujo motorista é o próprio utilizador (GPS deste telemóvel).
import { api } from '@/lib/api/client';

export async function openOwnDriverApp(tripId: string) {
  const r = await api<{ driverToken: string }>(`/api/trips/${tripId}/my-driver-session`, { method: 'POST' });
  try { localStorage.setItem('if_driver_token', r.driverToken); localStorage.removeItem('if_driver_me'); } catch { /* sem armazenamento */ }
  location.href = '/driver/';
}

/** É um telemóvel (o aparelho que pode fazer de "camião")? No computador o dono acompanha; nunca abre o ecrã do motorista. */
export const isPhone = () => window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768;

/** O utilizador tocou em "Voltar ao painel" nesta sessão: não o mandar de volta para o ecrã do motorista. */
export const stayOnPanel = () => { try { return sessionStorage.getItem('if_painel') === '1'; } catch { return false; } };
