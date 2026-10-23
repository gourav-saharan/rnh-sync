// Unit tests for the useSync hook (Requirements 7.1, 7.5, 10.3, 10.4).
//
// These example-based tests mount the hook via @testing-library/react's
// renderHook with an injected fake Sync_Service — no Firebase. They assert:
//   - the hook starts the service on mount and stops it on unmount (R7.1),
//   - enqueue forwards a saved session to the service (R10.4),
//   - status changes emitted by the service are reflected (R10.3),
//   - enqueue never throws even when the service push rejects (R7.5).

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LocalTestSession } from '@rnh/shared';
import type { SyncService, SyncStatus } from './syncService';
import { useSync } from './useSync';

function makeFakeSync(enqueueImpl?: (s: LocalTestSession) => Promise<void>) {
  const state = { started: false, stopped: false };
  let status: SyncStatus = {
    pendingCount: 0,
    syncing: false,
    lastSyncedAt: null,
    lastError: null,
  };
  const listeners = new Set<(s: SyncStatus) => void>();
  const enqueued: LocalTestSession[] = [];
  const service: SyncService = {
    async enqueue(session) {
      enqueued.push(session);
      if (enqueueImpl) {
        await enqueueImpl(session);
      }
    },
    async syncNow() {
      return { synced: true, syncedCount: 0, failedCount: 0, skippedOffline: false };
    },
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    start() {
      state.started = true;
      return () => {
        state.stopped = true;
      };
    },
    stop() {
      state.stopped = true;
    },
  };
  const emit = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    act(() => {
      for (const l of listeners) l(status);
    });
  };
  return { service, state, enqueued, emit };
}

const session = { sessionId: 's1', vehicle: { vehicleId: 'CAR-1' } } as unknown as LocalTestSession;

describe('useSync', () => {
  it('starts the service on mount and stops it on unmount (R7.1)', () => {
    const fake = makeFakeSync();
    const { unmount } = renderHook(() => useSync(fake.service));
    expect(fake.state.started).toBe(true);
    expect(fake.state.stopped).toBe(false);
    unmount();
    expect(fake.state.stopped).toBe(true);
  });

  it('forwards a saved session to the service on enqueue (R10.4)', async () => {
    const fake = makeFakeSync();
    const { result } = renderHook(() => useSync(fake.service));
    act(() => result.current.enqueue(session));
    await waitFor(() => expect(fake.enqueued).toHaveLength(1));
    expect(fake.enqueued[0]?.sessionId).toBe('s1');
  });

  it('reflects status changes emitted by the service (R10.3)', () => {
    const fake = makeFakeSync();
    const { result } = renderHook(() => useSync(fake.service));
    expect(result.current.status.pendingCount).toBe(0);
    fake.emit({ pendingCount: 3, lastError: 'boom' });
    expect(result.current.status.pendingCount).toBe(3);
    expect(result.current.status.lastError).toBe('boom');
  });

  it('never throws from enqueue even when the push rejects (R7.5)', async () => {
    const fake = makeFakeSync(async () => {
      throw new Error('network down');
    });
    const { result } = renderHook(() => useSync(fake.service));
    // Should not reject/throw synchronously or asynchronously.
    expect(() => act(() => result.current.enqueue(session))).not.toThrow();
    await waitFor(() => expect(fake.enqueued).toHaveLength(1));
  });
});
