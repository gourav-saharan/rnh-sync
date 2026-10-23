import { describe, expect, it } from 'vitest';
import type { FieldMapping } from '../index';
import {
  createMapping,
  resolveMappingAnchor,
  resolveMergeAnchor,
} from './mapping';

/** Builds a minimal, valid Field_Mapping for tests. */
function mapping(overrides: Partial<FieldMapping> = {}): FieldMapping {
  return {
    mappingId: overrides.mappingId ?? 'm1',
    templateId: overrides.templateId ?? 't1',
    sheetName: overrides.sheetName ?? 'MU1',
    cellAddress: overrides.cellAddress ?? 'A1',
    inputFieldKey: overrides.inputFieldKey ?? 'vehicle.vehicleId',
    fieldType: overrides.fieldType ?? 'vehicle',
    rhParameterName: overrides.rhParameterName,
    required: overrides.required ?? false,
  };
}

describe('resolveMergeAnchor', () => {
  it('resolves a cell inside a horizontal merge to the top-left anchor', () => {
    expect(resolveMergeAnchor('C1', ['A1:D1'])).toBe('A1');
    expect(resolveMergeAnchor('D1', ['A1:D1'])).toBe('A1');
  });

  it('resolves a cell inside a rectangular merge to the top-left anchor', () => {
    expect(resolveMergeAnchor('C3', ['B2:D4'])).toBe('B2');
    expect(resolveMergeAnchor('B2', ['B2:D4'])).toBe('B2');
  });

  it('leaves the anchor itself unchanged', () => {
    expect(resolveMergeAnchor('A1', ['A1:D1'])).toBe('A1');
  });

  it('canonicalises a cell outside every merge to uppercase A1', () => {
    expect(resolveMergeAnchor('e5', ['A1:D1'])).toBe('E5');
    expect(resolveMergeAnchor('$B$7', [])).toBe('B7');
  });

  it('is case-insensitive for addresses and ranges', () => {
    expect(resolveMergeAnchor('c1', ['a1:d1'])).toBe('A1');
  });

  it('picks the first containing range when ranges overlap', () => {
    expect(resolveMergeAnchor('B2', ['A1:C3', 'B2:D4'])).toBe('A1');
  });

  it('handles multi-letter columns', () => {
    expect(resolveMergeAnchor('AB2', ['AA1:AC3'])).toBe('AA1');
  });

  it('returns the trimmed original when the address is unparseable', () => {
    expect(resolveMergeAnchor('  not-a-cell  ', ['A1:D1'])).toBe('not-a-cell');
  });

  it('ignores unparseable ranges', () => {
    expect(resolveMergeAnchor('C1', ['garbage', 'A1:D1'])).toBe('A1');
  });
});

describe('resolveMappingAnchor', () => {
  it('rewrites cellAddress to the merge anchor for the mapping sheet', () => {
    const m = mapping({ sheetName: 'MU1', cellAddress: 'C1' });
    const resolved = resolveMappingAnchor(m, { MU1: ['A1:D1'] });
    expect(resolved.cellAddress).toBe('A1');
  });

  it('treats a sheet with no merge entry as having no merges', () => {
    const m = mapping({ sheetName: 'Other', cellAddress: 'c1' });
    const resolved = resolveMappingAnchor(m, { MU1: ['A1:D1'] });
    expect(resolved.cellAddress).toBe('C1');
  });

  it('returns the same object reference when the address does not change', () => {
    const m = mapping({ cellAddress: 'A1', sheetName: 'MU1' });
    const resolved = resolveMappingAnchor(m, { MU1: ['A1:D1'] });
    expect(resolved).toBe(m);
  });
});

describe('createMapping', () => {
  it('accepts a single mapping', () => {
    const result = createMapping(mapping({ cellAddress: 'B2' }));
    expect(result.accepted).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it('accepts distinct target cells and reports no conflicts', () => {
    const result = createMapping([
      mapping({ mappingId: 'a', cellAddress: 'A1', inputFieldKey: 'vehicle.vehicleId' }),
      mapping({ mappingId: 'b', cellAddress: 'B1', inputFieldKey: 'vehicle.tyreSize' }),
    ]);
    expect(result.accepted.map((m) => m.mappingId)).toEqual(['a', 'b']);
    expect(result.conflicts).toHaveLength(0);
  });

  it('withholds only the second mapping to the same target cell (R3.5)', () => {
    const result = createMapping([
      mapping({ mappingId: 'a', cellAddress: 'C7', inputFieldKey: 'vehicle.vehicleId' }),
      mapping({ mappingId: 'b', cellAddress: 'C7', inputFieldKey: 'vehicle.tyreSize' }),
      mapping({ mappingId: 'c', cellAddress: 'D7', inputFieldKey: 'vehicle.rimSize' }),
    ]);
    expect(result.accepted.map((m) => m.mappingId)).toEqual(['a', 'c']);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].mapping.mappingId).toBe('b');
    expect(result.conflicts[0].reason).toBe('duplicate-target-cell');
  });

  it('treats the same cell on different sheets as distinct targets (R3.3)', () => {
    const result = createMapping([
      mapping({ mappingId: 'a', sheetName: 'MU1', cellAddress: 'A1' }),
      mapping({ mappingId: 'b', sheetName: 'MU2', cellAddress: 'A1' }),
    ]);
    expect(result.accepted).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  it('detects a case-insensitive duplicate target cell', () => {
    const result = createMapping([
      mapping({ mappingId: 'a', cellAddress: 'C7' }),
      mapping({ mappingId: 'b', cellAddress: 'c7' }),
    ]);
    expect(result.accepted.map((m) => m.mappingId)).toEqual(['a']);
    expect(result.conflicts.map((c) => c.mapping.mappingId)).toEqual(['b']);
  });

  it('detects a conflict when two cells resolve to the same merge anchor', () => {
    const result = createMapping(
      [
        mapping({ mappingId: 'a', sheetName: 'MU1', cellAddress: 'A1' }),
        mapping({ mappingId: 'b', sheetName: 'MU1', cellAddress: 'C1' }),
      ],
      { mergedRangesBySheet: { MU1: ['A1:D1'] } },
    );
    expect(result.accepted.map((m) => m.mappingId)).toEqual(['a']);
    expect(result.conflicts.map((c) => c.mapping.mappingId)).toEqual(['b']);
  });

  it('stores the resolved merge anchor on accepted mappings', () => {
    const result = createMapping(mapping({ sheetName: 'MU1', cellAddress: 'C1' }), {
      mergedRangesBySheet: { MU1: ['A1:D1'] },
    });
    expect(result.accepted[0].cellAddress).toBe('A1');
  });

  it('returns empty result for an empty proposal list', () => {
    const result = createMapping([]);
    expect(result.accepted).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });
});
