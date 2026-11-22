import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Snapcut — private clip generator',
        short_name: 'Snapcut',
        description: 'Find and export 9:16 clips from your videos, entirely in your browser.',
        theme_color: '#0b0b12',
        background_color: '#0b0b12',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@ffmpeg')) return 'ffmpeg';
          if (id.includes('@mediapipe')) return 'mediapipe';
          if (id.includes('mediabunny')) return 'mediabunny';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  server: {
    proxy: {
      '/health': 'http://127.0.0.1:8787',
      '/transcribe': 'http://127.0.0.1:8787',
      '/highlights': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'worker/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    server: { deps: { inline: ['mediabunny'] } },
  },
});
