import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ROLES,
  RATING_INCREMENT,
  DEFAULT_RATING_RANGE,
  DEFAULT_RH_PARAMETERS,
  mappingTargetKey,
  inputFieldKey,
  type FieldMapping,
} from './index';

describe('roles', () => {
  it('exposes exactly the two valid roles', () => {
    expect(ROLES).toEqual(['Tester', 'Report_Viewer']);
  });
});

describe('rating grid constants', () => {
  it('uses a 0.25 increment', () => {
    expect(RATING_INCREMENT).toBe(0.25);
  });

  it('provides a sane default range', () => {
    expect(DEFAULT_RATING_RANGE.min).toBeLessThan(DEFAULT_RATING_RANGE.max);
  });
});

describe('default R&H parameter set', () => {
  it('is non-empty and split across ride and handling categories', () => {
    expect(DEFAULT_RH_PARAMETERS.length).toBeGreaterThan(0);
    const categories = new Set(DEFAULT_RH_PARAMETERS.map((p) => p.category));
    expect(categories.has('ride')).toBe(true);
    expect(categories.has('handling')).toBe(true);
  });

  it('gives every parameter a valid range', () => {
    for (const p of DEFAULT_RH_PARAMETERS) {
      expect(p.range.min).toBeLessThan(p.range.max);
    }
  });
});

describe('mappingTargetKey', () => {
  it('treats cell addresses case-insensitively', () => {
    const base = { templateId: 't1', sheetName: 'R&H' };
    expect(mappingTargetKey({ ...base, cellAddress: 'c7' })).toBe(
      mappingTargetKey({ ...base, cellAddress: 'C7' }),
    );
  });

  it('distinguishes different sheets, cells, and templates', () => {
    const a = mappingTargetKey({ templateId: 't1', sheetName: 'S1', cellAddress: 'A1' });
    const b = mappingTargetKey({ templateId: 't1', sheetName: 'S2', cellAddress: 'A1' });
    const c = mappingTargetKey({ templateId: 't1', sheetName: 'S1', cellAddress: 'A2' });
    const d = mappingTargetKey({ templateId: 't2', sheetName: 'S1', cellAddress: 'A1' });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('is collision-free for distinct triples across arbitrary inputs', () => {
    const triple = fc.record({
      templateId: fc.string(),
      sheetName: fc.string(),
      cellAddress: fc
        .tuple(fc.constantFrom('A', 'B', 'C', 'AA', 'ZZ'), fc.integer({ min: 1, max: 9999 }))
        .map(([col, row]) => `${col}${row}`),
    });
    fc.assert(
      fc.property(triple, triple, (x, y) => {
        const sameTriple =
          x.templateId === y.templateId &&
          x.sheetName === y.sheetName &&
          x.cellAddress.toUpperCase() === y.cellAddress.toUpperCase();
        const sameKey = mappingTargetKey(x) === mappingTargetKey(y);
        // Equal keys iff equal (normalized) triples.
        expect(sameKey).toBe(sameTriple);
      }),
      { numRuns: 100 },
    );
  });
});

describe('inputFieldKey conventions', () => {
  it('builds indexed tyre set keys', () => {
    expect(inputFieldKey.tyreSet(0, 'make')).toBe('tyreSet[0].make');
  });

  it('builds vehicle, condition, rating, note, and meta keys', () => {
    expect(inputFieldKey.vehicle('frontAxlePressure')).toBe('vehicle.frontAxlePressure');
    expect(inputFieldKey.condition('testDate')).toBe('condition.testDate');
    expect(inputFieldKey.rhRating('ride', 'smoothRoad')).toBe('rhRating.ride.smoothRoad');
    expect(inputFieldKey.rhNote('handling', 'rearTracking')).toBe('rhNote.handling.rearTracking');
    expect(inputFieldKey.meta('customerName')).toBe('meta.customerName');
  });
});

describe('FieldMapping type usage', () => {
  it('accepts a well-formed mapping literal', () => {
    const m: FieldMapping = {
      mappingId: 'm1',
      templateId: 't1',
      sheetName: 'R&H',
      cellAddress: 'C7',
      inputFieldKey: inputFieldKey.tyreSet(0, 'make'),
      fieldType: 'tyreSet',
      required: true,
    };
    expect(mappingTargetKey(m)).toBe('t1|R&H|C7');
  });
});
