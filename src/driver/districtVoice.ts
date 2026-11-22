// Voz dos distritos: "Chegou ao distrito de X." ao entrar num distrito da rota e "Falta pouco para chegar ao distrito de Y."
// uns km antes. Os km de entrada vêm do servidor (rota real × limites ADM2 do geoBoundaries); os km feitos vêm do motor
// de percurso. Frases gravadas com o ElevenLabs (ficheiros estáticos em /voz, sem chave de API nem pedidos em tempo real);
// um distrito sem gravação usa a voz do telemóvel com o mesmo texto.
import { t } from '@/i18n/pt-MZ';
import manifest from './voz-manifest.json';

export type RouteDistrict = { code: string; name: string; province: string | null; km: number };
export type DistrictEvent = { kind: 'chegou' | 'falta'; district: RouteDistrict; key: string; text: string; clip: string | null };

export const FALTA_KM = 5; // "falta pouco" uns 5 km antes de entrar
const CLIPS = new Set<string>(manifest.clips);

export const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isCity = (name: string) => /^cidade (de|da|do) /i.test(name);

export function phrase(kind: 'chegou' | 'falta', name: string) {
  const city = isCity(name);
  const target = city ? name.charAt(0).toLowerCase() + name.slice(1) : name; // "cidade da Beira"
  return kind === 'chegou' ? (city ? t.voice.arrivedCity(target) : t.voice.arrivedDistrict(name)) : (city ? t.voice.nearCity(target) : t.voice.nearDistrict(name));
}

export function clipFor(kind: 'chegou' | 'falta', name: string): string | null {
  const id = `${slugify(name)}-${kind}`;
  return CLIPS.has(id) ? `/voz/${id}.mp3` : null;
}

/** Marca como já ditos os distritos antes da posição atual (ao abrir a app a meio da viagem não repete o que passou). */
export function seedSaid(entries: RouteDistrict[], km: number | null): Set<string> {
  const said = new Set<string>();
  entries.forEach((d, i) => {
    if (i === 0 || (km != null && km >= d.km)) { said.add(`c${i}`); said.add(`f${i}`); }
    else if (km != null && km >= d.km - FALTA_KM) said.add(`f${i}`);
  });
  return said;
}

/** Eventos de voz entre a última posição conhecida e a atual (km ao longo da rota). Atualiza `said`. */
export function districtEvents(entries: RouteDistrict[], km: number | null, said: Set<string>): DistrictEvent[] {
  if (km == null) return [];
  const out: DistrictEvent[] = [];
  entries.forEach((d, i) => {
    if (i === 0) return; // o distrito de partida não se anuncia
    if (!said.has(`c${i}`) && km >= d.km) {
      said.add(`c${i}`); said.add(`f${i}`);
      out.push({ kind: 'chegou', district: d, key: `c${i}`, text: phrase('chegou', d.name), clip: clipFor('chegou', d.name) });
    } else if (!said.has(`f${i}`) && km >= d.km - FALTA_KM && km < d.km - 0.3) {
      said.add(`f${i}`);
      out.push({ kind: 'falta', district: d, key: `f${i}`, text: phrase('falta', d.name), clip: clipFor('falta', d.name) });
    }
  });
  // se no mesmo instante chega a um e se aproxima do seguinte: primeiro "chegou", depois "falta pouco"
  return out.sort((a, b) => (a.kind === b.kind ? a.district.km - b.district.km : a.kind === 'chegou' ? -1 : 1));
}

/** Toca as frases por ordem: gravação do ElevenLabs se existir, senão a voz do telemóvel. */
export function createDistrictPlayer(speak: (text: string) => boolean, isMuted: () => boolean) {
  const queue: DistrictEvent[] = [];
  const cache = new Map<string, string>();
  let busy = false;
  const next = async () => {
    if (busy) return;
    const ev = queue.shift();
    if (!ev) return;
    busy = true;
    try {
      if (!isMuted()) {
        if (ev.clip) {
          const a = new Audio(cache.get(ev.clip) ?? ev.clip);
          await new Promise<void>((res) => { a.onended = () => res(); a.onerror = () => { speak(ev.text); res(); }; a.play().catch(() => { speak(ev.text); res(); }); });
        } else { speak(ev.text); await new Promise((r) => setTimeout(r, 3500)); }
      }
    } finally { busy = false; void next(); }
  };
  return {
    play(evs: DistrictEvent[]) { queue.push(...evs); void next(); },
    /** Descarrega já as gravações dos distritos desta rota (continuam a tocar sem rede). */
    async prefetch(entries: RouteDistrict[]) {
      for (const d of entries) for (const k of ['chegou', 'falta'] as const) {
        const u = clipFor(k, d.name);
        if (!u || cache.has(u)) continue;
        try { const r = await fetch(u); if (r.ok) cache.set(u, URL.createObjectURL(await r.blob())); } catch { /* sem rede: tenta tocar pelo endereço */ }
      }
    },
  };
}
