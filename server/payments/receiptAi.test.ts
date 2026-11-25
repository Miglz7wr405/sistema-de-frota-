import { describe, expect, it } from 'vitest';
import { decide, parseMaputoDateTime, type AiVerdict, type Expected } from './receiptAi';

const now = new Date(Date.UTC(2026, 10, 25, 8, 0)); // 10:00 em Maputo
const e: Expected = { price: 250, code: 'DK45H7GT2P', method: 'mpesa', accounts: [{ number: '841112223', name: 'Minoria Dono' }, { number: '861112223', name: 'Maria Chanzina' }] };
const good: AiVerdict = { operadora: 'M-Pesa', valor: 250, destinatario_numero: '841112223', destinatario_nome: 'MINORIA', codigo: 'DK45H7GT2P',
  data_hora: '25/11/2026 09:40', sinais_edicao: [], parece_ecra_real: true, risco: 8, motivo: 'formato normal' };

describe('comprovativo: hora de Maputo', () => {
  it('lê formatos comuns como UTC+2', () => {
    expect(parseMaputoDateTime('25/11/2026 09:40')?.toISOString()).toBe('2026-11-25T07:40:00.000Z');
    expect(parseMaputoDateTime('25/11/26 às 09:40:12')?.toISOString()).toBe('2026-11-25T07:40:12.000Z');
    expect(parseMaputoDateTime('2026-11-25 09:40')?.toISOString()).toBe('2026-11-25T07:40:00.000Z');
    expect(parseMaputoDateTime('ontem')).toBeNull();
    expect(parseMaputoDateTime('32/13/2026 25:00')).toBeNull();
  });
});

describe('comprovativo: decisão', () => {
  it('tudo certo e sem sinais de edição → aprovado', () => expect(decide(good, e, now).status).toBe('aprovado'));
  it('sem análise da IA → em análise (nunca aprova sozinho)', () => expect(decide(null, e, now).status).toBe('pendente'));
  it('valor errado → rejeitado', () => expect(decide({ ...good, valor: 25 }, e, now)).toMatchObject({ status: 'rejeitado', reason: expect.stringContaining('25 MT') }));
  it('outro número → rejeitado', () => expect(decide({ ...good, destinatario_numero: '849990000' }, e, now).status).toBe('rejeitado'));
  it('número escondido mas nome certo → aprovado; nome desconhecido → em análise', () => {
    expect(decide({ ...good, destinatario_numero: '84****223', destinatario_nome: 'MARIA CHANZINA' }, e, now).status).toBe('aprovado');
    expect(decide({ ...good, destinatario_numero: null, destinatario_nome: 'JOAO X' }, e, now).status).toBe('pendente');
  });
  it('código diferente → em análise', () => expect(decide({ ...good, codigo: 'ZZ99XX88YY' }, e, now).status).toBe('pendente'));
  it('hora: futuro e > 24 h → rejeitado; 1–24 h → em análise', () => {
    expect(decide({ ...good, data_hora: '25/11/2026 11:00' }, e, now).status).toBe('rejeitado');
    expect(decide({ ...good, data_hora: '23/11/2026 09:00' }, e, now).status).toBe('rejeitado');
    expect(decide({ ...good, data_hora: '25/11/2026 07:30' }, e, now).status).toBe('pendente');
    expect(decide({ ...good, data_hora: null }, e, now).status).toBe('pendente');
  });
  it('edição: risco alto → rejeitado; médio ou sinais → em análise', () => {
    expect(decide({ ...good, risco: 85, sinais_edicao: ['valor com fonte diferente'] }, e, now).status).toBe('rejeitado');
    expect(decide({ ...good, risco: 45 }, e, now).status).toBe('pendente');
    expect(decide({ ...good, sinais_edicao: ['fundo manchado'] }, e, now).status).toBe('pendente');
    expect(decide({ ...good, parece_ecra_real: false }, e, now).status).toBe('pendente');
  });
  it('valor lido no telemóvel diferente do lido pela IA → em análise', () => expect(decide(good, { ...e, clientAmount: 2500 }, now).status).toBe('pendente'));
});
