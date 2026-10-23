// Laptop routing via the URL hash, so refresh, Back/Forward and shared links
// keep the current screen (e.g. https://rnh-sync.web.app/#/tests/s_abc123).
// Hash routing needs no server rewrites. Pure parse/format + a small hook.

import { useCallback, useEffect, useState } from 'react';

export type LaptopRoute =
  | { name: 'tests' }
  | { name: 'session'; sessionId: string }
  | { name: 'analysis' }
  | { name: 'templates' }
  | { name: 'template'; templateId: string }
  | { name: 'trash' };

/** Ids are generated as [a-z0-9_]; anything else is rejected. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(hash: string): LaptopRoute | null {
  let parts: string[];
  try {
    parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    // Malformed escape (e.g. "%E0") in a pasted link: treat as unknown.
    return null;
  }
  const [a, b] = parts;
  if (a === 'tests' && b && ID_RE.test(b)) return { name: 'session', sessionId: b };
  if (a === 'tests' && !b) return { name: 'tests' };
  if (a === 'templates' && b && ID_RE.test(b)) return { name: 'template', templateId: b };
  if (a === 'templates' && !b) return { name: 'templates' };
  if (a === 'analysis' && !b) return { name: 'analysis' };
  if (a === 'trash' && !b) return { name: 'trash' };
  return null;
}

export function formatRoute(r: LaptopRoute): string {
  switch (r.name) {
    case 'session':
      return `#/tests/${encodeURIComponent(r.sessionId)}`;
    case 'template':
      return `#/templates/${encodeURIComponent(r.templateId)}`;
    default:
      return `#/${r.name}`;
  }
}

/** Current route from the hash, falling back to `fallback` for empty/unknown hashes. */
export function useHashRoute(fallback: LaptopRoute): [LaptopRoute, (r: LaptopRoute) => void] {
  const read = useCallback(() => parseRoute(window.location.hash) ?? fallback, [fallback]);
  const [route, setRoute] = useState<LaptopRoute>(read);

  useEffect(() => {
    const onHash = () => {
      setRoute(read());
      window.scrollTo?.(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [read]);

  const go = useCallback((r: LaptopRoute) => {
    const next = formatRoute(r);
    if (window.location.hash === next) {
      setRoute(r);
      return;
    }
    // Pushes a history entry, so the browser Back button returns here.
    window.location.hash = next;
  }, []);

  return [route, go];
}
