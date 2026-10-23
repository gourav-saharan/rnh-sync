// Vitest global setup for the Mobile_PWA.
//
// jsdom does not provide IndexedDB, so we register the fake-indexeddb
// implementation on the global scope. This lets the Dexie-based
// `LocalSessionStore` run against a real (in-memory) IndexedDB in tests.
import 'fake-indexeddb/auto';

// Extend Vitest's `expect` with the DOM matchers (`toBeInTheDocument`, etc.)
// used by the @testing-library/react component tests, and auto-clean the
// rendered DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
