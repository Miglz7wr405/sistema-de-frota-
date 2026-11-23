// Leitura do texto de um comprovativo / SMS de M-Pesa ou e-Mola: código da transação, valor, números e data.
// Usada no telemóvel (texto lido da fotografia, OCR) e no servidor (SMS reencaminhado do telemóvel do proprietário).
// ⚠️ Formatos reais NÃO testados: afinados com exemplos típicos ("Confirmado ABC123XYZ. Transferiste 250.00MT para…",
// "ID da transacao: …"). Ajustar quando houver SMS/comprovativos verdadeiros. A fotografia nunca aprova sozinha.

export type ReceiptFields = { transactionId: string | null; amount: number | null; phones: string[]; date: string | null; method: 'mpesa' | 'emola' | null };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Número de Moçambique → 9 dígitos (84xxxxxxx), sem +258. */
export function mzPhone(s: string): string | null {
  const d = s.replace(/\D/g, '');
  const m = d.match(/^(?:258)?(8[2-7]\d{7})$/);
  return m ? m[1]! : null;
}

export function parseReceipt(raw: string): ReceiptFields {
  const text = norm(raw).replace(/\r/g, '');
  const up = text.toUpperCase();
  const method: ReceiptFields['method'] = /M-?PESA|VODACOM/.test(up) ? 'mpesa' : /E-?MOLA|MOVITEL/.test(up) ? 'emola' : null;

  // código: depois de "Confirmado", "ID da transacao", "Transacao", "Ref"; senão um token com letras E números (8–12)
  let transactionId: string | null = null;
  const labelled = up.match(/(?:CONFIRMADO|ID\s*(?:DA\s*)?TRANSAC(?:AO|CAO)|TRANSAC(?:AO|CAO)|REF(?:ERENCIA)?)[\s.:#-]*([A-Z0-9]{8,14})\b/);
  if (labelled && /[A-Z]/.test(labelled[1]!) && /\d/.test(labelled[1]!)) transactionId = labelled[1]!;
  if (!transactionId) {
    for (const tok of up.match(/\b[A-Z0-9]{8,12}\b/g) ?? []) {
      if (/[A-Z]/.test(tok) && /\d/.test(tok) && !/^(258)?8[2-7]\d{7}$/.test(tok)) { transactionId = tok; break; }
    }
  }

  // valor: "250.00MT", "250,00 MT", "MZN 250", "Valor: 250"
  let amount: number | null = null;
  const am = up.match(/(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{1,2})?)\s*(?:MT|MZN)\b/) ?? up.match(/(?:MZN|VALOR|MONTANTE)[\s:]*(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{1,2})?)/);
  if (am) {
    let v = am[1]!.replace(/\s/g, '');
    // "1.250,00" / "1,250.00" / "250.00" / "250,00"
    if (/[.,]\d{1,2}$/.test(v)) { const dec = v.slice(-3).replace(/^[.,]/, '.'); v = v.slice(0, -3).replace(/[.,]/g, '') + (dec.startsWith('.') ? dec : '.' + dec.slice(1)); }
    else v = v.replace(/[.,]/g, '');
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) amount = Math.round(n * 100) / 100;
  }

  const phones = [...new Set((text.match(/(?:\+?258[\s-]?)?8[2-7](?:[\s-]?\d){7}/g) ?? []).map(mzPhone).filter((x): x is string => !!x))];
  const dm = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  const date = dm ? `${dm[1]!.padStart(2, '0')}/${dm[2]!.padStart(2, '0')}/${dm[3]!.length === 2 ? `20${dm[3]}` : dm[3]}` : null;
  return { transactionId, amount, phones, date, method };
}

/** Data do comprovativo (dd/mm/aaaa) há mais de `hours` horas? Sem data lida → null (não se sabe). */
export function receiptTooOld(date: string | null, now = Date.now(), hours = 48): boolean | null {
  if (!date) return null;
  const [d, m, y] = date.split('/').map(Number);
  const t = Date.UTC(y!, m! - 1, d!, 23, 59);
  if (!Number.isFinite(t)) return null;
  return now - t > hours * 3600_000;
}
