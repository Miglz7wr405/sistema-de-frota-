// Assistente de voz (Fase 9): correspondência local de intenções, sem LLM e sem rede.
// Regra de ouro: responde APENAS com dados calculados; sem dados → "Não tenho essa informação neste momento."
import type { Snapshot, RouteModel } from './progress';

export type AssistantTexts = {
  noInfo: string; whereAmI: (label: string) => string; remaining: (km: number) => string; nextCity: (name: string, km: number) => string;
  toPlace: (name: string, km: number) => string; arrival: (time: string) => string; province: (name: string) => string; notUnderstood: string;
};

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function answer(question: string, snap: Snapshot | null, route: RouteModel | null, txt: AssistantTexts, fmtTime: (ms: number) => string, labelText: (s: Snapshot) => string | null): string {
  const q = norm(question);
  const has = (...w: string[]) => w.some((x) => q.includes(x));
  const noData = !snap || snap.kmDone == null;

  // "Quanto falta para Caia?" — procura uma localidade da rota mencionada na pergunta
  if (route && has('falta para', 'falta ate', 'distancia ate', 'quanto falta pra', 'longe fica')) {
    const pl = route.places.find((p) => q.includes(norm(p.name)));
    if (pl) {
      if (noData) return txt.noInfo;
      const km = Math.round(pl.kmFromOrigin - snap!.kmDone!);
      return km > 0 ? txt.toPlace(pl.name, km) : txt.noInfo;
    }
  }
  if (has('que horas chego', 'hora de chegada', 'quando chego', 'a que horas')) {
    if (!snap || !snap.etaDestination || snap.etaConfidence === 'indisponivel') return txt.noInfo;
    return txt.arrival(fmtTime(snap.etaDestination));
  }
  if (has('quanto falta', 'quantos quilometros', 'quantos km', 'falta muito')) {
    if (noData || snap!.kmLeft == null) return txt.noInfo;
    return txt.remaining(Math.round(snap!.kmLeft));
  }
  if (has('proxima cidade', 'proxima localidade', 'proxima vila', 'qual e a proxima', 'o que vem')) {
    if (noData || !snap!.nextPlace) return txt.noInfo;
    return txt.nextCity(snap!.nextPlace.name, Math.max(1, Math.round(snap!.nextPlace.km - snap!.kmDone!)));
  }
  if (has('provincia')) {
    if (!snap?.provinceName) return txt.noInfo;
    return txt.province(snap.provinceName);
  }
  if (has('onde estou', 'em que cidade', 'onde e que estou', 'onde estamos', 'que lugar')) {
    if (noData) return txt.noInfo;
    const l = labelText(snap!);
    return l ? txt.whereAmI(l) : txt.noInfo;
  }
  return txt.notUnderstood;
}
