// Optional, browser-only Firebase Analytics.
//
// Analytics is a progressive enhancement: it is never required for the app to
// work and must never run outside a supporting browser. This module is
// deliberately kept out of the core `initializeFirebase()` path so importing
// or initializing Firebase in Node (tests, tooling, SSR) has zero Analytics
// side effects.
//
// `initAnalytics()` is safe to call unconditionally from an app entry point as
// a fire-and-forget: it resolves to `null` (never throws) whenever Analytics
// cannot or should not start — including when:
//   - the runtime is not a supported browser (Node/SSR/jsdom/unsupported), or
//   - no `measurementId` is configured (Analytics intentionally disabled).

import type { Analytics } from 'firebase/analytics';
import { getFirebaseServices } from './app';
import { loadFirebaseConfig } from './config';

/**
 * Initializes browser-only Firebase Analytics when it is supported and a
 * `measurementId` is configured.
 *
 * @returns the initialized {@link Analytics} instance, or `null` when
 *   Analytics is unsupported, unconfigured, or initialization fails. This
 *   function never throws.
 */
export async function initAnalytics(): Promise<Analytics | null> {
  try {
    // No browser window -> not a browser runtime (Node/SSR/test). Bail early
    // before touching any browser-only Firebase Analytics code paths.
    if (typeof window === 'undefined') {
      return null;
    }

    // Analytics is opt-in: without a measurement ID there is nothing to wire.
    let measurementId: string | undefined;
    try {
      measurementId = loadFirebaseConfig().measurementId;
    } catch {
      // Config not available/valid in this context; treat as disabled.
      return null;
    }
    if (!measurementId) {
      return null;
    }

    // `isSupported()` returns false in unsupported browsers, jsdom, and any
    // environment lacking the required web APIs — the authoritative guard.
    const { getAnalytics, isSupported } = await import('firebase/analytics');
    const supported = await isSupported();
    if (!supported) {
      return null;
    }

    const { app } = getFirebaseServices();
    return getAnalytics(app);
  } catch {
    // Analytics is best-effort; never let it break the app.
    return null;
  }
}

/**
 * Alias of {@link initAnalytics} for callers that prefer an explicitly
 * support-gated name. Returns the {@link Analytics} instance or `null`.
 */
export function getAnalyticsIfSupported(): Promise<Analytics | null> {
  return initAnalytics();
}
