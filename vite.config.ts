import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Vite puro (ADR-000): três entradas HTML independentes.
// - index.html  → landing, /login, /register, /app/*, /platform/*
// - track.html  → /track/* (página pública, bundle mínimo, sem código de /app)
// - driver.html → /driver/* (PWA do motorista)
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registado manualmente só em driver.html
      scope: '/driver/',
      manifest: {
        name: 'insightFrota Motorista',
        short_name: 'Motorista',
        start_url: '/driver/',
        scope: '/driver/',
        display: 'standalone',
        background_color: '#F5F7FA',
        theme_color: '#10243D',
        lang: 'pt-MZ',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
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
