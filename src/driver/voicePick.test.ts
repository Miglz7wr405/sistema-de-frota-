import { describe, expect, it } from 'vitest';
import { pickVoice } from './voicePick';

describe('escolha da voz do telemóvel', () => {
  it('prefere a voz masculina em português (Portugal) se existir', () => {
    const vs = [{ name: 'Google português do Brasil', lang: 'pt-BR' }, { name: 'pt-pt-x-sfs-local', lang: 'pt-PT' }, { name: 'pt-pt-x-jmn-local', lang: 'pt-PT' }, { name: 'English', lang: 'en-US' }];
    expect(pickVoice(vs)).toEqual({ voice: vs[2], male: true });
  });
  it('sem voz masculina: a primeira em português, com Portugal antes do Brasil', () => {
    const vs = [{ name: 'Luciana', lang: 'pt-BR' }, { name: 'Joana', lang: 'pt_PT' }];
    expect(pickVoice(vs)).toEqual({ voice: vs[1], male: false });
  });
  it('sem vozes em português: nenhuma', () => {
    expect(pickVoice([{ name: 'Samantha', lang: 'en-US' }])).toEqual({ voice: null, male: false });
  });
});
