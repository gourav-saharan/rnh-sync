// v2 Template_Manager data access (R2, R3, R4 persistence).
//
// Firestore: customerTemplates/{tid} holds the editable draft inline;
// customerTemplates/{tid}/versions/{n} holds immutable published versions.
// Blob storage: customerTemplates/{tid}/blobs/draft and
// customerTemplates/{tid}/blobs/v{n} store Excel workbooks as native
// chunked Firestore binary blobs with zero external GCS or CORS dependencies.
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
import { readFirestoreBlob } from './blobs';

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
      const template: CustomerTemplateV2 = {
        templateId: tid,
        customerName: input.customerName.trim(),
        templateName: input.templateName.trim(),
        archived: false,
        latestVersion: 0,
        latestPublishedAt: null,
        draft: {
          storagePath: templatePathsV2.draftBlob(tid),
          workbookBytes: Bytes.fromUint8Array(input.bytes),
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
      await updateDoc(doc(fs(), templatePathsV2.template(tid)), {
        'draft.storagePath': templatePathsV2.draftBlob(tid),
        'draft.workbookBytes': Bytes.fromUint8Array(bytes),
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
      const raw = data?.draft?.workbookBytes;
      if (raw && typeof (raw as Bytes).toUint8Array === 'function') {
        return (raw as Bytes).toUint8Array();
      }
      if (raw instanceof Uint8Array) {
        return raw;
      }
      return await readFirestoreBlob(fs(), templatePathsV2.blobs(tid), 'draft').catch(
        () => new Uint8Array(0),
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
      const raw = data?.workbookBytes;
      if (raw && typeof (raw as Bytes).toUint8Array === 'function') {
        return (raw as Bytes).toUint8Array();
      }
      if (raw instanceof Uint8Array) {
        return raw;
      }
      return await readFirestoreBlob(fs(), templatePathsV2.blobs(tid), `v${n}`).catch(
        () => new Uint8Array(0),
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
     * The workbook bytes are copied from the draft into the version document,
     * then the version doc and the template's latestVersion are written in one transaction.
     */
    async publish(tid, userId) {
      const tpl = await d.getTemplate(tid);
      if (!tpl) throw new Error('Template not found.');
      if (!tpl.draft.structure) throw new Error('Upload a workbook before publishing.');
      const n = (tpl.latestVersion ?? 0) + 1;
      const bytes = await store.loadDraftBytes(tid);
      const at = d.now();
      const version: TemplateVersion = {
        templateId: tid,
        customerName: tpl.customerName,
        templateName: tpl.templateName,
        version: n,
        storagePath: templatePathsV2.versionBlob(tid, n),
        workbookBytes: Bytes.fromUint8Array(bytes),
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
