import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { categoryAverage } from './rating';

/**
 * Property-based test for the category-average derivation.
 *
 * Feature: rnh-tyre-testing-system, Property 9: Category average derivation
 * Validates: Requirements 6.5
 *
 * For any non-empty set of R&H_Parameter Ratings within a category, the derived
 * category average equals the arithmetic mean (sum / count) of those Ratings.
 */
describe('Property 9: Category average derivation', () => {
  // Ratings live on a 0.25 grid within a bounded range; generate arbitrary
  // non-empty arrays of such Ratings to cover realistic category inputs.
  const ratingArb = fc
    .integer({ min: 4, max: 40 }) // 4..40 quarter-steps => 1.0 .. 10.0
    .map((quarterSteps) => quarterSteps * 0.25);

  const nonEmptyRatingsArb = fc.array(ratingArb, { minLength: 1, maxLength: 50 });

  it('equals the arithmetic mean of the ratings (Feature: rnh-tyre-testing-system, Property 9: Category average derivation)', () => {
    fc.assert(
      fc.property(nonEmptyRatingsArb, (ratings) => {
        const expectedMean =
          ratings.reduce((acc, r) => acc + r, 0) / ratings.length;

        const actual = categoryAverage(ratings);

        // Floating-point summation order can introduce tiny rounding error, so
        // compare with a small tolerance rather than exact equality.
        expect(Math.abs(actual - expectedMean)).toBeLessThan(1e-9);
      }),
      { numRuns: 100 },
    );
  });
});
