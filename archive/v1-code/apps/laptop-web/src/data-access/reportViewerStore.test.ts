// Unit tests for the Report_Viewer data access (Laptop_Web_App, task 15.1).
//
// The store exposes Firestore `onSnapshot` listeners so synchronized sessions,
// templates, and mappings appear in the Report_Viewer UI without a reload
// (R7.2), and a confirmation-gated Test_Session deletion that removes the
// Firestore document — the removal that propagates to remove local copies on
// every device (R10.5, R10.6).
//
// Firestore is replaced with a tiny in-memory fake so these run with no
// emulator and no network:
//  - collections are path-addressed maps of documents;
//  - onSnapshot registers a listener, emits the current contents immediately,
//    and re-emits whenever the test mutates that collection;
//  - deleteDoc removes a document (and notifies any collection listeners),
//    modelling how a laptop delete propagates to other listeners.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerTemplateSummary, FieldMapping, TestSession } from '@rnh/shared';

// ---------------------------------------------------------------------------
// In-memory Firestore fake (path-addressed collections + live listeners)
// ---------------------------------------------------------------------------

interface CollRef {
  __kind: 'collection';
  __path: string;
}
interface DocRef {
  __kind: 'doc';
  __path: string;
}

/** Documents keyed by full path, e.g. "testSessions/session-1". */
const store = new Map<string, Record<string, unknown>>();
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

function snapshotFor(collectionPath: string): FakeQuerySnapshot {
  const prefix = `${collectionPath}/`;
  const docs: FakeQueryDoc[] = [];
  for (const [path, data] of store.entries()) {
    // Only direct children of the collection (no deeper subcollection paths).
    if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
      docs.push({ id: idOf(path), data: () => ({ ...data }) });
    }
  }
  return { docs };
}

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

/** Test helper: write a document and notify its collection's listeners. */
function putDoc(path: string, data: object): void {
  store.set(path, { ...(data as Record<string, unknown>) });
  notify(collectionOf(path));
}

vi.mock('firebase/firestore', () => {
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
    collection: (_fs: unknown, path: string): CollRef => ({
      __kind: 'collection',
      __path: path,
    }),
    doc: (_fs: unknown, path: string): DocRef => ({ __kind: 'doc', __path: path }),
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
      const existed = store.delete(ref.__path);
      if (existed) {
        notify(collectionOf(ref.__path));
      }
    },
  };
});

// Import AFTER vi.mock so the store binds to the mocked firebase/firestore.
import type { Firestore } from 'firebase/firestore';
import {
  createReportViewerStore,
  DeletionNotConfirmedError,
} from './reportViewerStore';

// The mocked firebase/firestore keys off path strings and ignores the instance.
const fakeFirestore = {} as unknown as Firestore;

function makeSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    sessionId: 'session-1',
    templateId: null,
    createdBy: 'tester-uid',
    tyreSets: [],
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
    ride: { parameters: [], averageRating: 0 },
    handling: { parameters: [], averageRating: 0 },
    syncState: 'synced',
    fieldTimestamps: {},
    updatedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  collectionListeners.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('subscribeTestSessions — live sessions without reload (R7.2)', () => {
  it('emits the current sessions immediately on subscribe', () => {
    putDoc('testSessions/session-1', makeSession());

    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: TestSession[][] = [];
    const unsubscribe = reportStore.subscribeTestSessions((sessions) => {
      seen.push(sessions);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0].sessionId).toBe('session-1');
    unsubscribe();
  });

  it('re-emits when a new session syncs in, without a manual reload', () => {
    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: TestSession[][] = [];
    const unsubscribe = reportStore.subscribeTestSessions((sessions) => {
      seen.push(sessions);
    });

    // Initial empty emission.
    expect(seen[0]).toHaveLength(0);

    // A tester's session synchronizes into Firestore.
    putDoc('testSessions/session-2', makeSession({ sessionId: 'session-2' }));

    expect(seen).toHaveLength(2);
    expect(seen[1].map((s) => s.sessionId)).toEqual(['session-2']);
    unsubscribe();
  });

  it('falls back to the document id for sessionId when the field is absent', () => {
    // A raw document written without an explicit sessionId field.
    putDoc('testSessions/doc-abc', { ...makeSession(), sessionId: undefined });

    const reportStore = createReportViewerStore(fakeFirestore);
    let latest: TestSession[] = [];
    const unsubscribe = reportStore.subscribeTestSessions((s) => {
      latest = s;
    });

    expect(latest[0].sessionId).toBe('doc-abc');
    unsubscribe();
  });

  it('stops emitting after unsubscribe', () => {
    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: TestSession[][] = [];
    const unsubscribe = reportStore.subscribeTestSessions((s) => seen.push(s));

    unsubscribe();
    putDoc('testSessions/session-9', makeSession({ sessionId: 'session-9' }));

    // Only the initial emission was recorded; post-unsubscribe change ignored.
    expect(seen).toHaveLength(1);
  });
});

describe('subscribeCustomerTemplates — live template list projection', () => {
  it('projects documents to the listing summary and re-emits on change', async () => {
    const { Timestamp } = await import('firebase/firestore');
    putDoc('customerTemplates/t1', {
      templateId: 't1',
      customerName: 'MSIL',
      uploadDate: Timestamp.fromMillis(1_700_000_000_000),
      structure: { sheets: [] },
    });

    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: CustomerTemplateSummary[][] = [];
    const unsubscribe = reportStore.subscribeCustomerTemplates((t) => seen.push(t));

    expect(seen[0]).toEqual([
      { templateId: 't1', customerName: 'MSIL', uploadDate: 1_700_000_000_000 },
    ]);

    putDoc('customerTemplates/t2', {
      templateId: 't2',
      customerName: 'Renault',
      uploadDate: Timestamp.fromMillis(1_700_000_500_000),
      structure: { sheets: [] },
    });

    expect(seen[1]).toHaveLength(2);
    const names = seen[1].map((t) => t.customerName).sort();
    expect(names).toEqual(['MSIL', 'Renault']);
    unsubscribe();
  });
});

describe('subscribeFieldMappings — live mappings for a template', () => {
  it('emits the mappings under the given template and re-emits on change', () => {
    const mapping: FieldMapping = {
      mappingId: 'm1',
      templateId: 't1',
      sheetName: 'Sheet1',
      cellAddress: 'C7',
      inputFieldKey: 'vehicle.frontAxlePressure',
      fieldType: 'vehicle',
      required: true,
    };
    putDoc('customerTemplates/t1/fieldMappings/m1', { ...mapping });

    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: FieldMapping[][] = [];
    const unsubscribe = reportStore.subscribeFieldMappings('t1', (m) => seen.push(m));

    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0]).toMatchObject({ mappingId: 'm1', cellAddress: 'C7' });

    putDoc('customerTemplates/t1/fieldMappings/m2', {
      ...mapping,
      mappingId: 'm2',
      cellAddress: 'C8',
      inputFieldKey: 'vehicle.rearAxlePressure',
    });

    expect(seen[1]).toHaveLength(2);
    unsubscribe();
  });

  it('does not include mappings from a different template', () => {
    putDoc('customerTemplates/t1/fieldMappings/m1', {
      mappingId: 'm1',
      templateId: 't1',
      sheetName: 'S',
      cellAddress: 'A1',
      inputFieldKey: 'meta.customerName',
      fieldType: 'meta',
      required: false,
    });
    putDoc('customerTemplates/t2/fieldMappings/mx', {
      mappingId: 'mx',
      templateId: 't2',
      sheetName: 'S',
      cellAddress: 'A1',
      inputFieldKey: 'meta.customerName',
      fieldType: 'meta',
      required: false,
    });

    const reportStore = createReportViewerStore(fakeFirestore);
    let latest: FieldMapping[] = [];
    const unsubscribe = reportStore.subscribeFieldMappings('t1', (m) => {
      latest = m;
    });

    expect(latest).toHaveLength(1);
    expect(latest[0].mappingId).toBe('m1');
    unsubscribe();
  });
});

describe('deleteTestSession — confirmation-gated deletion (R10.5, R10.6)', () => {
  it('rejects and deletes nothing when the deletion is not confirmed', async () => {
    putDoc('testSessions/session-1', makeSession());
    const reportStore = createReportViewerStore(fakeFirestore);

    await expect(
      reportStore.deleteTestSession('session-1', { confirmed: false }),
    ).rejects.toBeInstanceOf(DeletionNotConfirmedError);

    // The session is still present — nothing was removed.
    expect(store.has('testSessions/session-1')).toBe(true);
  });

  it('removes the Firestore document when confirmed (R10.6)', async () => {
    putDoc('testSessions/session-1', makeSession());
    const reportStore = createReportViewerStore(fakeFirestore);

    await reportStore.deleteTestSession('session-1', { confirmed: true });

    expect(store.has('testSessions/session-1')).toBe(false);
  });

  it('propagates the removal to active listeners (models local-copy removal)', async () => {
    putDoc('testSessions/session-1', makeSession());
    putDoc('testSessions/session-2', makeSession({ sessionId: 'session-2' }));

    const reportStore = createReportViewerStore(fakeFirestore);
    const seen: string[][] = [];
    const unsubscribe = reportStore.subscribeTestSessions((sessions) => {
      seen.push(sessions.map((s) => s.sessionId).sort());
    });

    expect(seen[seen.length - 1]).toEqual(['session-1', 'session-2']);

    await reportStore.deleteTestSession('session-1', { confirmed: true });

    // The listener re-emitted without the deleted session — the same signal
    // that drives removal of local copies on other devices (R10.6).
    expect(seen[seen.length - 1]).toEqual(['session-2']);
    unsubscribe();
  });
});
