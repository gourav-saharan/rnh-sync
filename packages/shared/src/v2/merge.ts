// v2 Sync_Engine merge (R9.4, R9.5). Pure.
//
// The phone pushes only `dirtyPaths` as Firestore field-path updates, so two
// devices editing different cells never overwrite each other. When a remote
// snapshot arrives, `mergeRemoteIntoLocal` folds it into the local copy:
//   - paths NOT dirty locally take the remote value;
//   - dirty paths keep the local value (it is about to be pushed), except a
//     comment edited on both sides since the last sync: both texts are kept
//     and the cell is flagged `conflict` for review.

import { joinComment } from './session';
import type { LocalTestSessionV2, RatingCell, TestSessionV2 } from './model';

function isDirty(dirty: readonly string[], path: string): boolean {
  return dirty.some((d) => d === path || path.startsWith(`${d}.`) || d.startsWith(`${path}.`));
}

function mergeCell(
  local: RatingCell | undefined,
  remote: RatingCell | undefined,
  dirty: boolean,
  lastSyncedAt: number,
): RatingCell | undefined {
  if (!dirty) return remote ?? local;
  if (!local) return remote;
  if (!remote) return local;
  // Remote changed after our last sync while we also changed it locally.
  const remoteNewer = remote.updatedAt > lastSyncedAt;
  const lc = local.comment.trim();
  const rc = remote.comment.trim();
  if (remoteNewer && lc !== rc && rc !== '' && lc !== '' && !lc.includes(rc)) {
    return { ...local, comment: joinComment(rc, lc), conflict: true };
  }
  return local;
}

/**
 * Fold a remote TestSessionV2 into the local copy. `lastSyncedAt` is the
 * local `updatedAt` at the last successful push (0 when never synced).
 */
export function mergeRemoteIntoLocal(
  local: LocalTestSessionV2,
  remote: TestSessionV2,
  lastSyncedAt: number,
): LocalTestSessionV2 {
  const dirty = local.dirtyPaths;
  if (dirty.length === 0) {
    return { ...local, ...remote, syncState: 'synced', isNew: false, lastError: null };
  }
  const cells: Record<string, RatingCell> = {};
  const keys = new Set([...Object.keys(local.cells), ...Object.keys(remote.cells ?? {})]);
  const extraDirty: string[] = [];
  for (const k of keys) {
    const d = isDirty(dirty, `cells.${k}`);
    const merged = mergeCell(local.cells[k], remote.cells?.[k], d, lastSyncedAt);
    if (merged) cells[k] = merged;
    if (merged?.conflict && !local.cells[k]?.conflict) extraDirty.push(`cells.${k}`);
  }
  const header = { ...remote.header };
  for (const [f, v] of Object.entries(local.header)) {
    if (isDirty(dirty, `header.${f}`)) header[f] = v;
  }
  const tyreSets = { ...remote.tyreSets };
  for (const [id, t] of Object.entries(local.tyreSets)) {
    if (isDirty(dirty, `tyreSets.${id}`) || isDirty(dirty, 'tyreSets')) tyreSets[id] = t;
  }
  if (isDirty(dirty, 'tyreSets')) {
    for (const id of Object.keys(tyreSets)) if (!local.tyreSets[id]) delete tyreSets[id];
  }
  const scalar = <K extends keyof TestSessionV2>(k: K): TestSessionV2[K] =>
    isDirty(dirty, String(k)) ? local[k] : remote[k];
  return {
    ...local,
    ...remote,
    header,
    tyreSets,
    cells,
    status: scalar('status'),
    progress: scalar('progress'),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt ?? 0),
    dirtyPaths: [...new Set([...dirty, ...extraDirty])],
    isNew: false,
    syncState: local.syncState,
    lastError: local.lastError,
    cursor: local.cursor,
  };
}

/** Build the Firestore update payload (field path -> value) for dirty paths. */
export function dirtyPayload(session: LocalTestSessionV2): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of session.dirtyPaths) {
    const parts = path.split('.');
    let v: unknown = session;
    for (const p of parts)
      v = v === null || v === undefined ? undefined : (v as Record<string, unknown>)[p];
    out[path] = v === undefined ? null : v;
  }
  return out;
}
