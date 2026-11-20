// "Testar com o meu telemóvel": um toque. Lê a posição GPS real, cria a viagem (destino automático, rota real) já em
// viagem e abre a app do motorista com o GPS a enviar. O navegador só pede a permissão de localização na 1.ª vez.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Smartphone } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card } from '@/components/ui';

type Fix = { lat: number; lng: number; accuracy: number };
type Near = { id: string; name: string; kind: string; province: string | null };

const getFix = () => new Promise<Fix>((resolve, reject) => {
  if (!('geolocation' in navigator)) { reject(new Error(t.selftest.unsupported)); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
    (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? t.selftest.denied : t.selftest.poorAccuracy)),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
});

export default function SelfTest() {
  const [sp] = useSearchParams();
  const choosing = sp.get('escolher') === '1';
  const [phase, setPhase] = useState<'idle' | 'locating' | 'starting'>('idle');
  const [fix, setFix] = useState<Fix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const auto = useRef(false);

  const start = useCallback(async (destinationPlaceId?: string) => {
    setErr(null);
    try {
      setPhase('locating');
      const f = fix && destinationPlaceId ? fix : await getFix();
      setFix(f);
      if (f.accuracy > 500) throw new Error(t.selftest.poorAccuracy);
      setPhase('starting');
      const r = await api<{ driverToken: string; tripId: string }>('/api/selftest/start', { body: { lat: f.lat, lng: f.lng, accuracy: f.accuracy, ...(destinationPlaceId ? { destinationPlaceId } : {}) } });
      try { localStorage.setItem('if_driver_token', r.driverToken); localStorage.removeItem('if_driver_me'); sessionStorage.setItem('if_auto_driver', r.tripId); } catch { /* sem armazenamento */ }
      // replace: a página de teste não fica no histórico (voltar não arranca outro teste)
      location.replace('/driver/');
    } catch (e) {
      setPhase('idle');
      setErr(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
    }
  }, [fix]);

  // Começa logo ao abrir (o toque no painel já foi o pedido): o navegador só pergunta a localização na 1.ª vez.
  useEffect(() => {
    if (choosing || auto.current) return;
    auto.current = true;
    void start();
  }, [choosing, start]);

  // escolher outro destino (opcional)
  useEffect(() => { if (choosing && !fix) getFix().then(setFix).catch((e: Error) => setErr(e.message)); }, [choosing, fix]);
  const near = useQuery({ queryKey: ['places-near', fix?.lat.toFixed(3), fix?.lng.toFixed(3)], enabled: choosing && !!fix,
    queryFn: () => api<Near[]>(`/api/places/near?lat=${fix!.lat}&lng=${fix!.lng}`) });

  const busy = phase !== 'idle';
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="rounded-2xl bg-primary-soft p-4 text-primary"><Smartphone className="h-8 w-8" /></span>
          <h1 className="text-2xl font-bold">{choosing ? t.selftest.chooseTitle : t.selftest.title}</h1>
          {!choosing && <>
            <p className="text-muted">{t.selftest.intro}</p>
            <Button size="lg" className="h-16 w-full text-lg" loading={busy} onClick={() => start()}>
              <MapPin className="h-6 w-6" />{phase === 'locating' ? t.selftest.locating : phase === 'starting' ? t.selftest.starting : t.selftest.go}</Button>
            <p className="text-xs text-muted">{t.selftest.consent}</p>
          </>}
          {choosing && (near.data?.length ? <ul className="w-full space-y-2 text-left">{near.data.map((p) => (
            <li key={p.id}><button disabled={busy} onClick={() => start(p.id)} className="w-full rounded-xl border border-border px-4 py-3 text-left hover:border-primary disabled:opacity-50">
              <span className="font-semibold">{p.name}</span>{p.province ? <span className="text-muted"> · {p.province}</span> : null}</button></li>))}</ul>
            : !err && <p className="text-muted">{busy ? t.selftest.starting : t.common.loading}</p>)}
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        </div>
      </Card>
    </div>
  );
}
