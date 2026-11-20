// Escolha da voz (gratuita, do próprio telemóvel: speechSynthesis / vozes Google-Android). Preferência: português de Portugal/
// Moçambique, masculina se o telemóvel tiver uma reconhecível pelo nome. A lista de vozes depende do aparelho.
export type VoiceLike = { name: string; lang: string; voiceURI?: string };

const MALE = /\b(male|masculin[ao]?|homem)\b|x-(jmn|pmj|ptd|ptl|afs-m)|duarte|cristiano|ant[oó]nio|ricardo|joaquim|daniel|felipe|jo[aã]o|helio|f[aá]bio/i;
const FEMALE = /\b(female|feminin[ao]?|mulher)\b|joana|catarina|raquel|helena|luciana|francisca|fernanda|maria|ines|in[eê]s|x-(jfb|sfs|afs|pte|ptf)/i;

export function pickVoice<V extends VoiceLike>(voices: V[]): { voice: V | null; male: boolean } {
  const pt = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('pt'));
  const rank = (v: V) => (/pt-(pt|mz)/i.test(v.lang.replace('_', '-')) ? 0 : 1);
  const byLang = [...pt].sort((a, b) => rank(a) - rank(b));
  const id = (v: V) => `${v.name} ${v.voiceURI ?? ''}`;
  const male = byLang.find((v) => MALE.test(id(v)) && !FEMALE.test(id(v)));
  if (male) return { voice: male, male: true };
  return { voice: byLang[0] ?? null, male: false };
}
