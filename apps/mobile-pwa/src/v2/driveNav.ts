// Drive_Mode navigation (R6.1, R6.9, R6.10). Pure.
//
// The capture sequence is every (parameter, tyre set) pair, ordered either
// "by tyre" (all parameters of Ref, then MU1, ...) or "by parameter" (one
// parameter across all tyre sets, then the next).

import {
  cellKey,
  orderedParameters,
  orderedTyreSets,
  type CaptureOrder,
  type TemplateSchema,
  type TestSessionV2,
} from '@rnh/shared/v2';

export interface Step {
  paramId: string;
  tyreSetId: string;
}

export function sequenceOf(
  session: Pick<TestSessionV2, 'tyreSets'>,
  schema: TemplateSchema,
  order: CaptureOrder,
): Step[] {
  const params = orderedParameters(schema);
  const sets = orderedTyreSets(session);
  const out: Step[] = [];
  if (order === 'byTyre') {
    for (const t of sets)
      for (const p of params) out.push({ paramId: p.paramId, tyreSetId: t.tyreSetId });
  } else {
    for (const p of params)
      for (const t of sets) out.push({ paramId: p.paramId, tyreSetId: t.tyreSetId });
  }
  return out;
}

export function indexOfStep(seq: readonly Step[], step: Step): number {
  const i = seq.findIndex((s) => s.paramId === step.paramId && s.tyreSetId === step.tyreSetId);
  return i < 0 ? 0 : i;
}

function isRated(session: Pick<TestSessionV2, 'cells'>, s: Step): boolean {
  const c = session.cells[cellKey(s.paramId, s.tyreSetId)];
  return !!c && typeof c.rating === 'number';
}

/** Next step after `i`; `skipRated` jumps to the next Unrated cell (wrapping). */
export function nextIndex(
  seq: readonly Step[],
  i: number,
  session: Pick<TestSessionV2, 'cells'>,
  skipRated = false,
): number | null {
  if (!skipRated) return i + 1 < seq.length ? i + 1 : null;
  for (let k = 1; k <= seq.length; k += 1) {
    const j = (i + k) % seq.length;
    if (!isRated(session, seq[j])) return j;
  }
  return null;
}

export function firstUnratedIndex(
  seq: readonly Step[],
  session: Pick<TestSessionV2, 'cells'>,
): number | null {
  const i = seq.findIndex((s) => !isRated(session, s));
  return i < 0 ? null : i;
}

/**
 * True when moving from step i to j in "by tyre" order crosses into another
 * tyre set: Drive_Mode then shows the "change tyres" card.
 */
export function crossesTyreSet(seq: readonly Step[], i: number, j: number): boolean {
  return !!seq[i] && !!seq[j] && seq[i].tyreSetId !== seq[j].tyreSetId;
}

/** Position of step i within its tyre set, e.g. 7 of 19. */
export function positionInSet(seq: readonly Step[], i: number): { n: number; of: number } {
  const t = seq[i]?.tyreSetId;
  const same = seq.filter((s) => s.tyreSetId === t);
  const n = same.findIndex((s) => s.paramId === seq[i]?.paramId) + 1;
  return { n, of: same.length };
}
