import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
    filename: 'service-worker.js',
    registerType: 'autoUpdate',
    injectRegister: null,
    manifestFilename: 'manifest.json',
    includeAssets: ['favicon.svg', 'pwa-icon.svg'],
    manifest: {
      name: 'ServicePilot · Gestion de restaurant',
      short_name: 'ServicePilot',
      description: 'Commandes, salle, cuisine et caisse de votre restaurant.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#173f32',
      background_color: '#f3f7f3',
      icons: [{ src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      navigateFallback: '/index.html',
      cleanupOutdatedCaches: true,
    },
    devOptions: { enabled: true, type: 'module' },
  })],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
