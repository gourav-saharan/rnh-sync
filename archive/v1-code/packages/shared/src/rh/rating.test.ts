import { describe, expect, it } from 'vitest';
import { DEFAULT_RATING_RANGE, type RatingRange } from '../index';
import {
  applyRating,
  categoryAverage,
  isRatingIncrement,
  isValidRating,
} from './rating';

describe('isRatingIncrement', () => {
  it('accepts multiples of 0.25', () => {
    expect(isRatingIncrement(0)).toBe(true);
    expect(isRatingIncrement(0.25)).toBe(true);
    expect(isRatingIncrement(5.5)).toBe(true);
    expect(isRatingIncrement(6)).toBe(true);
    expect(isRatingIncrement(6.25)).toBe(true);
    expect(isRatingIncrement(-1.75)).toBe(true);
  });

  it('rejects values that are not multiples of 0.25', () => {
    expect(isRatingIncrement(5.1)).toBe(false);
    expect(isRatingIncrement(6.3)).toBe(false);
    expect(isRatingIncrement(0.1)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isRatingIncrement(NaN)).toBe(false);
    expect(isRatingIncrement(Infinity)).toBe(false);
    expect(isRatingIncrement(-Infinity)).toBe(false);
  });
});

describe('isValidRating', () => {
  it('accepts an in-range multiple of 0.25', () => {
    expect(isValidRating(5.5)).toBe(true);
    expect(isValidRating(6.25)).toBe(true);
  });

  it('accepts the inclusive range boundaries when on the grid', () => {
    expect(isValidRating(DEFAULT_RATING_RANGE.min)).toBe(true);
    expect(isValidRating(DEFAULT_RATING_RANGE.max)).toBe(true);
  });

  it('rejects out-of-range values even when on the grid', () => {
    expect(isValidRating(0.75)).toBe(false); // below default min of 1
    expect(isValidRating(10.25)).toBe(false); // above default max of 10
  });

  it('rejects in-range values that are off the 0.25 grid', () => {
    expect(isValidRating(5.1)).toBe(false);
  });

  it('honours a custom range', () => {
    const range: RatingRange = { min: 0, max: 5 };
    expect(isValidRating(0, range)).toBe(true);
    expect(isValidRating(5, range)).toBe(true);
    expect(isValidRating(5.25, range)).toBe(false);
    expect(isValidRating(-0.25, range)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidRating(NaN)).toBe(false);
    expect(isValidRating(Infinity)).toBe(false);
  });
});

describe('applyRating', () => {
  it('keeps the proposed value when it is valid', () => {
    expect(applyRating(6.25, 5)).toBe(6.25);
  });

  it('keeps the prior value when the proposed value is out of range', () => {
    expect(applyRating(10.25, 5)).toBe(5);
  });

  it('keeps the prior value when the proposed value is off the grid', () => {
    expect(applyRating(5.1, 5)).toBe(5);
  });

  it('keeps the prior value when the proposed value is non-finite', () => {
    expect(applyRating(NaN, 5)).toBe(5);
  });
});

describe('categoryAverage', () => {
  it('returns the single rating for a one-element set', () => {
    expect(categoryAverage([6.5])).toBe(6.5);
  });

  it('computes the arithmetic mean of a set', () => {
    expect(categoryAverage([5, 6, 7])).toBe(6);
    expect(categoryAverage([5.5, 6.5])).toBe(6);
  });

  it('throws on an empty set', () => {
    expect(() => categoryAverage([])).toThrowError(/non-empty/);
  });
});
