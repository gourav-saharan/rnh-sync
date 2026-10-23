// Sync_Service — local-first synchronization for the Mobile_PWA (task 14.1).
//
// The Mobile_PWA treats IndexedDB as the offline source of truth: every capture
// change is written locally first (task 12/13, R10.1) and only later pushed to
// Firestore. This service is the "push" half of that story. It:
//
//  - reads dirty / unsynced `LocalTestSession`s from the local store and pushes
//    them to `testSessions/{sessionId}` in Firestore while online
//    (R7.1, R10.3, R10.4);
//  - marks a session `synced` locally once the backend confirms the write —
//    clearing `dirty` and `pendingSince` — and leaves it unsynced on failure so
//    it is retried later (R7.3, R7.5, R10.4);
//  - retries with capped exponential backoff when connectivity returns, without
//    ever blocking the capture flow (it runs in the background and swallows
//    per-session failures);
//  - exposes an observable sync status (pending count / last error / syncing
//    flag) so the capture UI can surface an unsynced indicator (R10.3).
//
// Conflict resolution (per-field, latest-server-timestamp wins, never
// discarding R&H_Parameter notes — R7.4, R6.4) is the shared pure
// `mergeSession` (task 14.2). Before each push this service reads the current
// remote document and routes it, with the local session, through the injectable
// `mergeStrategy` seam (defaulting to `mergeSession`) to produce the document
// to persist. When there is no remote document (a new session) the merge is a
// straight overwrite with the local session.
//
// The service is fully injectable (firestore adapter + local store +
// connectivity + clock + scheduler) so it can be unit-tested deterministically
// against a fake Firestore and a fake-indexeddb-backed store, with no timers or
// real network.
//
// See .kiro/specs/rnh-tyre-testing-system/design.md
//   (Sync_Engine; Offline and Sync Strategy -> Synchronization / Conflict
//   Resolution).

import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import {
  getFirebaseServices,
  firestorePaths,
  mergeSession,
  type LocalTestSession,
  type TestSession,
} from '@rnh/shared';
import { LocalSessionStore, localSessionStore } from '../local';

/**
 * Observable sync status for the whole local store. The capture UI can render
 * an "unsynced" indicator from `pendingCount` (R10.3) and surface `lastError`
 * when a background attempt failed.
 */
export interface SyncStatus {
  /** Number of locally persisted sessions still awaiting confirmation. */
  pendingCount: number;
  /** True while a `syncNow` pass is in flight. */
  syncing: boolean;
  /** When the most recent successful push completed (epoch ms), or null. */
  lastSyncedAt: number | null;
  /** The message of the most recent push failure, or null after a clean pass. */
  lastError: string | null;
}

/** Outcome of a single {@link SyncService.syncNow} pass. */
export interface SyncOutcome {
  /** True when a pass ran and every pending session was confirmed synced. */
  synced: boolean;
  /** How many sessions were confirmed synced in this pass. */
  syncedCount: number;
  /** How many sessions were attempted but failed and remain unsynced. */
  failedCount: number;
  /** True when the pass was skipped because the device was offline. */
  skippedOffline: boolean;
}

/** Reports whether the device currently has connectivity. */
export interface ConnectivityMonitor {
  /** True when the device believes it is online. */
  isOnline(): boolean;
  /**
   * Registers a listener invoked when connectivity is restored. Returns an
   * unsubscribe function. Used to trigger a retry pass (R7.3, R4.5).
   */
  onOnline(listener: () => void): () => void;
}

/**
 * Per-field conflict merge seam (R7.4, R6.4). Given the local session and
 * whatever the backend currently holds (or `undefined` when the doc is new), it
 * returns the `TestSession` document to persist. Defaults to the shared pure
 * `mergeSession` (per-field, latest-server-timestamp wins, notes preserved);
 * a straight overwrite is also available via {@link overwriteMergeStrategy}.
 */
export type MergeStrategy = (
  local: LocalTestSession,
  remote: TestSession | undefined,
) => TestSession;

/** Options for {@link createSyncService}; every dependency is injectable. */
export interface SyncServiceOptions {
  /** The local IndexedDB store. Defaults to the app-wide singleton. */
  store?: LocalSessionStore;
  /** Firestore instance. Defaults to the shared, env-initialized services. */
  firestore?: Firestore;
  /** Connectivity source. Defaults to the browser `navigator.onLine` monitor. */
  connectivity?: ConnectivityMonitor;
  /** Clock used for timestamps and backoff. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Conflict merge seam (R7.4, R6.4). Defaults to the shared per-field,
   * latest-server-timestamp, note-preserving {@link mergeSession}. Inject
   * {@link overwriteMergeStrategy} (local always wins) for a straight push.
   */
  mergeStrategy?: MergeStrategy;
  /** Base backoff delay (ms) between failed retry passes. Default 1000. */
  backoffBaseMs?: number;
  /** Maximum backoff delay (ms). Default 30000. */
  backoffMaxMs?: number;
  /**
   * Schedules a deferred retry after `delayMs`. Defaults to `setTimeout`.
   * Injected in tests so backoff retries are deterministic (no real timers).
   * Returns a cancel function.
   */
  scheduleRetry?: (fn: () => void, delayMs: number) => () => void;
}

/**
 * The local-first Sync_Service. Construct one per app via
 * {@link createSyncService}; call {@link SyncService.start} once to wire up the
 * connectivity-restore retry, and {@link SyncService.enqueue} after each local
 * save to opportunistically push in the background.
 */
export interface SyncService {
  /**
   * Records a local edit and, when online, kicks off a background push. The
   * returned promise resolves as soon as the (already-durable) local write is
   * acknowledged — it never waits on the network, so capture is never blocked
   * (R10.1). The session is expected to have been persisted to the local store
   * by the caller already.
   */
  enqueue(session: LocalTestSession): Promise<void>;

  /**
   * Pushes every pending (dirty or unsynced) local session to Firestore once.
   * Confirmed sessions are marked `synced` locally; failures are retained and
   * left for a later pass (R7.3, R7.5, R10.4). Resolves with the pass outcome.
   * Concurrent calls share the in-flight pass.
   */
  syncNow(): Promise<SyncOutcome>;

  /** Current sync status snapshot (R10.3). */
  getStatus(): SyncStatus;

  /** Subscribes to status changes; returns an unsubscribe function. */
  subscribe(listener: (status: SyncStatus) => void): () => void;

  /**
   * Wires up the connectivity-restore retry (R4.5, R7.3) and runs an initial
   * pass if already online. Returns a stop function that tears the wiring down.
   */
  start(): () => void;

  /** Tears down connectivity wiring (idempotent). */
  stop(): void;
}

/** Default connectivity monitor backed by the browser's online/offline events. */
export function browserConnectivityMonitor(): ConnectivityMonitor {
  return {
    isOnline(): boolean {
      // Default to online when the API is unavailable (e.g. non-browser tests).
      return typeof navigator === 'undefined' ? true : navigator.onLine;
    },
    onOnline(listener: () => void): () => void {
      if (typeof window === 'undefined') {
        return () => {};
      }
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
  };
}

/**
 * Straight push/overwrite strategy: the local session wins outright, ignoring
 * whatever the backend holds. Retained as an explicit opt-in (e.g. for
 * new-document-only flows or tests); the default is now the note-preserving
 * per-field {@link mergeSession} (R7.4, R6.4).
 */
export const overwriteMergeStrategy: MergeStrategy = (local) => toTestSession(local);

/**
 * Default merge strategy: the shared pure per-field, latest-server-timestamp
 * merge that never discards R&H_Parameter notes (R7.4, R6.4). Re-exported here
 * as the Sync_Service's default `MergeStrategy` so `createSyncService()` uses it
 * without extra wiring.
 */
export const defaultMergeStrategy: MergeStrategy = mergeSession;

/** Strips the local-only bookkeeping fields to get the Firestore document shape. */
function toTestSession(local: LocalTestSession): TestSession {
  // Destructure away the local-only fields; the rest is exactly a TestSession.
  const { dirty: _dirty, pendingSince: _pendingSince, ...session } = local;
  return session;
}

/** True when a locally persisted session still awaits sync confirmation. */
function isPending(session: LocalTestSession): boolean {
  return session.dirty || session.syncState === 'unsynced';
}

/**
 * Creates a {@link SyncService}. All dependencies default to production wiring
 * (shared Firestore, singleton local store, browser connectivity, real clock),
 * so `createSyncService()` "just works" in the app; tests inject fakes.
 */
export function createSyncService(options: SyncServiceOptions = {}): SyncService {
  const store = options.store ?? localSessionStore;
  // Resolve Firestore lazily: only touch the shared, env-initialized services
  // when a push actually happens and no instance was injected. This keeps
  // construction side-effect free (no Firebase config load) so the service can
  // be created and unit-tested without environment configuration.
  let firestoreInstance: Firestore | null = options.firestore ?? null;
  const getFirestore = (): Firestore =>
    firestoreInstance ?? (firestoreInstance = getFirebaseServices().firestore);
  const connectivity = options.connectivity ?? browserConnectivityMonitor();
  const now = options.now ?? (() => Date.now());
  const merge = options.mergeStrategy ?? defaultMergeStrategy;
  const backoffBaseMs = options.backoffBaseMs ?? 1000;
  const backoffMaxMs = options.backoffMaxMs ?? 30000;
  const scheduleRetry =
    options.scheduleRetry ??
    ((fn: () => void, delayMs: number): (() => void) => {
      const handle = setTimeout(fn, delayMs);
      return () => clearTimeout(handle);
    });

  let status: SyncStatus = {
    pendingCount: 0,
    syncing: false,
    lastSyncedAt: null,
    lastError: null,
  };
  const listeners = new Set<(status: SyncStatus) => void>();

  // Serializes passes: concurrent syncNow() calls share one in-flight promise.
  let inFlight: Promise<SyncOutcome> | null = null;
  // Counts consecutive failing passes to drive backoff on connectivity retry.
  let consecutiveFailures = 0;
  let stopConnectivity: (() => void) | null = null;
  let cancelRetry: (() => void) | null = null;
  let started = false;

  /** Backoff delay (ms) for the current consecutive-failure streak. */
  function backoffDelay(): number {
    if (consecutiveFailures <= 0) {
      return 0;
    }
    const delay = backoffBaseMs * 2 ** (consecutiveFailures - 1);
    return Math.min(delay, backoffMaxMs);
  }

  function emit(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch };
    for (const listener of listeners) {
      listener(status);
    }
  }

  async function refreshPendingCount(): Promise<void> {
    const all = await store.loadAll();
    emit({ pendingCount: all.filter(isPending).length });
  }

  /**
   * Pushes a single local session to Firestore and, on success, marks it synced
   * locally. Throws on failure so the caller can retain and retry it. The write
   * is routed through the merge seam (R7.4 lives in task 14.2); for 14.1 the
   * default strategy overwrites with the local session.
   */
  async function pushOne(local: LocalTestSession): Promise<void> {
    const sessionRef = doc(
      getFirestore(),
      firestorePaths.testSession(local.sessionId),
    );

    // Read whatever the backend currently holds so the merge can resolve any
    // concurrent edits per field (R7.4). A missing document (new session)
    // yields `undefined`, driving the straight-overwrite path in the merge.
    const remoteSnap = await getDoc(sessionRef);
    const remote = remoteSnap.exists()
      ? (remoteSnap.data() as TestSession)
      : undefined;

    const toWrite = merge(local, remote);

    await setDoc(sessionRef, toWrite);

    // Backend confirmed the write: mark synced and clear local bookkeeping so
    // the session drops out of the pending set (R10.4, R7.5). Re-read to avoid
    // clobbering a concurrent capture edit; if the record changed under us, the
    // capture edit remains dirty and a later pass will resync it.
    const current = await store.load(local.sessionId);
    const confirmed: LocalTestSession = {
      ...(current ?? local),
      syncState: 'synced',
      dirty: false,
      pendingSince: null,
    };
    await store.save(confirmed);
  }

  async function runPass(): Promise<SyncOutcome> {
    if (!connectivity.isOnline()) {
      await refreshPendingCount();
      return { synced: false, syncedCount: 0, failedCount: 0, skippedOffline: true };
    }

    emit({ syncing: true });
    const all = await store.loadAll();
    const pending = all.filter(isPending);

    let syncedCount = 0;
    let failedCount = 0;
    let lastError: string | null = null;

    for (const session of pending) {
      try {
        await pushOne(session);
        syncedCount += 1;
      } catch (error) {
        // Do NOT block or abort the whole pass on one failure: retain the local
        // data and keep going, so one bad session cannot starve the others
        // (R7.3, R7.5). The session stays dirty/unsynced for a later retry.
        failedCount += 1;
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    const remaining = (await store.loadAll()).filter(isPending).length;
    emit({
      syncing: false,
      pendingCount: remaining,
      lastError: failedCount > 0 ? lastError : null,
      lastSyncedAt: syncedCount > 0 ? now() : status.lastSyncedAt,
    });

    return {
      synced: failedCount === 0,
      syncedCount,
      failedCount,
      skippedOffline: false,
    };
  }

  function syncNow(): Promise<SyncOutcome> {
    // Coalesce concurrent callers onto a single in-flight pass.
    if (inFlight) {
      return inFlight;
    }
    inFlight = runPass()
      .then((outcome) => {
        if (outcome.skippedOffline) {
          // Offline is not a failure; leave the backoff counter untouched. The
          // connectivity-restore listener will retry when the network returns.
          return outcome;
        }
        if (outcome.failedCount > 0) {
          consecutiveFailures += 1;
          // Retain the local data and retry later with capped exponential
          // backoff, without blocking the caller (R7.3, R7.5).
          if (cancelRetry) {
            cancelRetry();
          }
          cancelRetry = scheduleRetry(() => {
            cancelRetry = null;
            void syncNow();
          }, backoffDelay());
        } else {
          consecutiveFailures = 0;
        }
        return outcome;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    async enqueue(session: LocalTestSession): Promise<void> {
      // Ensure the edit is durable locally before anything else (R10.1). Callers
      // normally save first, but persisting here is idempotent and makes the
      // local write the one thing enqueue guarantees. This is the only await;
      // the network push is fired in the background so capture is never blocked
      // (R7.3).
      await store.save(session);
      await refreshPendingCount();
      if (connectivity.isOnline()) {
        void syncNow();
      }
    },

    syncNow,

    getStatus(): SyncStatus {
      return status;
    },

    subscribe(listener: (status: SyncStatus) => void): () => void {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },

    start(): () => void {
      if (started) {
        return () => this.stop();
      }
      started = true;

      // Retry when connectivity is restored (R4.5, R7.3). Backoff caps how eager
      // the immediate retry is after repeated failures, so a flapping connection
      // does not spin.
      stopConnectivity = connectivity.onOnline(() => {
        void syncNow();
      });

      // Opportunistic initial pass if we are already online.
      if (connectivity.isOnline()) {
        void syncNow();
      } else {
        void refreshPendingCount();
      }

      return () => this.stop();
    },

    stop(): void {
      if (stopConnectivity) {
        stopConnectivity();
        stopConnectivity = null;
      }
      if (cancelRetry) {
        cancelRetry();
        cancelRetry = null;
      }
      started = false;
    },
  };
}
