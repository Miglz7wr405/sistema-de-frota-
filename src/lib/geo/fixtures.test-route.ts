// ROTA SINTÉTICA PARA TESTES — não representa nenhuma estrada real.
// Coordenadas geradas por uma função (zig-zag suave) para exercitar o motor; nomes "Localidade A…E" fictícios.
import type { LngLat } from './geometry';
import { cumulative } from './geometry';
import type { RouteModel } from './progress';

export function syntheticRoute(): RouteModel {
  const coords: LngLat[] = [];
  // ~ 300 km para sudoeste, com curvas
  for (let i = 0; i <= 600; i++) {
    const f = i / 600;
    coords.push([36.9 - f * 2.0 + Math.sin(f * 12) * 0.05, -17.9 - f * 1.8 + Math.cos(f * 9) * 0.04]);
  }
  const cum = cumulative(coords);
  const lengthM = cum[cum.length - 1]!;
  const km = (f: number) => (lengthM * f) / 1000;
  return {
    coords, cum, lengthM, plannedDurationS: (lengthM / 1000 / 55) * 3600,
    places: [
      { placeId: 'A', name: 'Localidade A', kind: 'city', importance: 5, provinceId: 'P1', provinceName: 'Província Um', kmFromOrigin: 0 },
      { placeId: 'B', name: 'Localidade B', kind: 'town', importance: 3, provinceId: 'P1', provinceName: 'Província Um', kmFromOrigin: km(0.12) },
      { placeId: 'V', name: 'Aldeia V', kind: 'village', importance: 2, provinceId: 'P1', provinceName: 'Província Um', kmFromOrigin: km(0.3) },
      { placeId: 'C', name: 'Localidade C', kind: 'town', importance: 4, provinceId: 'P2', provinceName: 'Província Dois', kmFromOrigin: km(0.55) },
      { placeId: 'D', name: 'Localidade D', kind: 'town', importance: 3, provinceId: 'P2', provinceName: 'Província Dois', kmFromOrigin: km(0.8) },
      { placeId: 'E', name: 'Localidade E', kind: 'city', importance: 5, provinceId: 'P2', provinceName: 'Província Dois', kmFromOrigin: km(1) },
    ],
  };
}
