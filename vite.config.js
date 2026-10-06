import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': PwaControls asks before reloading so unsaved forms are not lost.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'logo.jpg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'CEPEV · Gestión integral',
        short_name: 'CEPEV',
        description: 'CEPEV · Gestión integral de cocina, alojamientos, flota y colportores.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#007c98',
        background_color: '#f3f8fb',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell is cached; Supabase data always goes to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,woff,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          data: ['@supabase/supabase-js', '@tanstack/react-query'],
        },
      },
    },
  },
})
