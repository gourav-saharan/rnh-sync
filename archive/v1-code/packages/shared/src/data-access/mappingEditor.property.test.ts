// Property-based test for Mapping_Editor save/load round-trip persistence.
//
// Feature: rnh-tyre-testing-system, Property 4: Mapping persistence round-trip
//
// Property 4 (Mapping persistence round-trip): For any set of saved
// (non-conflicting) Field_Mappings, loading the associated Customer_Template
// yields exactly those mappings with the same
// (sheetName, cellAddress, inputFieldKey) associations.
//
// Validates: Requirements 3.4, 3.6
//
// The implementation under test is `createMappingEditorStore` in
// ./mappingEditor.ts. `save` and `loadExisting` talk to Firestore via the
// `firebase/firestore` SDK. To keep this test deterministic and fast (no
// emulator, no network), we replace `firebase/firestore` with a tiny in-memory
// document store keyed by the same slash-delimited paths the implementation
// uses (firestorePaths.*). The fake models exactly the operations the store
// relies on: doc/collection references, getDoc/getDocs, setDoc, deleteDoc.

import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory Firestore fake (path-addressed document store)
// ---------------------------------------------------------------------------

/** Every document lives at its full slash-delimited path. */
const store = new Map<string, Record<string, unknown>>();

/** A reference is just its path plus a discriminator for doc vs collection. */
interface PathRef {
  __path: string;
  __kind: 'doc' | 'collection';
}

function docRef(path: string): PathRef {
  return { __path: path, __kind: 'doc' };
}

function collectionRef(path: string): PathRef {
  return { __path: path, __kind: 'collection' };
}

/** True when `docPath` is an immediate child document of `collectionPath`. */
function isDirectChild(collectionPath: string, docPath: string): boolean {
  if (!docPath.startsWith(`${collectionPath}/`)) {
    return false;
  }
  const rest = docPath.slice(collectionPath.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

vi.mock('firebase/firestore', () => {
  return {
    // The implementation may build refs as doc(firestore, path) — we ignore the
    // firestore instance and key purely off the path string.
    doc: (_fs: unknown, path: string): PathRef => docRef(path),
    collection: (_fs: unknown, path: string): PathRef => collectionRef(path),

    setDoc: async (ref: PathRef, data: Record<string, unknown>): Promise<void> => {
      // Store a shallow clone so later mutations to the source object do not
      // leak into the persisted copy (mirrors real serialization).
      store.set(ref.__path, { ...data });
    },

    deleteDoc: async (ref: PathRef): Promise<void> => {
      store.delete(ref.__path);
    },

    getDoc: async (ref: PathRef) => {
      const data = store.get(ref.__path);
      return {
        exists: () => data !== undefined,
        data: () => data,
      };
    },

    getDocs: async (ref: PathRef) => {
      const docs = [...store.entries()]
        .filter(([path]) => isDirectChild(ref.__path, path))
        .map(([path, data]) => ({
          id: path.slice(ref.__path.length + 1),
          data: () => data,
        }));
      return { docs };
    },
  };
});

// Import AFTER vi.mock so the store picks up the mocked firebase/firestore.
import {
  inputFieldKey,
  type CustomerTemplate,
  type FieldMapping,
  type FieldType,
  type TemplateStructure,
} from '../index';
import { firestorePaths } from '../firebase/collections';
import { createMappingEditorStore } from './mappingEditor';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const FIELD_TYPES: readonly FieldType[] = [
  'tyreSet',
  'vehicle',
  'condition',
  'rhRating',
  'rhNote',
  'meta',
] as const;

/** A1 column letters for a small, bounded column space. */
function columnLetters(col: number): string {
  let n = col + 1; // 1-based
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** A single sheet name from a small fixed set (multi-sheet coverage, R3.3). */
const sheetNameArb = fc.constantFrom('MU1', 'MU2', 'dryhandling1', 'Description', 'Sheet 1');

/**
 * A distinct (sheetName, cellAddress) target within a bounded grid. Uniqueness
 * of the pair across a set is enforced by the caller via fc.uniqueArray on the
 * `${sheet}!${cell}` key, so the saved mappings are non-conflicting (R3.5) and
 * every one is persisted (R3.4).
 */
const targetArb = fc.record({
  sheetName: sheetNameArb,
  // Bounded grid keeps the (sheet, cell) key space small enough that
  // uniqueArray reliably yields distinct non-conflicting targets.
  col: fc.integer({ min: 0, max: 15 }),
  row: fc.integer({ min: 1, max: 30 }),
});

type Target = { sheetName: string; col: number; row: number };

function targetKey(t: Target): string {
  return `${t.sheetName}!${columnLetters(t.col)}${t.row}`;
}

/** Builds a FieldMapping from a target and an index, for a fixed template. */
function buildMapping(templateId: string, t: Target, index: number): FieldMapping {
  const fieldType = FIELD_TYPES[index % FIELD_TYPES.length];
  const mapping: FieldMapping = {
    mappingId: `m${index}`,
    templateId,
    sheetName: t.sheetName,
    cellAddress: `${columnLetters(t.col)}${t.row}`,
    inputFieldKey: inputFieldKey.meta(`field${index}`),
    fieldType,
    required: index % 2 === 0,
  };
  if (fieldType === 'rhRating') {
    mapping.rhParameterName = `Param ${index}`;
  }
  return mapping;
}

/**
 * A set of non-conflicting Field_Mappings for a single template: targets are a
 * unique array (distinct (sheet, cell) pairs), so createMapping() accepts them
 * all and none are withheld. inputFieldKey is unique per mapping via its index.
 */
const mappingSetArb: fc.Arbitrary<FieldMapping[]> = fc
  .uniqueArray(targetArb, {
    minLength: 0,
    maxLength: 12,
    selector: targetKey,
  })
  .map((targets) => targets.map((t, i) => buildMapping('tmpl-1', t, i)));

/**
 * Seeds the fake store with the Customer_Template document the store's `save`
 * and `begin` read. An empty-merge structure means no merge-anchor rewrites, so
 * distinct (sheet, cell) targets stay distinct through createMapping().
 */
function seedTemplate(templateId: string): void {
  const structure: TemplateStructure = {
    sheets: ['MU1', 'MU2', 'dryhandling1', 'Description', 'Sheet 1'].map((name, index) => ({
      name,
      index,
      rowCount: 100,
      columnCount: 30,
      mergedRanges: [],
    })),
  };
  const template: CustomerTemplate = {
    templateId,
    customerName: 'Acme',
    storagePath: `templates/${templateId}/original.xlsx`,
    uploadDate: 0,
    structure,
    createdBy: 'viewer-1',
  };
  store.set(firestorePaths.customerTemplate(templateId), {
    ...(template as unknown as Record<string, unknown>),
  });
}

/** Normalises a mapping to only the associations the property asserts on. */
function assoc(m: FieldMapping): { sheetName: string; cellAddress: string; inputFieldKey: string } {
  return {
    sheetName: m.sheetName,
    cellAddress: m.cellAddress,
    inputFieldKey: m.inputFieldKey,
  };
}

function sortAssoc(
  list: readonly FieldMapping[],
): Array<{ sheetName: string; cellAddress: string; inputFieldKey: string }> {
  return list
    .map(assoc)
    .sort((a, b) =>
      `${a.sheetName}|${a.cellAddress}|${a.inputFieldKey}`.localeCompare(
        `${b.sheetName}|${b.cellAddress}|${b.inputFieldKey}`,
      ),
    );
}

// ---------------------------------------------------------------------------
// Property 4: Mapping persistence round-trip
// ---------------------------------------------------------------------------

describe('Property 4: Mapping persistence round-trip', () => {
  afterEach(() => {
    store.clear();
  });

  it('loadExisting yields exactly the saved non-conflicting mappings by (sheet, cell, inputFieldKey)', async () => {
    await fc.assert(
      fc.asyncProperty(mappingSetArb, async (mappings) => {
        // Fresh state per run: only the template document exists before save.
        store.clear();
        const templateId = 'tmpl-1';
        seedTemplate(templateId);

        const editor = createMappingEditorStore({} as never);

        const result = await editor.save(templateId, mappings);

        // Preconditions of the property: the inputs are non-conflicting, so
        // every mapping is saved and none withheld (R3.4, R3.5).
        expect(result.withheld).toHaveLength(0);
        expect(result.saved).toHaveLength(mappings.length);

        // Round-trip: loading the associated template yields exactly the saved
        // set with the same (sheet, cell, inputFieldKey) associations (R3.6).
        const loaded = await editor.loadExisting(templateId);

        expect(loaded).toHaveLength(mappings.length);
        expect(sortAssoc(loaded)).toEqual(sortAssoc(mappings));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
