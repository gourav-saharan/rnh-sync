// Vitest global setup for the Laptop_Web_App.
//
// Extends Vitest's `expect` with the DOM matchers (`toBeInTheDocument`, etc.)
// used by the @testing-library/react component tests, and auto-cleans the
// rendered DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
