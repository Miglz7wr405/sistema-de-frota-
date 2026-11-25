// Análise do comprovativo de pagamento (ADR-030): a IA (visão) lê a imagem e procura sinais de edição; depois o servidor
// aplica regras duras (valor, número/nome de quem recebe, código, hora) que a IA não pode contornar.
// Nenhuma IA garante que o dinheiro entrou: as dúvidas ficam "em análise" para o proprietário, e um pagamento aprovado
// pode ser anulado depois (era burla) → empresa bloqueada.
// ⚠️ DEPENDÊNCIA EXTERNA: GEMINI_API_KEY (Google AI Studio, plano grátis; limites diários; a Google pode usar os dados
// do plano grátis para melhorar os modelos). Sem chave ou com erro → o pagamento fica "em análise" (nunca aprova sem IA).
import { z } from 'zod';
import { mzPhone, parseReceipt } from '../../src/lib/billing/receipt.js';

export type AiVerdict = {
  operadora: string | null; valor: number | null; destinatario_numero: string | null; destinatario_nome: string | null;
  codigo: string | null; data_hora: string | null; sinais_edicao: string[]; parece_ecra_real: boolean; risco: number; motivo: string;
};
export type Expected = {
  price: number; code: string; method: 'mpesa' | 'emola';
  accounts: { number: string | null; name: string | null }[]; // números/nomes do proprietário que recebem
  clientAmount?: number | null; // valor lido no telemóvel do cliente (OCR) — só para comparar
};
export type Decision = { status: 'aprovado' | 'pendente' | 'rejeitado'; reason: string | null; checks: { k: string; ok: boolean | null; d?: string }[] };

const AiSchema = z.object({
  operadora: z.string().nullable().catch(null),
  valor: z.union([z.number(), z.string()]).nullable().catch(null)
    .transform((v) => (v == null ? null : typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || null)),
  destinatario_numero: z.string().nullable().catch(null),
  destinatario_nome: z.string().nullable().catch(null),
  codigo: z.string().nullable().catch(null),
  data_hora: z.string().nullable().catch(null),
  sinais_edicao: z.array(z.string()).catch([]),
  parece_ecra_real: z.boolean().catch(false),
  risco: z.coerce.number().min(0).max(100).catch(100),
  motivo: z.string().catch(''),
});

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "25/11/2026 14:05", "25/11/26 às 14:05:10", "2026-11-25 14:05", ISO → instante (hora de Maputo, UTC+2 sem horário de verão). */
export function parseMaputoDateTime(s: string | null): Date | null {
  if (!s) return null;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const dmy = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\D{0,8}?(\d{1,2})[:hH](\d{2})(?::(\d{2}))?/);
  let y: number, mo: number, d: number, h: number, mi: number, se: number;
  if (iso) [y, mo, d, h, mi, se] = [+iso[1]!, +iso[2]!, +iso[3]!, +iso[4]!, +iso[5]!, +(iso[6] ?? 0)];
  else if (dmy) [d, mo, y, h, mi, se] = [+dmy[1]!, +dmy[2]!, dmy[3]!.length === 2 ? 2000 + +dmy[3]! : +dmy[3]!, +dmy[4]!, +dmy[5]!, +(dmy[6] ?? 0)];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h - 2, mi, se));
}

/** Regras duras sobre o que a IA leu. Puro (testado em receiptAi.test.ts). */
export function decide(ai: AiVerdict | null, e: Expected, now = new Date()): Decision {
  const checks: Decision['checks'] = [];
  if (!ai) return { status: 'pendente', reason: 'Análise automática indisponível — o proprietário vai confirmar.', checks };
  const reject = (reason: string): Decision => ({ status: 'rejeitado', reason, checks });
  const doubts: string[] = [];

  // 1) valor
  if (ai.valor == null) { checks.push({ k: 'valor', ok: null }); doubts.push('valor não legível'); }
  else if (Math.abs(ai.valor - e.price) > 0.009) { checks.push({ k: 'valor', ok: false, d: String(ai.valor) }); return reject(`Valor do comprovativo (${ai.valor} MT) diferente do preço (${e.price} MT).`); }
  else checks.push({ k: 'valor', ok: true });
  if (e.clientAmount != null && ai.valor != null && Math.abs(e.clientAmount - ai.valor) > 0.009) doubts.push('valor lido no telemóvel diferente');

  // 2) quem recebeu: número do proprietário; se o número estiver escondido, o nome
  const ours = e.accounts.map((a) => (a.number ? mzPhone(a.number) : null)).filter(Boolean) as string[];
  const readNum = ai.destinatario_numero ? mzPhone(ai.destinatario_numero) : null;
  if (readNum) {
    if (ours.length && !ours.includes(readNum)) { checks.push({ k: 'destino', ok: false, d: readNum }); return reject('A transferência foi para outro número, não para o insightFrota.'); }
    checks.push({ k: 'destino', ok: true });
  } else {
    const names = e.accounts.flatMap((a) => (a.name ? norm(a.name) : []));
    const read = ai.destinatario_nome ? norm(ai.destinatario_nome) : [];
    const nameOk = names.length > 0 && read.some((w) => names.includes(w));
    checks.push({ k: 'destino', ok: nameOk ? true : null });
    if (!nameOk) doubts.push('número/nome de quem recebeu não confirmado');
  }

  // 3) código da transação igual ao que o cliente indicou
  const code = ai.codigo ? normCode(ai.codigo) : null;
  if (!code) { checks.push({ k: 'codigo', ok: null }); doubts.push('código não legível'); }
  else if (code !== normCode(e.code)) { checks.push({ k: 'codigo', ok: false, d: code }); doubts.push('código diferente do indicado'); }
  else checks.push({ k: 'codigo', ok: true });

  // 4) hora: comprovativo recente (≤ 60 min), nunca no futuro
  const at = parseMaputoDateTime(ai.data_hora);
  if (!at) { checks.push({ k: 'hora', ok: null }); doubts.push('data/hora não legível'); }
  else {
    const min = (now.getTime() - at.getTime()) / 60_000;
    if (min < -10) { checks.push({ k: 'hora', ok: false, d: ai.data_hora! }); return reject('A data do comprovativo está no futuro.'); }
    if (min > 24 * 60) { checks.push({ k: 'hora', ok: false, d: ai.data_hora! }); return reject('Comprovativo antigo (mais de 24 horas). Envie o comprovativo do pagamento desta viagem.'); }
    if (min > 60) { checks.push({ k: 'hora', ok: false, d: ai.data_hora! }); doubts.push('comprovativo com mais de 60 minutos'); }
    else checks.push({ k: 'hora', ok: true });
  }

  // 5) sinais de edição (IA)
  checks.push({ k: 'edicao', ok: ai.risco < 30 && ai.sinais_edicao.length === 0 && ai.parece_ecra_real });
  if (ai.risco >= 70) return reject(`O comprovativo parece alterado: ${ai.motivo || ai.sinais_edicao.join('; ') || 'sinais de edição'}.`);
  if (ai.risco >= 30 || ai.sinais_edicao.length || !ai.parece_ecra_real) doubts.push(`possíveis sinais de edição (${ai.sinais_edicao.join('; ') || ai.motivo || 'risco ' + ai.risco})`);

  if (doubts.length) return { status: 'pendente', reason: `Em análise: ${doubts.join('; ')}.`, checks };
  return { status: 'aprovado', reason: null, checks };
}

const PROMPT = (e: Expected, nowLocal: string) => `És um verificador anti-fraude de comprovativos de pagamento móvel em Moçambique (M-Pesa da Vodacom, e-Mola da Movitel).
A imagem deve ser o SMS ou o ecrã de confirmação de uma transferência de ${e.price} MT para ${e.accounts.map((a) => `${a.number ?? '?'} (${a.name ?? '?'})`).join(' ou ')}.
O cliente diz que o código da transação é ${e.code}. Agora, em Maputo, são ${nowLocal}.

Tarefas:
1) Lê exatamente: operadora, valor transferido, número e nome de quem RECEBEU, código da transação, data e hora da transação.
2) Procura sinais de edição ou falsificação: números com fonte, tamanho, cor, espessura ou alinhamento diferentes do resto; fundo manchado,
   desfocado ou com blocos à volta de números/datas; texto sobreposto; formato da mensagem diferente do padrão real da operadora
   (ex.: M-Pesa "XXXXXXXX Confirmado. Transferiste 250.00MT para 84xxxxxxx - NOME aos dd/mm/aa as HH:MM..."); hora da barra de estado do
   telemóvel incoerente com a hora da mensagem; imagem gerada ou montagem; fotografia de outro ecrã com moldura estranha.
NÃO são sinais de burla: imagem recortada, saldo ou outros dados pessoais tapados/borrados pelo cliente, captura de ecrã com pouca qualidade.
3) Dá um risco de 0 (claramente genuíno) a 100 (claramente falso). Se não consegues ler bem, risco moderado (40–60), não baixo.

Responde APENAS JSON com as chaves: operadora, valor (número), destinatario_numero, destinatario_nome, codigo, data_hora ("dd/mm/aaaa HH:MM"),
sinais_edicao (lista de frases curtas em português), parece_ecra_real (true/false), risco (0-100), motivo (uma frase em português).
Usa null quando um campo não é legível. Não inventes valores.`;

const nowMaputo = (d: Date) => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', dateStyle: 'short', timeStyle: 'short' }).format(d);

/** Pede a análise à IA. null = indisponível (sem chave, limite, erro, resposta inválida). */
export async function analyseReceipt(img: { data: Buffer; contentType: string }, e: Expected, opts: { ocrText?: string | null; now?: Date } = {}): Promise<AiVerdict | null> {
  const now = opts.now ?? new Date();
  if (process.env.AI_RECEIPT_STUB === '1' && !process.env.VERCEL) return stub(e, opts.ocrText ?? '', now);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 40_000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT(e, nowMaputo(now)) }, { inline_data: { mime_type: img.contentType, data: img.data.toString('base64') } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!r.ok) { console.warn('[pagamento-ia] HTTP', r.status, (await r.text()).slice(0, 300)); return null; }
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = AiSchema.safeParse(JSON.parse(txt.replace(/^```(?:json)?|```$/g, '').trim()));
    return parsed.success ? parsed.data : null;
  } catch (err) { console.warn('[pagamento-ia]', (err as Error).message); return null; }
  finally { clearTimeout(timer); }
}

/** Simulador para testes locais (nunca na Vercel): lê o texto do comprovativo; "EDITADO"/"DUVIDA" no texto sobem o risco. */
function stub(e: Expected, text: string, now: Date): AiVerdict {
  const looksLikeReceipt = /\d\s*(MT|MZN)\b/i.test(text); // texto do OCR de uma imagem qualquer → campos esperados
  const f = looksLikeReceipt ? parseReceipt(text) : parseReceipt('');
  const up = text.toUpperCase();
  const risk = up.includes('EDITADO') ? 85 : up.includes('DUVIDA') ? 45 : 8;
  const dt = text.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\D{0,8}?(\d{1,2}[:hH]\d{2})/);
  return {
    operadora: f.method ?? e.method, valor: f.amount ?? e.price,
    destinatario_numero: f.phones[0] ?? e.accounts[0]?.number ?? null, destinatario_nome: e.accounts[0]?.name ?? null,
    codigo: f.transactionId ?? e.code, data_hora: dt ? `${dt[1]} ${dt[2]}` : nowMaputo(now).replace(',', ''),
    sinais_edicao: risk >= 30 ? ['números com fonte diferente'] : [], parece_ecra_real: risk < 70, risco: risk, motivo: risk >= 30 ? 'fonte dos números diferente' : 'formato normal',
  };
}
