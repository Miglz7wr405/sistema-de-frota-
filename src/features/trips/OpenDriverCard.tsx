// Cartão para abrir o ecrã do motorista quando o utilizador quiser (viagem própria em curso), sem o prender lá.
// Fotografia de um camião na estrada ao fundo (a deslizar devagar) e camiões a andar numa estrada desenhada.
// Os camiões andam SEMPRE (pedido do proprietário), mesmo com "reduzir movimento" no telemóvel.
import { ChevronRight } from 'lucide-react';
import { t } from '@/i18n/pt-MZ';
import { TruckIcon } from '@/components/ui/icons';
import { useNavigate } from 'react-router-dom';
import { isPhone, openOwnDriverApp } from './ownDriver';

export function OpenDriverCard({ tripId, origin, destination }: { tripId: string; origin?: string | null; destination?: string | null }) {
  const nav = useNavigate();
  // telemóvel: ecrã do motorista (GPS a enviar); computador: página da viagem (mapa com o GPS)
  const open = () => (isPhone() ? openOwnDriverApp(tripId) : nav(`/app/trips/${tripId}`));
  return (
    <button type="button" onClick={open}
      aria-label={t.ownGps.openDriver} className="hero-trip group relative block h-40 w-full overflow-hidden rounded-2xl bg-navy text-left shadow-sm">
      <div className="hero-trip-photo absolute inset-0 bg-cover" style={{ backgroundImage: 'url(/img/camiao-fundo.webp)' }} aria-hidden="true" />
      <div className="absolute inset-0 bg-gradient-to-r from-navy/95 via-navy/70 to-navy/10" aria-hidden="true" />
      {/* estrada com camiões a andar */}
      <div className="absolute inset-x-0 bottom-3 h-6" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-white/35" />
        <TruckIcon className="hero-truck absolute top-0 h-6 w-8 text-white" />
        <TruckIcon className="hero-truck hero-truck-2 absolute top-0 h-6 w-8 text-white/70" />
      </div>
      <div className="relative flex h-full flex-col justify-between p-4 pb-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success px-2.5 py-0.5 text-xs font-semibold text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />{t.ownGps.liveBadge}</span>
        <div className="flex items-end justify-between gap-3">
          <span className="min-w-0"><span className="block text-lg font-bold leading-tight text-white">{origin && destination ? t.ownGps.heroTrip(origin, destination) : t.ownGps.heroTitle}</span><span className="block text-sm text-white/80">{t.ownGps.heroSub}</span></span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-primary shadow-sm transition-transform group-active:scale-95">
            {t.ownGps.openDriverShort}<ChevronRight className="h-4 w-4" /></span>
        </div>
      </div>
    </button>
  );
}
