/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const configDir = dirname(fileURLToPath(import.meta.url));

// Dedicated Vitest project for the Firestore/Storage Security Rules tests.
//
// These tests are cross-cutting: they exercise the repo-root `firestore.rules`
// and `storage.rules` against the Firebase Emulator Suite, so they live at the
// repo root rather than inside a single workspace package.
//
// They REQUIRE the emulators to be running (see the sibling README-style
// header in `securityRules.test.ts` and the `test:rules` npm script). When the
// emulator is unreachable the suite fails fast with a clear message instead of
// silently passing.
export default defineConfig({
  // Root the project at this folder so it never collects the workspace apps'
  // tests (which need jsdom/IndexedDB). Only the sibling *.test.ts run here.
  root: configDir,
  test: {
    // The rules-unit-testing SDK is a Node library; no DOM needed.
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts'],
    // Emulator round-trips are slower than pure unit tests.
    testTimeout: 20000,
    hookTimeout: 30000,
    // Never run these in parallel with anything else touching the emulator.
    fileParallelism: false,
  },
});
