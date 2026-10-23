/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const sharedModules = fileURLToPath(
  new URL('../../packages/shared/node_modules', import.meta.url),
).replace(/\\/g, '/');

// The Mobile_PWA is installable and offline-capable (Requirement 4).
//
// - `VitePWA` emits a Web App Manifest so the app can be installed to the
//   device home screen (R4.1) and launched standalone/full-screen (R4.2).
// - Workbox generates a Service Worker that precaches the built app shell
//   (HTML/CSS/JS + icons) so the capture UI opens and runs with no network
//   (R4.3). `navigateFallback` serves the cached shell for any navigation
//   request while offline.
//
// The plugin is only active for `serve`/`build`. It is not needed for the
// Vitest (jsdom) test run and is left out there to keep the test environment
// free of Service Worker / manifest side effects.
export default defineConfig(({ mode }) => ({
  // Dedicated dev port for the Mobile_PWA so it never collides with other
  // locally running apps. strictPort makes a taken port fail loudly instead
  // of silently drifting onto another port.
  server: {
    port: 5181,
    strictPort: true,
  },
  // Pre-bundle the Firebase submodules together in dev so their internal
  // component-registration side effects (Auth/Firestore/Storage) all run
  // relative to the same `firebase/app` instance. Without this, Vite's
  // on-demand dep optimizer can discover and pre-bundle these submodules
  // separately (especially with the dynamic `firebase/analytics` import),
  // which drops the Firestore/Auth/Storage component registration and
  // surfaces the runtime "Service firestore is not available" error.
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/storage',
      'firebase/analytics',
    ],
  },
  // The `@firebase/rules-unit-testing` devDependency pulls in a second copy of
  // `firebase` (v10) alongside the app's `firebase` (v11). Dedupe ensures the
  // browser build always resolves a single `firebase`/`@firebase` copy so
  // component registration and `getFirestore`/`getAuth` line up.
  // Firebase 11 (the app's copy) is installed under packages/shared; the root
  // node_modules holds Firebase 10 from @firebase/rules-unit-testing. Alias
  // every firebase / @firebase import to the shared copy so one SDK is bundled.
  resolve: {
    alias: [
      { find: /^firebase\/(.*)$/, replacement: `${sharedModules}/firebase/$1` },
      { find: /^@firebase\/(.*)$/, replacement: `${sharedModules}/@firebase/$1` },
    ],
  },
  plugins: [
    react(),
    ...(mode === 'test'
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
              name: 'R&H Tyre Testing',
              short_name: 'R&H Testing',
              description:
                'Capture Ride & Handling tyre evaluations offline during and after driving.',
              theme_color: '#0f172a',
              background_color: '#0f172a',
              display: 'standalone',
              orientation: 'portrait',
              start_url: '/',
              scope: '/',
              icons: [
                {
                  src: 'pwa-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                },
                {
                  src: 'pwa-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                },
                {
                  src: 'maskable-icon-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              // Precache the built app shell so open-and-capture works offline.
              globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
              navigateFallback: 'index.html',
              cleanupOutdatedCaches: true,
            },
            devOptions: {
              enabled: false,
            },
          }),
        ]),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split the large Firebase SDK into its own chunk so the initial app
        // shell stays small and Firebase can be cached/loaded independently.
        // React is separated as a rarely-changing vendor chunk. All emitted
        // JS chunks are still matched by the Workbox `globPatterns`
        // (**/*.js) above, so the full offline app shell is precached (R4.3).
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase') || id.includes('@firebase')) {
              return 'firebase';
            }
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'react-vendor';
            }
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // UI + fake-indexeddb tests are slow under full-suite parallel load.
    testTimeout: 30_000,
  },
}));
