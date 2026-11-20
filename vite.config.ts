import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Vite puro (ADR-000): três entradas HTML independentes.
// - index.html  → landing, /login, /register, /app/*, /platform/*
// - track.html  → /track/* (página pública, bundle mínimo, sem código de /app)
// - driver.html → /driver/* (PWA do motorista)
// Em desenvolvimento/pré-visualização, faz o mesmo que as rotas da Vercel: /track/* → track.html, /driver/* → driver.html.
const mpaRewrite = (): Plugin => {
  const mw = (req: { url?: string }, _res: unknown, next: () => void) => {
    const u = req.url ?? '';
    if (/^\/track(\/|\?|$)/.test(u) && !u.startsWith('/track.html')) req.url = '/track.html' + (u.includes('?') ? u.slice(u.indexOf('?')) : '');
    else if (/^\/driver(\/|\?|$)/.test(u) && !u.startsWith('/driver.html')) req.url = '/driver.html' + (u.includes('?') ? u.slice(u.indexOf('?')) : '');
    next();
  };
  return { name: 'mpa-rewrite', configureServer: (s) => { s.middlewares.use(mw); }, configurePreviewServer: (s) => { s.middlewares.use(mw); } };
};

export default defineConfig({
  plugins: [
    mpaRewrite(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registado manualmente só em driver.html
      scope: '/driver/',
      manifest: false, // manifest próprio em public/manifest.webmanifest, ligado só em driver.html
      workbox: {
        navigateFallback: '/driver.html',
        navigateFallbackAllowlist: [/^\/driver/],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Tiles e estilos do mapa: cache para funcionar no corredor sem rede.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/t/': 'http://localhost:3001' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3001', '/t/': 'http://localhost:3001', '/__test': 'http://localhost:3001' } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        track: fileURLToPath(new URL('./track.html', import.meta.url)),
        driver: fileURLToPath(new URL('./driver.html', import.meta.url)),
      },
    },
  },
});
