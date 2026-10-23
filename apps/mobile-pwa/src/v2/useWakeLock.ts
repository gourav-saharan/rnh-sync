// Keep the screen awake during Drive_Mode (R6.11). Progressive enhancement:
// silently does nothing where the Screen Wake Lock API is unsupported.

import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = () => {
      nav
        .wakeLock!.request('screen')
        .then((s) => {
          if (cancelled) void s.release();
          else sentinel = s;
        })
        .catch(() => undefined);
    };
    // The lock is dropped when the page is hidden; re-acquire on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}

/** Short haptic tick where supported (R6.4). */
export function haptic(enabled: boolean): void {
  if (!enabled) return;
  try {
    (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(15);
  } catch {
    /* unsupported */
  }
}
