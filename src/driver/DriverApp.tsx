import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Navigation, Pause, Play, Volume2, VolumeX, Receipt, MapPin } from 'lucide-react';
import { t } from '@/i18n/pt-MZ';
import { formatAgo, formatDuration, formatKm, formatTime } from '@/lib/format';
import { speedTrend } from '@/features/tracking/RouteStrip';
import { fileToUpload } from '@/lib/api/client';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { DriverRoute } from './DriverRoute';
import { TOKEN_KEY, driverApi, getToken, useDriverRuntime, type Me } from './useDriverRuntime';

export function DriverApp() {
  const [token, setToken] = useState(getToken());
  const [me, setMe] = useState<Me | null>(() => { try { return JSON.parse(localStorage.getItem('if_driver_me') ?? 'null'); } catch { return null; } });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const m = await driverApi<Me>('/api/driver/me');
      setMe(m); setLoadErr(null);
      localStorage.setItem('if_driver_me', JSON.stringify(m)); // cópia local: rota e localidades disponíveis sem rede
    } catch (e) {
      const s = (e as { status?: number }).status;
      if (s === 401) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('if_driver_me'); setToken(null); setMe(null); }
      else setLoadErr(t.errors.network);
    }
  }, []);
  useEffect(() => { if (token) { load(); const h = setInterval(load, 60_000); return () => clearInterval(h); } }, [token, load]);

  if (!token) return <Login onToken={(tk) => { localStorage.setItem(TOKEN_KEY, tk); setToken(tk); }} />;
  if (!me) return <Centered>{loadErr ?? t.common.loading}</Centered>;
  if (me.consentRequired) return <Consent onAccept={async () => { await driverApi('/api/driver/consent', 'POST', {}); load(); }} />;
  return <TripScreen me={me} setMe={setMe} reload={load} />;
}

const Centered = ({ children }: { children: React.ReactNode }) => <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted">{children}</div>;

function Login({ onToken }: { onToken: (t: string) => void }) {
  const linkToken = location.hash.slice(1);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(linkToken)) return <Centered>{t.driverApp.invalidLink}</Centered>;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/driver/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: linkToken, pin }) });
      if (r.ok) {
        const j = await r.json();
        // consentimento dado no próprio ecrã do PIN (frase por baixo do botão): sem ecrã extra
        await fetch('/api/driver/consent', { method: 'POST', headers: { authorization: `Bearer ${j.token}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
        history.replaceState(null, '', '/driver/'); onToken(j.token); return;
      }
      setErr(r.status === 429 ? t.driverApp.locked : r.status === 401 ? ((await r.json()).error === 'pin_incorreto' ? t.driverApp.wrongPin : t.driverApp.invalidLink) : t.errors.generic);
    } catch { setErr(t.errors.network); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-navy p-6 text-white">
      <p className="mt-10 text-2xl font-bold">insight<span className="text-[#6EA8FF]">Frota</span></p>
      <div className="mt-10 rounded-2xl bg-white p-6 text-navy">
        <label className="label" htmlFor="pin">{t.driverApp.enterPin}</label>
        <input id="pin" className="input text-center text-3xl tracking-[0.5em]" inputMode="numeric" maxLength={6} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
        <Button size="lg" className="mt-4 w-full" disabled={pin.length < 4} loading={busy} onClick={submit}>{t.driverApp.enter}</Button>
        <p className="mt-3 text-xs text-muted">{t.driverApp.pinConsent}</p>
      </div>
    </div>
  );
}

function Consent({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="card mt-10 p-6"><h1 className="text-xl font-bold">{t.driverApp.consentTitle}</h1><p className="mt-3 text-muted">{t.driverApp.consentText}</p>
        <p className="mt-3 text-sm text-warning">{t.driverApp.honesty}</p>
        <Button size="lg" className="mt-6 w-full" onClick={onAccept}>{t.driverApp.consentAccept}</Button></div>
    </div>
  );
}

function TripScreen({ me, setMe, reload }: { me: Me; setMe: (m: Me) => void; reload: () => void }) {
  const [muted, setMuted] = useState(localStorage.getItem('if_driver_muted') === '1');
  const rt = useDriverRuntime(me, muted);
  const [modal, setModal] = useState<'incident' | 'delivery' | 'expense' | 'voice' | null>(null);
  const trip = me.trip;
  const status = trip?.status;
  const moving = (rt.speed ?? 0) > 10; // em movimento: interface reduzida (segurança rodoviária)
  const scale = rt.route && me.route ? rt.route.lengthM / me.route.lengthM : 1;
  const kmLeft = rt.snap?.kmLeft != null ? rt.snap.kmLeft / scale : null;
  const next = rt.snap?.places.find((p) => p.state === 'proxima' && p.importance >= 3) ?? null;
  const etaOk = rt.snap?.etaDestination && rt.snap.etaConfidence !== 'indisponivel';

  const transition = async (to: 'em_viagem' | 'pausada' | 'concluida') => {
    if (!trip) return;
    await rt.action('POST', `/api/driver/trips/${trip.id}/transition`, { to, at: new Date().toISOString() });
    setMe({ ...me, trip: { ...trip, status: to } }); // otimista: funciona sem rede
    if (to === 'em_viagem' && status !== 'pausada') rt.speak(t.voice.tripStarted);
    setTimeout(reload, 3000);
  };


  const gpsLine = !navigator.onLine || !rt.online ? t.driverApp.offline(rt.queued)
    : rt.gps.status === 'denied' ? t.driverApp.gpsDenied : rt.gps.status === 'ok' && rt.gps.lastFixAt ? t.driverApp.gpsSending(formatAgo(rt.gps.lastFixAt)) : t.driverApp.gpsNoFix;
  const gpsOk = rt.gps.status === 'ok' && rt.online;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="bg-navy px-5 pb-4 pt-5 text-white">
        {/* o dono (teste com o telemóvel) volta ao painel; motoristas reais só têm esta app */}
        {rt.testMode && <a href="/app/dashboard" className="mb-2 inline-block text-sm font-semibold text-[#6EA8FF]">← {t.driverApp.backToPanel}</a>}
        <p className="text-sm text-slate-300">{t.driverApp.hello(me.driver.fullName)}</p>
        <div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-bold text-white">{trip ? `${trip.origin} → ${trip.destination}` : '—'}</h1>
          {trip && <span className="rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success-text">{t.trip.statuses[trip.status]}</span>}</div>
        {(status === 'em_viagem' || status === 'pausada') && <div className="mt-3 flex items-center justify-between rounded-xl bg-white/10 px-3 py-2 text-sm">
          <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${gpsOk ? 'bg-success' : rt.gps.status === 'denied' ? 'bg-danger' : 'bg-warning'}`} />{gpsLine}</span><span className="text-slate-300">{t.driverApp.queue(rt.queued)}</span></div>}
      </header>

      {!trip ? <Centered>{t.driverApp.noTrip}</Centered> : (
        <main className="flex flex-1 flex-col gap-3 p-4">
          {status === 'em_viagem' || status === 'pausada' ? <>
            {(rt.gps.status !== 'ok' || !rt.gps.lastFixAt || Date.now() - rt.gps.lastFixAt > 30_000) && rt.gps.status !== 'waiting' && (
              <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4">
                <p className="text-sm text-danger">{rt.gps.status === 'denied' ? t.driverApp.gpsDeniedHelp : t.driverApp.reconnectHint}</p>
                <Button size="lg" className="mt-3 h-14 w-full text-lg" onClick={rt.reconnect}><Navigation className="h-5 w-5" />{t.driverApp.reconnect}</Button>
              </div>)}
            <SpeedCard rt={rt} kmLeft={kmLeft} kmDone={rt.snap?.kmDone != null ? rt.snap.kmDone / scale : null} />
            {(trip.cargo_description || trip.recipient_name) && <div className="card p-4 text-sm">
              {trip.cargo_description && <p><span className="text-muted">{t.trip.cargoLoad}:</span> <b>{trip.cargo_description}</b></p>}
              {(trip.recipient_name || trip.recipient_phone) && <p className="mt-1"><span className="text-muted">{t.trip.cargoOwner}:</span> <b>{trip.recipient_name ?? ''}</b>
                {trip.recipient_phone && <> · <a className="text-primary" href={`tel:${trip.recipient_phone}`}>{trip.recipient_phone}</a></>}</p>}
            </div>}
            <DriverRoute me={me} model={rt.route} kmDone={rt.snap?.kmDone != null ? rt.snap.kmDone / scale : null} pos={rt.pos} road={rt.road} />
            {!moving && <div className="card flex items-center gap-4 p-4"><span className="rounded-xl bg-primary-soft p-3 text-primary"><Navigation className="h-6 w-6" /></span>
              <div><p className="text-sm text-muted">{t.driverApp.nextPoint}</p><p className="text-xl font-bold">{next ? `${next.name} · ${formatKm((next.kmFromOrigin - (rt.snap?.kmDone ?? 0)) / scale)}` : rt.snap ? t.label(rt.snap.label) : t.common.noData}</p></div></div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-4"><p className="text-sm text-muted">{t.driverApp.toDestination}</p><p className="text-3xl font-bold">{kmLeft != null ? formatKm(kmLeft) : me.route ? formatKm(me.route.lengthM / 1000) : '—'}</p>
                {kmLeft == null && me.route && <p className="text-xs text-muted">{t.ownGps.fullRoute}</p>}</div>
              <div className="card p-4"><p className="text-sm text-muted">{t.driverApp.eta}</p><p className="text-3xl font-bold">{etaOk ? formatTime(rt.snap!.etaDestination!) : '—'}</p>
                {!etaOk && <p className="text-xs text-muted">{t.trip.etaUnavailable}</p>}</div>
            </div>
            {!rt.voiceReady && !muted && <p className="text-center text-sm text-muted">{t.driverApp.tapForVoice}</p>}
            {rt.lastSpoken && <div className="rounded-2xl bg-primary-soft p-4"><p className="flex items-center gap-2 text-sm font-semibold text-primary"><Volume2 className="h-4 w-4" />{t.driverApp.assistant}</p><p className="mt-1 text-lg">"{rt.lastSpoken}"</p></div>}
            {moving ? <p className="text-center text-sm text-muted">{t.driverApp.moving}</p> : <>
              <div className="grid grid-cols-2 gap-3">
                {status === 'em_viagem' ? <Button variant="secondary" size="lg" className="h-16" onClick={() => transition('pausada')}><Pause className="h-5 w-5" />{t.driverApp.pause}</Button>
                  : <Button variant="secondary" size="lg" className="h-16" onClick={() => transition('em_viagem')}><Play className="h-5 w-5" />{t.driverApp.resume}</Button>}
                <Button size="lg" className="h-16 border border-warning/40 bg-warning-soft text-warning hover:bg-warning-soft" onClick={() => setModal('incident')}><AlertTriangle className="h-5 w-5" />{t.driverApp.incident}</Button>
                <Button variant="secondary" size="lg" className="h-14" onClick={() => setModal('expense')}><Receipt className="h-5 w-5" />{t.driverApp.expense}</Button>
                <Button variant="secondary" size="lg" className="h-14" onClick={() => { const nv = !muted; setMuted(nv); localStorage.setItem('if_driver_muted', nv ? '1' : '0'); }}>
                  {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}{muted ? t.driverApp.unmute : t.driverApp.mute}</Button>
              </div>
              {me.stops.filter((s) => !s.arrived_at).slice(0, 1).map((s) => (
                <Button key={s.id} variant="secondary" size="lg" onClick={() => rt.action('POST', `/api/driver/trips/${trip.id}/stops/${s.id}/arrive`, {}).then(reload)}><MapPin className="h-5 w-5" />{t.driverApp.arriveStop}: {s.place_name}</Button>))}
              <div className="mt-auto space-y-2 pt-4">
                <Button variant="success" size="lg" className="h-16 w-full text-lg" onClick={() => setModal('delivery')}><CheckCircle2 className="h-6 w-6" />{t.driverApp.deliver}</Button>
                <button className="w-full py-2 text-sm text-muted" onClick={() => setModal('voice')}>{t.driverApp.voiceTest}</button>
              </div>
            </>}
            {rt.testMode && <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => { location.href = '/app/self-test?escolher=1'; }}>{t.selftest.changeDestination}</Button>
              <Button variant="danger" onClick={async () => { await transition('concluida'); location.href = '/app/dashboard'; }}>{t.selftest.endTest}</Button>
            </div>}
            {rt.gps.status === 'denied' && <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger" role="alert">{t.driverApp.gpsDeniedHelp}</p>}
            {!window.isSecureContext && <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">{t.driverApp.gpsNeedsHttps}</p>}
            <p className="text-center text-xs text-muted">{t.driverApp.keepOpen}</p>
          </> : (
            <div className="flex flex-1 flex-col gap-3">
              <div className="card p-5"><p className="text-sm text-muted">{trip.code}{trip.plate ? ` · ${trip.plate}` : ''}</p><p className="mt-1 text-lg font-semibold">{trip.cargo_description ?? ''}</p>
                {trip.recipient_name && <p className="text-sm text-muted">{t.trip.cargoOwner}: {trip.recipient_name}{trip.recipient_phone ? ` · ${trip.recipient_phone}` : ''}</p>}
                {me.route ? <p className="mt-2 text-muted">{t.trip.distance}: {formatKm(me.route.lengthM / 1000)}</p> : <p className="mt-2 text-warning">{t.trip.routeNone}</p>}</div>
              <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">{t.driverApp.honesty}</p>
              <Button size="lg" className="mt-auto h-16 text-lg" onClick={() => transition('em_viagem')}><Play className="h-6 w-6" />{t.driverApp.start}</Button>
              <button className="py-2 text-sm text-muted" onClick={() => setModal('voice')}>{t.driverApp.voiceTest}</button>
            </div>
          )}
        </main>
      )}
      {trip && <>
        <IncidentModal open={modal === 'incident'} onClose={() => setModal(null)} onSubmit={async (b) => { await rt.action('POST', `/api/driver/trips/${trip.id}/incidents`, b); setModal(null); }} />
        <ExpenseModal open={modal === 'expense'} onClose={() => setModal(null)} onSubmit={async (b) => { await rt.action('POST', `/api/driver/trips/${trip.id}/expenses`, b); setModal(null); }} />
        <DeliveryModal open={modal === 'delivery'} onClose={() => setModal(null)} onSubmit={async (b) => {
          await rt.action('POST', `/api/driver/trips/${trip.id}/delivery`, b);
          await transition('concluida');
          setModal(null);
        }} />
      </>}
      <VoiceTest open={modal === 'voice'} onClose={() => setModal(null)} speak={rt.speak} />
    </div>
  );
}


async function uploadFile(file: Blob, kind: string): Promise<string | null> {
  // Ficheiros precisam de rede (não ficam na fila para poupar espaço do telemóvel).
  try { return (await driverApi<{ id: string }>('/api/driver/files', 'POST', { kind, ...(await fileToUpload(file, 1280)) })).id; } catch { return null; }
}

function IncidentModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (b: unknown) => Promise<void> }) {
  const [kind, setKind] = useState('avaria');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={t.driverApp.incident}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">{Object.entries(t.driverApp.incidentKinds).map(([k, v]) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-xl border p-3 text-left font-medium ${kind === k ? 'border-primary bg-primary-soft' : 'border-border'}`}>{v}</button>))}</div>
        <Textarea placeholder={t.common.notes} value={note} onChange={(e) => setNote(e.target.value)} />
        <Field label={`${t.driverApp.photo} (${t.common.optional})`}><Input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
        <Button size="lg" className="w-full" loading={busy} onClick={async () => { setBusy(true); const photo_file_id = photo ? await uploadFile(photo, 'incident_photo') : null;
          await onSubmit({ kind, note: note || null, photo_file_id, occurred_at: new Date().toISOString() }); setBusy(false); setNote(''); setPhoto(null); }}>{t.driverApp.send}</Button>
      </div>
    </Modal>
  );
}

function ExpenseModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (b: unknown) => Promise<void> }) {
  const [category, setCategory] = useState('portagem');
  const [amount, setAmount] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={t.driverApp.expense}>
      <div className="space-y-3">
        <Field label={t.costs.category}><Select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(t.costs.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label={`${t.costs.amount} (MZN)`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={`${t.costs.receipt} (${t.common.optional})`}><Input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
        <Button size="lg" className="w-full" disabled={!amount} loading={busy} onClick={async () => { setBusy(true); const receipt_file_id = photo ? await uploadFile(photo, 'receipt') : null;
          await onSubmit({ category, amount: Number(amount.replace(',', '.')), receipt_file_id, spent_at: new Date().toISOString() }); setBusy(false); setAmount(''); }}>{t.driverApp.send}</Button>
      </div>
    </Modal>
  );
}

function DeliveryModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (b: unknown) => Promise<void> }) {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (canvas.current!.width / r.width), (e.clientY - r.top) * (canvas.current!.height / r.height)] as const; };
  return (
    <Modal open={open} onClose={onClose} title={t.driverApp.deliver}>
      <div className="space-y-3">
        <Field label={t.driverApp.receivedBy}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div><span className="label">{t.driverApp.signature}</span>
          <canvas ref={canvas} width={600} height={220} className="h-40 w-full touch-none rounded-xl border border-border bg-white"
            onPointerDown={(e) => { drawing.current = true; const c = canvas.current!.getContext('2d')!; c.lineWidth = 3; c.lineCap = 'round'; c.strokeStyle = '#10243D'; c.beginPath(); c.moveTo(...pos(e)); }}
            onPointerMove={(e) => { if (!drawing.current) return; const c = canvas.current!.getContext('2d')!; c.lineTo(...pos(e)); c.stroke(); setSigned(true); }}
            onPointerUp={() => { drawing.current = false; }} />
          <button className="mt-1 text-sm text-primary" onClick={() => { canvas.current!.getContext('2d')!.clearRect(0, 0, 600, 220); setSigned(false); }}>{t.driverApp.clear}</button></div>
        <Field label={`${t.driverApp.photo} (${t.common.optional})`}><Input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
        <Button variant="success" size="lg" className="w-full" disabled={name.trim().length < 2} loading={busy} onClick={async () => {
          setBusy(true);
          const sig = signed ? await new Promise<Blob | null>((r) => canvas.current!.toBlob(r, 'image/png')) : null;
          const signature_file_id = sig ? await uploadFile(sig, 'signature') : null;
          const photo_file_id = photo ? await uploadFile(photo, 'delivery_photo') : null;
          await onSubmit({ received_by_name: name.trim(), signature_file_id, photo_file_id, delivered_at: new Date().toISOString() });
          setBusy(false);
        }}>{t.driverApp.finish}</Button>
      </div>
    </Modal>
  );
}

function VoiceTest({ open, onClose, speak }: { open: boolean; onClose: () => void; speak: (s: string) => boolean }) {
  const [res, setRes] = useState<string | null>(null);
  const test = () => {
    if (!('speechSynthesis' in window)) { setRes(t.driverApp.voiceNone); return; }
    const check = () => {
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'));
      const local = voices.filter((v) => v.localService);
      setRes(local.length ? `${t.driverApp.voiceOk} (${local.map((v) => v.lang).join(', ')})` : t.driverApp.voiceNone);
      if (voices.length) speak(t.voice.tripStarted);
    };
    if (speechSynthesis.getVoices().length) check(); else speechSynthesis.onvoiceschanged = check;
  };
  return <Modal open={open} onClose={onClose} title={t.driverApp.voiceTest}><Button className="w-full" onClick={test}>{t.driverApp.voiceTest}</Button>{res && <p className="mt-3 text-sm">{res}</p>}</Modal>;
}

// Velocidade REAL do GPS, tendência (a acelerar / a reduzir), estrada e limite (só se registado no OpenStreetMap).
function SpeedCard({ rt, kmLeft, kmDone }: { rt: ReturnType<typeof useDriverRuntime>; kmLeft: number | null; kmDone: number | null }) {
  const fresh = rt.gps.lastFixAt != null && Date.now() - rt.gps.lastFixAt < 30_000;
  const speed = fresh && rt.speed != null ? Math.round(rt.speed) : null;
  const trend = fresh ? speedTrend(rt.speedHist) : null;
  const road = rt.road && Date.now() - rt.road.at < 60_000 ? rt.road : null;
  const over = speed != null && road?.speedLimitKmh != null && speed > road.speedLimitKmh + 3;
  const avg = rt.speedHist.length >= 3 ? rt.speedHist.reduce((a, b) => a + b, 0) / rt.speedHist.length : null;
  const paceS = fresh && avg != null && avg >= 5 && kmLeft != null ? (kmLeft / avg) * 3600 : null;
  return (
    <div className={`card p-4 ${over ? 'border-danger' : ''}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{t.strip.speed}</p>
          <p className={`text-5xl font-bold tabular-nums ${over ? 'text-danger' : ''}`}>{speed ?? '—'}<span className="ml-1 text-lg font-medium text-muted">km/h</span></p>
          {trend && <p className={`text-sm font-semibold ${trend === 'slowing' ? 'text-warning' : trend === 'accelerating' ? 'text-success' : 'text-muted'}`}>{trend === 'accelerating' ? '▲ ' : trend === 'slowing' ? '▼ ' : ''}{t.strip[trend]}</p>}
        </div>
        {road?.speedLimitKmh != null
          ? <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[6px] bg-white text-2xl font-bold ${over ? 'border-danger text-danger' : 'border-danger text-navy'}`} aria-label={t.strip.limit(road.speedLimitKmh)}>{road.speedLimitKmh}</span>
          : <span className="max-w-[45%] text-right text-xs text-muted">{t.strip.limitUnknown}</span>}
      </div>
      {over && <p className="mt-2 font-semibold text-danger">{t.strip.overLimit}</p>}
      <p className="mt-2 text-sm"><span className="text-muted">{t.strip.road}: </span><span className="font-semibold">{road?.roadName ?? t.strip.noRoad}</span></p>
      <p className="mt-1 text-sm text-muted">{kmDone != null ? `${t.strip.done(formatKm(kmDone))} · ` : ''}{t.strip.pace}: {paceS != null ? formatDuration(paceS) : '—'}
        {rt.gps.accuracyM != null ? ` · ${t.strip.accuracy(Math.round(rt.gps.accuracyM))}` : ''}</p>
    </div>
  );
}
