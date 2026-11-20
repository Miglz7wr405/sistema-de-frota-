// "Testar com o meu telemóvel": tudo real. A partida é a posição GPS real do telemóvel; a rota vem do motor de rotas;
// as posições seguintes são as do GPS real enviadas pela app do motorista (mesma porta de ingestão).
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapPin, Smartphone } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';

type Fix = { lat: number; lng: number; accuracy: number };
type Near = { id: string; name: string; kind: string; province: string | null };

export default function SelfTest() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [dest, setDest] = useState('');
  const [phone, setPhone] = useState('+258');
  const [err, setErr] = useState<string | null>(null);

  const locate = () => {
    setLocErr(null);
    if (!('geolocation' in navigator)) { setLocErr(t.selftest.unsupported); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); },
      (e) => { setLocating(false); setLocErr(e.code === e.PERMISSION_DENIED ? t.selftest.denied : errorMessage(e)); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
  };

  const near = useQuery({ queryKey: ['places-near', fix?.lat.toFixed(3), fix?.lng.toFixed(3)], enabled: !!fix,
    queryFn: () => api<Near[]>(`/api/places/near?lat=${fix!.lat}&lng=${fix!.lng}`) });

  const start = useMutation({
    mutationFn: () => api<{ tripId: string; code: string; driverToken: string }>('/api/selftest/start',
      { body: { lat: fix!.lat, lng: fix!.lng, accuracy: fix!.accuracy, destinationPlaceId: dest, phone: phone.replace(/\s/g, '') } }),
    onSuccess: (r) => {
      try { localStorage.setItem('if_driver_token', r.driverToken); localStorage.removeItem('if_driver_me'); } catch { /* sem armazenamento */ }
      location.href = '/driver/';
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  const poor = fix != null && fix.accuracy > 500;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t.selftest.title} subtitle={t.selftest.intro} />
      <div className="space-y-4">
        <Card title={t.selftest.step1}>
          <Button onClick={locate} loading={locating} variant={fix ? 'secondary' : 'primary'}><MapPin className="h-4 w-4" />{locating ? t.selftest.locating : t.selftest.locate}</Button>
          {fix && <p className={`mt-3 text-sm ${poor ? 'text-warning' : 'text-success-text'}`}>{poor ? t.selftest.poorAccuracy : t.selftest.located(fix.accuracy)}</p>}
          {fix && <p className="mt-1 font-mono text-xs text-muted">{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</p>}
          {locErr && <p role="alert" className="mt-3 text-sm text-danger">{locErr}</p>}
        </Card>
        {fix && !poor && <Card title={t.selftest.step2}>
          {near.isLoading ? <p className="text-sm text-muted">{t.common.loading}</p> : near.data?.length ? (
            <Select aria-label={t.selftest.step2} value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">—</option>
              {near.data.map((p) => <option key={p.id} value={p.id}>{p.name}{p.province ? ` (${p.province})` : ''}</option>)}
            </Select>) : <p className="text-sm text-warning">{near.isError ? errorMessage(near.error) : t.selftest.noPlaces}</p>}
        </Card>}
        {fix && !poor && dest && <Card title={t.selftest.step3}>
          <Field label={t.driver.phone}><Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Button className="mt-4 w-full" size="lg" disabled={!/^\+[1-9]\d{7,14}$/.test(phone.replace(/\s/g, ''))} loading={start.isPending} onClick={() => { setErr(null); start.mutate(); }}>
            <Smartphone className="h-5 w-5" />{start.isPending ? t.selftest.starting : t.selftest.start}</Button>
          <p className="mt-3 text-sm text-muted">{t.selftest.after}</p>
          {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
        </Card>}
      </div>
    </div>
  );
}
