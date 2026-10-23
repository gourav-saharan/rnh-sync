// Cross-app integration tests for the sync + deletion flows (task 15.2).
//
// These are example-based integration tests (not property tests) that exercise
// the Mobile_PWA Sync_Service and the Laptop_Web_App Report_Viewer store END TO
// END, wired through a SINGLE shared in-memory Firestore fake. The two apps are
// separate Vitest projects, so this suite lives at the repo root (its own
// vitest.config.ts) where it can import the real modules from both workspaces.
//
// The seam that makes this an integration test rather than two isolated unit
// tests is the shared fake: `firebase/firestore` is mocked once, and BOTH the
// mobile syncService and the laptop reportViewerStore bind to that same mock.
// A `setDoc` performed by the mobile push therefore lands in the same document
// map that the laptop's `onSnapshot` listener observes, so a mobile write is
// seen live on the laptop side with no reload — the real propagation path.
//
// What is real here:
//  - The mobile Sync_Service is the real `createSyncService` from
//    apps/mobile-pwa/src/sync/syncService.ts (push to testSessions/{id}, mark
//    synced locally) — R7.5.
//  - The mobile local store is the real Dexie `LocalSessionStore` running
//    against fake-indexeddb (registered in ./setup.ts), so "marked synced
//    locally" is verified against real IndexedDB persistence.
//  - The laptop Report_Viewer store is the real `createReportViewerStore` from
//    apps/laptop-web/src/data-access/reportViewerStore.ts (live listener +
//    confirmation-gated delete) — R7.6, R10.5, R10.6.
//
// What is faked: only `firebase/firestore` (path-addressed docs + live
// collection listeners), shared by both sides. No emulator, no network.
//
// Covered flows:
//  1. Local-to-cloud propagation + laptop live update (R7.5, R7.6): save a
//     session locally on mobile, run syncNow(); the laptop's
//     subscribeTestSessions listener receives the new session without a reload,
//     and the local session is marked synced.
//  2. Confirmation-gated deletion (R10.5, R10.6): an unconfirmed delete rejects
//     and the session remains (still visible to the laptop listener); a
//     confirmed delete removes the doc and the laptop listener re-emits without
//     it (models local-copy removal on other devices).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalTestSession } from '@rnh/shared';

// ---------------------------------------------------------------------------
// Shared in-memory Firestore fake (path-addressed docs + live collection
// listeners) — the single seam both apps bind to.
// ---------------------------------------------------------------------------

interface CollRef {
  __kind: 'collection';
  __path: string;
}
interface DocRef {
  __kind: 'doc';
  __path: string;
}

/** Documents keyed by full slash-delimited path, e.g. "testSessions/session-1". */
const firestoreDocs = new Map<string, Record<string, unknown>>();
/** Active collection listeners keyed by collection path. */
const collectionListeners = new Map<
  string,
  Set<(snap: FakeQuerySnapshot) => void>
>();

interface FakeQueryDoc {
  id: string;
  data(): Record<string, unknown>;
}
interface FakeQuerySnapshot {
  docs: FakeQueryDoc[];
}

/** The last path segment is the doc id; the rest is the collection path. */
function idOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}
function collectionOf(docPath: string): string {
  const parts = docPath.split('/');
  parts.pop();
  return parts.join('/');
}

/** Build the current snapshot for a collection (direct children only). */
function snapshotFor(collectionPath: string): FakeQuerySnapshot {
  const prefix = `${collectionPath}/`;
  const docs: FakeQueryDoc[] = [];
  for (const [path, data] of firestoreDocs.entries()) {
    if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
      docs.push({ id: idOf(path), data: () => ({ ...data }) });
    }
  }
  return { docs };
}

/** Notify all listeners on a collection with a fresh snapshot. */
function notify(collectionPath: string): void {
  const listeners = collectionListeners.get(collectionPath);
  if (!listeners) {
    return;
  }
  const snap = snapshotFor(collectionPath);
  for (const listener of listeners) {
    listener(snap);
  }
}

vi.mock('firebase/firestore', () => {
  // A minimal Timestamp so any timestamp-shaped fields still behave; the
  // sessions used here carry numeric millis, but the report store imports it.
  class Timestamp {
    constructor(
      public readonly seconds: number,
      public readonly nanoseconds: number,
    ) {}
    static fromMillis(ms: number): Timestamp {
      return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1_000_000);
    }
    toMillis(): number {
      return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
    }
  }

  return {
    Timestamp,
    // Used by the mobile syncService (single-document read/write).
    doc: (_fs: unknown, path: string): DocRef => ({ __kind: 'doc', __path: path }),
    getDoc: async (ref: DocRef) => {
      const data = firestoreDocs.get(ref.__path);
      return {
        exists: () => data !== undefined,
        data: () => data,
      };
    },
    setDoc: async (ref: DocRef, data: Record<string, unknown>): Promise<void> => {
      firestoreDocs.set(ref.__path, { ...data });
      // A write is exactly what the laptop's live listener observes (R7.6).
      notify(collectionOf(ref.__path));
    },
    // Used by the laptop reportViewerStore (collection listeners + delete).
    collection: (_fs: unknown, path: string): CollRef => ({
      __kind: 'collection',
      __path: path,
    }),
    onSnapshot: (
      ref: CollRef,
      onNext: (snap: FakeQuerySnapshot) => void,
      _onError?: (e: Error) => void,
    ): (() => void) => {
      const path = ref.__path;
      let listeners = collectionListeners.get(path);
      if (!listeners) {
        listeners = new Set();
        collectionListeners.set(path, listeners);
      }
      listeners.add(onNext);
      // Emit the current contents immediately, as Firestore does.
      onNext(snapshotFor(path));
      return () => {
        listeners!.delete(onNext);
      };
    },
    deleteDoc: async (ref: DocRef): Promise<void> => {
      const existed = firestoreDocs.delete(ref.__path);
      if (existed) {
        notify(collectionOf(ref.__path));
      }
    },
  };
});

// Import the REAL modules AFTER vi.mock so they bind to the shared fake.
import type { Firestore } from 'firebase/firestore';
import { createSyncService } from '../../apps/mobile-pwa/src/sync/syncService';
import {
  LocalSessionDatabase,
  LocalSessionStore,
} from '../../apps/mobile-pwa/src/local/localSessionStore';
import {
  createReportViewerStore,
  DeletionNotConfirmedError,
} from '../../apps/laptop-web/src/data-access/reportViewerStore';

// The fake keys off path strings and ignores the Firestore instance, so any
// placeholder works for both sides.
const fakeFirestore = {} as unknown as Firestore;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A connectivity monitor with a fixed online state (online for these flows). */
function onlineConnectivity() {
  return {
    isOnline: () => true,
    onOnline: (_listener: () => void) => () => {},
  };
}

function makeLocalSession(
  overrides: Partial<LocalTestSession> = {},
): LocalTestSession {
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

let dbCounter = 0;
let db: LocalSessionDatabase;
let mobileStore: LocalSessionStore;

beforeEach(() => {
  firestoreDocs.clear();
  collectionListeners.clear();
  db = new LocalSessionDatabase(`integration-db-${dbCounter++}`);
  mobileStore = new LocalSessionStore(db);
});

afterEach(async () => {
  await db.delete();
});

// ---------------------------------------------------------------------------
// Flow 1: local-to-cloud propagation + laptop live update (R7.5, R7.6)
// ---------------------------------------------------------------------------

describe('local-to-cloud propagation and laptop live update (R7.5, R7.6)', () => {
  it('pushes a mobile-saved session to the cloud and the laptop listener sees it without a reload; local copy is marked synced', async () => {
    // The laptop is already viewing the Report_Viewer with a live listener
    // attached BEFORE the session syncs (models "data appears without reload").
    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: string[][] = [];
    const unsubscribe = reportStore.subscribeTestSessions((sessions) => {
      seen.push(sessions.map((s) => s.sessionId).sort());
    });

    // Initial emission: the laptop sees an empty collection.
    expect(seen[0]).toEqual([]);

    // A tester captures and saves a session locally on the mobile device.
    const session = makeLocalSession({ sessionId: 'session-1' });
    await mobileStore.save(session);

    // The mobile Sync_Service pushes pending local sessions to the cloud (R7.5).
    const sync = createSyncService({
      store: mobileStore,
      firestore: fakeFirestore,
      connectivity: onlineConnectivity(),
      now: () => 5000,
    });
    const outcome = await sync.syncNow();

    // The push succeeded and reached the shared cloud at the right path.
    expect(outcome).toMatchObject({ synced: true, syncedCount: 1, failedCount: 0 });
    expect(firestoreDocs.has('testSessions/session-1')).toBe(true);

    // The laptop's live listener re-emitted with the new session — no reload
    // was needed; the write propagated through the shared cloud (R7.6).
    expect(seen[seen.length - 1]).toEqual(['session-1']);

    // The mobile local copy is now marked synced and no longer pending (R7.5).
    const local = await mobileStore.load('session-1');
    expect(local?.syncState).toBe('synced');
    expect(local?.dirty).toBe(false);
    expect(local?.pendingSince).toBeNull();
    expect(sync.getStatus().pendingCount).toBe(0);

    unsubscribe();
  });

  it('propagates each subsequent mobile sync to the laptop listener live', async () => {
    const reportStore = createReportViewerStore(fakeFirestore);
    let latest: string[] = [];
    const unsubscribe = reportStore.subscribeTestSessions((sessions) => {
      latest = sessions.map((s) => s.sessionId).sort();
    });

    const sync = createSyncService({
      store: mobileStore,
      firestore: fakeFirestore,
      connectivity: onlineConnectivity(),
    });

    // First session synced from the mobile device.
    await mobileStore.save(makeLocalSession({ sessionId: 'a' }));
    await sync.syncNow();
    expect(latest).toEqual(['a']);

    // A second session captured later and synced also appears live.
    await mobileStore.save(makeLocalSession({ sessionId: 'b' }));
    await sync.syncNow();
    expect(latest).toEqual(['a', 'b']);

    // Both local copies are marked synced.
    expect((await mobileStore.load('a'))?.syncState).toBe('synced');
    expect((await mobileStore.load('b'))?.syncState).toBe('synced');

    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// Flow 2: confirmation-gated deletion end to end (R10.5, R10.6)
// ---------------------------------------------------------------------------

describe('confirmation-gated deletion end to end (R10.5, R10.6)', () => {
  it('rejects an unconfirmed delete and the session remains visible to the laptop listener', async () => {
    // Seed a synced session end to end (mobile push -> shared cloud).
    await mobileStore.save(makeLocalSession({ sessionId: 'keep-me' }));
    const sync = createSyncService({
      store: mobileStore,
      firestore: fakeFirestore,
      connectivity: onlineConnectivity(),
    });
    await sync.syncNow();

    const reportStore = createReportViewerStore(fakeFirestore);
    let latest: string[] = [];
    const unsubscribe = reportStore.subscribeTestSessions((sessions) => {
      latest = sessions.map((s) => s.sessionId).sort();
    });
    expect(latest).toEqual(['keep-me']);

    // An unconfirmed delete must be rejected and remove nothing (R10.5).
    await expect(
      reportStore.deleteTestSession('keep-me', { confirmed: false }),
    ).rejects.toBeInstanceOf(DeletionNotConfirmedError);

    // The session is still in the cloud and still visible to the laptop.
    expect(firestoreDocs.has('testSessions/keep-me')).toBe(true);
    expect(latest).toEqual(['keep-me']);

    unsubscribe();
  });

  it('removes the cloud document on a confirmed delete and the laptop listener re-emits without it (models local-copy removal on other devices)', async () => {
    // Two sessions synced from the mobile device.
    await mobileStore.save(makeLocalSession({ sessionId: 'session-1' }));
    await mobileStore.save(makeLocalSession({ sessionId: 'session-2' }));
    const sync = createSyncService({
      store: mobileStore,
      firestore: fakeFirestore,
      connectivity: onlineConnectivity(),
    });
    await sync.syncNow();

    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: string[][] = [];
    const unsubscribe = reportStore.subscribeTestSessions((sessions) => {
      seen.push(sessions.map((s) => s.sessionId).sort());
    });
    expect(seen[seen.length - 1]).toEqual(['session-1', 'session-2']);

    // A Report_Viewer explicitly confirms the deletion (R10.5).
    await reportStore.deleteTestSession('session-1', { confirmed: true });

    // The cloud document is gone.
    expect(firestoreDocs.has('testSessions/session-1')).toBe(false);

    // The laptop listener re-emitted without the deleted session — the same
    // propagation signal that removes local copies on other devices (R10.6).
    expect(seen[seen.length - 1]).toEqual(['session-2']);

    unsubscribe();
  });
});
