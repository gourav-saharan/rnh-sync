/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Property tests over real ExcelJS workbooks are slow under full-suite load.
    testTimeout: 60_000,
  },
});
