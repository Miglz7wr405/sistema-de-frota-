// Implementação MapLibre GL + tiles vetoriais OpenStreetMap servidos pelo OpenFreeMap (ADR-014).
// ⚠️ DEPENDÊNCIA EXTERNA: tiles.openfreemap.org — gratuito, sem chave, sem SLA. Trocar = mudar STYLE_URL ou o provider.
import type { MapHandle, MapProvider, MapState, LngLat, VehicleMarker, PointMarker } from './types';

const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';
const COLORS = { primary: '#1769E8', success: '#16A36A', muted: '#94A3B8', danger: '#C62828' };

const truckSvg = (color: string) => `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="16" fill="${color}" fill-opacity="0.18"/>
<circle cx="17" cy="17" r="11" fill="${color}" stroke="#fff" stroke-width="2"/><path d="M17 9 L22 21 L17 18.5 L12 21 Z" fill="#fff"/></svg>`;

export const maplibreProvider: MapProvider = {
  async create(container, opts) {
    const [{ default: maplibregl }] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
    const map = new maplibregl.Map({
      container, style: STYLE_URL, center: opts.center ?? [35.5, -18.7], zoom: opts.zoom ?? 5.2, interactive: opts.interactive ?? true,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    await new Promise<void>((r) => (map.loaded() ? r() : map.once('load', () => r())));

    const lineSrc = (id: string, color: string, dashed: boolean, width: number, opacity = 1) => {
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity, ...(dashed ? { 'line-dasharray': [1, 2] } : {}) } });
    };
    lineSrc('route-left', COLORS.primary, true, 4, 0.55);
    lineSrc('route-done', COLORS.primary, false, 5);
    lineSrc('extra', '#0F172A', false, 3, 0.7);
    const setLine = (id: string, coords: LngLat[] | null | undefined) =>
      (map.getSource(id) as maplibregl.GeoJSONSource).setData(coords && coords.length > 1
        ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : { type: 'FeatureCollection', features: [] });

    const vMarkers = new Map<string, { m: maplibregl.Marker; el: HTMLDivElement; from: LngLat; to: LngLat; t0: number }>();
    const pMarkers = new Map<string, maplibregl.Marker>();
    let vehicleClick: ((id: string) => void) | null = null;
    let raf = 0;
    const ANIM_MS = 1500; // movimento suave do camião (única animação obrigatória)
    const tick = () => {
      const now = performance.now();
      let active = false;
      for (const v of vMarkers.values()) {
        const k = Math.min(1, (now - v.t0) / ANIM_MS);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        v.m.setLngLat([v.from[0] + (v.to[0] - v.from[0]) * e, v.from[1] + (v.to[1] - v.from[1]) * e]);
        if (k < 1) active = true;
      }
      raf = active ? requestAnimationFrame(tick) : 0;
    };

    const renderVehicle = (el: HTMLDivElement, v: VehicleMarker) => {
      el.innerHTML = `<div style="transform: rotate(${v.heading ?? 0}deg); width:34px; height:34px">${truckSvg(COLORS[v.tone])}</div>` +
        (v.label ? `<div style="position:absolute; left:38px; top:2px; background:#fff; border:1px solid #E2E8F0; border-radius:10px; padding:3px 8px; white-space:nowrap; font: 600 12px Inter,system-ui; color:#10243D; box-shadow:0 1px 2px rgba(16,36,61,.08)">${esc(v.label)}${v.sublabel ? `<div style="font-weight:500; color:${v.tone === 'danger' ? COLORS.danger : v.tone === 'success' ? '#0F7A4F' : '#64748B'}">${esc(v.sublabel)}</div>` : ''}</div>` : '');
    };
    const pointEl = (p: PointMarker) => {
      const el = document.createElement('div');
      const color = p.kind === 'origin' ? COLORS.success : p.kind === 'destination' ? COLORS.danger : p.kind === 'passed' ? COLORS.primary : '#fff';
      el.innerHTML = `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:3px solid ${p.kind === 'waypoint' || p.kind === 'place' ? COLORS.primary : '#fff'};box-shadow:0 0 0 1px rgba(16,36,61,.2)"></div>` +
        (p.label ? `<div style="position:absolute;top:16px;left:50%;transform:translateX(-50%);background:#fff;border-radius:8px;padding:2px 7px;font:600 12px Inter,system-ui;color:#10243D;white-space:nowrap;box-shadow:0 1px 2px rgba(16,36,61,.15)">${esc(p.label)}</div>` : '');
      return el;
    };

    const handle: MapHandle = {
      update(s: MapState) {
        if (s.routeDone !== undefined) setLine('route-done', s.routeDone);
        if (s.routeLeft !== undefined) setLine('route-left', s.routeLeft);
        if (s.extraLine !== undefined) setLine('extra', s.extraLine);
        if (s.vehicles) {
          const keep = new Set(s.vehicles.map((v) => v.id));
          for (const [id, v] of vMarkers) if (!keep.has(id)) { v.m.remove(); vMarkers.delete(id); }
          for (const v of s.vehicles) {
            const ex = vMarkers.get(v.id);
            if (ex) {
              const cur = ex.m.getLngLat();
              ex.from = [cur.lng, cur.lat]; ex.to = [v.lng, v.lat]; ex.t0 = performance.now();
              renderVehicle(ex.el, v);
            } else {
              const el = document.createElement('div');
              el.style.position = 'relative'; el.style.cursor = 'pointer';
              el.addEventListener('click', (e) => { e.stopPropagation(); vehicleClick?.(v.id); });
              renderVehicle(el, v);
              const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([v.lng, v.lat]).addTo(map);
              vMarkers.set(v.id, { m, el, from: [v.lng, v.lat], to: [v.lng, v.lat], t0: 0 });
            }
          }
          if (!raf) raf = requestAnimationFrame(tick);
        }
        if (s.points) {
          for (const m of pMarkers.values()) m.remove();
          pMarkers.clear();
          for (const p of s.points) pMarkers.set(p.id, new maplibregl.Marker({ element: pointEl(p), anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map));
        }
      },
      fit(coords, padding = 60) {
        if (!coords.length) return;
        if (coords.length === 1) { map.easeTo({ center: coords[0], zoom: 11, duration: 0 }); return; }
        const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
        for (const c of coords) b.extend(c);
        map.fitBounds(b, { padding, duration: 0, maxZoom: 13 });
      },
      onClick(cb) { map.on('click', (e) => cb([e.lngLat.lng, e.lngLat.lat])); },
      onVehicleClick(cb) { vehicleClick = cb; },
      resize() { map.resize(); },
      destroy() { cancelAnimationFrame(raf); map.remove(); },
    };
    return handle;
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
