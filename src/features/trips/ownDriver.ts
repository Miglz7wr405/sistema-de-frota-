// Abre a app do motorista NESTE telemóvel, para a viagem cujo motorista é o próprio utilizador (GPS deste telemóvel).
import { api } from '@/lib/api/client';

export async function openOwnDriverApp(tripId: string) {
  const r = await api<{ driverToken: string }>(`/api/trips/${tripId}/my-driver-session`, { method: 'POST' });
  try { localStorage.setItem('if_driver_token', r.driverToken); localStorage.removeItem('if_driver_me'); } catch { /* sem armazenamento */ }
  location.href = '/driver/';
}
