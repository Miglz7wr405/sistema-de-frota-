import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { clipFor, districtEvents, phrase, seedSaid, slugify, type RouteDistrict } from './districtVoice';
import manifest from './voz-manifest.json';

const R: RouteDistrict[] = [
  { code: 'q', name: 'Cidade de Quelimane', province: 'Zambézia', km: 0 },
  { code: 'n', name: 'Nicoadala', province: 'Zambézia', km: 12 },
  { code: 'm', name: 'Namacurra', province: 'Zambézia', km: 60 },
  { code: 'b', name: 'Cidade da Beira', province: 'Sofala', km: 640 },
];

describe('voz dos distritos', () => {
  it('frases em português, distrito e cidade', () => {
    expect(phrase('chegou', 'Nicoadala')).toBe('Chegou ao distrito de Nicoadala.');
    expect(phrase('falta', 'Nicoadala')).toBe('Falta pouco para chegar ao distrito de Nicoadala.');
    expect(phrase('chegou', 'Cidade da Beira')).toBe('Chegou à cidade da Beira.');
    expect(phrase('falta', 'Cidade de Quelimane')).toBe('Falta pouco para chegar à cidade de Quelimane.');
    expect(slugify('Alto Molócuè')).toBe('alto-molocue');
  });
  it('anuncia "falta pouco" 5 km antes e "chegou" ao entrar, uma só vez, por ordem', () => {
    const said = seedSaid(R, 0);
    expect(districtEvents(R, 3, said)).toEqual([]); // o distrito de partida não se anuncia
    expect(districtEvents(R, 7.5, said).map((e) => `${e.kind}:${e.district.name}`)).toEqual(['falta:Nicoadala']);
    expect(districtEvents(R, 9, said)).toEqual([]);
    expect(districtEvents(R, 12.2, said).map((e) => `${e.kind}:${e.district.name}`)).toEqual(['chegou:Nicoadala']);
    expect(districtEvents(R, 12.5, said)).toEqual([]);
    expect(districtEvents(R, 56, said).map((e) => e.kind)).toEqual(['falta']);
    // GPS saltou por cima (sem rede): diz que chegou, sem o "falta pouco" atrasado
    expect(districtEvents(R, 641, said).map((e) => `${e.kind}:${e.district.name}`)).toEqual(['chegou:Namacurra', 'chegou:Cidade da Beira']);
  });
  it('ao abrir a meio da viagem não repete os distritos que ficaram para trás', () => {
    const said = seedSaid(R, 58);
    expect(districtEvents(R, 58.5, said)).toEqual([]);
    expect(districtEvents(R, 60.1, said).map((e) => e.district.name)).toEqual(['Namacurra']);
  });
  it('sem km (sem GPS) não diz nada', () => { expect(districtEvents(R, null, seedSaid(R, null))).toEqual([]); });
  it('gravações ElevenLabs: o manifesto só lista ficheiros que existem; sem gravação usa a voz do telemóvel', () => {
    expect(clipFor('chegou', 'Nicoadala')).toBe('/voz/nicoadala-chegou.mp3');
    expect(clipFor('falta', 'Cidade de Quelimane')).toBe('/voz/cidade-de-quelimane-falta.mp3');
    expect(clipFor('chegou', 'Distrito Sem Gravação')).toBeNull();
    for (const c of manifest.clips) expect(existsSync(`public/voz/${c}.mp3`)).toBe(true);
  });
});
