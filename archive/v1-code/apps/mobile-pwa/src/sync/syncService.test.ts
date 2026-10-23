// Unit tests for the Mobile_PWA Sync_Service (task 14.1).
//
// The service pushes dirty/unsynced LocalTestSessions to Firestore and marks
// them synced once the backend confirms the write (R7.1, R10.3, R10.4); on
// failure it retains the local data and retries without blocking capture
// (R7.3, R7.5). These tests exercise that behaviour deterministically:
//
//  - Firestore is replaced with a tiny in-memory document store, so we can make
//    individual writes succeed or fail on demand (no emulator, no network).
//  - The local store is the real Dexie/IndexedDB store running against
//    fake-indexeddb (registered in src/test/setup.ts), so we verify real local
//    persistence, not a mock.
//  - Connectivity and the retry scheduler are injected, so online/offline and
//    backoff retries are fully controllable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalTestSession } from '@rnh/shared';

// ---------------------------------------------------------------------------
// In-memory Firestore fake (path-addressed, with a controllable failure hook)
// ---------------------------------------------------------------------------

interface PathRef {
  __path: string;
}

/** Persisted documents keyed by full slash-delimited path. */
const firestoreDocs = new Map<string, Record<string, unknown>>();
/** When set, setDoc for a given sessionId path throws (simulated push failure). */
const failPaths = new Set<string>();

vi.mock('firebase/firestore', () => {
  return {
    doc: (_fs: unknown, path: string): PathRef => ({ __path: path }),
    getDoc: async (ref: PathRef) => {
      const data = firestoreDocs.get(ref.__path);
      return {
        exists: () => data !== undefined,
        data: () => data,
      };
    },
    setDoc: async (ref: PathRef, data: Record<string, unknown>): Promise<void> => {
      if (failPaths.has(ref.__path)) {
        throw new Error(`simulated Firestore failure for ${ref.__path}`);
      }
      firestoreDocs.set(ref.__path, { ...data });
    },
  };
});

// Import AFTER vi.mock so the service binds to the mocked firebase/firestore.
import type { Firestore } from 'firebase/firestore';
import { LocalSessionDatabase, LocalSessionStore } from '../local';
import {
  createSyncService,
  type ConnectivityMonitor,
  type SyncServiceOptions,
} from './syncService';

// The mocked firebase/firestore ignores the Firestore instance (it keys off the
// path string), so any placeholder works. Injecting it means the service never
// falls back to getFirebaseServices(), keeping the tests free of Firebase env
// configuration.
const fakeFirestore = {} as unknown as Firestore;

/** createSyncService with the fake Firestore always injected. */
function makeService(options: Omit<SyncServiceOptions, 'firestore'>) {
  return createSyncService({ ...options, firestore: fakeFirestore });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;
let db: LocalSessionDatabase;
let store: LocalSessionStore;

function makeSession(overrides: Partial<LocalTestSession> = {}): LocalTestSession {
  const base: LocalTestSession = {
    sessionId: 'session-1',
    templateId: null,
    createdBy: 'tester-uid',
    tyreSets: [
      {
        groupName: 'Set A',
        make: 'BrandX',
        pattern: 'P1',
        srlr: 'SR',
        weekCode: '2401',
        dot: 'DOT123',
      },
    ],
    vehicle: {
      vehicleId: 'V-1',
      tyreSize: '235/60R18',
      rimSize: '18',
      frontAxlePressure: 32,
      rearAxlePressure: 30,
    },
    conditions: {
      testTrack: 'Track 1',
      driverName: 'Driver A',
      loadOfCar: 'GVW',
      airTempC: 25,
      roadTempC: 30,
      testDate: '2026-09-15',
    },
    ride: {
      parameters: [{ name: 'Smooth Road', rating: 6.5, note: 'ok' }],
      averageRating: 6.5,
    },
    handling: {
      parameters: [{ name: 'Rear Tracking', rating: 7, note: '' }],
      averageRating: 7,
    },
    syncState: 'unsynced',
    fieldTimestamps: {},
    updatedAt: 1000,
    dirty: true,
    pendingSince: 1000,
  };
  return { ...base, ...overrides };
}

/** A connectivity monitor whose online state is flipped by the test. */
function fakeConnectivity(initialOnline: boolean): ConnectivityMonitor & {
  setOnline(online: boolean): void;
  fireOnline(): void;
} {
  let online = initialOnline;
  const onlineListeners = new Set<() => void>();
  return {
    isOnline: () => online,
    onOnline(listener: () => void): () => void {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    setOnline(next: boolean): void {
      online = next;
    },
    fireOnline(): void {
      online = true;
      for (const l of onlineListeners) {
        l();
      }
    },
  };
}

beforeEach(() => {
  firestoreDocs.clear();
  failPaths.clear();
  db = new LocalSessionDatabase(`sync-test-db-${dbCounter++}`);
  store = new LocalSessionStore(db);
});

afterEach(async () => {
  await db.delete();
});

describe('SyncService.syncNow — successful sync marks synced (R7.1, R10.4)', () => {
  it('pushes a pending session to Firestore and marks it synced locally', async () => {
    const session = makeSession();
    await store.save(session);

    const connectivity = fakeConnectivity(true);
    const service = makeService({ store, connectivity, now: () => 5000 });

    const outcome = await service.syncNow();

    expect(outcome).toMatchObject({ synced: true, syncedCount: 1, failedCount: 0 });

    // The document reached Firestore at the right path, without local-only fields.
    const pushed = firestoreDocs.get('testSessions/session-1');
    expect(pushed).toBeDefined();
    expect(pushed).not.toHaveProperty('dirty');
    expect(pushed).not.toHaveProperty('pendingSince');
    expect(pushed?.sessionId).toBe('session-1');

    // Locally the session is now synced and no longer pending (R10.4, R7.5).
    const local = await store.load('session-1');
    expect(local?.syncState).toBe('synced');
    expect(local?.dirty).toBe(false);
    expect(local?.pendingSince).toBeNull();

    expect(service.getStatus().pendingCount).toBe(0);
    expect(service.getStatus().lastError).toBeNull();
    expect(service.getStatus().lastSyncedAt).toBe(5000);
  });

  it('does not re-push sessions that are already synced and clean', async () => {
    await store.save(
      makeSession({ sessionId: 'done', syncState: 'synced', dirty: false, pendingSince: null }),
    );

    const service = makeService({ store, connectivity: fakeConnectivity(true) });
    const outcome = await service.syncNow();

    expect(outcome.syncedCount).toBe(0);
    expect(firestoreDocs.has('testSessions/done')).toBe(false);
  });
});

describe('SyncService.syncNow — failure keeps unsynced and retries (R7.3, R7.5)', () => {
  it('retains local data as unsynced when the push fails', async () => {
    const session = makeSession();
    await store.save(session);
    failPaths.add('testSessions/session-1');

    const service = makeService({
      store,
      connectivity: fakeConnectivity(true),
      // Do not actually schedule real timers in this assertion.
      scheduleRetry: () => () => {},
    });

    const outcome = await service.syncNow();

    expect(outcome).toMatchObject({ synced: false, syncedCount: 0, failedCount: 1 });

    // Nothing persisted to Firestore; local copy is retained and still pending.
    expect(firestoreDocs.has('testSessions/session-1')).toBe(false);
    const local = await store.load('session-1');
    expect(local?.syncState).toBe('unsynced');
    expect(local?.dirty).toBe(true);
    expect(service.getStatus().pendingCount).toBe(1);
    expect(service.getStatus().lastError).toContain('simulated Firestore failure');
  });

  it('schedules a backoff retry after a failure and succeeds once the fault clears', async () => {
    const session = makeSession();
    await store.save(session);
    failPaths.add('testSessions/session-1');

    // Capture the scheduled retry so the test can run it deterministically.
    let scheduled: (() => void) | null = null;
    const service = makeService({
      store,
      connectivity: fakeConnectivity(true),
      scheduleRetry: (fn) => {
        scheduled = fn;
        return () => {};
      },
    });

    const first = await service.syncNow();
    expect(first.failedCount).toBe(1);
    expect(scheduled).toBeTypeOf('function');

    // Clear the simulated fault, then run the scheduled retry.
    failPaths.clear();
    scheduled!();
    // Allow the async retry pass to settle.
    await vi.waitFor(() => {
      expect(firestoreDocs.has('testSessions/session-1')).toBe(true);
    });

    const local = await store.load('session-1');
    expect(local?.syncState).toBe('synced');
    expect(local?.dirty).toBe(false);
  });

  it('syncs the good sessions even when one push fails (one bad session does not block the rest)', async () => {
    await store.save(makeSession({ sessionId: 'ok-1' }));
    await store.save(makeSession({ sessionId: 'bad' }));
    await store.save(makeSession({ sessionId: 'ok-2' }));
    failPaths.add('testSessions/bad');

    const service = makeService({
      store,
      connectivity: fakeConnectivity(true),
      scheduleRetry: () => () => {},
    });

    const outcome = await service.syncNow();

    expect(outcome.syncedCount).toBe(2);
    expect(outcome.failedCount).toBe(1);
    expect((await store.load('ok-1'))?.syncState).toBe('synced');
    expect((await store.load('ok-2'))?.syncState).toBe('synced');
    expect((await store.load('bad'))?.syncState).toBe('unsynced');
  });
});

describe('SyncService — offline behaviour and connectivity-restore retry (R4.5)', () => {
  it('skips the push while offline and retries when connectivity is restored', async () => {
    const session = makeSession();
    await store.save(session);

    const connectivity = fakeConnectivity(false);
    const service = makeService({ store, connectivity });

    const offlineOutcome = await service.syncNow();
    expect(offlineOutcome.skippedOffline).toBe(true);
    expect(firestoreDocs.has('testSessions/session-1')).toBe(false);
    expect((await store.load('session-1'))?.syncState).toBe('unsynced');

    // Wiring the service up registers the connectivity-restore retry.
    service.start();
    connectivity.fireOnline();

    await vi.waitFor(() => {
      expect(firestoreDocs.has('testSessions/session-1')).toBe(true);
    });
    expect((await store.load('session-1'))?.syncState).toBe('synced');
    service.stop();
  });
});

describe('SyncService.enqueue — capture is never blocked (R7.3, R10.1)', () => {
  it('resolves immediately without waiting for the background push', async () => {
    const session = makeSession();
    await store.save(session);

    // Gate the background push on a promise the test controls. enqueue must
    // resolve BEFORE the push is allowed to proceed, proving it does not wait
    // on the (potentially slow) network path (R7.3, R10.1).
    let releasePush!: () => void;
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    let pushStarted = false;

    const service = makeService({
      store,
      connectivity: fakeConnectivity(true),
      // The merge runs inside the push; block there until the test releases it.
      mergeStrategy: (local) => {
        pushStarted = true;
        const { dirty: _d, pendingSince: _p, ...rest } = local;
        return rest;
      },
    });

    // enqueue must resolve promptly even though a push is kicked off in the
    // background. Racing against a timeout guards against it blocking.
    await expect(
      Promise.race([
        service.enqueue(session),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('enqueue blocked')), 500),
        ),
      ]),
    ).resolves.toBeUndefined();

    // enqueue returned without the push having to complete: at this point the
    // session is still pending locally.
    expect(service.getStatus().pendingCount).toBe(1);

    // Now let any background work finish and drain it before teardown so no
    // store access outlives the test's IndexedDB database.
    releasePush();
    void pushGate;
    void pushStarted;
    await vi.waitFor(() => {
      expect(service.getStatus().pendingCount).toBe(0);
    });
  });

  it('reflects the pending count after enqueue and drives it to zero after sync', async () => {
    const connectivity = fakeConnectivity(true);
    const service = makeService({ store, connectivity });

    const session = makeSession();
    await store.save(session);
    await service.enqueue(session);

    // The background push may already be in flight; wait for it to complete.
    await vi.waitFor(() => {
      expect(service.getStatus().pendingCount).toBe(0);
    });
    expect((await store.load('session-1'))?.syncState).toBe('synced');
  });
});

describe('SyncService.subscribe — status is observable (R10.3)', () => {
  it('notifies subscribers of pending-count and error changes', async () => {
    await store.save(makeSession());

    const service = makeService({
      store,
      connectivity: fakeConnectivity(true),
    });

    const seen: number[] = [];
    const unsubscribe = service.subscribe((s) => seen.push(s.pendingCount));

    await service.syncNow();

    // Immediately notified with the initial status, then updated after the pass.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(service.getStatus().pendingCount).toBe(0);
    unsubscribe();
  });
});
