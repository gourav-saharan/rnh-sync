// Mobile_PWA v2 Sync_Engine (R9). Local-first: the UI saves to IndexedDB, then
// calls `notify()`. The engine pushes only dirty field paths (R9.5), retries
// with backoff 2 s -> 60 s (R9.2), pulls laptop corrections for idle sessions,
// and handles server-side trash (R13.3). Never blocks capture.

import type { LocalTestSessionV2 } from '@rnh/shared/v2';
import { asLocal, dirtyPayload, mergeRemoteIntoLocal } from '@rnh/shared/v2';
import type { SessionStoreV2, TemplateStoreV2 } from '@rnh/shared/v2data';
import type { MobileStoreV2 } from './store';
import { uploadPendingPhotos, type UploadFn } from './photos';

export interface SyncStatusV2 {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastError: string | null;
  lastSyncedAt: number | null;
}

export interface SyncEngineV2 {
  start(): () => void;
  notify(): void;
  syncNow(): Promise<void>;
  refreshTemplates(): Promise<void>;
  getStatus(): SyncStatusV2;
  subscribe(cb: (s: SyncStatusV2) => void): () => void;
}

export interface SyncDeps {
  local: MobileStoreV2;
  remote: SessionStoreV2;
  templates: TemplateStoreV2;
  /** Uploads one queued tyre photo to Storage (R5.8). Omit to skip photos. */
  uploadPhoto?: UploadFn;
  /** Signed-in Tester; when set, tests assigned to them are downloaded (R14.2). */
  userId?: string;
  isOnline?: () => boolean;
  now?: () => number;
}

export const lastSyncedKey = (sid: string) => `lastSynced:${sid}`;

/** Paths whose value changed while the push was in flight stay dirty. */
export function remainingDirty(pushed: LocalTestSessionV2, current: LocalTestSessionV2): string[] {
  const before = dirtyPayload(pushed);
  const pushedSet = new Set(pushed.dirtyPaths);
  const nowVals = dirtyPayload(current);
  return current.dirtyPaths.filter(
    (p) => !pushedSet.has(p) || JSON.stringify(before[p]) !== JSON.stringify(nowVals[p]),
  );
}

/** Push one session and record what is still dirty afterwards. */
export async function pushOne(deps: SyncDeps, s: LocalTestSessionV2): Promise<void> {
  const result = await deps.remote.push(s);
  const current = (await deps.local.getSession(s.sessionId)) ?? s;
  if (result === 'deletedOnServer') {
    await deps.local.saveSession({
      ...current,
      deletedOnServer: true,
      syncState: 'error',
      lastError: 'This test was deleted on the laptop.',
    });
    return;
  }
  const dirty = remainingDirty(s, current);
  await deps.local.saveSession({
    ...current,
    isNew: false,
    dirtyPaths: dirty,
    syncState: dirty.length ? 'saved_local' : 'synced',
    lastError: null,
  });
  await deps.local.setMeta(lastSyncedKey(s.sessionId), s.updatedAt);
}

export type DeletedChoice = 'keep' | 'discard';

/**
 * Resolve a test that was trashed (or purged) on the laptop while this phone
 * still had unsynced edits (R13.3).
 *  - keep: restore the server copy from the trash (or re-create it when it
 *    was purged) and queue the local edits for the next push.
 *  - discard: drop the phone copy.
 */
export async function resolveDeletedOnServer(
  deps: Pick<SyncDeps, 'local' | 'remote'>,
  sessionId: string,
  choice: DeletedChoice,
  uid: string,
): Promise<void> {
  const s = await deps.local.getSession(sessionId);
  if (!s) return;
  if (choice === 'discard') {
    await deps.local.deleteSession(sessionId);
    return;
  }
  const remote = await deps.remote.get(sessionId);
  if (remote && remote.deletedAt) await deps.remote.restore(sessionId, uid);
  await deps.local.saveSession({
    ...s,
    // Purged on the server: push the whole test again as a new document.
    isNew: remote === null ? true : s.isNew,
    deletedOnServer: false,
    deletedAt: null,
    syncState: 'saved_local',
    lastError: null,
  });
}

/** Pull laptop corrections / trash for sessions with nothing pending. */
export async function pullIdle(deps: SyncDeps, now: number): Promise<void> {
  const cutoff = now - 45 * 24 * 3600 * 1000;
  const idle = (await deps.local.listSessions()).filter(
    (s) => !s.isNew && s.dirtyPaths.length === 0 && s.updatedAt > cutoff,
  );
  for (const s of idle) {
    const remote = await deps.remote.get(s.sessionId);
    if (!remote || remote.deletedAt) {
      // Nothing unsynced locally, so it is safe to drop (R13.3).
      await deps.local.deleteSession(s.sessionId);
      continue;
    }
    if (remote.updatedAt !== s.updatedAt) {
      const last = (await deps.local.getMeta<number>(lastSyncedKey(s.sessionId))) ?? 0;
      await deps.local.saveSession(mergeRemoteIntoLocal(s, remote, last));
    }
  }
}

/**
 * Download tests a Report_Viewer assigned to this user that are not on the
 * phone yet, plus their pinned Template_Version when it is not cached.
 * Tests already on the phone are left to pullIdle / the merge, so local
 * edits are never overwritten here.
 */
export async function pullAssigned(deps: SyncDeps): Promise<number> {
  if (!deps.userId || !deps.remote.listAssigned) return 0;
  const assigned = await deps.remote.listAssigned(deps.userId);
  let added = 0;
  for (const remote of assigned) {
    if (remote.deletedAt) continue;
    if (await deps.local.getSession(remote.sessionId)) continue;
    let version = await deps.local.getVersion(remote.templateId, remote.templateVersion);
    if (!version) {
      const v = await deps.templates.getVersion(remote.templateId, remote.templateVersion);
      if (!v) continue; // template not readable yet; try again next pass
      await deps.local.putVersions([v]);
      version = await deps.local.getVersion(remote.templateId, remote.templateVersion);
    }
    const firstParam = version?.schema?.parameters?.[0]?.paramId ?? '';
    const firstSet =
      Object.values(remote.tyreSets).sort((a, b) => a.slot - b.slot)[0]?.tyreSetId ?? '';
    await deps.local.saveSession({
      ...asLocal(remote),
      cursor: { paramId: firstParam, tyreSetId: firstSet, order: 'byTyre', screen: 'setup' },
    });
    await deps.local.setMeta(lastSyncedKey(remote.sessionId), remote.updatedAt);
    added += 1;
  }
  return added;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission|insufficient/i.test(msg)) return 'The server refused the change (permission).';
  if (/offline|network|unavailable/i.test(msg)) return 'No connection. Will retry.';
  return msg || 'Sync failed. Will retry.';
}

const MIN_BACKOFF = 2_000;
const MAX_BACKOFF = 60_000;

export function createSyncEngineV2(deps: SyncDeps): SyncEngineV2 {
  const isOnline =
    deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const now = deps.now ?? (() => Date.now());
  let status: SyncStatusV2 = {
    online: isOnline(),
    syncing: false,
    pendingCount: 0,
    lastError: null,
    lastSyncedAt: null,
  };
  const listeners = new Set<(s: SyncStatusV2) => void>();
  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoff = MIN_BACKOFF;
  let started = false;

  const emit = (patch: Partial<SyncStatusV2>) => {
    status = { ...status, ...patch };
    for (const l of listeners) l(status);
  };

  const refreshPending = async () => {
    const pending = await deps.local.pendingSessions().catch(() => []);
    emit({ pendingCount: pending.filter((s) => !s.deletedOnServer).length });
  };

  const schedule = (ms: number) => {
    if (!started) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void engine.syncNow();
    }, ms);
  };

  async function pass(): Promise<void> {
    emit({ online: isOnline() });
    if (!isOnline()) {
      await refreshPending();
      return;
    }
    emit({ syncing: true });
    let failed: string | null = null;
    try {
      const pending = (await deps.local.pendingSessions()).filter((s) => !s.deletedOnServer);
      for (const s of pending) {
        await deps.local.saveSession({
          ...((await deps.local.getSession(s.sessionId)) ?? s),
          syncState: 'syncing',
        });
        try {
          await pushOne(deps, s);
        } catch (e) {
          failed = errorText(e);
          const cur = (await deps.local.getSession(s.sessionId)) ?? s;
          await deps.local.saveSession({ ...cur, syncState: 'error', lastError: failed });
        }
      }
      if (deps.uploadPhoto) {
        // Photo failures stay queued and never block rating sync.
        await uploadPendingPhotos(deps.local, deps.uploadPhoto).catch(() => undefined);
      }
      if (!failed) await pullIdle(deps, now()).catch(() => undefined);
      if (!failed) await pullAssigned(deps).catch(() => undefined);
    } catch (e) {
      failed = errorText(e);
    }
    await refreshPending();
    emit({ syncing: false, lastError: failed, lastSyncedAt: failed ? status.lastSyncedAt : now() });
    if (failed) {
      schedule(backoff);
      backoff = Math.min(MAX_BACKOFF, backoff * 2);
    } else {
      backoff = MIN_BACKOFF;
    }
  }

  const engine: SyncEngineV2 = {
    start() {
      started = true;
      const onOnline = () => {
        backoff = MIN_BACKOFF;
        emit({ online: true });
        void engine.refreshTemplates();
        void engine.syncNow();
      };
      const onOffline = () => emit({ online: false });
      const onVisible = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible')
          void engine.syncNow();
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
      // Periodic pull so laptop corrections appear without user action.
      const interval = setInterval(() => void engine.syncNow(), 60_000);
      void refreshPending();
      void engine.refreshTemplates();
      void engine.syncNow();
      return () => {
        started = false;
        clearInterval(interval);
        if (timer) clearTimeout(timer);
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', onOnline);
          window.removeEventListener('offline', onOffline);
        }
        if (typeof document !== 'undefined')
          document.removeEventListener('visibilitychange', onVisible);
      };
    },

    notify() {
      void refreshPending();
      // Debounce: coalesce bursts of taps into one push.
      schedule(800);
    },

    async syncNow() {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        do {
          again = false;
          await pass();
        } while (again);
      })().finally(() => {
        running = null;
      });
      return running;
    },

    async refreshTemplates() {
      if (!isOnline()) return;
      try {
        const latest = await deps.templates.listPublishedLatest();
        await deps.local.putVersions(latest);
        await deps.local.setActiveTemplateIds(latest.map((v) => v.templateId));
        await deps.local.setMeta('templatesRefreshedAt', now());
      } catch {
        /* keep the cached versions (R8.3) */
      }
    },

    getStatus: () => status,

    subscribe(cb) {
      listeners.add(cb);
      cb(status);
      return () => listeners.delete(cb);
    },
  };
  return engine;
}
