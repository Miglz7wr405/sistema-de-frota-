// Ligação para uma viagem. No telemóvel, se a viagem está em curso e o motorista é o próprio utilizador, tocar leva DIRETO ao
// ecrã do motorista (GPS liga-se sozinho, km feitos/restantes, velocidade). A seta "voltar" regressa à lista.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '@/app/session';
import { isPhone, openOwnDriverApp } from './ownDriver';

export function TripLink({ id, status, driverUserId, className, children }: { id: string; status: string; driverUserId?: string | null; className?: string; children: ReactNode }) {
  const me = useMe().data?.user?.id;
  const own = !!driverUserId && driverUserId === me && (status === 'em_viagem' || status === 'pausada');
  return (
    <Link className={className} to={`/app/trips/${id}`} onClick={(e) => { if (own && isPhone()) { e.preventDefault(); void openOwnDriverApp(id); } }}>{children}</Link>
  );
}
