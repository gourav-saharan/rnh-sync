// Mobile_PWA v2 offline store (R8). IndexedDB is the source of truth on the
// phone: every edit is written here BEFORE the UI shows it as saved (R8.1).
// A separate database from v1 so existing v1 local data is never touched.

import Dexie, { type Table } from 'dexie';
import type { LocalTestSessionV2, TemplateVersion } from '@rnh/shared/v2';

export const V2_DB_NAME = 'rnh-mobile-v2';

export interface CachedVersion extends TemplateVersion {
  /** `${templateId}#${version}` */
  key: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/** A tyre photo kept on the phone until it is uploaded to Storage (R5.8). */
export interface PhotoRow {
  /** Storage path, e.g. sessions/{sid}/photos/{file}. Also the primary key. */
  path: string;
  sessionId: string;
  tyreSetId: string;
  blob: Blob;
  contentType: string;
  /** 0 = waiting for upload, 1 = uploaded (numbers so Dexie can index it). */
  uploaded: 0 | 1;
  createdAt: number;
}

export class MobileV2Database extends Dexie {
  sessions!: Table<LocalTestSessionV2, string>;
  versions!: Table<CachedVersion, string>;
  meta!: Table<MetaRow, string>;
  photos!: Table<PhotoRow, string>;

  constructor(name: string = V2_DB_NAME) {
    super(name);
    this.version(1).stores({
      sessions: 'sessionId, updatedAt, syncState, templateId',
      versions: 'key, templateId, version',
      meta: 'key',
    });
    // v2 adds the photo queue; existing stores are kept unchanged.
    this.version(2).stores({
      sessions: 'sessionId, updatedAt, syncState, templateId',
      versions: 'key, templateId, version',
      meta: 'key',
      photos: 'path, sessionId, tyreSetId, uploaded',
    });
  }
}

export function versionKey(templateId: string, version: number): string {
  return `${templateId}#${version}`;
}

export class MobileStoreV2 {
  constructor(readonly db: MobileV2Database = new MobileV2Database()) {}

  /** Resolves only after the IndexedDB transaction commits (R8.1). */
  async saveSession(s: LocalTestSessionV2): Promise<void> {
    await this.db.sessions.put(s);
  }

  getSession(id: string): Promise<LocalTestSessionV2 | undefined> {
    return this.db.sessions.get(id);
  }

  async listSessions(): Promise<LocalTestSessionV2[]> {
    const all = await this.db.sessions.toArray();
    return all.filter((s) => !s.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async pendingSessions(): Promise<LocalTestSessionV2[]> {
    const all = await this.db.sessions.toArray();
    return all.filter((s) => s.isNew || s.dirtyPaths.length > 0);
  }

  deleteSession(id: string): Promise<void> {
    return this.db.sessions.delete(id);
  }

  async putVersions(list: readonly TemplateVersion[]): Promise<void> {
    await this.db.versions.bulkPut(
      list.map((v) => ({ ...v, key: versionKey(v.templateId, v.version) })),
    );
  }

  getVersion(templateId: string, version: number): Promise<CachedVersion | undefined> {
    return this.db.versions.get(versionKey(templateId, version));
  }

  /** Latest cached version per template, for the new-session picker. */
  async latestVersions(): Promise<CachedVersion[]> {
    const all = await this.db.versions.toArray();
    const best = new Map<string, CachedVersion>();
    for (const v of all) {
      const cur = best.get(v.templateId);
      if (!cur || v.version > cur.version) best.set(v.templateId, v);
    }
    return [...best.values()].sort(
      (a, b) =>
        a.customerName.localeCompare(b.customerName) ||
        a.templateName.localeCompare(b.templateName),
    );
  }

  /** Only templates still published (non-archived) are offered for new sessions. */
  async setActiveTemplateIds(ids: readonly string[]): Promise<void> {
    await this.db.meta.put({ key: 'activeTemplateIds', value: [...ids] });
  }

  async activeTemplateIds(): Promise<string[] | null> {
    const row = await this.db.meta.get('activeTemplateIds');
    return Array.isArray(row?.value) ? (row!.value as string[]) : null;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  /** Resolves after the photo is durably stored on the phone. */
  async savePhoto(row: PhotoRow): Promise<void> {
    await this.db.photos.put(row);
  }

  pendingPhotos(): Promise<PhotoRow[]> {
    return this.db.photos.where('uploaded').equals(0).toArray();
  }

  async markPhotoUploaded(path: string): Promise<void> {
    await this.db.photos.update(path, { uploaded: 1 });
  }

  photosOf(sessionId: string, tyreSetId: string): Promise<PhotoRow[]> {
    return this.db.photos
      .where('sessionId')
      .equals(sessionId)
      .filter((p) => p.tyreSetId === tyreSetId)
      .toArray();
  }
}

let shared: MobileStoreV2 | null = null;
export function mobileStoreV2(): MobileStoreV2 {
  shared ??= new MobileStoreV2();
  return shared;
}

/** Ask the browser to keep our data (R8.5). Returns the granted flag or null if unsupported. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const sm = (navigator as Navigator & { storage?: StorageManager }).storage;
    if (!sm || typeof sm.persist !== 'function') return null;
    if (typeof sm.persisted === 'function' && (await sm.persisted())) return true;
    return await sm.persist();
  } catch {
    return null;
  }
}
