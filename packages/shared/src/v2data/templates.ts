// v2 Template_Manager data access (R2, R3, R4 persistence).
//
// Firestore: customerTemplates/{tid} holds the editable draft metadata
// (structure, schema, mappings); customerTemplates/{tid}/versions/{n} holds
// immutable published versions. Workbooks (up to 10 MB, R2.2) live in
// customerTemplates/{tid}/blobs/draft and blobs/v{n} as chunked Firestore
// binary blobs (blobs.ts), never inline: a document is capped at 1 MiB.
// Templates created before this change may still carry inline
// `workbookBytes`; loaders read those first.
// No Cloud Functions: publish copies the draft blob client-side.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  deleteField,
  Bytes,
  type Firestore,
} from 'firebase/firestore';
import { getFirebaseServices } from '../firebase/app';
import {
  emptySchema,
  newId,
  type CustomerTemplateV2,
  type Mapping,
  type TemplateSchema,
  type TemplateStructureV2,
  type TemplateVersion,
} from '../v2/model';
import { readFirestoreBlob, writeFirestoreBlob } from './blobs';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const templatePathsV2 = {
  template: (tid: string) => `customerTemplates/${tid}`,
  versions: (tid: string) => `customerTemplates/${tid}/versions`,
  version: (tid: string, n: number) => `customerTemplates/${tid}/versions/${n}`,
  blobs: (tid: string) => `customerTemplates/${tid}/blobs`,
  draftBlob: (tid: string) => `customerTemplates/${tid}/blobs/draft`,
  versionBlob: (tid: string, n: number) => `customerTemplates/${tid}/blobs/v${n}`,
} as const;

/** Firestore rejects `undefined`; strip it recursively before writing. */
export function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value instanceof Uint8Array) return value;
  if (typeof (value as { toUint8Array?: unknown }).toUint8Array === 'function') return value;
  if (
    typeof value === 'object' &&
    (value.constructor === Object || Object.getPrototypeOf(value) === null)
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Thrown when a template or version has no stored workbook (R12.3). */
export class WorkbookMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookMissingError';
  }
}

/** Inline workbook bytes from a Firestore field, or null when absent/empty. */
export function storedWorkbookBytes(raw: unknown): Uint8Array | null {
  let bytes: Uint8Array | null = null;
  if (raw instanceof Uint8Array) bytes = raw;
  else if (raw && typeof (raw as Bytes).toUint8Array === 'function') {
    bytes = (raw as Bytes).toUint8Array();
  }
  return bytes && bytes.byteLength > 0 ? bytes : null;
}

/**
 * Inline bytes when present, else the chunked blob. A missing or empty
 * workbook raises WorkbookMissingError instead of returning an empty file,
 * so publishing and report generation fail loudly. Other errors (offline,
 * permission) are passed through unchanged.
 */
async function resolveWorkbookBytes(
  raw: unknown,
  readBlob: () => Promise<Uint8Array>,
  missingMessage: string,
): Promise<Uint8Array> {
  const inline = storedWorkbookBytes(raw);
  if (inline) return inline;
  let bytes: Uint8Array;
  try {
    bytes = await readBlob();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Blob not found')) {
      throw new WorkbookMissingError(missingMessage);
    }
    throw e;
  }
  if (bytes.byteLength === 0) throw new WorkbookMissingError(missingMessage);
  return bytes;
}

export interface TemplateStoreDeps {
  firestore?: Firestore;
  /** @deprecated Firebase Storage is no longer used; kept for API compatibility. */
  storage?: unknown;
  now?: () => number;
}

export interface TemplateStoreV2 {
  subscribeTemplates(
    cb: (items: CustomerTemplateV2[]) => void,
    onError?: (e: Error) => void,
  ): () => void;
  getTemplate(tid: string): Promise<CustomerTemplateV2 | null>;
  createTemplate(input: {
    customerName: string;
    templateName: string;
    userId: string;
    bytes: Uint8Array;
    structure: TemplateStructureV2;
    schema?: TemplateSchema;
    mappings?: Mapping[];
  }): Promise<CustomerTemplateV2>;
  replaceDraftWorkbook(
    tid: string,
    bytes: Uint8Array,
    structure: TemplateStructureV2,
    userId: string,
  ): Promise<void>;
  saveDraft(
    tid: string,
    patch: {
      schema?: TemplateSchema;
      mappings?: Mapping[];
      customerName?: string;
      templateName?: string;
    },
    userId: string,
  ): Promise<void>;
  loadDraftBytes(tid: string): Promise<Uint8Array>;
  publish(tid: string, userId: string): Promise<TemplateVersion>;
  setArchived(tid: string, archived: boolean, userId: string): Promise<void>;
  duplicate(
    tid: string,
    customerName: string,
    templateName: string,
    userId: string,
  ): Promise<CustomerTemplateV2>;
  listVersions(tid: string): Promise<TemplateVersion[]>;
  getVersion(tid: string, n: number): Promise<TemplateVersion | null>;
  loadVersionBytes(tid: string, n: number): Promise<Uint8Array>;
  /** Latest published version of every non-archived template (Tester cache, R8.4). */
  listPublishedLatest(): Promise<TemplateVersion[]>;
}

export function createTemplateStoreV2(deps: TemplateStoreDeps = {}): TemplateStoreV2 {
  const lazy = () => (deps.firestore ? null : getFirebaseServices());
  const fs = (): Firestore => deps.firestore ?? lazy()!.firestore;
  const now = deps.now ?? (() => Date.now());

  async function getTemplate(tid: string): Promise<CustomerTemplateV2 | null> {
    const snap = await getDoc(doc(fs(), templatePathsV2.template(tid)));
    return snap.exists() ? (snap.data() as CustomerTemplateV2) : null;
  }

  async function getVersion(tid: string, n: number): Promise<TemplateVersion | null> {
    const snap = await getDoc(doc(fs(), templatePathsV2.version(tid, n)));
    return snap.exists() ? (snap.data() as TemplateVersion) : null;
  }

  const store: TemplateStoreV2 = {
    subscribeTemplates(cb, onError) {
      return onSnapshot(
        collection(fs(), 'customerTemplates'),
        (snap) => {
          const items = snap.docs
            .map((d) => d.data() as CustomerTemplateV2)
            // v1 docs have no draft; hide them from v2 screens.
            .filter((t) => t && typeof t.draft === 'object' && t.draft !== null)
            .sort(
              (a, b) =>
                a.customerName.localeCompare(b.customerName) ||
                a.templateName.localeCompare(b.templateName),
            );
          cb(items);
        },
        (e) => onError?.(e),
      );
    },

    getTemplate,

    async createTemplate(input) {
      const tid = newId('tpl', 10);
      const at = now();
      // Workbook goes to the chunked blob first (up to 10 MB, R2.2). It is no
      // longer embedded in the template doc, which is capped at 1 MiB and is
      // downloaded by every template-list snapshot.
      await writeFirestoreBlob(fs(), templatePathsV2.blobs(tid), 'draft', input.bytes, {
        contentType: XLSX_MIME,
        userId: input.userId,
        now: at,
      });
      const template: CustomerTemplateV2 = {
        templateId: tid,
        customerName: input.customerName.trim(),
        templateName: input.templateName.trim(),
        archived: false,
        latestVersion: 0,
        latestPublishedAt: null,
        draft: {
          storagePath: templatePathsV2.draftBlob(tid),
          structure: input.structure,
          schema: input.schema ?? emptySchema(),
          mappings: input.mappings ?? [],
          updatedAt: at,
          updatedBy: input.userId,
        },
        createdBy: input.userId,
        createdAt: at,
      };
      await setDoc(doc(fs(), templatePathsV2.template(tid)), stripUndefined(template));
      return template;
    },

    async replaceDraftWorkbook(tid, bytes, structure, userId) {
      const at = now();
      await writeFirestoreBlob(fs(), templatePathsV2.blobs(tid), 'draft', bytes, {
        contentType: XLSX_MIME,
        userId,
        now: at,
      });
      await updateDoc(doc(fs(), templatePathsV2.template(tid)), {
        'draft.storagePath': templatePathsV2.draftBlob(tid),
        // Drop any legacy inline copy so loadDraftBytes reads the new blob.
        'draft.workbookBytes': deleteField(),
        'draft.structure': stripUndefined(structure),
        'draft.updatedAt': at,
        'draft.updatedBy': userId,
      });
    },

    async saveDraft(tid, patch, userId) {
      const update: Record<string, unknown> = {
        'draft.updatedAt': now(),
        'draft.updatedBy': userId,
      };
      if (patch.schema) update['draft.schema'] = stripUndefined(patch.schema);
      if (patch.mappings) update['draft.mappings'] = stripUndefined(patch.mappings);
      if (patch.customerName !== undefined) update.customerName = patch.customerName.trim();
      if (patch.templateName !== undefined) update.templateName = patch.templateName.trim();
      await updateDoc(doc(fs(), templatePathsV2.template(tid)), update);
    },

    async loadDraftBytes(tid) {
      const snap = await getDoc(doc(fs(), templatePathsV2.template(tid)));
      if (!snap.exists()) throw new Error('Template not found.');
      const data = snap.data() as Partial<CustomerTemplateV2> & {
        draft?: { workbookBytes?: unknown };
      };
      return resolveWorkbookBytes(
        data?.draft?.workbookBytes,
        () => readFirestoreBlob(fs(), templatePathsV2.blobs(tid), 'draft'),
        'The draft workbook is missing. Upload the Excel file again.',
      );
    },

    publish: async () => {
      throw new Error('not initialised');
    },
    setArchived: async () => undefined,
    duplicate: async () => {
      throw new Error('not initialised');
    },
    listVersions: async () => [],
    getVersion,
    async loadVersionBytes(tid, n) {
      const snap = await getDoc(doc(fs(), templatePathsV2.version(tid, n)));
      if (!snap.exists()) throw new Error('Version not found.');
      const data = snap.data() as Partial<TemplateVersion> & { workbookBytes?: unknown };
      return resolveWorkbookBytes(
        data?.workbookBytes,
        () => readFirestoreBlob(fs(), templatePathsV2.blobs(tid), `v${n}`),
        `The workbook for version ${n} is missing, so no report can be built from it.`,
      );
    },
    listPublishedLatest: async () => [],
  };
  return withPublishing(store, { fs, now, getTemplate, getVersion });
}

interface PublishDeps {
  fs: () => Firestore;
  now: () => number;
  getTemplate: (tid: string) => Promise<CustomerTemplateV2 | null>;
  getVersion: (tid: string, n: number) => Promise<TemplateVersion | null>;
}

function withPublishing(store: TemplateStoreV2, d: PublishDeps): TemplateStoreV2 {
  return {
    ...store,

    /**
     * Publish the draft as a new immutable version (R2.4).
     * The draft workbook is copied into the chunked blob `blobs/v{n}`, then the
     * version doc and the template's latestVersion are written in one transaction.
     */
    async publish(tid, userId) {
      const tpl = await d.getTemplate(tid);
      if (!tpl) throw new Error('Template not found.');
      if (!tpl.draft.structure) throw new Error('Upload a workbook before publishing.');
      const n = (tpl.latestVersion ?? 0) + 1;
      const bytes = await store.loadDraftBytes(tid);
      const at = d.now();
      // Copy the workbook into the immutable v{n} blob before the version doc
      // exists. Rules make the blob final once its meta is written; if two
      // people publish at once, the second write is refused here.
      // A previous attempt may have stored the blob and then failed before the
      // version doc was written: reuse it when it holds the same bytes.
      const existing = await readFirestoreBlob(d.fs(), templatePathsV2.blobs(tid), `v${n}`).catch(
        () => null,
      );
      if (!existing) {
        await writeFirestoreBlob(d.fs(), templatePathsV2.blobs(tid), `v${n}`, bytes, {
          contentType: XLSX_MIME,
          userId,
          now: at,
        });
      } else if (!sameBytes(existing, bytes)) {
        throw new Error('Someone else published meanwhile. Reload and try again.');
      }
      const version: TemplateVersion = {
        templateId: tid,
        customerName: tpl.customerName,
        templateName: tpl.templateName,
        version: n,
        storagePath: templatePathsV2.versionBlob(tid, n),
        structure: tpl.draft.structure,
        schema: tpl.draft.schema,
        mappings: tpl.draft.mappings,
        publishedBy: userId,
        publishedAt: at,
      };
      await runTransaction(d.fs(), async (tx) => {
        const tref = doc(d.fs(), templatePathsV2.template(tid));
        const current = await tx.get(tref);
        const latest = (current.data() as CustomerTemplateV2 | undefined)?.latestVersion ?? 0;
        if (latest !== n - 1)
          throw new Error('Someone else published meanwhile. Reload and try again.');
        tx.set(doc(d.fs(), templatePathsV2.version(tid, n)), stripUndefined(version));
        tx.update(tref, { latestVersion: n, latestPublishedAt: at });
      });
      return version;
    },

    async setArchived(tid, archived, userId) {
      await updateDoc(doc(d.fs(), templatePathsV2.template(tid)), {
        archived,
        'draft.updatedAt': d.now(),
        'draft.updatedBy': userId,
      });
    },

    async duplicate(tid, customerName, templateName, userId) {
      const tpl = await d.getTemplate(tid);
      if (!tpl || !tpl.draft.structure) throw new Error('Template not found.');
      const bytes = await store.loadDraftBytes(tid);
      return store.createTemplate({
        customerName,
        templateName,
        userId,
        bytes,
        structure: tpl.draft.structure,
        schema: tpl.draft.schema,
        mappings: tpl.draft.mappings,
      });
    },

    async listVersions(tid) {
      const snap = await getDocs(
        query(collection(d.fs(), templatePathsV2.versions(tid)), orderBy('version', 'desc')),
      );
      return snap.docs.map((x) => x.data() as TemplateVersion);
    },

    async listPublishedLatest() {
      const snap = await getDocs(collection(d.fs(), 'customerTemplates'));
      const templates = snap.docs
        .map((x) => x.data() as CustomerTemplateV2)
        .filter((t) => t && t.draft && !t.archived && (t.latestVersion ?? 0) > 0);
      const versions = await Promise.all(
        templates.map((t) => d.getVersion(t.templateId, t.latestVersion)),
      );
      return versions
        .filter((v): v is TemplateVersion => v !== null && Boolean(v.schema))
        .map((v) => ({
          ...v,
          schema: v.schema ?? emptySchema(),
        }));
    },
  };
}
