// Avisos por voz (SPEC §6.11 / prompt 8A.5). Puro e determinístico: recebe instantâneos e acontecimentos
// do motor de progresso e decide o que dizer. Regras:
//  - cada aviso toca UMA vez (chave idempotente) — histerese: só dispara ao CRUZAR um limiar;
//  - intervalo mínimo entre avisos, com prioridade;
//  - avisos por tempo só com confiança de ETA ≥ média; senão usa distância;
//  - só localidades com importância suficiente.

import type { EngineEvent, Snapshot } from './progress';

export type VoiceSettings = {
  minIntervalMs: number;
  minImportance: number;
  destinationKm: number[];
  minutesBefore: number[];
  kmBeforePlace: number[];
  maxQueueAgeMs: number;
};

export const DEFAULT_VOICE: VoiceSettings = {
  minIntervalMs: 2 * 60_000,
  minImportance: 3,
  destinationKm: [100, 50, 20, 10],
  minutesBefore: [15, 5],
  kmBeforePlace: [10, 2],
  maxQueueAgeMs: 4 * 60_000,
};

export type Announcement = { key: string; kind: string; text: string; priority: number; createdAt: number };

export type VoiceState = {
  said: Record<string, number>;
  lastSpokenAt: number | null;
  queue: Announcement[];
  prev: { kmLeft: number | null; nextPlaceId: string | null; minutesToNext: number | null; kmToNext: number | null };
};

export const initialVoiceState = (): VoiceState => ({
  said: {}, lastSpokenAt: null, queue: [], prev: { kmLeft: null, nextPlaceId: null, minutesToNext: null, kmToNext: null },
});

export type VoiceTexts = {
  faltamKmDestino: (km: number) => string;
  faltamMinutos: (min: number, place: string) => string;
  estaAKm: (km: number, place: string) => string;
  aEntrar: (place: string) => string;
  passou: (place: string) => string;
  provincia: (name: string) => string;
  chegou: () => string;
};

export function evaluate(
  vs: VoiceState, snap: Snapshot, events: EngineEvent[], t: number, texts: VoiceTexts, settings: VoiceSettings = DEFAULT_VOICE,
): { state: VoiceState; speak: Announcement | null } {
  const s: VoiceState = { said: { ...vs.said }, lastSpokenAt: vs.lastSpokenAt, queue: [...vs.queue], prev: { ...vs.prev } };
  const push = (a: Omit<Announcement, 'createdAt'>) => {
    if (s.said[a.key] != null || s.queue.some((q) => q.key === a.key)) return;
    s.queue.push({ ...a, createdAt: t });
  };

  for (const e of events) {
    if (e.kind === 'chegou_destino') push({ key: 'destino:chegou', kind: e.kind, text: texts.chegou(), priority: 0 });
    else if (e.kind === 'entrou_provincia') push({ key: `prov:${e.provinceId}`, kind: e.kind, text: texts.provincia(e.name), priority: 2 });
    else if (e.kind === 'chegou_localidade' && e.importance >= settings.minImportance)
      push({ key: `entra:${e.placeId}`, kind: e.kind, text: texts.aEntrar(e.name), priority: 1 });
    else if (e.kind === 'passou_localidade' && e.importance >= Math.max(settings.minImportance, 4))
      push({ key: `passou:${e.placeId}`, kind: e.kind, text: texts.passou(e.name), priority: 4 });
  }

  // Distância ao destino: só ao cruzar o limiar durante a viagem.
  if (snap.kmLeft != null && s.prev.kmLeft != null) {
    for (const th of settings.destinationKm) {
      if (s.prev.kmLeft > th && snap.kmLeft <= th) push({ key: `dest:${th}`, kind: 'distancia_destino', text: texts.faltamKmDestino(th), priority: 3 });
    }
  }

  // Próxima localidade importante: por tempo (com confiança) ou, sem confiança, por distância.
  const npS = snap.places.find((p) => p.state === 'proxima' && p.importance >= settings.minImportance) ?? null;
  const np = npS ? { placeId: npS.placeId, name: npS.name, km: npS.kmFromOrigin, eta: npS.eta } : null;
  const reliable = snap.etaConfidence === 'alta' || snap.etaConfidence === 'media';
  let minutesToNext: number | null = null;
  let kmToNext: number | null = null;
  if (np && snap.kmDone != null) {
    kmToNext = np.km - snap.kmDone;
    if (np.eta != null && reliable) minutesToNext = (np.eta - t) / 60_000;
    const samePlace = s.prev.nextPlaceId === np.placeId;
    if (samePlace) {
      if (minutesToNext != null && s.prev.minutesToNext != null) {
        for (const th of settings.minutesBefore) {
          if (s.prev.minutesToNext > th && minutesToNext <= th)
            push({ key: `min:${np.placeId}:${th}`, kind: 'tempo_localidade', text: texts.faltamMinutos(th, np.name), priority: 2 });
        }
      } else if (s.prev.kmToNext != null) {
        for (const th of settings.kmBeforePlace) {
          if (s.prev.kmToNext > th && kmToNext <= th)
            push({ key: `km:${np.placeId}:${th}`, kind: 'distancia_localidade', text: texts.estaAKm(th, np.name), priority: 3 });
        }
      }
    }
  }
  s.prev = { kmLeft: snap.kmLeft, nextPlaceId: np?.placeId ?? null, minutesToNext, kmToNext };

  // Descarta avisos velhos (ex.: "faltam 5 minutos" que já não é verdade).
  s.queue = s.queue.filter((q) => t - q.createdAt <= settings.maxQueueAgeMs || q.priority === 0);

  let speak: Announcement | null = null;
  const canSpeak = s.lastSpokenAt == null || t - s.lastSpokenAt >= settings.minIntervalMs;
  if (s.queue.length && (canSpeak || s.queue.some((q) => q.priority === 0))) {
    s.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    speak = s.queue.shift()!;
    s.said[speak.key] = t;
    s.lastSpokenAt = t;
  }
  return { state: s, speak };
}
