// Cartão para abrir o ecrã do motorista quando o utilizador quiser (viagem própria em curso), sem o prender lá.
import { Play } from 'lucide-react';
import { t } from '@/i18n/pt-MZ';
import { Button } from '@/components/ui';
import { openOwnDriverApp } from './ownDriver';

export function OpenDriverCard({ tripId }: { tripId: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary-soft p-4">
      <p className="text-sm text-navy">{t.ownGps.inProgress}</p>
      <Button onClick={() => openOwnDriverApp(tripId)}><Play className="h-4 w-4" />{t.ownGps.openDriver}</Button>
    </div>
  );
}
