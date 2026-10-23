// R&H Tyre Testing System — v2 pure rating core (design.md v2 "Rating core").
//
// Rating validity (R7.1), Unrated handling (R7.2), the Drive_Mode rating pad
// (R6.2), category averages that exclude Unrated cells (R7.3, R7.4), the
// difference to the Reference_Set (R7.5) and session progress (R10.1).
// Pure TypeScript: no React, no Firebase.

import {
  cellKey,
  orderedTyreSets,
  referenceSet,
  type ParameterDef,
  type RatingScale,
  type TemplateSchema,
  type TestSessionV2,
} from './model';

const EPS = 1e-9;

/** Round to 2 decimals to remove floating drift (all steps are 0.25 / 0.5). */
export function roundRating(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * True when `value` lies within [min, max] and is a whole number of steps
 * from `min` (R7.1). `null` (Unrated) is not a rating and returns false.
 */
export function isValidRating(value: unknown, scale: RatingScale): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value <= scale.min - RATING_TOLERANCE || value >= scale.max + RATING_TOLERANCE) return false;
  const nearest = scale.min + Math.round((value - scale.min) / scale.step) * scale.step;
  return Math.abs(value - nearest) < RATING_TOLERANCE;
}

/**
 * Absolute distance from a scale value still treated as that value (float
 * drift from typed or synced numbers). Used for both the range and the step check.
 */
export const RATING_TOLERANCE = 1e-7;

/**
 * Apply a proposed rating: a valid value is accepted (rounded), `null` clears
 * the cell to Unrated (R6.7), and anything else keeps the prior value (R7.1).
 */
export function applyRatingV2(
  proposed: number | null,
  prior: number | null,
  scale: RatingScale,
): number | null {
  if (proposed === null) return null;
  return isValidRating(proposed, scale) ? roundRating(proposed) : prior;
}

/** Snap any number to the nearest valid value on the scale. */
export function snapToScale(value: number, scale: RatingScale): number {
  const clamped = Math.min(scale.max, Math.max(scale.min, value));
  const steps = Math.round((clamped - scale.min) / scale.step);
  return roundRating(Math.min(scale.max, scale.min + steps * scale.step));
}

/** Every valid value on the scale, ascending. */
export function scaleValues(scale: RatingScale): number[] {
  const out: number[] = [];
  if (scale.max < scale.min || scale.step <= 0) return out;
  const n = Math.round((scale.max - scale.min) / scale.step);
  for (let i = 0; i <= n; i += 1) out.push(roundRating(scale.min + i * scale.step));
  return out;
}

/**
 * The Drive_Mode rating pad (R6.2): `count` consecutive scale values centred
 * on `anchor` (snapped to the scale). Near either end of the scale the window
 * shifts so it stays full and inside [min, max]. When the whole scale has fewer
 * than `count` values, every value is returned.
 *
 * Default: 9 values = anchor ± 4 steps (± 1.0 for step 0.25).
 */
export function padValues(anchor: number, scale: RatingScale, count = 9): number[] {
  const all = scaleValues(scale);
  if (all.length <= count) return all;
  const centre = snapToScale(anchor, scale);
  const centreIdx = all.findIndex((v) => Math.abs(v - centre) < EPS);
  const half = Math.floor(count / 2);
  let start = centreIdx - half;
  start = Math.max(0, Math.min(start, all.length - count));
  return all.slice(start, start + count);
}

/** Move the pad anchor by `steps` scale steps, clamped to the scale. */
export function shiftAnchor(anchor: number, steps: number, scale: RatingScale): number {
  return snapToScale(anchor + steps * scale.step, scale);
}

/** Scale midpoint, snapped to the scale (e.g. 1–10 / 0.25 -> 5.5). */
export function scaleMidpoint(scale: RatingScale): number {
  return snapToScale((scale.min + scale.max) / 2, scale);
}

/** The recorded rating of a cell, or null when Unrated / absent (R7.2). */
export function ratingOf(
  session: Pick<TestSessionV2, 'cells'>,
  paramId: string,
  tyreSetId: string,
): number | null {
  const cell = session.cells[cellKey(paramId, tyreSetId)];
  return cell && typeof cell.rating === 'number' ? cell.rating : null;
}

/**
 * The value the rating pad centres on for one cell (R6.2):
 *  1. the cell's own rating, if already rated (so it is visible and selected);
 *  2. the Reference_Set's rating for the same parameter;
 *  3. the Tester's most recent rating on this tyre set (keeps the pad in the
 *     range they are actually using, e.g. 5–7);
 *  4. the scale midpoint.
 */
export function anchorFor(
  session: Pick<TestSessionV2, 'cells' | 'tyreSets'>,
  schema: Pick<TemplateSchema, 'scale' | 'parameters'>,
  paramId: string,
  tyreSetId: string,
): number {
  const own = ratingOf(session, paramId, tyreSetId);
  if (own !== null) return snapToScale(own, schema.scale);

  const ref = referenceSet(session);
  if (ref && ref.tyreSetId !== tyreSetId) {
    const refRating = ratingOf(session, paramId, ref.tyreSetId);
    if (refRating !== null) return snapToScale(refRating, schema.scale);
  }

  let latest: { at: number; rating: number } | null = null;
  for (const p of schema.parameters) {
    const cell = session.cells[cellKey(p.paramId, tyreSetId)];
    if (cell && typeof cell.rating === 'number' && (!latest || cell.updatedAt > latest.at)) {
      latest = { at: cell.updatedAt, rating: cell.rating };
    }
  }
  if (latest) return snapToScale(latest.rating, schema.scale);

  return scaleMidpoint(schema.scale);
}

/** Point label for a value, e.g. 7 -> "satisfactory", when defined. */
export function pointLabel(value: number | null, scale: RatingScale): string | undefined {
  if (value === null || !scale.pointLabels) return undefined;
  return scale.pointLabels[String(Math.floor(value + EPS))];
}

/** Parameters of one category, in order. */
export function parametersIn(schema: TemplateSchema, categoryId: string): ParameterDef[] {
  return schema.parameters
    .filter((p) => p.categoryId === categoryId)
    .sort((a, b) => a.order - b.order);
}

/** Re-exported for callers that only import the rating core. */
export { orderedTyreSets };

// ---------------------------------------------------------------------------
// Averages, difference to reference, progress (R7.3, R7.4, R7.5, R10.1)
// ---------------------------------------------------------------------------

/** Arithmetic mean of the numeric values, or null when there are none (R7.3). */
export function meanOrNull(values: readonly (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Category average for one Tyre_Set: mean of its rated parameters in the
 * category, Unrated excluded; null when nothing is rated (R7.3).
 */
export function categoryAverageV2(
  session: Pick<TestSessionV2, 'cells'>,
  schema: TemplateSchema,
  categoryId: string,
  tyreSetId: string,
): number | null {
  return meanOrNull(
    parametersIn(schema, categoryId).map((p) => ratingOf(session, p.paramId, tyreSetId)),
  );
}

/**
 * Weighted category average (R7.4): only rated parameters with a positive
 * weight count, and weights are renormalised over them. Null when the category
 * has no weights or no weighted parameter is rated.
 */
export function weightedCategoryAverage(
  session: Pick<TestSessionV2, 'cells'>,
  schema: TemplateSchema,
  categoryId: string,
  tyreSetId: string,
): number | null {
  let sumW = 0;
  let sum = 0;
  for (const p of parametersIn(schema, categoryId)) {
    const w = p.weight;
    if (typeof w !== 'number' || !(w > 0)) continue;
    const r = ratingOf(session, p.paramId, tyreSetId);
    if (r === null) continue;
    sumW += w;
    sum += w * r;
  }
  return sumW > 0 ? sum / sumW : null;
}

/** True when any parameter in the category carries a positive weight. */
export function categoryHasWeights(schema: TemplateSchema, categoryId: string): boolean {
  return parametersIn(schema, categoryId).some((p) => typeof p.weight === 'number' && p.weight > 0);
}

/**
 * Total average for one Tyre_Set: mean of its non-null category averages, as
 * the customer sheets do with `AVERAGE(cat1, cat2, ...)`.
 */
export function totalAverage(
  session: Pick<TestSessionV2, 'cells'>,
  schema: TemplateSchema,
  tyreSetId: string,
): number | null {
  return meanOrNull(
    schema.categories.map((c) => categoryAverageV2(session, schema, c.categoryId, tyreSetId)),
  );
}

/** a - b when both are numbers, else null (R7.5). */
export function diffOrNull(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : roundRating(a - b);
}

/** Difference of one cell's rating from the Reference_Set's rating (R7.5). */
export function diffToReference(
  session: Pick<TestSessionV2, 'cells' | 'tyreSets'>,
  paramId: string,
  tyreSetId: string,
): number | null {
  const ref = referenceSet(session);
  if (!ref || ref.tyreSetId === tyreSetId) return null;
  return diffOrNull(
    ratingOf(session, paramId, tyreSetId),
    ratingOf(session, paramId, ref.tyreSetId),
  );
}

/** Difference of a category average from the Reference_Set's (R7.5). */
export function categoryDiffToReference(
  session: Pick<TestSessionV2, 'cells' | 'tyreSets'>,
  schema: TemplateSchema,
  categoryId: string,
  tyreSetId: string,
): number | null {
  const ref = referenceSet(session);
  if (!ref || ref.tyreSetId === tyreSetId) return null;
  const a = categoryAverageV2(session, schema, categoryId, tyreSetId);
  const b = categoryAverageV2(session, schema, categoryId, ref.tyreSetId);
  return a === null || b === null ? null : a - b;
}

/** Format a signed difference: +0.25 / −0.5 / 0 / "" for null. */
export function formatDiff(diff: number | null): string {
  if (diff === null) return '';
  const r = Math.round(diff * 100) / 100;
  if (Math.abs(r) < EPS) return '0';
  return r > 0 ? `+${r}` : `−${Math.abs(r)}`;
}

/** Format an average to 2 decimals, or "–" when undefined. */
export function formatAverage(avg: number | null): string {
  return avg === null ? '–' : avg.toFixed(2);
}

/** Rated / total Rating_Cells for the session's tyre sets (R10.1). */
export function progressOf(
  session: Pick<TestSessionV2, 'cells' | 'tyreSets'>,
  schema: Pick<TemplateSchema, 'parameters'>,
): { rated: number; total: number } {
  const sets = orderedTyreSets(session);
  let rated = 0;
  for (const t of sets) {
    for (const p of schema.parameters) {
      if (ratingOf(session, p.paramId, t.tyreSetId) !== null) rated += 1;
    }
  }
  return { rated, total: sets.length * schema.parameters.length };
}

/** Progress as an integer percentage 0–100. */
export function progressPercent(progress: { rated: number; total: number }): number {
  return progress.total === 0 ? 0 : Math.round((progress.rated / progress.total) * 100);
}
