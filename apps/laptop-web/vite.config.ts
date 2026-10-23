/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const sharedModules = fileURLToPath(
  new URL('../../packages/shared/node_modules', import.meta.url),
).replace(/\\/g, '/');

export default defineConfig({
  plugins: [react()],
  // Dedicated dev/preview port for the Laptop_Web_App so it never collides
  // with other locally running apps. strictPort makes a taken port fail
  // loudly instead of silently drifting onto another port.
  server: {
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 5180,
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
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor dependencies into their own chunks so the initial
        // app chunk stays small and the browser can cache/lazy-load them
        // independently. Firebase and ExcelJS are the two large libraries in
        // the Laptop_Web_App bundle; React is separated as a stable vendor
        // chunk that changes rarely.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('exceljs')) {
              return 'exceljs';
            }
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
    testTimeout: 30_000,
  },
});
