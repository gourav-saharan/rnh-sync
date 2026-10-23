// Per-field, latest-server-timestamp conflict merge for Test_Sessions
// (task 14.2, R7.4, R6.4).
//
// When the same Test_Session is edited on two devices, the Sync_Engine must
// resolve the conflict deterministically without losing work:
//
//   - Per field, the value carrying the latest Firebase-server-received
//     timestamp wins (R7.4). The per-field timestamps live in
//     `TestSession.fieldTimestamps`, keyed by the `inputFieldKey` conventions
//     (see the shared index). A field present in only one side's timestamp map
//     is treated as newer there.
//   - R&H_Parameter *notes* are NEVER discarded on conflict (R6.4, Property 12
//     "preserves both note texts"). Where two devices captured different note
//     text for the same parameter, both texts are preserved as distinct
//     entries rather than letting the latest-timestamp rule drop one.
//
// This module is pure (no Firebase, no React, no storage) so it can be reused
// by the Mobile_PWA Sync_Service as its `MergeStrategy` and exercised directly
// by property tests (task 14.3).
//
// The merge is intentionally conservative: it only diverges from a straight
// "latest wins" field-by-field where the design demands it (notes). When there
// is no remote document (a brand-new session), the local session passes
// through unchanged so the straight-overwrite path in the Sync_Service keeps
// working.
//
// See .kiro/specs/rnh-tyre-testing-system/design.md
//   (Sync_Engine; Property 12: Per-field conflict merge).

import {
  inputFieldKey,
  type LocalTestSession,
  type RHCategory,
  type RHParameterEntry,
  type TestSession,
  type Timestamp,
} from '../index';

/** Strips the local-only bookkeeping fields to get the Firestore document shape. */
function toTestSession(local: LocalTestSession): TestSession {
  const { dirty: _dirty, pendingSince: _pendingSince, ...session } = local;
  return session;
}

/**
 * Returns the per-field timestamp for `key`, or `-Infinity` when the field has
 * no recorded timestamp. Treating an absent timestamp as `-Infinity` means a
 * side that has a timestamp for a field always wins over a side that does not,
 * and when neither side has one the tie-break below applies.
 */
function tsOf(session: TestSession, key: string): number {
  const ts = session.fieldTimestamps[key];
  return typeof ts === 'number' ? ts : Number.NEGATIVE_INFINITY;
}

/**
 * Chooses, for a single field `key`, whether the local or remote value wins by
 * latest server timestamp (R7.4). Ties (equal or both-absent timestamps)
 * resolve to the remote value, because remote is the value the backend has
 * already confirmed; this keeps the merge idempotent (merging an already-synced
 * value against itself is a no-op).
 */
function localWins(local: TestSession, remote: TestSession, key: string): boolean {
  return tsOf(local, key) > tsOf(remote, key);
}

/** Picks the field value from local or remote by latest timestamp for `key`. */
function pick<T>(
  local: TestSession,
  remote: TestSession,
  key: string,
  localValue: T,
  remoteValue: T,
): T {
  return localWins(local, remote, key) ? localValue : remoteValue;
}

/**
 * Preserves both note texts on conflict (R6.4, Property 12). Returns a note
 * string that contains every distinct, non-empty note text from `localNote`
 * and `remoteNote`:
 *
 *   - identical notes collapse to one (no duplication);
 *   - when only one side has a note, that note is kept verbatim;
 *   - when both sides have differing non-empty notes, both are preserved,
 *     joined by a newline, remote first (the backend-confirmed text) then local,
 *     so neither tester's note is ever lost.
 *
 * The latest-timestamp rule is deliberately NOT applied to note text: dropping
 * a note because the other device's field timestamp was newer would discard a
 * tester's note, which R6.4 forbids.
 */
export function mergeNote(localNote: string, remoteNote: string): string {
  const local = localNote.trim();
  const remote = remoteNote.trim();
  if (local === '' && remote === '') {
    return '';
  }
  if (local === '') {
    return remoteNote;
  }
  if (remote === '') {
    return localNote;
  }
  if (local === remote) {
    return remoteNote;
  }
  // Both sides carry distinct notes: preserve both as distinct entries.
  return `${remoteNote}\n${localNote}`;
}

/**
 * Merges the parameter entries of one R&H category (Ride or Handling). The
 * category's parameter set is the union of both sides' parameters, matched by
 * name. For each matched parameter:
 *   - the rating is chosen by the latest per-field timestamp (R7.4), keyed by
 *     `rhRating.<category>.<name>`;
 *   - the note preserves both texts (R6.4) via {@link mergeNote}.
 * Parameters present on only one side are carried through unchanged.
 *
 * `averageRating` is taken by the same latest-timestamp rule as the category's
 * ratings, keyed by `rhRating.<category>.<name>` collectively is not meaningful,
 * so we recompute nothing here (averaging is a separate concern, R6.5) and
 * instead keep the winning side's stored average keyed by
 * `<categoryKey>.averageRating`.
 */
function mergeCategory(
  categoryKey: 'ride' | 'handling',
  local: TestSession,
  remote: TestSession,
  localCat: RHCategory,
  remoteCat: RHCategory,
): RHCategory {
  const byName = new Map<string, { local?: RHParameterEntry; remote?: RHParameterEntry }>();
  for (const p of remoteCat.parameters) {
    byName.set(p.name, { remote: p });
  }
  for (const p of localCat.parameters) {
    const existing = byName.get(p.name) ?? {};
    existing.local = p;
    byName.set(p.name, existing);
  }

  const parameters: RHParameterEntry[] = [];
  for (const [name, pair] of byName) {
    if (pair.local && pair.remote) {
      const ratingKey = inputFieldKey.rhRating(categoryKey, name);
      const rating = pick(local, remote, ratingKey, pair.local.rating, pair.remote.rating);
      // Notes are preserved (never dropped) regardless of the timestamp winner.
      const note = mergeNote(pair.local.note, pair.remote.note);
      parameters.push({ name, rating, note });
    } else if (pair.local) {
      parameters.push(pair.local);
    } else if (pair.remote) {
      parameters.push(pair.remote);
    }
  }

  const avgKey = `${categoryKey}.averageRating`;
  const averageRating = pick(
    local,
    remote,
    avgKey,
    localCat.averageRating,
    remoteCat.averageRating,
  );

  return { parameters, averageRating };
}

/**
 * Builds the merged `fieldTimestamps` map by taking, per field key, the later
 * of the two recorded timestamps. This keeps the merged document's timestamps
 * consistent with the values chosen field-by-field and makes the merge
 * idempotent and monotonic (a subsequent merge never rolls a timestamp back).
 */
function mergeFieldTimestamps(
  local: TestSession,
  remote: TestSession,
): Record<string, Timestamp> {
  const merged: Record<string, Timestamp> = { ...remote.fieldTimestamps };
  for (const [key, ts] of Object.entries(local.fieldTimestamps)) {
    const existing = merged[key];
    merged[key] = typeof existing === 'number' ? Math.max(existing, ts) : ts;
  }
  return merged;
}

/**
 * Merges a local Test_Session against the current remote document by the
 * per-field, latest-server-timestamp rule (R7.4), never discarding
 * R&H_Parameter notes (R6.4, Property 12).
 *
 * When `remote` is `undefined` (a brand-new session the backend has not seen),
 * the local session passes through unchanged as a straight write — this keeps
 * the Sync_Service's new-document path working exactly as before.
 *
 * The returned document is a `TestSession` (local-only bookkeeping stripped),
 * ready to persist to `testSessions/{sessionId}`.
 */
export function mergeSession(
  local: LocalTestSession,
  remote: TestSession | undefined,
): TestSession {
  const localSession = toTestSession(local);
  if (!remote) {
    // New document: straight overwrite with the local session.
    return localSession;
  }

  // Scalar / grouped fields resolved by their input-field-key timestamps.
  const tyreSets = pick(
    localSession,
    remote,
    'tyreSets',
    localSession.tyreSets,
    remote.tyreSets,
  );
  const vehicle = pick(
    localSession,
    remote,
    'vehicle',
    localSession.vehicle,
    remote.vehicle,
  );
  const conditions = pick(
    localSession,
    remote,
    'conditions',
    localSession.conditions,
    remote.conditions,
  );
  const templateId = pick(
    localSession,
    remote,
    'templateId',
    localSession.templateId,
    remote.templateId,
  );

  const ride = mergeCategory('ride', localSession, remote, localSession.ride, remote.ride);
  const handling = mergeCategory(
    'handling',
    localSession,
    remote,
    localSession.handling,
    remote.handling,
  );

  const fieldTimestamps = mergeFieldTimestamps(localSession, remote);

  return {
    // Identity fields are invariant across devices for the same session.
    sessionId: localSession.sessionId,
    createdBy: remote.createdBy ?? localSession.createdBy,
    templateId,
    tyreSets,
    vehicle,
    conditions,
    ride,
    handling,
    // The merged document reflects local intent to sync; the Sync_Service marks
    // it synced only after the backend confirms the write (R10.4).
    syncState: localSession.syncState,
    fieldTimestamps,
    updatedAt: Math.max(localSession.updatedAt, remote.updatedAt),
  };
}
