import { describe, expect, it } from 'vitest';
import { answer, type AssistantTexts } from './assistant';
import { syntheticRoute } from './fixtures.test-route';
import { initialState, step } from './progress';
import { pointAt } from './geometry';
import { t } from '@/i18n/pt-MZ';

const txt: AssistantTexts = { noInfo: t.voice.noInfo, notUnderstood: t.assistant.notUnderstood, whereAmI: t.assistant.whereAmI, remaining: t.assistant.remaining,
  nextCity: t.assistant.nextCity, toPlace: t.assistant.toPlace, arrival: t.assistant.arrival, province: t.assistant.province };
const route = syntheticRoute();
const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 16);

describe('assistente: nunca responde com dados inexistentes', () => {
  const questions = ['Onde estou?', 'Em que cidade estou?', 'Quanto falta?', 'Qual é a próxima cidade?', 'Quanto falta para Localidade C?', 'A que horas chego?', 'Em que província estou?'];
  it('sem posição: todas as respostas dizem que não há informação', () => {
    for (const q of questions) expect(answer(q, null, route, txt, fmt, (s) => t.label(s.label))).toBe(t.voice.noInfo);
    const empty = step(route, initialState(), { t: 0, lng: 0, lat: 0, accuracyM: 5000 }).snapshot;
    for (const q of questions) expect(answer(q, empty, route, txt, fmt, (s) => t.label(s.label))).toBe(t.voice.noInfo);
  });
  it('com posição real: responde com os valores calculados pelo motor', () => {
    let s = initialState();
    let snap = null as ReturnType<typeof step>['snapshot'] | null;
    for (let i = 0; i <= 40; i++) {
      const p = pointAt(route.coords, route.cum, i * 2000);
      const r = step(route, s, { t: i * 120_000, lng: p[0], lat: p[1], accuracyM: 10, speedKmh: 60 });
      s = r.state; snap = r.snapshot;
    }
    expect(answer('Quanto falta?', snap, route, txt, fmt, (x) => t.label(x.label))).toBe(t.assistant.remaining(Math.round(snap!.kmLeft!)));
    const c = route.places.find((p) => p.placeId === 'C')!;
    expect(answer('quanto falta para localidade c', snap, route, txt, fmt, (x) => t.label(x.label))).toBe(t.assistant.toPlace('Localidade C', Math.round(c.kmFromOrigin - snap!.kmDone!)));
    expect(answer('Qual é a próxima cidade?', snap, route, txt, fmt, (x) => t.label(x.label))).toContain(snap!.nextPlace!.name);
    expect(answer('Em que província estou?', snap, route, txt, fmt, (x) => t.label(x.label))).toBe(t.assistant.province('Província Um'));
    expect(answer('blá blá', snap, route, txt, fmt, (x) => t.label(x.label))).toBe(t.assistant.notUnderstood);
  });
});
