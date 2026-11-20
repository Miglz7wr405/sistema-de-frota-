// Motor do motorista no telemóvel: GPS → fila offline → envio; cálculo local de progresso e avisos por voz (funciona sem rede).
import { useCallback, useEffect, useRef, useState } from 'react';
import { enqueue, flush, positionsCount, type QueueItem } from '@/lib/offline/queue';
import { cumulative, type LngLat } from '@/lib/geo/geometry';
import { initialState, step, type EngineState, type RouteModel, type Snapshot } from '@/lib/geo/progress';
import { DEFAULT_VOICE, evaluate, initialVoiceState, type VoiceState } from '@/lib/geo/voice';
import { t, voiceTexts } from '@/i18n/pt-MZ';

export const TOKEN_KEY = 'if_driver_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);

export type Me = {
  testMode?: boolean;
  driver: { id: string; fullName: string }; org: { name: string; settings: Record<string, number> }; consentRequired: boolean;
  trip: { id: string; code: string; status: string; origin: string; destination: string; plate: string | null; cargo_description: string | null; planned_arrival: string | null } | null;
  route: { routeId: string; version: number; baseKm: number; coords: LngLat[]; lengthM: number; plannedDurationS: number; places: RouteModel['places'] } | null;
  stops: { id: string; seq: number; kind: string; arrived_at: string | null; place_name: string }[]; serverTime: string;
};

export async function driverApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: { authorization: `Bearer ${getToken()}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!r.ok) { const e = new Error(String(r.status)) as Error & { status: number }; e.status = r.status; throw e; }
  return r.json() as Promise<T>;
}

type GpsState = { status: 'off' | 'waiting' | 'ok' | 'denied' | 'error'; lastFixAt: number | null; lastSentAt: number | null; accuracyM: number | null };
export type Road = { roadName: string | null; speedLimitKmh: number | null; lat?: number; lng?: number; at: number };
export type Pos = { lat: number; lng: number; heading: number | null; t: number };

const hav = (a: [number, number], b: [number, number]) => {
  const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export function useDriverRuntime(me: Me | null, muted: boolean) {
  const [gps, setGps] = useState<GpsState>({ status: 'off', lastFixAt: null, lastSentAt: null, accuracyM: null });
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [lastSpoken, setLastSpoken] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [speedHist, setSpeedHist] = useState<number[]>([]);
  const [road, setRoad] = useState<Road | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const prevFix = useRef<{ t: number; lng: number; lat: number; acc: number } | null>(null);
  const testMode = !!me?.testMode;
  const engine = useRef<{ model: RouteModel; state: EngineState; voice: VoiceState; key: string } | null>(null);
  const buffer = useRef<unknown[]>([]);
  const lastRecorded = useRef<{ t: number; moving: boolean } | null>(null);
  const watchId = useRef<number | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const voiceLog = useRef<unknown[]>([]);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const active = me?.trip?.status === 'em_viagem' || me?.trip?.status === 'pausada';

  const speak = useCallback((text: string) => {
    setLastSpoken(text);
    if (mutedRef.current || !('speechSynthesis' in window)) return false;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === 'pt-PT') ?? voices.find((v) => v.lang.startsWith('pt')) ?? null;
    u.lang = u.voice?.lang ?? 'pt-PT';
    speechSynthesis.speak(u);
    return true;
  }, []);

  // Modelo da rota: guardado localmente para funcionar sem rede (lacuna L6).
  useEffect(() => {
    if (!me?.trip || !me.route) { engine.current = null; return; }
    const key = `if_engine_${me.trip.id}_${me.route.routeId}`;
    if (engine.current?.key === key) return;
    const model: RouteModel = { coords: me.route.coords, cum: cumulative(me.route.coords), lengthM: me.route.lengthM, plannedDurationS: me.route.plannedDurationS,
      places: me.route.places.map((p) => ({ ...p })) };
    // o motor local usa a geometria simplificada → reescala os km das localidades para a mesma medida
    const scale = model.cum[model.cum.length - 1]! / model.lengthM;
    model.places = model.places.map((p) => ({ ...p, kmFromOrigin: p.kmFromOrigin * scale }));
    model.lengthM = model.cum[model.cum.length - 1]!;
    let saved: { state: EngineState; voice: VoiceState } | null = null;
    try { saved = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* estado corrompido: recomeça */ }
    engine.current = { model, key, state: saved?.state ?? initialState(), voice: saved?.voice ?? initialVoiceState() };
  }, [me?.trip?.id, me?.route?.routeId]);

  const sync = useCallback(async () => {
    if (buffer.current.length) {
      await enqueue({ kind: 'positions', body: { positions: buffer.current.splice(0) } });
    }
    if (voiceLog.current.length && me?.trip) await enqueue({ kind: 'action', method: 'POST', path: `/api/driver/trips/${me.trip.id}/voice`, body: { items: voiceLog.current.splice(0) } });
    if (navigator.onLine) {
      const send = async (it: QueueItem): Promise<'ok' | 'retry' | 'drop'> => {
        try {
          const r = it.kind === 'positions'
            ? await fetch('/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...it.body, sent_at: new Date().toISOString() }) })
            : await fetch(it.path, { method: it.method, headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(it.body) });
          if (r.ok) {
            if (it.kind === 'positions') {
              const j = await r.json().catch(() => null) as { road?: { roadName: string | null; speedLimitKmh: number | null; lat: number; lng: number } | null } | null;
              if (j?.road) setRoad({ ...j.road, at: Date.now() });
            }
            return 'ok';
          }
          if (r.status >= 500 || r.status === 429) return 'retry';
          return 'drop'; // rejeição definitiva (ex.: transição já aplicada): não bloqueia a fila
        } catch { return 'retry'; }
      };
      const res = await flush(send);
      if (res.sent) setGps((g) => ({ ...g, lastSentAt: Date.now() }));
    }
    setQueued(await positionsCount() + buffer.current.length);
  }, [me?.trip?.id]);

  const syncRef = useRef(sync);
  syncRef.current = sync;

  const onFix = useCallback((pos: GeolocationPosition) => {
    const now = pos.timestamp || Date.now();
    // Velocidade REAL: a do GPS do telemóvel; se o navegador não a der, calculada entre duas posições precisas consecutivas.
    let kmh: number | null = pos.coords.speed != null && Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : null;
    const pf = prevFix.current;
    if (kmh == null && pf && pos.coords.accuracy <= 30 && pf.acc <= 30) {
      const dt = (now - pf.t) / 1000;
      if (dt >= 1 && dt <= 30) kmh = (hav([pf.lng, pf.lat], [pos.coords.longitude, pos.coords.latitude]) / dt) * 3.6;
    }
    prevFix.current = { t: now, lng: pos.coords.longitude, lat: pos.coords.latitude, acc: pos.coords.accuracy };
    setSpeed(kmh);
    setPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading != null && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : null, t: now });
    if (kmh != null) setSpeedHist((h) => [...h.slice(-7), kmh!]);
    setGps((g) => ({ ...g, status: 'ok', lastFixAt: now, accuracyM: pos.coords.accuracy }));
    const st = me?.org.settings ?? {};
    const moving = kmh == null || kmh > 3;
    const interval = testMode ? (moving ? 5 : 30) * 1000 : (moving ? st.gps_interval_moving_s ?? 15 : st.gps_interval_stopped_s ?? 120) * 1000;
    const last = lastRecorded.current;
    if (!last || now - last.t >= interval || last.moving !== moving) {
      lastRecorded.current = { t: now, moving };
      buffer.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, device_time: new Date(now).toISOString(), speed_kmh: kmh,
        heading: pos.coords.heading != null && !Number.isNaN(pos.coords.heading) ? pos.coords.heading % 360 : null, accuracy_m: pos.coords.accuracy,
        battery_pct: batteryPct.current });
    }
    // Cálculo local (offline): progresso + avisos por voz
    const e = engine.current;
    if (e && me?.trip?.status === 'em_viagem') {
      const r = step(e.model, e.state, { t: now, lng: pos.coords.longitude, lat: pos.coords.latitude, accuracyM: pos.coords.accuracy, speedKmh: kmh });
      const v = evaluate(e.voice, r.snapshot, r.events, now, voiceTexts, { ...DEFAULT_VOICE, minImportance: st.voice_min_importance ?? 3 });
      e.state = r.state; e.voice = v.state;
      setSnap(r.snapshot);
      if (v.speak) {
        const played = speak(v.speak.text);
        voiceLog.current.push({ key: v.speak.key, kind: v.speak.kind, text: v.speak.text, at: new Date(now).toISOString(), km: r.snapshot.kmDone, played });
      }
      try { localStorage.setItem(e.key, JSON.stringify({ state: e.state, voice: e.voice })); } catch { /* armazenamento cheio */ }
    }
  }, [me, speak, testMode]);

  const batteryPct = useRef<number | null>(null);
  useEffect(() => {
    (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.().then((b) => { batteryPct.current = Math.round(b.level * 100); }).catch(() => {});
  }, []);

  // GPS só durante a viagem ativa (privacidade, L2). Religa sozinho ao voltar à app, e pode ser religado com o botão.
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;
  const lastFixRef = useRef<number | null>(null);
  lastFixRef.current = gps.lastFixAt;
  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) { setGps((g) => ({ ...g, status: 'error' })); return; }
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    setGps((g) => ({ ...g, status: g.status === 'ok' ? 'ok' : 'waiting' }));
    watchId.current = navigator.geolocation.watchPosition((p) => onFixRef.current(p),
      (err) => setGps((g) => ({ ...g, status: err.code === err.PERMISSION_DENIED ? 'denied' : 'error' })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 });
  }, []);
  const reqWake = useCallback(() => (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } }).wakeLock?.request('screen').then((w) => { wake.current = w; }).catch(() => {}), []);
  useEffect(() => {
    if (!active) return;
    startWatch(); reqWake();
    // ao voltar à app (saiu sem querer): religa o GPS e envia o que ficou na fila
    const vis = () => { if (document.visibilityState === 'visible') { startWatch(); reqWake(); void syncRef.current(); } };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', vis);
    // vigilância: sem posição há mais de 45 s com a app aberta → religa
    const dog = setInterval(() => {
      if (document.visibilityState === 'visible' && (lastFixRef.current == null || Date.now() - lastFixRef.current > 45_000)) startWatch();
    }, 20_000);
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      wake.current?.release().catch(() => {});
      document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); clearInterval(dog);
    };
  }, [active, startWatch, reqWake]);
  /** Botão "Ligar GPS novamente". */
  const reconnect = useCallback(() => { startWatch(); reqWake(); void syncRef.current(); }, [startWatch, reqWake]);

  // Envio periódico + quando a rede volta.
  useEffect(() => {
    const h = setInterval(sync, testMode ? 5_000 : 10_000);
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    sync();
    return () => { clearInterval(h); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [sync, testMode]);

  // Aviso "A localização deixou de ser atualizada" (uma vez por episódio).
  const lostAnnounced = useRef(false);
  useEffect(() => {
    const h = setInterval(() => {
      if (!active || !gps.lastFixAt) return;
      const lost = Date.now() - gps.lastFixAt > 2 * 60_000;
      if (lost && !lostAnnounced.current) { lostAnnounced.current = true; speak(t.voice.signalLost); }
      if (!lost) lostAnnounced.current = false;
    }, 15_000);
    return () => clearInterval(h);
  }, [active, gps.lastFixAt, speak]);

  /** Ação do motorista: vai para a fila (ordenada com as posições) e é enviada quando houver rede. */
  const action = useCallback(async (method: string, path: string, body: unknown) => {
    if (buffer.current.length) await enqueue({ kind: 'positions', body: { positions: buffer.current.splice(0) } });
    await enqueue({ kind: 'action', method, path, body });
    await sync();
  }, [sync]);

  return { gps, queued, online, snap, speed, speedHist, road, pos, testMode, reconnect, lastSpoken, speak, action, sync, route: engine.current?.model ?? null };
}
