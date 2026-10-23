// Laptop-side edits (R10.3). The laptop edits the Firestore copy directly, but
// reuses the SAME pure session operations as the phone: the remote session is
// wrapped as a local one, the edit runs, and the resulting dirty paths become
// field-path changes (with their previous values for the edit history, R10.4).
// Pure.

import { dirtyPayload } from './merge';
import type { LocalTestSessionV2, TestSessionV2 } from './model';

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

/** Bookkeeping paths the store writes itself; never recorded as history. */
const BOOKKEEPING = new Set(['updatedAt', 'updatedBy']);

export function asLocal(remote: TestSessionV2): LocalTestSessionV2 {
  return {
    ...remote,
    dirtyPaths: [],
    isNew: false,
    syncState: 'synced',
    lastError: null,
    cursor: { paramId: '', tyreSetId: '', order: 'byTyre', screen: 'summary' },
  };
}

export function valueAtPath(obj: unknown, path: string): unknown {
  let v: unknown = obj;
  for (const p of path.split('.')) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[p];
  }
  return v;
}

/**
 * Run a pure session edit against a remote session and return the field
 * changes to write. An edit that changes nothing returns [].
 */
export function remoteChanges(
  remote: TestSessionV2,
  edit: (s: LocalTestSessionV2) => LocalTestSessionV2,
): FieldChange[] {
  const local = asLocal(remote);
  const next = edit(local);
  if (next === local || next.dirtyPaths.length === 0) return [];
  const payload = dirtyPayload(next);
  return Object.entries(payload)
    .filter(([path]) => !BOOKKEEPING.has(path))
    .map(([path, after]) => ({ path, before: valueAtPath(remote, path) ?? null, after }));
}
