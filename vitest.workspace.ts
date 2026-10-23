import { defineWorkspace } from 'vitest/config';

// Root Vitest workspace: runs tests across the shared package and both apps
// via a single `npm test` at the repo root.
export default defineWorkspace(['packages/*', 'apps/*']);
