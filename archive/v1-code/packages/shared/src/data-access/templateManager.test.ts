// Unit + integration tests for the Template_Manager persistence module
// (task 8.4). These are example-based tests that exercise the real
// createTemplateManager logic end-to-end against in-memory fakes for Firestore
// and Cloud Storage, so they run deterministically under `vitest run` without
// the Firebase emulator.
//
// The module under test imports the modular Firebase functions directly
// (doc/setDoc/getDoc/getDocs/deleteDoc from firebase/firestore and
// ref/uploadBytes/deleteObject from firebase/storage). We mock those two
// modules with tiny in-memory implementations. The injected `firestore` and
// `storage` handles are opaque sentinels carrying the backing stores, so the
// manager's real control flow (validation, path building, timestamp
// conversion, confirmation gating, blob cleanup) is what runs.
//
// Coverage (design.md Template_Manager + requirements.md Requirement 2):
//   - invalid-file rejection on upload (R2.3)
//   - upload + inspect round-trip of the extracted structure (R2.5), also
//     exercising list (R2.4) and not-found inspection
//   - delete requires confirmation and removes both metadata and blob (R2.6)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// In-memory Firestore fake
// ---------------------------------------------------------------------------
//
// A Firestore handle is `{ __docs: Map<path, data> }`. Document refs and
// collection refs are plain `{ __store, path }` objects. This is enough for the
// manager, which only ever addresses documents/collections by path.

interface FakeFirestore {
  __docs: Map<string, Record<string, unknown>>;
}

interface FakeRef {
  __store: Map<string, Record<string, unknown>>;
  path: string;
}

function createFakeFirestore(): FakeFirestore {
  return { __docs: new Map() };
}

vi.mock('firebase/firestore', () => {
  // A minimal Timestamp that mirrors the pieces the manager touches:
  // `Timestamp.fromMillis(ms)` on write and `instanceof Timestamp` +
  // `.toMillis()` on read. Defined inside the factory because vi.mock is
  // hoisted above the module's top-level declarations.
  class FakeTimestamp {
    constructor(private readonly millis: number) {}
    static fromMillis(millis: number): FakeTimestamp {
      return new FakeTimestamp(millis);
    }
    toMillis(): number {
      return this.millis;
    }
  }

  return {
    Timestamp: FakeTimestamp,
    collection(firestore: FakeFirestore, path: string): FakeRef {
      return { __store: firestore.__docs, path };
    },
    doc(parent: FakeFirestore | FakeRef, path?: string): FakeRef {
      // doc(firestore, 'a/b') — absolute document path.
      if (path !== undefined) {
        return { __store: (parent as FakeFirestore).__docs, path };
      }
      // doc(collectionRef) — auto-id within a collection. The manager only
      // uses this branch for its default id generator, which tests override
      // via `generateId`, but we support it for completeness.
      const collectionRef = parent as FakeRef;
      const id = `auto-${Math.random().toString(36).slice(2)}`;
      return { __store: collectionRef.__store, path: `${collectionRef.path}/${id}`, id } as FakeRef;
    },
    async setDoc(docRef: FakeRef, data: Record<string, unknown>): Promise<void> {
      docRef.__store.set(docRef.path, { ...data });
    },
    async getDoc(docRef: FakeRef) {
      const data = docRef.__store.get(docRef.path);
      return {
        exists: () => data !== undefined,
        data: () => data,
        id: docRef.path.split('/').pop() ?? docRef.path,
      };
    },
    async getDocs(collectionRef: FakeRef) {
      const prefix = `${collectionRef.path}/`;
      const docs = [...collectionRef.__store.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({
          id: path.slice(prefix.length),
          data: () => data,
        }));
      return { docs };
    },
    async deleteDoc(docRef: FakeRef): Promise<void> {
      docRef.__store.delete(docRef.path);
    },
  };
});

// ---------------------------------------------------------------------------
// In-memory Cloud Storage fake
// ---------------------------------------------------------------------------

interface FakeStorage {
  __blobs: Map<string, Uint8Array>;
}

interface FakeStorageRef {
  __blobs: Map<string, Uint8Array>;
  path: string;
}

function createFakeStorage(): FakeStorage {
  return { __blobs: new Map() };
}

vi.mock('firebase/storage', () => {
  return {
    ref(storage: FakeStorage, path: string): FakeStorageRef {
      return { __blobs: storage.__blobs, path };
    },
    async uploadBytes(storageRef: FakeStorageRef, bytes: Uint8Array): Promise<void> {
      storageRef.__blobs.set(storageRef.path, bytes);
    },
    async deleteObject(storageRef: FakeStorageRef): Promise<void> {
      if (!storageRef.__blobs.has(storageRef.path)) {
        // Mirror the SDK's not-found error so the manager can treat an
        // already-gone blob as a successful delete.
        throw { code: 'storage/object-not-found' };
      }
      storageRef.__blobs.delete(storageRef.path);
    },
  };
});

// Import the module under test AFTER the mocks are registered.
import {
  createTemplateManager,
  DeletionNotConfirmedError,
  TemplateManagerNotFoundError,
} from './templateManager.index';
import { templateStoragePath } from '../firebase/collections';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Builds a real, valid `.xlsx` buffer with the given sheet names. */
async function buildXlsx(
  sheets: { name: string; merge?: string }[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  for (const { name, merge } of sheets) {
    const ws = workbook.addWorksheet(name);
    ws.getCell('A1').value = `${name}-header`;
    ws.getCell('B2').value = 42;
    if (merge) {
      ws.mergeCells(merge);
    }
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

/** A managed manager instance plus its backing fakes and injected id. */
function makeManager(id = 'tpl-1') {
  const firestore = createFakeFirestore();
  const storage = createFakeStorage();
  const manager = createTemplateManager({
    // The manager types these as the Firebase SDK handles; our mocked module
    // treats them structurally, so the sentinel stores flow through unchanged.
    firestore: firestore as never,
    storage: storage as never,
    generateId: () => id,
    currentUid: () => 'viewer-uid',
  });
  return { manager, firestore, storage, id };
}

// ---------------------------------------------------------------------------
// R2.3 — invalid-file rejection
// ---------------------------------------------------------------------------

describe('Template_Manager.upload — invalid file rejection (R2.3)', () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });

  it('rejects a non-.xlsx file with a descriptive error and stores nothing', async () => {
    const notXlsx = new TextEncoder().encode('this is plain text, not a workbook');

    await expect(ctx.manager.upload(notXlsx, 'Maruti')).rejects.toThrow(
      /valid \.xlsx workbook/i,
    );

    // No metadata and no blob should have been written for a rejected upload.
    expect(ctx.firestore.__docs.size).toBe(0);
    expect(ctx.storage.__blobs.size).toBe(0);
  });

  it('rejects an empty file with a descriptive error', async () => {
    await expect(ctx.manager.upload(new Uint8Array(0), 'Renault')).rejects.toThrow(
      /empty|valid \.xlsx/i,
    );
    expect(ctx.firestore.__docs.size).toBe(0);
    expect(ctx.storage.__blobs.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R2.4 / R2.5 — upload persists, list projects, inspect returns structure
// ---------------------------------------------------------------------------

describe('Template_Manager — upload, list, inspect round-trip (R2.4, R2.5)', () => {
  it('uploads a valid multi-sheet workbook and stores blob + metadata', async () => {
    const { manager, firestore, storage, id } = makeManager('tpl-multi');
    const bytes = await buildXlsx([
      { name: 'MU1', merge: 'A1:D1' },
      { name: 'MU2' },
      { name: 'Description' },
    ]);

    const template = await manager.upload(bytes, 'Hyundai');

    expect(template.templateId).toBe(id);
    expect(template.customerName).toBe('Hyundai');
    expect(template.createdBy).toBe('viewer-uid');
    expect(template.storagePath).toBe(templateStoragePath(id));
    expect(typeof template.uploadDate).toBe('number');

    // Metadata written to Firestore and blob written to Storage.
    expect(firestore.__docs.has(`customerTemplates/${id}`)).toBe(true);
    expect(storage.__blobs.get(templateStoragePath(id))).toBeInstanceOf(Uint8Array);
  });

  it('inspect returns the stored structure: each sheet name and its dimensions (R2.5)', async () => {
    const { manager, id } = makeManager('tpl-inspect');
    const bytes = await buildXlsx([
      { name: 'MU1', merge: 'A1:D1' },
      { name: 'MU2' },
    ]);

    const uploaded = await manager.upload(bytes, 'Hyundai');
    const structure = await manager.inspect(id);

    // Round-trip: inspect yields the same structure stored at upload time.
    expect(structure).toEqual(uploaded.structure);

    // Sheet names preserved in order (R2.2, R8.3).
    expect(structure.sheets.map((s) => s.name)).toEqual(['MU1', 'MU2']);

    // Cell dimensions are present for each sheet (R2.5).
    for (const sheet of structure.sheets) {
      expect(sheet.rowCount).toBeGreaterThan(0);
      expect(sheet.columnCount).toBeGreaterThan(0);
    }

    // Merge on the first sheet is captured.
    expect(structure.sheets[0].mergedRanges).toContain('A1:D1');
  });

  it('inspect throws a not-found error for an unknown template id', async () => {
    const { manager } = makeManager();
    await expect(manager.inspect('does-not-exist')).rejects.toBeInstanceOf(
      TemplateManagerNotFoundError,
    );
  });

  it('list projects stored templates to customerName + uploadDate (R2.4)', async () => {
    // Two uploads into a shared backing store via distinct ids.
    const firestore = createFakeFirestore();
    const storage = createFakeStorage();
    const make = (id: string) =>
      createTemplateManager({
        firestore: firestore as never,
        storage: storage as never,
        generateId: () => id,
        currentUid: () => 'viewer-uid',
      });

    const bytes = await buildXlsx([{ name: 'MU1' }]);
    await make('tpl-a').upload(bytes, 'Maruti');
    await make('tpl-b').upload(bytes, 'Renault');

    const summaries = await make('unused').list();

    expect(summaries).toHaveLength(2);
    const byId = Object.fromEntries(summaries.map((s) => [s.templateId, s]));
    expect(byId['tpl-a'].customerName).toBe('Maruti');
    expect(byId['tpl-b'].customerName).toBe('Renault');
    for (const s of summaries) {
      expect(typeof s.uploadDate).toBe('number');
      expect(s.uploadDate).toBeGreaterThan(0);
      // Summary must not carry the full structure.
      expect(s).not.toHaveProperty('structure');
    }
  });
});

// ---------------------------------------------------------------------------
// R2.6 — confirmation-gated deletion removes metadata + blob
// ---------------------------------------------------------------------------

describe('Template_Manager.delete — confirmation gating (R2.6)', () => {
  it('throws when deletion is not confirmed and leaves metadata + blob intact', async () => {
    const { manager, firestore, storage, id } = makeManager('tpl-del-1');
    await manager.upload(await buildXlsx([{ name: 'MU1' }]), 'Maruti');

    await expect(manager.delete(id, false)).rejects.toBeInstanceOf(
      DeletionNotConfirmedError,
    );

    // Nothing removed on an unconfirmed delete.
    expect(firestore.__docs.has(`customerTemplates/${id}`)).toBe(true);
    expect(storage.__blobs.has(templateStoragePath(id))).toBe(true);
  });

  it('removes both the Firestore metadata and the Cloud Storage blob when confirmed', async () => {
    const { manager, firestore, storage, id } = makeManager('tpl-del-2');
    await manager.upload(await buildXlsx([{ name: 'MU1' }]), 'Maruti');

    expect(firestore.__docs.has(`customerTemplates/${id}`)).toBe(true);
    expect(storage.__blobs.has(templateStoragePath(id))).toBe(true);

    await manager.delete(id, true);

    expect(firestore.__docs.has(`customerTemplates/${id}`)).toBe(false);
    expect(storage.__blobs.has(templateStoragePath(id))).toBe(false);

    // After deletion the template is no longer inspectable.
    await expect(manager.inspect(id)).rejects.toBeInstanceOf(
      TemplateManagerNotFoundError,
    );
  });

  it('treats an already-missing blob as a successful confirmed deletion', async () => {
    const { manager, firestore, storage, id } = makeManager('tpl-del-3');
    await manager.upload(await buildXlsx([{ name: 'MU1' }]), 'Maruti');

    // Simulate the blob already being gone from Storage.
    storage.__blobs.delete(templateStoragePath(id));

    await expect(manager.delete(id, true)).resolves.toBeUndefined();
    expect(firestore.__docs.has(`customerTemplates/${id}`)).toBe(false);
  });
});
