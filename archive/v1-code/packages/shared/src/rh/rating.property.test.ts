// Property-based tests for R&H rating validation.
//
// Feature: rnh-tyre-testing-system, Property 7: Rating validation
//
// Property 7 (Rating validation): For any numeric value, the Mobile_PWA
// accepts it as a Rating if and only if it lies within the R&H_Parameter's
// configured range AND is a multiple of 0.25.
//
// Validates: Requirements 5.4

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RATING_INCREMENT, type RatingRange } from '../index';
import { isValidRating } from './rating';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 500;

/**
 * Independent oracle for "is this finite value a multiple of 0.25?".
 *
 * This is deliberately computed differently from the implementation
 * (integer-cents comparison rather than a divide-and-round check) so the test
 * does not simply mirror the code under test.
 */
function isMultipleOfQuarter(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  // 0.25 == 1/4, so a value is on-grid iff (value * 4) is an integer.
  const quarters = value * 4;
  return Math.abs(quarters - Math.round(quarters)) < 1e-9;
}

/** Independent oracle mirroring the Property 7 specification. */
function specAccepts(value: number, range: RatingRange): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  const inRange = value >= range.min && value <= range.max;
  return inRange && isMultipleOfQuarter(value);
}

/**
 * A range arbitrary. Widths span from a single point up to a broad interval so
 * both in-range and out-of-range values are exercised.
 */
const rangeArb: fc.Arbitrary<RatingRange> = fc
  .tuple(
    fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 40, noNaN: true, noDefaultInfinity: true }),
  )
  .map(([min, span]) => ({ min, max: min + span }));

/**
 * A value arbitrary biased toward the interesting parts of the input space:
 *   - on-grid values (multiples of 0.25), which satisfy the increment branch;
 *   - off-grid values, which must be rejected regardless of range;
 *   - values near a range's boundaries, to stress the inclusive comparison;
 *   - a small share of fully arbitrary doubles for breadth.
 *
 * The bias guarantees both branches of the iff (accept / reject) are hit often.
 */
function valueArb(range: RatingRange): fc.Arbitrary<number> {
  const onGrid = fc
    .integer({ min: -160, max: 160 })
    .map((steps) => steps * RATING_INCREMENT);

  const offGrid = fc
    .double({ min: -20, max: 40, noNaN: true, noDefaultInfinity: true })
    // Nudge off the grid; the oracle still decides correctness.
    .map((v) => v + 0.1);

  const boundary = fc.constantFrom(
    range.min,
    range.max,
    range.min - RATING_INCREMENT,
    range.max + RATING_INCREMENT,
    // Snap boundaries onto the grid to catch on-grid boundary cases.
    Math.round(range.min * 4) / 4,
    Math.round(range.max * 4) / 4,
  );

  const anyDouble = fc.double({
    min: -50,
    max: 70,
    noNaN: true,
    noDefaultInfinity: true,
  });

  return fc.oneof(
    { weight: 4, arbitrary: onGrid },
    { weight: 3, arbitrary: boundary },
    { weight: 2, arbitrary: offGrid },
    { weight: 1, arbitrary: anyDouble },
  );
}

describe('Property 7: Rating validation', () => {
  it('accepts a value iff it is in range AND a multiple of 0.25', () => {
    fc.assert(
      fc.property(
        rangeArb.chain((range) =>
          valueArb(range).map((value) => ({ range, value })),
        ),
        ({ range, value }) => {
          expect(isValidRating(value, range)).toBe(specAccepts(value, range));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects every non-finite value regardless of range', () => {
    fc.assert(
      fc.property(
        rangeArb,
        fc.constantFrom(NaN, Infinity, -Infinity),
        (range, value) => {
          expect(isValidRating(value, range)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
