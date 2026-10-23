// Template_Manager — Firestore + Cloud Storage persistence for Customer_Templates.
//
// This module implements the Template_Manager described in design.md
// (Components and Interfaces -> Template_Manager):
//
//   interface TemplateManager {
//     upload(file, customerName): Promise<CustomerTemplate>;  // R2.1, R2.3
//     list(): Promise<CustomerTemplateSummary[]>;             // R2.4
//     inspect(templateId): Promise<TemplateStructure>;        // R2.5
//     delete(templateId, confirmed): Promise<void>;           // R2.6
//   }
//
// Responsibilities and fidelity-by-preservation notes:
//   - upload validates the file is a real `.xlsx` (via extractTemplateStructure,
//     which rejects invalid files with a descriptive error — R2.3), stores the
//     raw workbook blob unchanged in Cloud Storage at
//     `templates/{templateId}/original.xlsx`, and stores the metadata plus the
//     extracted TemplateStructure in `customerTemplates/{templateId}` so listing
//     and inspection never re-download the blob (R2.1, R2.2, R2.5).
//   - list projects the stored templates to {templateId, customerName,
//     uploadDate} without reading their full structure (R2.4).
//   - inspect returns the stored TemplateStructure for a template (R2.5).
//   - delete is confirmation-gated: it does nothing until `confirmed` is true,
//     then removes both the Firestore metadata and the Cloud Storage blob (R2.6).
//
// This is the Laptop_Web_App data-access layer. It lives in @rnh/shared so the
// laptop app can consume it, and it takes its Firebase services from
// getFirebaseServices() with injectable overrides for tests. It shares the
// `data-access` folder with the Mapping_Editor persistence (task 8.2) and
// reuses its TemplateNotFoundError for a consistent not-found error.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp as FirestoreTimestamp,
  type Firestore,
} from 'firebase/firestore';
import {
  deleteObject,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';
import { firestorePaths, templateStoragePath } from '../firebase/collections';
import { getFirebaseServices } from '../firebase/app';
import { extractTemplateStructure, type WorkbookBytes } from '../template/extract';
import type {
  CustomerTemplate,
  CustomerTemplateSummary,
  TemplateStructure,
  Timestamp,
} from '../index';

/** The Template_Manager surface consumed by the Laptop_Web_App (design.md). */
export interface TemplateManager {
  /** Validate + store a Customer_Template (blob + metadata) (R2.1, R2.3). */
  upload(file: TemplateUploadFile, customerName: string): Promise<CustomerTemplate>;
  /** List stored templates with customer name and upload date (R2.4). */
  list(): Promise<CustomerTemplateSummary[]>;
  /** Return a stored template's structure (sheets + dimensions) (R2.5). */
  inspect(templateId: string): Promise<TemplateStructure>;
  /** Confirmation-gated removal of metadata + blob (R2.6). */
  delete(templateId: string, confirmed: boolean): Promise<void>;
}

/**
 * The accepted upload input. The Laptop_Web_App passes a browser `File`/`Blob`
 * (which exposes `arrayBuffer()`); tests and back-end callers can pass raw
 * bytes directly. Keeping this permissive means the same manager works in the
 * browser and in emulator/integration tests.
 */
export type TemplateUploadFile = WorkbookBytes | { arrayBuffer(): Promise<ArrayBuffer> };

/**
 * Error thrown when a requested Customer_Template does not exist in Firestore,
 * e.g. on {@link TemplateManager.inspect} of an unknown id. Carries a
 * descriptive, user-facing message.
 */
export class TemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`No Customer_Template was found for id "${templateId}".`);
    this.name = 'TemplateNotFoundError';
  }
}

/**
 * Error thrown when {@link TemplateManager.delete} is called without an
 * explicit confirmation. Deletion must be confirmed by the user first (R2.6).
 */
export class DeletionNotConfirmedError extends Error {
  constructor(templateId: string) {
    super(
      `Deletion of Customer_Template "${templateId}" was not confirmed. ` +
        'Confirm the deletion before it can be removed.',
    );
    this.name = 'DeletionNotConfirmedError';
  }
}

/** Options for {@link createTemplateManager}. */
export interface TemplateManagerOptions {
  firestore?: Firestore;
  storage?: FirebaseStorage;
  /**
   * Generates the id for a newly uploaded template. Defaults to a Firestore
   * auto-id; injectable so tests can produce deterministic ids.
   */
  generateId?: () => string;
  /** The uid recorded as the template's creator. Optional for tests. */
  currentUid?: () => string;
}

/** Normalises the permissive upload input to raw {@link WorkbookBytes}. */
async function toBytes(file: TemplateUploadFile): Promise<WorkbookBytes> {
  if (
    typeof file === 'object' &&
    file !== null &&
    'arrayBuffer' in file &&
    typeof (file as { arrayBuffer: unknown }).arrayBuffer === 'function'
  ) {
    return (file as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer();
  }
  return file as WorkbookBytes;
}

/** Converts {@link WorkbookBytes} to a Uint8Array for Cloud Storage upload. */
function toUint8Array(bytes: WorkbookBytes): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  return new Uint8Array(bytes);
}

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Reads a Firestore timestamp-ish value back into the backend-neutral
 * {@link Timestamp} (milliseconds since epoch) the shared types use.
 */
function toMillis(value: unknown): Timestamp {
  if (value instanceof FirestoreTimestamp) {
    return value.toMillis();
  }
  if (typeof value === 'number') {
    return value;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'seconds' in value &&
    typeof (value as { seconds: unknown }).seconds === 'number'
  ) {
    const { seconds, nanoseconds } = value as {
      seconds: number;
      nanoseconds?: number;
    };
    return seconds * 1000 + Math.floor((nanoseconds ?? 0) / 1_000_000);
  }
  return 0;
}

/**
 * Creates a {@link TemplateManager} bound to the given Firebase services.
 * Defaults to the shared, environment-initialized services so the laptop app
 * can call {@link createTemplateManager} with no arguments; tests inject
 * emulator-backed instances and deterministic id/uid generators.
 */
export function createTemplateManager(
  options: TemplateManagerOptions = {},
): TemplateManager {
  const needsServices = !options.firestore || !options.storage;
  const services = needsServices ? getFirebaseServices() : null;
  const firestore = options.firestore ?? services!.firestore;
  const storage = options.storage ?? services!.storage;

  const generateId =
    options.generateId ??
    (() => doc(collection(firestore, firestorePaths.customerTemplates())).id);

  const currentUid = options.currentUid ?? (() => '');

  return {
    async upload(
      file: TemplateUploadFile,
      customerName: string,
    ): Promise<CustomerTemplate> {
      const bytes = await toBytes(file);

      // Validate the file is a real .xlsx and extract its structure in one
      // step. extractTemplateStructure throws InvalidTemplateFileError with a
      // descriptive message for invalid files (R2.3) and yields the sheets,
      // order, dimensions, and merges we persist as metadata (R2.2, R2.5).
      const structure = await extractTemplateStructure(bytes);

      const templateId = generateId();
      const storagePath = templateStoragePath(templateId);

      // Store the raw workbook blob unchanged in Cloud Storage so report
      // generation can later preserve the original bytes (fidelity-by-
      // preservation). Path convention: templates/{templateId}/original.xlsx.
      const blobRef = ref(storage, storagePath);
      await uploadBytes(blobRef, toUint8Array(bytes), {
        contentType: XLSX_CONTENT_TYPE,
      });

      const uploadDate = Date.now();
      const template: CustomerTemplate = {
        templateId,
        customerName,
        storagePath,
        uploadDate,
        structure,
        createdBy: currentUid(),
      };

      // Store metadata + extracted structure in Firestore so list/inspect never
      // re-download the blob (R2.1, R2.4, R2.5).
      await setDoc(doc(firestore, firestorePaths.customerTemplate(templateId)), {
        ...template,
        uploadDate: FirestoreTimestamp.fromMillis(uploadDate),
      });

      return template;
    },

    async list(): Promise<CustomerTemplateSummary[]> {
      const snapshot = await getDocs(
        collection(firestore, firestorePaths.customerTemplates()),
      );

      // Project to the listing summary only — customer name + upload date —
      // without carrying each template's full structure (R2.4).
      return snapshot.docs.map((d) => {
        const data = d.data() as Partial<CustomerTemplate>;
        return {
          templateId: data.templateId ?? d.id,
          customerName: data.customerName ?? '',
          uploadDate: toMillis(data.uploadDate),
        };
      });
    },

    async inspect(templateId: string): Promise<TemplateStructure> {
      const snapshot = await getDoc(
        doc(firestore, firestorePaths.customerTemplate(templateId)),
      );

      if (!snapshot.exists()) {
        throw new TemplateNotFoundError(templateId);
      }

      const data = snapshot.data() as Partial<CustomerTemplate>;
      // Return the stored structure: each sheet name and its cell dimensions
      // (R2.5). Fall back to an empty sheet list if somehow absent.
      return data.structure ?? { sheets: [] };
    },

    async delete(templateId: string, confirmed: boolean): Promise<void> {
      // Confirmation-gated: do nothing destructive until the user confirms (R2.6).
      if (!confirmed) {
        throw new DeletionNotConfirmedError(templateId);
      }

      // Remove the Firestore metadata and the Cloud Storage blob (R2.6).
      await deleteDoc(doc(firestore, firestorePaths.customerTemplate(templateId)));

      const blobRef = ref(storage, templateStoragePath(templateId));
      try {
        await deleteObject(blobRef);
      } catch (cause) {
        // A missing blob (already gone) should not fail the deletion — the
        // user's intent (remove the template) is still satisfied. Re-throw any
        // other storage error.
        const code =
          typeof cause === 'object' && cause !== null && 'code' in cause
            ? String((cause as { code: unknown }).code)
            : '';
        if (code !== 'storage/object-not-found') {
          throw cause;
        }
      }
    },
  };
}
