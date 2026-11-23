// Implementação MapLibre GL + tiles vetoriais OpenStreetMap servidos pelo OpenFreeMap (ADR-014).
// ⚠️ DEPENDÊNCIA EXTERNA: tiles.openfreemap.org — gratuito, sem chave, sem SLA. Trocar = mudar STYLE_URL ou o provider.
import type { MapHandle, MapProvider, MapState, LngLat, VehicleMarker, PointMarker } from './types';

const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';
// Mapa de reserva se o principal não carregar (rede bloqueada, serviço em baixo): tiles raster OpenStreetMap.
// ⚠️ DEPENDÊNCIA EXTERNA: tile.openstreetmap.org — gratuito, uso moderado, atribuição obrigatória, sem SLA.
const FALLBACK_STYLE = {
  version: 8 as const,
  sources: { osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};
const LOAD_TIMEOUT_MS = 10_000;
const COLORS = { primary: '#1769E8', success: '#16A36A', muted: '#94A3B8', danger: '#C62828' };

// Camião visto de lado, sempre direito, dentro de um círculo com uma ponta em baixo (alfinete).
// A ponta (fundo do elemento, anchor 'bottom') é a coordenada: o camião fica sempre EM CIMA da estrada.
const TRUCK_W = 40, TRUCK_H = 48;
const truckSvg = (color: string) => `<svg width="${TRUCK_W}" height="${TRUCK_H}" viewBox="0 0 40 48" aria-hidden="true" style="display:block; filter:drop-shadow(0 1px 2px rgba(16,36,61,.35))">
<path d="M13 33 L20 47 L27 33 Z" fill="${color}"/>
<circle cx="20" cy="19" r="17" fill="${color}" stroke="#fff" stroke-width="2.5"/>
<rect x="7" y="11.5" width="16" height="11" rx="1.5" fill="#fff"/>
<path d="M24.5 14.5 h4.6 a1.5 1.5 0 0 1 1.2.6 l2.6 3.6 a1.5 1.5 0 0 1 .3.9 v2.9 h-8.7 z" fill="#fff"/>
<path d="M26.3 16 h2.5 l2 2.8 h-4.5 z" fill="${color}"/>
<circle cx="12" cy="24.5" r="2.7" fill="${color}" stroke="#fff" stroke-width="1.6"/>
<circle cx="28" cy="24.5" r="2.7" fill="${color}" stroke="#fff" stroke-width="1.6"/>
</svg>`;

// Aproximado (zoom alto): camião pequeno, sem círculo, em cima da estrada — não tapa os nomes das localidades.
// Afastado: o alfinete grande (vê-se bem no país inteiro).
const MINI_ZOOM = 8;
const miniTruckSvg = (color: string) => `<svg width="26" height="17" viewBox="0 0 26 17" aria-hidden="true" style="display:block; filter:drop-shadow(0 1px 1.5px rgba(16,36,61,.45))">
<rect x="1" y="2" width="14" height="10" rx="1.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>
<path d="M15.5 5h4.3c.45 0 .87.2 1.15.55l2.7 3.4c.22.27.35.6.35.95v2.1H15.5z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M17.3 6.4h2.2l1.8 2.4h-4z" fill="#fff" fill-opacity=".9"/>
<circle cx="5.5" cy="13.6" r="2.1" fill="#10243D" stroke="#fff" stroke-width="1.2"/><circle cx="19.5" cy="13.6" r="2.1" fill="#10243D" stroke="#fff" stroke-width="1.2"/>
</svg>`;
const TRUCK_CSS = `.if-area-label{font:700 10.5px Inter,system-ui;letter-spacing:.06em;text-transform:uppercase;color:#334155;
text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;white-space:nowrap;pointer-events:none;z-index:0!important}
.if-areas-hidden .if-area-label{display:none}
.if-truck-mini{display:none;position:absolute;left:50%;bottom:0;transform:translate(-50%,50%)}
.if-trucks-small .if-truck-pin{display:none}.if-trucks-small .if-truck-mini{display:block}
.if-trucks-small .if-truck-label{top:auto!important;bottom:-10px;left:${TRUCK_W / 2 + 16}px!important}`;

export const maplibreProvider: MapProvider = {
  async create(container, opts) {
    const [{ default: maplibregl }] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
    const make = (style: string | typeof FALLBACK_STYLE) => new maplibregl.Map({
      container, style: style as maplibregl.StyleSpecification | string, center: opts.center ?? [35.5, -18.7], zoom: opts.zoom ?? 5.2,
      interactive: opts.interactive ?? true, attributionControl: { compact: true },
    });
    // Espera pelo estilo com tempo limite; se falhar, tenta o mapa de reserva (nunca fica "a carregar" para sempre).
    const waitLoad = (m: maplibregl.Map) => new Promise<void>((resolve, reject) => {
      if (m.loaded()) return resolve();
      const t = setTimeout(() => reject(new Error('tempo_esgotado')), LOAD_TIMEOUT_MS);
      m.once('load', () => { clearTimeout(t); resolve(); });
      m.on('error', (e) => { if (!m.isStyleLoaded()) { clearTimeout(t); reject(e.error ?? new Error('erro_estilo')); } });
    });
    let map = make(STYLE_URL);
    try { await waitLoad(map); }
    catch (e) {
      console.warn('[mapa] estilo principal falhou, a usar o mapa de reserva:', (e as Error)?.message);
      map.remove();
      map = make(FALLBACK_STYLE);
      await waitLoad(map);
    }
    // projeção ecrã↔coordenadas acessível ao teste E2E (verifica que o camião é desenhado na coordenada certa)
    // camião pequeno quando o mapa está aproximado (não tapa os nomes); alfinete quando afastado
    if (!document.getElementById('if-truck-css')) { const st = document.createElement('style'); st.id = 'if-truck-css'; st.textContent = TRUCK_CSS; document.head.appendChild(st); }
    const sizeTrucks = () => {
      (container as HTMLElement).classList.toggle('if-trucks-small', map.getZoom() >= MINI_ZOOM);
      // nomes dos distritos só a partir de um zoom em que cabem (no país inteiro ficariam uns por cima dos outros)
      (container as HTMLElement).classList.toggle('if-areas-hidden', map.getZoom() < 6);
    };
    map.on('zoom', sizeTrucks); map.on('load', sizeTrucks); sizeTrucks();
    (container as HTMLElement & { __zoom?: () => number }).__zoom = () => map.getZoom();
    (container as HTMLElement & { __project?: (ll: LngLat) => { x: number; y: number } }).__project = (ll) => map.project(ll);
    // créditos do mapa (obrigatórios pela licença do OpenStreetMap) só no botão "i", fechado: o mapa fica limpo
    const closeAttrib = () => container.querySelectorAll('.maplibregl-ctrl-attrib').forEach((el) => { el.classList.remove('maplibregl-compact-show'); el.removeAttribute('open'); });
    closeAttrib(); map.once('idle', closeAttrib); map.on('resize', () => setTimeout(closeAttrib, 0)); setTimeout(closeAttrib, 1500);
    if (opts.controls !== false) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const lineSrc = (id: string, color: string, dashed: boolean, width: number, opacity = 1) => {
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity, ...(dashed ? { 'line-dasharray': [1, 2] } : {}) } });
    };
    // limites dos distritos (por baixo da rota): cinzento, tracejado fino
    map.addSource('areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'areas', type: 'line', source: 'areas', layout: { 'line-join': 'round' },
      paint: { 'line-color': '#475569', 'line-width': 1.3, 'line-opacity': 0.55, 'line-dasharray': [3, 2] } });
    lineSrc('route-left', COLORS.primary, true, 4, 0.55);
    lineSrc('route-done', COLORS.primary, false, 5);
    lineSrc('extra', '#0F172A', false, 3, 0.7);
    const setLine = (id: string, coords: LngLat[] | null | undefined) =>
      (map.getSource(id) as maplibregl.GeoJSONSource).setData(coords && coords.length > 1
        ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : { type: 'FeatureCollection', features: [] });

    const vMarkers = new Map<string, { m: maplibregl.Marker; el: HTMLDivElement; from: LngLat; to: LngLat; t0: number }>();
    const pMarkers = new Map<string, maplibregl.Marker>();
    const aMarkers: maplibregl.Marker[] = [];
    let lastAreas: unknown = undefined; // só redesenha os distritos quando a lista muda (não a cada posição)
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
      // camião sempre direito (não roda com o rumo do GPS; o rumo continua guardado nos dados)
      el.innerHTML = `<div class="if-truck-pin">${truckSvg(COLORS[v.tone])}</div><div class="if-truck-mini">${miniTruckSvg(COLORS[v.tone])}</div>` +
        (v.label ? `<div class="if-truck-label" style="position:absolute; left:${TRUCK_W + 4}px; top:4px; background:#fff; border:1px solid #E2E8F0; border-radius:10px; padding:3px 8px; white-space:nowrap; font: 600 12px Inter,system-ui; color:#10243D; box-shadow:0 1px 2px rgba(16,36,61,.08)">${esc(v.label)}${v.sublabel ? `<div style="font-weight:500; color:${v.tone === 'danger' ? COLORS.danger : v.tone === 'success' ? '#0F7A4F' : '#64748B'}">${esc(v.sublabel)}</div>` : ''}</div>` : '');
    };
    const pointEl = (p: PointMarker) => {
      const el = document.createElement('div');
      el.style.width = '14px'; el.style.height = '14px';
      const color = p.kind === 'origin' ? COLORS.success : p.kind === 'destination' ? COLORS.danger : p.kind === 'passed' ? COLORS.primary : '#fff';
      el.innerHTML = `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:3px solid ${p.kind === 'waypoint' || p.kind === 'place' ? COLORS.primary : '#fff'};box-shadow:0 0 0 1px rgba(16,36,61,.2)"></div>` +
        (p.label ? `<div style="position:absolute;top:16px;left:50%;transform:translateX(-50%);background:#fff;border-radius:8px;padding:2px 7px;font:600 12px Inter,system-ui;color:#10243D;white-space:nowrap;box-shadow:0 1px 2px rgba(16,36,61,.15)">${esc(p.label)}</div>` : '');
      return el;
    };

    const handle: MapHandle = {
      update(s: MapState) {
        if (s.areas !== undefined && s.areas !== lastAreas) {
          lastAreas = s.areas;
          (map.getSource('areas') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection',
            features: (s.areas ?? []).filter((a) => a.boundary).map((a) => ({ type: 'Feature', properties: { name: a.name }, geometry: a.boundary as GeoJSON.Geometry })) });
          for (const m of aMarkers.splice(0)) m.remove();
          for (const a of s.areas ?? []) {
            const el = document.createElement('div');
            el.className = 'if-area-label';
            el.textContent = a.name;
            aMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(a.label).addTo(map));
          }
        }
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
              // NUNCA mudar 'position' do elemento: o MapLibre posiciona-o com position:absolute + transform.
              el.style.width = `${TRUCK_W}px`; el.style.height = `${TRUCK_H}px`; el.style.cursor = 'pointer'; el.style.zIndex = '2'; // camião por cima dos pontos
              el.addEventListener('click', (e) => { e.stopPropagation(); vehicleClick?.(v.id); });
              renderVehicle(el, v);
              const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([v.lng, v.lat]).addTo(map);
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
      fit(coords, padding = 60, durationMs = 0) {
        if (!coords.length) return;
        if (coords.length === 1) { map.easeTo({ center: coords[0], zoom: 11, duration: durationMs }); return; }
        const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
        for (const c of coords) b.extend(c);
        // com duração: animação suave de aproximar/afastar (a única animação além do movimento do camião)
        map.fitBounds(b, { padding, duration: durationMs, maxZoom: 13, essential: true });
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
