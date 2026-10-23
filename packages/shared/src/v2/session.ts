// R&H Tyre Testing System — v2 pure session operations.
//
// Every mutation returns a NEW LocalTestSessionV2 (never mutates its input),
// records the changed Firestore field path in `dirtyPaths` (so the Sync_Engine
// pushes only what changed, R9.5), bumps `updatedAt`, and recomputes
// `progress` (R10.1). Pure TypeScript: no React, no Firebase.

import {
  cellKey,
  newId,
  orderedTyreSets,
  type AppUser,
  type HeaderValue,
  type LocalTestSessionV2,
  type RatingCell,
  type TemplateVersion,
  type TestSessionV2,
  type TyreSetV2,
} from './model';
import { applyRatingV2, progressOf } from './rating';

/** A fresh Tyre_Set for a slot. */
export function blankTyreSetV2(slot: number, isReference = false, label?: string): TyreSetV2 {
  return {
    tyreSetId: newId('t'),
    slot,
    isReference,
    label: label ?? (isReference ? 'Ref' : `Set ${slot}`),
    make: '',
    pattern: '',
    size: '',
    srlr: '',
    weekCode: '',
    dot: '',
    compound: '',
    airTempC: null,
    roadTempC: null,
    overallComment: '',
    photoPaths: [],
  };
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso(now: number = Date.now()): string {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface CreateSessionOptions {
  version: TemplateVersion;
  user: AppUser;
  now?: number;
  sessionId?: string;
  /** Header values of the Tester's previous session on this template (R5.4). */
  previousHeader?: Record<string, HeaderValue>;
}

/**
 * New in-progress session pinned to `version` (R5.1) with header prefills
 * (R5.4) and one Reference Tyre_Set.
 */
export function createSessionV2(opts: CreateSessionOptions): LocalTestSessionV2 {
  const now = opts.now ?? Date.now();
  const { version, user } = opts;
  const header: Record<string, HeaderValue> = {};
  for (const f of version.schema.headerFields) {
    let value: HeaderValue = f.defaultValue ?? null;
    if (f.prefill === 'today') value = todayIso(now);
    else if (f.prefill === 'userDisplayName') value = user.displayName || user.email;
    else if (
      f.prefill === 'lastSession' &&
      opts.previousHeader &&
      f.fieldId in opts.previousHeader
    ) {
      value = opts.previousHeader[f.fieldId] ?? value;
    }
    header[f.fieldId] = value;
  }
  const ref = blankTyreSetV2(1, true);
  const session: LocalTestSessionV2 = {
    sessionId: opts.sessionId ?? newId('s', 12),
    schemaVersion: 2,
    templateId: version.templateId,
    templateVersion: version.version,
    customerName: version.customerName,
    templateName: version.templateName,
    status: 'in_progress',
    createdBy: user.uid,
    createdByName: user.displayName || user.email,
    assignedTo: [],
    header,
    tyreSets: { [ref.tyreSetId]: ref },
    cells: {},
    fieldTimestamps: {},
    progress: { rated: 0, total: version.schema.parameters.length },
    lastReport: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: now,
    updatedBy: user.uid,
    updatedAt: now,
    dirtyPaths: [],
    isNew: true,
    syncState: 'saved_local',
    lastError: null,
    cursor: {
      paramId: version.schema.parameters[0]?.paramId ?? '',
      tyreSetId: ref.tyreSetId,
      order: 'byTyre',
      screen: 'setup',
    },
  };
  return session;
}

/** Merge dirty paths, dropping any path already covered by a parent path. */
export function addDirtyPaths(existing: readonly string[], paths: readonly string[]): string[] {
  const all = [...existing, ...paths];
  const unique = [...new Set(all)];
  return unique.filter((p) => !unique.some((q) => q !== p && p.startsWith(`${q}.`)));
}

/** Internal: apply a change + dirty paths + bookkeeping. */
function touch(
  session: LocalTestSessionV2,
  change: Partial<LocalTestSessionV2>,
  paths: string[],
  userId: string,
  now: number,
  version?: Pick<TemplateVersion, 'schema'>,
): LocalTestSessionV2 {
  const next: LocalTestSessionV2 = {
    ...session,
    ...change,
    updatedAt: now,
    updatedBy: userId,
    dirtyPaths: addDirtyPaths(session.dirtyPaths, [...paths, 'updatedAt', 'updatedBy']),
    syncState: 'saved_local',
  };
  if (version) {
    next.progress = progressOf(next, version.schema);
    next.dirtyPaths = addDirtyPaths(next.dirtyPaths, ['progress']);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Rating_Cell edits (R6.4–R6.7, R6.13)
// ---------------------------------------------------------------------------

export interface EditContext {
  userId: string;
  version: Pick<TemplateVersion, 'schema'>;
  now?: number;
}

function withCell(
  session: LocalTestSessionV2,
  key: string,
  cell: RatingCell | undefined,
  ctx: EditContext,
): LocalTestSessionV2 {
  const now = ctx.now ?? Date.now();
  // A cleared cell is stored as an explicit Unrated/empty cell (not deleted)
  // so it syncs as a plain field-path update without a deleteField sentinel.
  const cells = {
    ...session.cells,
    [key]: cell ?? { rating: null, comment: '', updatedAt: now, updatedBy: ctx.userId },
  };
  return touch(session, { cells }, [`cells.${key}`], ctx.userId, now, ctx.version);
}

/** Current cell or an empty Unrated cell. */
export function cellOf(
  session: Pick<LocalTestSessionV2, 'cells'>,
  paramId: string,
  tyreSetId: string,
): RatingCell {
  return (
    session.cells[cellKey(paramId, tyreSetId)] ?? {
      rating: null,
      comment: '',
      updatedAt: 0,
      updatedBy: '',
    }
  );
}

/**
 * Record a rating (or null = clear to Unrated, R6.7). Invalid values keep the
 * prior rating (R7.1); an unchanged value returns the same session object.
 */
export function setRatingV2(
  session: LocalTestSessionV2,
  paramId: string,
  tyreSetId: string,
  proposed: number | null,
  ctx: EditContext,
): LocalTestSessionV2 {
  const key = cellKey(paramId, tyreSetId);
  const prior = session.cells[key];
  const priorRating = prior && typeof prior.rating === 'number' ? prior.rating : null;
  const rating = applyRatingV2(proposed, priorRating, ctx.version.schema.scale);
  if (rating === priorRating && prior) return session;
  const now = ctx.now ?? Date.now();
  return withCell(
    session,
    key,
    { rating, comment: prior?.comment ?? '', updatedAt: now, updatedBy: ctx.userId },
    ctx,
  );
}

/** Replace a cell's comment text. */
export function setCommentV2(
  session: LocalTestSessionV2,
  paramId: string,
  tyreSetId: string,
  comment: string,
  ctx: EditContext,
): LocalTestSessionV2 {
  const key = cellKey(paramId, tyreSetId);
  const prior = session.cells[key];
  if ((prior?.comment ?? '') === comment) return session;
  const now = ctx.now ?? Date.now();
  return withCell(
    session,
    key,
    {
      rating: prior && typeof prior.rating === 'number' ? prior.rating : null,
      comment,
      updatedAt: now,
      updatedBy: ctx.userId,
    },
    ctx,
  );
}

/**
 * Join a new phrase onto existing comment text without losing it (R6.6).
 * Quick_Comments and dictation both go through here. A phrase already present
 * at the end is not duplicated.
 */
export function joinComment(existing: string, addition: string): string {
  const base = (existing ?? '').trim();
  const extra = (addition ?? '').trim();
  if (!extra) return base;
  if (!base) return extra;
  if (base.toLowerCase().endsWith(extra.toLowerCase())) return base;
  const sep = /[.;,]$/.test(base) ? ' ' : ', ';
  return `${base}${sep}${extra}`;
}

export function appendCommentV2(
  session: LocalTestSessionV2,
  paramId: string,
  tyreSetId: string,
  addition: string,
  ctx: EditContext,
): LocalTestSessionV2 {
  const current = cellOf(session, paramId, tyreSetId).comment;
  return setCommentV2(session, paramId, tyreSetId, joinComment(current, addition), ctx);
}

/**
 * Put a cell back to an earlier snapshot (undo, R6.13). `snapshot` undefined
 * means the cell did not exist before, which restores it as Unrated + empty.
 */
export function restoreCellV2(
  session: LocalTestSessionV2,
  paramId: string,
  tyreSetId: string,
  snapshot: RatingCell | undefined,
  ctx: EditContext,
): LocalTestSessionV2 {
  const key = cellKey(paramId, tyreSetId);
  const now = ctx.now ?? Date.now();
  return withCell(
    session,
    key,
    snapshot ? { ...snapshot, updatedAt: now, updatedBy: ctx.userId } : undefined,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Header fields (R5.3, R5.4)
// ---------------------------------------------------------------------------

export function setHeaderV2(
  session: LocalTestSessionV2,
  fieldId: string,
  value: HeaderValue,
  ctx: EditContext,
): LocalTestSessionV2 {
  if ((session.header[fieldId] ?? null) === value) return session;
  const now = ctx.now ?? Date.now();
  return touch(
    session,
    { header: { ...session.header, [fieldId]: value } },
    [`header.${fieldId}`],
    ctx.userId,
    now,
  );
}

// ---------------------------------------------------------------------------
// Tyre sets (R5.5–R5.8)
// ---------------------------------------------------------------------------

/** Add a Tyre_Set at the next slot. Returns the same session when full. */
export function addTyreSetV2(
  session: LocalTestSessionV2,
  ctx: EditContext,
  copyFromPrevious = false,
): LocalTestSessionV2 {
  const sets = orderedTyreSets(session);
  if (sets.length >= ctx.version.schema.slotCount) return session;
  const slot = sets.length + 1;
  const hasRef = sets.some((t) => t.isReference);
  const fresh = blankTyreSetV2(slot, !hasRef, hasRef ? `Set ${slot}` : 'Ref');
  const prev = sets[sets.length - 1];
  const set: TyreSetV2 =
    copyFromPrevious && prev
      ? {
          ...fresh,
          make: prev.make,
          pattern: prev.pattern,
          size: prev.size,
          srlr: prev.srlr,
          weekCode: prev.weekCode,
          compound: prev.compound,
        }
      : fresh;
  const now = ctx.now ?? Date.now();
  return touch(
    session,
    { tyreSets: { ...session.tyreSets, [set.tyreSetId]: set } },
    [`tyreSets.${set.tyreSetId}`],
    ctx.userId,
    now,
    ctx.version,
  );
}

/** Patch one Tyre_Set's details (not slot / isReference; use move / setReference). */
export function updateTyreSetV2(
  session: LocalTestSessionV2,
  tyreSetId: string,
  patch: Partial<Omit<TyreSetV2, 'tyreSetId' | 'slot' | 'isReference'>>,
  ctx: EditContext,
): LocalTestSessionV2 {
  const current = session.tyreSets[tyreSetId];
  if (!current) return session;
  const keys = (Object.keys(patch) as (keyof typeof patch)[]).filter(
    (k) => JSON.stringify(current[k]) !== JSON.stringify(patch[k]),
  );
  if (keys.length === 0) return session;
  const now = ctx.now ?? Date.now();
  return touch(
    session,
    { tyreSets: { ...session.tyreSets, [tyreSetId]: { ...current, ...patch } } },
    keys.map((k) => `tyreSets.${tyreSetId}.${String(k)}`),
    ctx.userId,
    now,
  );
}

/** Renumber slots 1..n in the given order, marking changed slots dirty. */
function renumber(
  session: LocalTestSessionV2,
  ordered: TyreSetV2[],
): { tyreSets: Record<string, TyreSetV2>; paths: string[] } {
  const tyreSets: Record<string, TyreSetV2> = {};
  const paths: string[] = [];
  ordered.forEach((t, i) => {
    const slot = i + 1;
    tyreSets[t.tyreSetId] = { ...t, slot };
    if (session.tyreSets[t.tyreSetId]?.slot !== slot) {
      paths.push(`tyreSets.${t.tyreSetId}.slot`);
    }
  });
  return { tyreSets, paths };
}

/**
 * Remove a Tyre_Set. Its Rating_Cells stay in `cells` as orphans (ignored by
 * progress, review and report) so a removal never rewrites the whole matrix.
 * If the Reference is removed, the first remaining set becomes Reference.
 */
export function removeTyreSetV2(
  session: LocalTestSessionV2,
  tyreSetId: string,
  ctx: EditContext,
): LocalTestSessionV2 {
  if (!session.tyreSets[tyreSetId]) return session;
  const remaining = orderedTyreSets(session).filter((t) => t.tyreSetId !== tyreSetId);
  if (remaining.length === 0) return session;
  if (!remaining.some((t) => t.isReference)) {
    remaining[0] = { ...remaining[0], isReference: true };
  }
  const { tyreSets } = renumber(session, remaining);
  const now = ctx.now ?? Date.now();
  const next = touch(session, { tyreSets }, ['tyreSets'], ctx.userId, now, ctx.version);
  if (next.cursor.tyreSetId === tyreSetId) {
    next.cursor = { ...next.cursor, tyreSetId: remaining[0].tyreSetId };
  }
  return next;
}

/** Move a Tyre_Set up (-1) or down (+1); slots follow order (R5.7). */
export function moveTyreSetV2(
  session: LocalTestSessionV2,
  tyreSetId: string,
  delta: -1 | 1,
  ctx: EditContext,
): LocalTestSessionV2 {
  const sets = orderedTyreSets(session);
  const i = sets.findIndex((t) => t.tyreSetId === tyreSetId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sets.length) return session;
  [sets[i], sets[j]] = [sets[j], sets[i]];
  const { tyreSets, paths } = renumber(session, sets);
  const now = ctx.now ?? Date.now();
  return touch(session, { tyreSets }, paths, ctx.userId, now);
}

/** Make exactly one Tyre_Set the Reference_Set (R5.5). */
export function setReferenceV2(
  session: LocalTestSessionV2,
  tyreSetId: string,
  ctx: EditContext,
): LocalTestSessionV2 {
  if (!session.tyreSets[tyreSetId] || session.tyreSets[tyreSetId].isReference) return session;
  const tyreSets: Record<string, TyreSetV2> = {};
  const paths: string[] = [];
  for (const t of Object.values(session.tyreSets)) {
    const isReference = t.tyreSetId === tyreSetId;
    tyreSets[t.tyreSetId] = { ...t, isReference };
    if (t.isReference !== isReference) paths.push(`tyreSets.${t.tyreSetId}.isReference`);
  }
  const now = ctx.now ?? Date.now();
  return touch(session, { tyreSets }, paths, ctx.userId, now);
}

// ---------------------------------------------------------------------------
// Status and cursor (R8.2, R10.6)
// ---------------------------------------------------------------------------

export function setStatusV2(
  session: LocalTestSessionV2,
  status: LocalTestSessionV2['status'],
  ctx: Pick<EditContext, 'userId' | 'now'>,
): LocalTestSessionV2 {
  if (session.status === status) return session;
  return touch(session, { status }, ['status'], ctx.userId, ctx.now ?? Date.now());
}

/**
 * Move the resume cursor. The cursor is device-local (never pushed), so this
 * does not touch dirtyPaths or updatedAt.
 */
export function setCursorV2(
  session: LocalTestSessionV2,
  patch: Partial<LocalTestSessionV2['cursor']>,
): LocalTestSessionV2 {
  const cursor = { ...session.cursor, ...patch };
  if (JSON.stringify(cursor) === JSON.stringify(session.cursor)) return session;
  return { ...session, cursor };
}

/** Local-only fields that must never be written to Firestore. */
export const LOCAL_ONLY_FIELDS = [
  'dirtyPaths',
  'isNew',
  'syncState',
  'lastError',
  'cursor',
  'deletedOnServer',
] as const;

/** Strip local-only fields to get the Firestore document shape. */
export function toRemoteSession(session: LocalTestSessionV2): TestSessionV2 {
  const copy: Record<string, unknown> = { ...session };
  for (const k of LOCAL_ONLY_FIELDS) delete copy[k];
  return copy as unknown as TestSessionV2;
}
