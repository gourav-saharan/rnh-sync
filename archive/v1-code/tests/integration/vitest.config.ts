/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(configDir, '..', '..');

// Dedicated Vitest project for the cross-app integration tests (task 15.2).
//
// These tests are cross-cutting: they exercise BOTH the Mobile_PWA Sync_Service
// (apps/mobile-pwa/src/sync/syncService.ts) and the Laptop_Web_App
// Report_Viewer store (apps/laptop-web/src/data-access/reportViewerStore.ts)
// end to end, wired through a SINGLE shared in-memory Firestore fake so a write
// on the mobile side is observed live on the laptop side (R7.5, R7.6, R10.5,
// R10.6).
//
// Because the two apps are separate Vitest projects, this project is rooted at
// the repo root so it can import real modules from both `apps/*` workspaces and
// the shared package via its `@rnh/shared` alias. The mobile local store runs
// against fake-indexeddb (registered in ./setup.ts) so local persistence is
// real, and `firebase/firestore` is replaced per-test with a shared fake.
export default defineConfig({
  root: configDir,
  resolve: {
    alias: {
      // Resolve the shared package to its TS source, matching the workspace
      // wiring both apps rely on.
      '@rnh/shared': resolve(repoRoot, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    // jsdom so navigator/window seams used by the services are present.
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts'],
    setupFiles: ['./setup.ts'],
  },
});
