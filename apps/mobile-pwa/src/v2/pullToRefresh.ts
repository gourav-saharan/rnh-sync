// Pull down on the Home list to sync (native list gesture). Listens on the
// app's scroll container (.native-app-body) and only starts at the very top.

import { useEffect, useRef, useState, type RefObject } from 'react';

/** Distance (px, after damping) that triggers a sync on release. */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;

/** Finger travel -> indicator height, damped like a native rubber band. */
export function pullOffset(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_MAX, dy * 0.5);
}

export interface PullState {
  offset: number;
  refreshing: boolean;
}

export function usePullToRefresh(
  anchor: RefObject<HTMLElement>,
  opts: { enabled: boolean; onRefresh: () => Promise<unknown> },
): PullState {
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const scroller = anchor.current?.closest<HTMLElement>('.native-app-body') ?? null;
    if (!scroller) return;
    let startY: number | null = null;
    let current = 0;

    const onStart = (e: TouchEvent) => {
      if (!optsRef.current.enabled || scroller.scrollTop > 0 || e.touches.length !== 1) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      if (scroller.scrollTop > 0) {
        startY = null;
        current = 0;
        setOffset(0);
        return;
      }
      current = pullOffset(e.touches[0].clientY - startY);
      setOffset(current);
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      const trigger = current >= PULL_THRESHOLD;
      current = 0;
      setOffset(0);
      if (trigger) {
        setRefreshing(true);
        void optsRef.current
          .onRefresh()
          .catch(() => undefined)
          .finally(() => setRefreshing(false));
      }
    };

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: true });
    scroller.addEventListener('touchend', onEnd);
    scroller.addEventListener('touchcancel', onEnd);
    return () => {
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, [anchor]);

  return { offset, refreshing };
}
