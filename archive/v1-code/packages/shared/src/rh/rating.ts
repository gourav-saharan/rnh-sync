// Pure rating validation and category-average derivation for the R&H Tyre
// Testing System.
//
// This module holds the input-varying subjective-rating logic captured by the
// Mobile_PWA. It is deliberately free of any framework or storage dependency
// so both apps (and the property tests) can consume it directly.
//
// Semantics come from the design document
// (.kiro/specs/rnh-tyre-testing-system/design.md):
//   - Property 7 (Rating validation): a value is a valid Rating iff it lies
//     within the R&H_Parameter's configured range AND is a multiple of 0.25.
//   - Error Handling (Rating input): an out-of-range or non-0.25 value is
//     rejected while the prior valid value is kept.
//   - Property 9 (Category average derivation): the derived category average
//     equals the arithmetic mean of a non-empty set of parameter ratings.

import { DEFAULT_RATING_RANGE, RATING_INCREMENT, type RatingRange } from '../index';

/**
 * Returns true iff `value` is a multiple of {@link RATING_INCREMENT} (0.25).
 *
 * Multiples of 0.25 are exactly representable in IEEE-754 double precision, but
 * dividing an arbitrary input by 0.25 can still introduce a tiny rounding
 * error. We compare against the nearest integer with a small epsilon so values
 * such as 5.25 or 6 are accepted while 5.1 or 6.3 are rejected.
 */
export function isRatingIncrement(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  const steps = value / RATING_INCREMENT;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/**
 * Returns true iff `value` is a valid Rating for the given range: it is finite,
 * lies within `[range.min, range.max]` inclusive, and is a multiple of 0.25
 * (Property 7, R5.4).
 *
 * @param value the proposed numeric rating.
 * @param range the R&H_Parameter's configured range; defaults to
 *   {@link DEFAULT_RATING_RANGE} when a parameter has no override.
 */
export function isValidRating(
  value: number,
  range: RatingRange = DEFAULT_RATING_RANGE,
): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  if (value < range.min || value > range.max) {
    return false;
  }
  return isRatingIncrement(value);
}

/**
 * Applies a proposed rating against a prior value, implementing the design's
 * error-handling rule: accept the proposed value when it is a valid Rating,
 * otherwise reject it and keep the prior valid value (R5.4, Error Handling —
 * "Reject the value; keep prior valid value").
 *
 * @param proposed the newly entered value to validate.
 * @param prior the last valid rating to fall back to when `proposed` is invalid.
 * @param range the R&H_Parameter's configured range.
 * @returns the value that should be kept: `proposed` if valid, else `prior`.
 */
export function applyRating(
  proposed: number,
  prior: number,
  range: RatingRange = DEFAULT_RATING_RANGE,
): number {
  return isValidRating(proposed, range) ? proposed : prior;
}

/**
 * Derives a category average as the arithmetic mean of a non-empty set of
 * R&H_Parameter ratings (Property 9, R6.5).
 *
 * @param ratings a non-empty array of parameter ratings.
 * @throws {Error} when `ratings` is empty; a mean is undefined for an empty set
 *   and the property is scoped to non-empty sets.
 */
export function categoryAverage(ratings: readonly number[]): number {
  if (ratings.length === 0) {
    throw new Error('categoryAverage requires a non-empty set of ratings');
  }
  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return sum / ratings.length;
}
