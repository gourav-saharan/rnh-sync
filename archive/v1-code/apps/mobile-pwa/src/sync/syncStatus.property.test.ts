// Property-based test for the Mobile_PWA Sync_Service observable status.
//
// Feature: rnh-tyre-testing-system, Property: Sync-status invariant
//
// Property 18 (Sync-status invariant): For any Test_Session, its status is
// `synced` if and only if the Firebase_Backend has confirmed its storage;
// otherwise it is `unsynced`. Surfaced through the Sync_Service's observable
// SyncStatus, this means: for any sequence of local saves and per-session sync
// outcomes, the exposed status is consistent with the local store —
//   - `pendingCount` always equals the number of locally-saved sessions that
//     are dirty or unsynced (the same predicate the store uses to decide what
//     still awaits confirmation);
//   - a clean, fully-successful online pass clears `lastError` and drives
//     `pendingCount` to zero;
//   - when some pushes fail, `pendingCount` equals the number still
//     dirty/unsynced and is never fewer than the true unsynced count.
//
// Validates: Requirements 10.3, 10.4
//
// The test runs the REAL Dexie/IndexedDB store over fake-indexeddb (registered
// in src/test/setup.ts) and an in-memory Firestore mock whose per-path writes
// can be made to fail on demand. Connectivity and the retry scheduler are
// injected so online/offline and backoff retries are fully deterministic (the
// scheduler runs retries synchronously). Uses fast-check with >= 100 runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { LocalTestSession } from '@rnh/shared';

// ---------------------------------------------------------------------------
// In-memory Firestore fake (path-addressed, with a controllable failure hook).
// Mirrors the unit-test fake so the service binds to a mocked
// firebase/firestore with no emulator and no network.
// ---------------------------------------------------------------------------

interface PathRef {
  __path: string;
}

/** Persisted documents keyed by full slash-delimited path. */
const firestoreDocs = new Map<string, Record<string, unknown>>();
/** setDoc for any path in this set throws (simulated push failure). */
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
import { firestorePaths } from '@rnh/shared';
import { LocalSessionDatabase, LocalSessionStore } from '../local';
import {
  createSyncService,
  type ConnectivityMonitor,
  type SyncServiceOptions,
} from './syncService';

// The mocked firebase/firestore keys off the path string and ignores the
// Firestore instance, so any placeholder works. Injecting it keeps the service
// from ever falling back to getFirebaseServices() (no Firebase env needed).
const fakeFirestore = {} as unknown as Firestore;

function makeService(options: Omit<SyncServiceOptions, 'firestore'>) {
  return createSyncService({ ...options, firestore: fakeFirestore });
}

/** A connectivity monitor with a fixed online state (no restore listeners). */
function fixedConnectivity(online: boolean): ConnectivityMonitor {
  return {
    isOnline: () => online,
    onOnline: () => () => {},
  };
}

/**
 * The same "still awaiting confirmation" predicate the store and service use
 * (LocalSessionStore.loadMostRecentInProgress / syncService.isPending): a
 * session counts as pending iff it is dirty OR its syncState is 'unsynced'.
 */
function isPending(session: LocalTestSession): boolean {
  return session.dirty || session.syncState === 'unsynced';
}

// ---------------------------------------------------------------------------
// Arbitraries — a set of local sessions with a mix of dirty/unsynced/synced,
// each tagged with whether its remote push should succeed or fail.
// ---------------------------------------------------------------------------

/** One generated session plus the outcome its Firestore write should have. */
interface SessionSpec {
  session: LocalTestSession;
  /** When true, this session's setDoc will fail (stays unsynced). */
  fail: boolean;
}

function makeSession(sessionId: string, syncState: 'unsynced' | 'synced', dirty: boolean): LocalTestSession {
  return {
    sessionId,
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
    syncState,
    fieldTimestamps: {},
    updatedAt: 1000,
    dirty,
    pendingSince: dirty ? 1000 : null,
  };
}

/** A session spec: an arbitrary (dirty, syncState) mix + a fail flag. */
function sessionSpecArb(sessionId: string): fc.Arbitrary<SessionSpec> {
  return fc.record({
    dirty: fc.boolean(),
    syncState: fc.constantFrom<'unsynced' | 'synced'>('unsynced', 'synced'),
    fail: fc.boolean(),
  }).map(({ dirty, syncState, fail }) => ({
    session: makeSession(sessionId, syncState, dirty),
    fail,
  }));
}

/** A set of 0..6 sessions with distinct ids and independent outcome flags. */
const sessionSetArb: fc.Arbitrary<SessionSpec[]> = fc
  .integer({ min: 0, max: 6 })
  .chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_v, i) => sessionSpecArb(`session-${i}`)),
    ),
  );

// ---------------------------------------------------------------------------
// Isolated database lifecycle: a fresh DB per property run, cleaned up after.
// ---------------------------------------------------------------------------

let dbCounter = 0;
const openDbs: LocalSessionDatabase[] = [];

function freshStore(): LocalSessionStore {
  const db = new LocalSessionDatabase(`sync-status-prop-db-${dbCounter++}`);
  openDbs.push(db);
  return new LocalSessionStore(db);
}

beforeEach(() => {
  firestoreDocs.clear();
  failPaths.clear();
});

afterEach(async () => {
  while (openDbs.length > 0) {
    const db = openDbs.pop()!;
    await db.delete();
  }
  firestoreDocs.clear();
  failPaths.clear();
});

describe('Property: Sync-status invariant (Property 18)', () => {
  it('pendingCount always matches the locally dirty/unsynced sessions across any save + sync pattern', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionSetArb,
        fc.boolean(),
        async (specs, online) => {
          // Fresh, isolated backend + local store per example.
          firestoreDocs.clear();
          failPaths.clear();
          const store = freshStore();

          // Persist every generated session to the real local store and arm
          // the per-session failure flags on the in-memory Firestore.
          for (const { session, fail } of specs) {
            await store.save(session);
            if (fail) {
              failPaths.add(firestorePaths.testSession(session.sessionId));
            }
          }

          const service = makeService({
            store,
            connectivity: fixedConnectivity(online),
            now: () => 5000,
            // Run any backoff retry synchronously (no real timers). It re-reads
            // the store, so a deterministic retry cannot hide a status drift.
            scheduleRetry: (fn) => {
              fn();
              return () => {};
            },
          });

          await service.syncNow();

          // Ground truth from the local store after the pass settles.
          const after = await store.loadAll();
          const trulyPending = after.filter(isPending).length;
          const status = service.getStatus();

          // Core invariant (R10.3, R10.4): exposed pendingCount equals the
          // number of locally dirty/unsynced sessions...
          expect(status.pendingCount).toBe(trulyPending);
          // ...and never under-reports what actually remains unsynced.
          expect(status.pendingCount).toBeGreaterThanOrEqual(trulyPending);

          if (!online) {
            // Offline: nothing was pushed, so the pending set is untouched and
            // the count equals the originally-pending sessions.
            const originallyPending = specs.filter((s) => isPending(s.session)).length;
            expect(status.pendingCount).toBe(originallyPending);
            return;
          }

          const anyFailed = specs.some((s) => isPending(s.session) && s.fail);
          if (!anyFailed) {
            // A clean, fully-successful online pass clears the error and drains
            // every pending session (R10.4).
            expect(status.lastError).toBeNull();
            expect(status.pendingCount).toBe(0);
            expect(after.every((s) => !isPending(s))).toBe(true);
          } else {
            // With failures, the remaining pending count equals the number of
            // sessions whose push failed (they stay dirty/unsynced) and is
            // never fewer than the true unsynced count.
            const stillFailing = after.filter(isPending).length;
            expect(status.pendingCount).toBe(stillFailing);
            expect(status.pendingCount).toBeGreaterThanOrEqual(0);
            // Every remaining pending session is one we forced to fail.
            for (const s of after.filter(isPending)) {
              expect(failPaths.has(firestorePaths.testSession(s.sessionId))).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
