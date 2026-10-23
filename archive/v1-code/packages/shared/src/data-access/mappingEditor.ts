// Mapping_Editor persistence — Firestore data access (Laptop_Web_App).
//
// This module implements the persistence surface of the Mapping_Editor
// described in design.md (Components and Interfaces -> Mapping_Editor):
//
//   interface MappingEditor {
//     begin(templateId): Promise<TemplateStructure>;               // R3.1
//     createMapping(m: FieldMapping): MappingDraftResult;          // R3.2, R3.3, R3.5
//     loadExisting(templateId): Promise<FieldMapping[]>;           // R3.6
//     save(templateId, mappings): Promise<SaveResult>;             // R3.4, R3.5
//   }
//
//   interface SaveResult {
//     saved: FieldMapping[];
//     withheld: Array<{ mapping: FieldMapping; reason: string }>;  // R3.5
//   }
//
// Responsibilities of the persistence layer (task 8.2):
//   - begin(templateId): present the template's sheets/cells/columns by
//     reading the stored TemplateStructure so the editor can render its grid
//     (R3.1). Structure extraction / inspection lives in Template_Manager
//     (task 8.1); here we read the persisted CustomerTemplate.structure.
//   - loadExisting(templateId): read previously saved Field_Mappings back from
//     `customerTemplates/{templateId}/fieldMappings` (R3.6).
//   - save(templateId, mappings): persist only the non-conflicting mappings to
//     `customerTemplates/{templateId}/fieldMappings`, and withhold only the
//     conflicting ones, associated with the Customer_Template (R3.4, R3.5).
//
// Conflict detection is NOT reimplemented here: it delegates to the pure
// createMapping() from the ingest engine (task 7.3), which resolves
// merge-anchors and detects duplicate-target-cell conflicts. This layer only
// adds Firestore reads/writes around that pure decision.
//
// This is the Laptop_Web_App data-access layer, colocated with Template_Manager
// (task 8.1) in @rnh/shared/data-access under a distinct filename.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { getFirebaseServices } from '../firebase/app';
import { firestorePaths } from '../firebase/collections';
import { createMapping, type MappingConflictReason } from '../template/mapping';
import type { CustomerTemplate, FieldMapping, TemplateStructure } from '../index';

/**
 * Error thrown when a data-access operation references a Customer_Template that
 * does not exist (R3.1, R2.5). Defined here in the Mapping_Editor module and
 * re-used by the Template_Manager module so both surfaces report a missing
 * template with a single, shared symbol.
 */
export class TemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`No Customer_Template found for id "${templateId}".`);
    this.name = 'TemplateNotFoundError';
  }
}

/**
 * A Field_Mapping that was withheld from a save because it conflicted with
 * another mapping targeting the same `(sheet, cell)` (R3.5). The `reason`
 * widens the pure engine's {@link MappingConflictReason} to the design's
 * `SaveResult.withheld` string form.
 */
export interface WithheldMapping {
  mapping: FieldMapping;
  reason: MappingConflictReason | string;
}

/**
 * The outcome of {@link MappingEditorStore.save}: the mappings that were
 * persisted and the conflicting ones that were withheld (design.md,
 * Mapping_Editor -> SaveResult; R3.5).
 */
export interface SaveResult {
  saved: FieldMapping[];
  withheld: WithheldMapping[];
}

/**
 * The persistence surface of the Mapping_Editor bound to a Firestore instance.
 * `createMapping` is intentionally omitted here — it is the pure, side-effect
 * free engine function re-exported from `@rnh/shared` (task 7.3); this store
 * covers only the persistence operations (begin/loadExisting/save).
 */
export interface MappingEditorStore {
  /**
   * Loads the template's structure so the editor can present its sheets,
   * cells, and columns for mapping (R3.1). Reads the persisted
   * {@link CustomerTemplate.structure} written by the Template_Manager.
   *
   * @throws {TemplateNotFoundError} when no template with that id exists.
   */
  begin(templateId: string): Promise<TemplateStructure>;

  /**
   * Loads the Field_Mappings previously saved for a template so editing an
   * existing template starts from its saved state (R3.6).
   */
  loadExisting(templateId: string): Promise<FieldMapping[]>;

  /**
   * Persists a proposed set of Field_Mappings for a template. Non-conflicting
   * mappings are written to `customerTemplates/{templateId}/fieldMappings`;
   * only the conflicting mappings are withheld (R3.4, R3.5). The saved set is
   * made to fully replace any previously stored mappings for the template so a
   * removed mapping does not linger.
   */
  save(templateId: string, mappings: readonly FieldMapping[]): Promise<SaveResult>;
}

/**
 * Builds a lookup of merged ranges per sheet from a {@link TemplateStructure},
 * so `createMapping` can resolve any cell inside a merged range to its anchor
 * before detecting duplicate-target conflicts (design cell-targeting note).
 */
function mergedRangesBySheet(
  structure: TemplateStructure | undefined,
): Record<string, readonly string[]> {
  const byline: Record<string, readonly string[]> = {};
  if (!structure) {
    return byline;
  }
  for (const sheet of structure.sheets) {
    byline[sheet.name] = sheet.mergedRanges;
  }
  return byline;
}

/**
 * The Firestore document shape for a stored Field_Mapping. It mirrors
 * {@link FieldMapping}; `rhParameterName` is optional and omitted (rather than
 * stored as `undefined`, which Firestore rejects) when not set.
 */
type FieldMappingDoc = Omit<FieldMapping, 'rhParameterName'> & {
  rhParameterName?: string;
};

/** Serializes a {@link FieldMapping} to its Firestore document form. */
function toDoc(mapping: FieldMapping): FieldMappingDoc {
  const {
    mappingId,
    templateId,
    sheetName,
    cellAddress,
    inputFieldKey,
    fieldType,
    required,
    rhParameterName,
  } = mapping;
  const docData: FieldMappingDoc = {
    mappingId,
    templateId,
    sheetName,
    cellAddress,
    inputFieldKey,
    fieldType,
    required,
  };
  // Firestore rejects `undefined`; only include the optional field when set.
  if (rhParameterName !== undefined) {
    docData.rhParameterName = rhParameterName;
  }
  return docData;
}

/** Deserializes a Firestore document into a {@link FieldMapping}. */
function fromDoc(data: FieldMappingDoc): FieldMapping {
  const mapping: FieldMapping = {
    mappingId: data.mappingId,
    templateId: data.templateId,
    sheetName: data.sheetName,
    cellAddress: data.cellAddress,
    inputFieldKey: data.inputFieldKey,
    fieldType: data.fieldType,
    required: data.required,
  };
  if (data.rhParameterName !== undefined) {
    mapping.rhParameterName = data.rhParameterName;
  }
  return mapping;
}

/**
 * Creates a {@link MappingEditorStore} bound to a Firestore instance.
 * Defaults to the shared, environment-initialized services so callers can use
 * `createMappingEditorStore()` with no arguments; tests can inject an
 * emulator-backed Firestore.
 */
export function createMappingEditorStore(
  firestoreInstance?: Firestore,
): MappingEditorStore {
  const firestore = firestoreInstance ?? getFirebaseServices().firestore;

  async function readTemplate(templateId: string): Promise<CustomerTemplate> {
    const snapshot = await getDoc(
      doc(firestore, firestorePaths.customerTemplate(templateId)),
    );
    if (!snapshot.exists()) {
      throw new TemplateNotFoundError(templateId);
    }
    return snapshot.data() as CustomerTemplate;
  }

  return {
    async begin(templateId: string): Promise<TemplateStructure> {
      // Present the template's sheets/cells/columns (R3.1) by reading the
      // structure the Template_Manager extracted and stored on upload.
      const template = await readTemplate(templateId);
      return template.structure;
    },

    async loadExisting(templateId: string): Promise<FieldMapping[]> {
      // Editing an existing template loads its previously saved mappings (R3.6).
      const mappingsCol = collection(
        firestore,
        firestorePaths.fieldMappings(templateId),
      );
      const snapshot = await getDocs(mappingsCol);
      return snapshot.docs.map((d) => fromDoc(d.data() as FieldMappingDoc));
    },

    async save(
      templateId: string,
      mappings: readonly FieldMapping[],
    ): Promise<SaveResult> {
      // Resolve conflicts with the pure engine (task 7.3): it resolves
      // merge-anchors using the template's merges and detects duplicate-target
      // conflicts. We do NOT reimplement that logic here (R3.5).
      const template = await readTemplate(templateId);
      const draft = createMapping(mappings, {
        mergedRangesBySheet: mergedRangesBySheet(template.structure),
      });

      const saved = draft.accepted;
      const withheld: WithheldMapping[] = draft.conflicts.map((c) => ({
        mapping: c.mapping,
        reason: c.reason,
      }));

      const mappingsColPath = firestorePaths.fieldMappings(templateId);

      // Fully replace the stored set so a mapping removed in this save does not
      // linger: delete any existing docs not in the new accepted set, then
      // write the accepted set. The persisted set is thereby exactly `saved`,
      // associated with the Customer_Template (R3.4).
      const existing = await getDocs(collection(firestore, mappingsColPath));
      const savedIds = new Set(saved.map((m) => m.mappingId));

      await Promise.all(
        existing.docs
          .filter((d) => !savedIds.has(d.id))
          .map((d) =>
            deleteDoc(doc(firestore, firestorePaths.fieldMapping(templateId, d.id))),
          ),
      );

      // Persist only the non-conflicting mappings (R3.4, R3.5).
      await Promise.all(
        saved.map((mapping) =>
          setDoc(
            doc(firestore, firestorePaths.fieldMapping(templateId, mapping.mappingId)),
            toDoc(mapping),
          ),
        ),
      );

      return { saved, withheld };
    },
  };
}
