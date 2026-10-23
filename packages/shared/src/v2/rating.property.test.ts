// Property tests for the v2 rating core.
// Feature: rnh-tyre-testing-system, Properties 1-4.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyRatingV2,
  categoryAverageV2,
  cellKey,
  isValidRating,
  padValues,
  RATING_TOLERANCE,
  scaleValues,
  weightedCategoryAverage,
  type RatingCell,
  type RatingScale,
  type TemplateSchema,
  type TyreSetV2,
} from './index';
import { blankTyreSetV2 } from './session';

const scaleArb: fc.Arbitrary<RatingScale> = fc
  .record({
    min: fc.integer({ min: 0, max: 5 }),
    span: fc.integer({ min: 1, max: 10 }),
    step: fc.constantFrom(0.25 as const, 0.5 as const),
  })
  .map(({ min, span, step }) => ({ min, max: min + span, step }));

describe('Property 1: rating validity (R7.1)', () => {
  it('accepts exactly the in-range step multiples', () => {
    fc.assert(
      fc.property(scaleArb, fc.double({ min: -5, max: 25, noNaN: true }), (scale, v) => {
        const onGrid = scaleValues(scale).some((s) => Math.abs(s - v) < RATING_TOLERANCE);
        expect(isValidRating(v, scale)).toBe(onGrid);
      }),
      { numRuns: 200 },
    );
  });

  it('invalid proposals keep the prior value; null clears', () => {
    fc.assert(
      fc.property(scaleArb, fc.double({ min: -5, max: 25, noNaN: true }), (scale, v) => {
        const prior = scale.min;
        const out = applyRatingV2(v, prior, scale);
        expect(out === prior || isValidRating(out, scale)).toBe(true);
        expect(applyRatingV2(null, prior, scale)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property 2: rating pad shape (R6.2)', () => {
  it('returns up to 9 consecutive valid values containing the snapped anchor', () => {
    fc.assert(
      fc.property(scaleArb, fc.double({ min: -5, max: 25, noNaN: true }), (scale, anchor) => {
        const all = scaleValues(scale);
        const pad = padValues(anchor, scale, 9);
        expect(pad.length).toBe(Math.min(9, all.length));
        pad.forEach((v) => expect(isValidRating(v, scale)).toBe(true));
        for (let i = 1; i < pad.length; i += 1) {
          expect(pad[i] - pad[i - 1]).toBeCloseTo(scale.step, 6);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('centres on the anchor when away from the scale ends', () => {
    const scale: RatingScale = { min: 1, max: 10, step: 0.25 };
    expect(padValues(6, scale)).toEqual([5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7]);
    expect(padValues(1, scale)[0]).toBe(1);
    expect(padValues(10, scale).at(-1)).toBe(10);
  });
});

function schemaWith(n: number, weights?: number[]): TemplateSchema {
  return {
    categories: [{ categoryId: 'c', name: 'Ride', order: 0 }],
    parameters: Array.from({ length: n }, (_, i) => ({
      paramId: `p${i}`,
      categoryId: 'c',
      name: `P${i}`,
      order: i,
      weight: weights?.[i],
    })),
    headerFields: [],
    scale: { min: 1, max: 10, step: 0.25 },
    slotCount: 4,
    quickComments: [],
    fileNamePattern: '',
  };
}

describe('Properties 3-4: Unrated excluded from averages (R7.2-R7.4)', () => {
  it('average equals the mean of rated cells only, or null when none', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.option(
            fc.integer({ min: 4, max: 40 }).map((x) => x / 4),
            { nil: null },
          ),
          {
            minLength: 1,
            maxLength: 12,
          },
        ),
        (ratings) => {
          const schema = schemaWith(ratings.length);
          const t: TyreSetV2 = blankTyreSetV2(1, true);
          const cells: Record<string, RatingCell> = {};
          ratings.forEach((r, i) => {
            cells[cellKey(`p${i}`, t.tyreSetId)] = {
              rating: r,
              comment: '',
              updatedAt: 0,
              updatedBy: '',
            };
          });
          const session = { cells, tyreSets: { [t.tyreSetId]: t } };
          const rated = ratings.filter((r): r is number => r !== null);
          const avg = categoryAverageV2(session, schema, 'c', t.tyreSetId);
          if (rated.length === 0) expect(avg).toBeNull();
          else expect(avg).toBeCloseTo(rated.reduce((a, b) => a + b, 0) / rated.length, 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('weighted average renormalises over rated parameters', () => {
    const schema = schemaWith(3, [0.1, 0.4, 0.5]);
    const t = blankTyreSetV2(1, true);
    const cells: Record<string, RatingCell> = {
      [cellKey('p0', t.tyreSetId)]: { rating: 6, comment: '', updatedAt: 0, updatedBy: '' },
      [cellKey('p1', t.tyreSetId)]: { rating: 7, comment: '', updatedAt: 0, updatedBy: '' },
    };
    const avg = weightedCategoryAverage({ cells }, schema, 'c', t.tyreSetId);
    expect(avg).toBeCloseTo((6 * 0.1 + 7 * 0.4) / 0.5, 6);
  });
});
