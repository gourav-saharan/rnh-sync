// Local (IndexedDB) persistence layer for the Mobile_PWA.
//
// The Mobile_PWA treats IndexedDB as the offline source of truth for in-progress
// Test_Sessions. This module wraps a Dexie database exposing a single
// `localSessions` object store keyed by `sessionId`, holding the full
// `LocalTestSession` shape (a `TestSession` plus the `dirty` flag and
// `pendingSince` timestamp).
//
// It implements two behaviours the design calls out:
//  - save-before-confirm: `save` persists the session to IndexedDB and only
//    resolves once the write has committed, so callers can show a saved
//    confirmation strictly after the data is durable (R10.1).
//  - load/restore of the most recent in-progress session on reopen (R5.6, R10.2).
//
// See .kiro/specs/rnh-tyre-testing-system/design.md
//   (Data Models -> Local (IndexedDB) Model on Mobile_PWA).

import Dexie, { type Table } from 'dexie';
import type { LocalTestSession } from '@rnh/shared';

/** The object-store name for locally persisted Test_Sessions. */
export const LOCAL_SESSIONS_STORE = 'localSessions';

/** Default database name; overridable for tests to get isolated databases. */
export const DEFAULT_DB_NAME = 'rnh-mobile-pwa';

/**
 * Dexie database exposing the `localSessions` store.
 *
 * The primary key is `sessionId`. `dirty`, `pendingSince`, `syncState`, and
 * `updatedAt` are indexed so restore queries (most recent in-progress session)
 * and future sync queries stay efficient.
 */
export class LocalSessionDatabase extends Dexie {
  localSessions!: Table<LocalTestSession, string>;

  constructor(dbName: string = DEFAULT_DB_NAME) {
    super(dbName);
    this.version(1).stores({
      // sessionId is the primary key; the remaining fields are secondary indexes.
      [LOCAL_SESSIONS_STORE]: 'sessionId, dirty, pendingSince, syncState, updatedAt',
    });
  }
}

/**
 * A thin, promise-based wrapper over the `localSessions` object store.
 *
 * All mutating methods await the underlying IndexedDB transaction before
 * resolving, which is what makes "save before confirm" reliable: the returned
 * promise settles only after the value is durably written.
 */
export class LocalSessionStore {
  private readonly db: LocalSessionDatabase;

  constructor(db: LocalSessionDatabase = new LocalSessionDatabase()) {
    this.db = db;
  }

  /**
   * Persist a Test_Session to IndexedDB and resolve only after the write has
   * committed. Returns the exact record that was stored so callers can display
   * a saved confirmation knowing the data is durable (R10.1).
   */
  async save(session: LocalTestSession): Promise<LocalTestSession> {
    await this.db.localSessions.put(session);
    return session;
  }

  /** Load a single session by id, or `undefined` if none is stored. */
  async load(sessionId: string): Promise<LocalTestSession | undefined> {
    return this.db.localSessions.get(sessionId);
  }

  /** Return every locally persisted session. */
  async loadAll(): Promise<LocalTestSession[]> {
    return this.db.localSessions.toArray();
  }

  /**
   * Restore the most recent in-progress session (R5.6, R10.2).
   *
   * "In progress" means not yet confirmed as synchronized (`dirty === true` or
   * `syncState === 'unsynced'`). "Most recent" is decided by the highest
   * `updatedAt` timestamp. Returns `undefined` when there is nothing to restore.
   */
  async loadMostRecentInProgress(): Promise<LocalTestSession | undefined> {
    const sessions = await this.db.localSessions.toArray();
    const inProgress = sessions.filter(
      (s) => s.dirty || s.syncState === 'unsynced',
    );
    if (inProgress.length === 0) {
      return undefined;
    }
    return inProgress.reduce((latest, current) =>
      current.updatedAt > latest.updatedAt ? current : latest,
    );
  }

  /** Remove a single session by id (e.g. after a confirmed delete). */
  async remove(sessionId: string): Promise<void> {
    await this.db.localSessions.delete(sessionId);
  }

  /** Remove every locally persisted session. */
  async clear(): Promise<void> {
    await this.db.localSessions.clear();
  }
}

/** Shared singleton store for the running app (tests construct their own). */
export const localSessionStore = new LocalSessionStore();
