// v2 Test_Session data access (R9, R10, R13). Firestore only, no Cloud Functions.
//
// The phone pushes only its dirty field paths (R9.5), so edits to different
// Rating_Cells from two devices never overwrite each other. The laptop edits
// through `updateFields`, which also appends history entries (R10.4).

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getFirebaseServices } from '../firebase/app';
import type { HistoryEntry, LocalTestSessionV2, TestSessionV2 } from '../v2/model';
import { dirtyPayload } from '../v2/merge';
import { toRemoteSession } from '../v2/session';
import { stripUndefined } from './templates';

export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 24 * 60 * 60 * 1000;

export const sessionPathsV2 = {
  sessions: () => 'testSessions',
  session: (sid: string) => `testSessions/${sid}`,
  history: (sid: string) => `testSessions/${sid}/history`,
} as const;

export function isV2Session(data: unknown): data is TestSessionV2 {
  return (
    !!data && typeof data === 'object' && (data as { schemaVersion?: unknown }).schemaVersion === 2
  );
}

export type PushResult = 'ok' | 'deletedOnServer';

export interface SessionStoreV2 {
  /** Push a local session: full create when new, else only dirty paths. */
  push(session: LocalTestSessionV2): Promise<PushResult>;
  get(sid: string): Promise<TestSessionV2 | null>;
  /** Sessions another user assigned to `uid` (phone pulls them, R14.2). Optional for fakes. */
  listAssigned?(uid: string): Promise<TestSessionV2[]>;
  subscribeAll(cb: (items: TestSessionV2[]) => void, onError?: (e: Error) => void): () => void;
  subscribeOne(
    sid: string,
    cb: (s: TestSessionV2 | null) => void,
    onError?: (e: Error) => void,
  ): () => void;
  /** Laptop edit: field-path update + one history entry per path (R10.3, R10.4). */
  updateFields(
    sid: string,
    changes: { path: string; before: unknown; after: unknown }[],
    by: { uid: string; name: string },
  ): Promise<void>;
  listHistory(sid: string): Promise<HistoryEntry[]>;
  trash(sid: string, uid: string): Promise<void>;
  restore(sid: string, uid: string): Promise<void>;
  /** Permanent delete; rules allow it only 30 days after trashing (R13.2). */
  purge(sid: string): Promise<void>;
}

export function createSessionStoreV2(
  deps: { firestore?: Firestore; now?: () => number } = {},
): SessionStoreV2 {
  const fs = (): Firestore => deps.firestore ?? getFirebaseServices().firestore;
  const now = deps.now ?? (() => Date.now());

  return {
    async push(session) {
      const ref = doc(fs(), sessionPathsV2.session(session.sessionId));
      if (session.isNew) {
        const snap = await getDoc(ref).catch(() => null);
        if (!snap || !snap.exists()) {
          await setDoc(ref, stripUndefined(toRemoteSession(session)));
          return 'ok';
        }
      }
      if (session.dirtyPaths.length === 0) return 'ok';
      const current = await getDoc(ref);
      if (!current.exists()) return 'deletedOnServer';
      const data = current.data() as TestSessionV2;
      if (data.deletedAt) return 'deletedOnServer';
      await updateDoc(ref, stripUndefined(dirtyPayload(session)));
      return 'ok';
    },

    async get(sid) {
      const snap = await getDoc(doc(fs(), sessionPathsV2.session(sid)));
      const data = snap.exists() ? snap.data() : null;
      return isV2Session(data) ? data : null;
    },

    async listAssigned(uid) {
      const snap = await getDocs(
        query(
          collection(fs(), sessionPathsV2.sessions()),
          where('assignedTo', 'array-contains', uid),
        ),
      );
      return snap.docs.map((d) => d.data()).filter(isV2Session);
    },

    subscribeAll(cb, onError) {
      return onSnapshot(
        collection(fs(), sessionPathsV2.sessions()),
        (snap) => {
          const items = snap.docs
            .map((d) => d.data())
            .filter(isV2Session)
            .sort((a, b) => b.updatedAt - a.updatedAt);
          cb(items);
        },
        (e) => onError?.(e),
      );
    },

    subscribeOne(sid, cb, onError) {
      return onSnapshot(
        doc(fs(), sessionPathsV2.session(sid)),
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          cb(isV2Session(data) ? data : null);
        },
        (e) => onError?.(e),
      );
    },

    async updateFields(sid, changes, by) {
      if (changes.length === 0) return;
      const at = now();
      const payload: Record<string, unknown> = { updatedAt: at, updatedBy: by.uid };
      for (const c of changes) payload[c.path] = c.after === undefined ? null : c.after;
      await updateDoc(doc(fs(), sessionPathsV2.session(sid)), stripUndefined(payload));
      // Derived progress is not a user edit; keep it out of the history.
      await Promise.all(
        changes
          .filter((c) => c.path !== 'progress')
          .map((c) =>
            addDoc(
              collection(fs(), sessionPathsV2.history(sid)),
              stripUndefined({
                path: c.path,
                before: c.before ?? null,
                after: c.after ?? null,
                by: by.uid,
                byName: by.name,
                at,
              } satisfies HistoryEntry),
            ),
          ),
      );
    },

    async listHistory(sid) {
      const snap = await getDocs(
        query(collection(fs(), sessionPathsV2.history(sid)), orderBy('at', 'desc')),
      );
      return snap.docs.map((d) => d.data() as HistoryEntry);
    },

    async trash(sid, uid) {
      await updateDoc(doc(fs(), sessionPathsV2.session(sid)), {
        deletedAt: now(),
        deletedBy: uid,
        updatedAt: now(),
        updatedBy: uid,
      });
    },

    async restore(sid, uid) {
      await updateDoc(doc(fs(), sessionPathsV2.session(sid)), {
        deletedAt: null,
        deletedBy: null,
        updatedAt: now(),
        updatedBy: uid,
      });
    },

    async purge(sid) {
      await deleteDoc(doc(fs(), sessionPathsV2.session(sid)));
    },
  };
}

/** Days left before a trashed session can be purged (0 = purgeable). */
export function trashDaysLeft(deletedAt: number | null, at: number = Date.now()): number {
  if (!deletedAt) return TRASH_DAYS;
  return Math.max(0, Math.ceil((deletedAt + TRASH_MS - at) / (24 * 60 * 60 * 1000)));
}
