import { describe, expect, it } from 'vitest';
import { mzPhone, parseReceipt, receiptTooOld } from './receipt';

describe('leitura de comprovativos e SMS (formatos típicos; reais por confirmar)', () => {
  it('M-Pesa: código depois de "Confirmado", valor com MT, número de destino e data', () => {
    const r = parseReceipt('Confirmado DK45H7GT2P. Transferiste 250.00MT para 258841234567 - JOAO SILVA aos 23/11/26 as 14:05. Saldo 1.020,50MT');
    expect(r).toMatchObject({ transactionId: 'DK45H7GT2P', amount: 250, date: '23/11/2026' });
    expect(r.phones).toContain('841234567');
  });
  it('e-Mola: "ID da transação", valor com vírgula e MZN', () => {
    const r = parseReceipt('e-Mola\nTransferência efetuada\nValor: 250,00 MZN\nPara: 86 123 4567\nID da Transação: PP251123.1405.A12345\nData: 23-11-2026');
    expect(r.method).toBe('emola');
    expect(r.amount).toBe(250);
    expect(r.phones).toContain('861234567');
    expect(r.date).toBe('23/11/2026');
  });
  it('SMS de quem recebe: "Recebeste 1.250,00MT de …"', () => {
    const r = parseReceipt('ABC12DEF34 Confirmado. Recebeste 1.250,00MT de 258879998877 - ANA aos 23/11/26');
    expect(r.amount).toBe(1250);
    expect(r.transactionId).toBe('ABC12DEF34');
  });
  it('fotografia que não é comprovativo: sem código nem valor', () => {
    expect(parseReceipt('Feliz aniversário Maria!')).toMatchObject({ transactionId: null, amount: null });
  });
  it('números e datas', () => {
    expect(mzPhone('+258 84 123 4567')).toBe('841234567');
    expect(mzPhone('123')).toBeNull();
    expect(receiptTooOld('01/01/2026', Date.UTC(2026, 10, 23))).toBe(true);
    expect(receiptTooOld('23/11/2026', Date.UTC(2026, 10, 23, 15))).toBe(false);
    expect(receiptTooOld(null)).toBeNull();
  });
});
