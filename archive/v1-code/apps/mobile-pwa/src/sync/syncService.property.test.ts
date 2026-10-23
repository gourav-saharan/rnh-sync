// Property-based test for the Mobile_PWA Sync_Service failure/retry behaviour.
//
// Feature: rnh-tyre-testing-system, Property: Failed sync retains and retries
//
// Property 11 — For any set of locally-saved Test_Sessions and any per-session
// success/failure pattern for the Firestore push (including faults that clear on
// a later retry), a sync pass followed by controlled retries must never lose
// locally-saved data:
//   - every session whose push ultimately succeeds ends up `synced` and clean
//     (not dirty, no pendingSince) locally, and is present in Firestore;
//   - every session whose push keeps failing is retained locally as
//     unsynced/dirty (no data lost) and is NOT in Firestore;
//   - the reported pending count equals the number of sessions still failing.
//
// This exercises local-first durability + retry: a failed synchronisation
// retains the local data and retries when connectivity is available (R7.3),
// marking a session synchronised only once the backend confirms it (R10.4),
// while nothing captured locally is ever dropped (R10.1).
//
// Validates: Requirements 7.5, 10.4
//
// Determinism: the real Dexie/IndexedDB store runs against fake-indexeddb
// (registered in src/test/setup.ts); Firestore is an in-memory fake whose
// per-path success/failure is driven by the generated pattern; and the retry
// scheduler is injected as a synchronous callback so backoff retries run
// deterministically without real timers. Minimum 100 iterations.

import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { LocalTestSession } from '@rnh/shared';

// ---------------------------------------------------------------------------
// In-memory Firestore fake (path-addressed, with a controllable failure hook).
// syncService reads the remote doc (getDoc) before writing (setDoc), so all
// three of doc/getDoc/setDoc are provided.
// ---------------------------------------------------------------------------

interface PathRef {
  __path: string;
}

/** Persisted documents keyed by full slash-delimited path. */
const firestoreDocs = new Map<string, Record<string, unknown>>();
/** Paths whose setDoc currently throws (simulated push failure). */
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

// The mocked firebase/firestore keys off the path string and ignores the
// Firestore instance, so any placeholder works. Injecting it keeps the service
// from falling back to getFirebaseServices() (no Firebase env configuration).
const fakeFirestore = {} as unknown as Firestore;

function makeService(options: Omit<SyncServiceOptions, 'firestore'>) {
  return createSyncService({ ...options, firestore: fakeFirestore });
}

/** An always-online connectivity monitor (offline is out of scope here). */
const onlineConnectivity: ConnectivityMonitor = {
  isOnline: () => true,
  onOnline: () => () => {},
};

// ---------------------------------------------------------------------------
// Session factory + arbitraries.
// ---------------------------------------------------------------------------

const firestorePath = (sessionId: string): string => `testSessions/${sessionId}`;

/** A pending (dirty + unsynced) LocalTestSession with the given id. */
function makePendingSession(sessionId: string): LocalTestSession {
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
    syncState: 'unsynced',
    fieldTimestamps: {},
    updatedAt: 1000,
    dirty: true,
    pendingSince: 1000,
  };
}

/**
 * A generated plan for one session:
 *  - `permanentFail`: the push always fails (models a session that keeps
 *    failing across the pass and every retry).
 *  - otherwise it succeeds; `failFirstAttempts` models a transient fault that
 *    clears after that many failed attempts (so a later retry succeeds).
 */
interface SessionPlan {
  id: string;
  permanentFail: boolean;
  failFirstAttempts: number;
}

const sessionPlansArb: fc.Arbitrary<SessionPlan[]> = fc
  .array(
    fc.record({
      permanentFail: fc.boolean(),
      // 0 => succeeds on the first attempt; >0 => succeeds only after that many
      // transient failures clear (verified via scheduled retries).
      failFirstAttempts: fc.integer({ min: 0, max: 3 }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  // Assign stable, unique ids so distinct sessions map to distinct paths.
  .map((plans) =>
    plans.map((plan, index) => ({
      id: `session-${index}`,
      permanentFail: plan.permanentFail,
      failFirstAttempts: plan.permanentFail ? 0 : plan.failFirstAttempts,
    })),
  );

// ---------------------------------------------------------------------------
// Isolated database lifecycle: a fresh DB per property run.
// ---------------------------------------------------------------------------

let dbCounter = 0;
const openDbs: LocalSessionDatabase[] = [];

function freshStore(): LocalSessionStore {
  const db = new LocalSessionDatabase(`sync-prop-db-${dbCounter++}`);
  openDbs.push(db);
  return new LocalSessionStore(db);
}

beforeEach(() => {
  firestoreDocs.clear();
  failPaths.clear();
});

afterEach(async () => {
  firestoreDocs.clear();
  failPaths.clear();
  while (openDbs.length > 0) {
    const db = openDbs.pop()!;
    await db.delete();
  }
});

describe('Property 11: Failed sync retains and retries (R7.3/7.5, R10.4)', () => {
  it('never loses local data: succeeding pushes become synced, failing ones stay unsynced', async () => {
    await fc.assert(
      fc.asyncProperty(sessionPlansArb, async (plans) => {
        // Fresh per-run world so examples cannot leak into one another.
        firestoreDocs.clear();
        failPaths.clear();
        const store = freshStore();

        // Save every session locally first (local-first durability, R10.1) and
        // arm the initial simulated faults. A session either fails permanently
        // or fails for its first N attempts before the fault clears.
        const remainingAttempts = new Map<string, number>();
        for (const plan of plans) {
          await store.save(makePendingSession(plan.id));
          if (plan.permanentFail) {
            failPaths.add(firestorePath(plan.id));
          } else if (plan.failFirstAttempts > 0) {
            failPaths.add(firestorePath(plan.id));
            remainingAttempts.set(plan.id, plan.failFirstAttempts);
          }
        }

        // Assert the service actually schedules a retry when a push fails
        // (R7.3), then drive retries deterministically by awaiting syncNow()
        // directly — the scheduled callback does exactly `void syncNow()`, so
        // awaiting the pass is the deterministic, no-timer equivalent of the
        // backoff retry firing. A no-op scheduler keeps real timers out.
        let retryScheduled = false;
        const service = makeService({
          store,
          connectivity: onlineConnectivity,
          scheduleRetry: (fn) => {
            retryScheduled = true;
            void fn; // Do not run it; we drive retries via awaited syncNow().
            return () => {};
          },
        });

        // Each sync pass over a still-failing transient session consumes one of
        // its attempts; when its budget hits zero we clear its fault so the next
        // retry succeeds. Permanent failures are never cleared.
        const consumeTransientFaults = (): void => {
          for (const [id, left] of [...remainingAttempts.entries()]) {
            const next = left - 1;
            if (next <= 0) {
              failPaths.delete(firestorePath(id));
              remainingAttempts.delete(id);
            } else {
              remainingAttempts.set(id, next);
            }
          }
        };

        // Initial pass, then run exactly enough retry rounds to exhaust the
        // largest transient-fault budget. A permanent failure reschedules
        // forever by design, so we bound the rounds by the known transient
        // budget rather than draining until retries stop.
        const anyFailingInitially = plans.some(
          (p) => p.permanentFail || p.failFirstAttempts > 0,
        );
        const firstOutcome = await service.syncNow();
        consumeTransientFaults();

        // A failed push must schedule a retry (retain-and-retry, R7.3).
        if (anyFailingInitially) {
          expect(firstOutcome.failedCount).toBeGreaterThan(0);
          expect(retryScheduled).toBe(true);
        }

        const maxTransient = plans.reduce(
          (max, p) => (p.permanentFail ? max : Math.max(max, p.failFirstAttempts)),
          0,
        );
        for (let round = 0; round < maxTransient; round += 1) {
          // eslint-disable-next-line no-await-in-loop
          await service.syncNow();
          consumeTransientFaults();
        }

        // Stop the service so any wiring is torn down before the DB is deleted.
        service.stop();

        // ----- Invariant checks -----
        const expectedFailing = plans.filter((p) => p.permanentFail);
        const expectedSucceeding = plans.filter((p) => !p.permanentFail);

        // Sessions that ultimately succeeded: synced + clean locally and in FS.
        for (const plan of expectedSucceeding) {
          const local = await store.load(plan.id);
          expect(local).toBeDefined();
          expect(local?.syncState).toBe('synced');
          expect(local?.dirty).toBe(false);
          expect(local?.pendingSince).toBeNull();
          expect(firestoreDocs.has(firestorePath(plan.id))).toBe(true);
        }

        // Sessions that kept failing: retained locally as unsynced/dirty (no
        // data lost) and never written to Firestore.
        for (const plan of expectedFailing) {
          const local = await store.load(plan.id);
          expect(local).toBeDefined();
          expect(local?.syncState).toBe('unsynced');
          expect(local?.dirty).toBe(true);
          expect(firestoreDocs.has(firestorePath(plan.id))).toBe(false);
        }

        // No local data is ever lost: every saved session is still present.
        const all = await store.loadAll();
        expect(all.length).toBe(plans.length);

        // The reported pending count equals the number still failing.
        expect(service.getStatus().pendingCount).toBe(expectedFailing.length);
      }),
      { numRuns: 100 },
    );
    // Generous per-test timeout: 100 property runs each drive several async
    // sync passes over a real (fake-indexeddb) Dexie store.
  }, 60_000);
});
