import { describe, expect, it } from 'vitest';
import { parseTrace } from './matching';
import { speedTrend } from '../src/features/tracking/RouteStrip';

describe('ajuste à estrada (Valhalla trace_attributes)', () => {
  it('usa o último ponto ajustado e a sua estrada; limite só se etiquetado', () => {
    const m = parseTrace({
      edges: [{ names: ['EN6'], speed_limit: 100, road_class: 'trunk' }, { names: ['Av. Eduardo Mondlane'], speed_limit: 0, road_class: 'secondary' }],
      matched_points: [{ lat: -19.83, lon: 34.84, type: 'matched', edge_index: 0 }, { lat: -19.831, lon: 34.841, type: 'matched', edge_index: 1 }, { lat: -19.9, lon: 34.9, type: 'unmatched' }],
    });
    expect(m).toEqual({ lat: -19.831, lng: 34.841, roadName: 'Av. Eduardo Mondlane', speedLimitKmh: null, roadClass: 'secondary' });
  });
  it('sem nome nem limite → null (nunca inventa)', () => {
    expect(parseTrace({ edges: [{}], matched_points: [{ lat: 1, lon: 2, type: 'matched', edge_index: 0 }] })).toMatchObject({ roadName: null, speedLimitKmh: null });
    expect(parseTrace({ edges: [], matched_points: [{ lat: 1, lon: 2, type: 'unmatched' }] })).toBeNull();
    expect(parseTrace({})).toBeNull();
  });
});

describe('tendência da velocidade', () => {
  it('a acelerar, a reduzir, estável, parado, sem dados', () => {
    expect(speedTrend([20, 25, 32, 40, 48])).toBe('accelerating');
    expect(speedTrend([80, 75, 66, 55, 40])).toBe('slowing');
    expect(speedTrend([60, 61, 59, 60, 61])).toBe('steady');
    expect(speedTrend([10, 5, 1])).toBe('stopped');
    expect(speedTrend([50, 60])).toBeNull();
    expect(speedTrend(null)).toBeNull();
  });
});
