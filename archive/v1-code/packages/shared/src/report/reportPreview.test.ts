import { describe, expect, it } from 'vitest';
import type { FieldMapping } from '../index';
import type { AppliedWrite } from './fillWorkbook';
import type { MissingRequiredField } from './generateReport';
import { buildReportPreview } from './reportPreview';

function mapping(overrides: Partial<FieldMapping> = {}): FieldMapping {
  return {
    templateId: 't1',
    sheetName: 'Sheet1',
    cellAddress: 'A1',
    inputFieldKey: 'vehicle.vehicleId',
    fieldType: 'vehicle',
    required: false,
    ...overrides,
  } as FieldMapping;
}

function write(overrides: Partial<AppliedWrite> = {}): AppliedWrite {
  const m = overrides.mapping ?? mapping();
  return {
    mapping: m,
    sheetName: overrides.sheetName ?? m.sheetName,
    cellAddress: overrides.cellAddress ?? m.cellAddress,
    value: overrides.value ?? 'value',
  };
}

describe('buildReportPreview (R9.4)', () => {
  it('groups applied writes by sheet in first-write order', () => {
    const applied: AppliedWrite[] = [
      write({ sheetName: 'S1', cellAddress: 'A1', value: 'a' }),
      write({ sheetName: 'S2', cellAddress: 'B2', value: 'b' }),
      write({ sheetName: 'S1', cellAddress: 'A2', value: 'c' }),
    ];

    const preview = buildReportPreview({ applied, missingRequiredFields: [] });

    expect(preview.populatedSheetNames).toEqual(['S1', 'S2']);
    expect(preview.sheets).toHaveLength(2);
    expect(preview.sheets[0].cells.map((c) => c.cellAddress)).toEqual(['A1', 'A2']);
    expect(preview.sheets[1].cells.map((c) => c.cellAddress)).toEqual(['B2']);
  });

  it('reports the total populated cell count', () => {
    const applied: AppliedWrite[] = [
      write({ sheetName: 'S1', cellAddress: 'A1' }),
      write({ sheetName: 'S1', cellAddress: 'A2' }),
      write({ sheetName: 'S2', cellAddress: 'C3' }),
    ];

    const preview = buildReportPreview({ applied, missingRequiredFields: [] });
    expect(preview.totalPopulatedCells).toBe(3);
  });

  it('renders numeric values as strings', () => {
    const applied: AppliedWrite[] = [write({ sheetName: 'S1', cellAddress: 'A1', value: 6.5 })];
    const preview = buildReportPreview({ applied, missingRequiredFields: [] });
    expect(preview.sheets[0].cells[0].value).toBe('6.5');
  });

  it('carries the input field key for each populated cell', () => {
    const applied: AppliedWrite[] = [
      write({
        mapping: mapping({ inputFieldKey: 'rhRating.ride.Smooth Road' }),
        sheetName: 'S1',
        cellAddress: 'A1',
      }),
    ];
    const preview = buildReportPreview({ applied, missingRequiredFields: [] });
    expect(preview.sheets[0].cells[0].inputFieldKey).toBe('rhRating.ride.Smooth Road');
  });

  it('passes through missing required fields', () => {
    const missing: MissingRequiredField[] = [
      { inputFieldKey: 'vehicle.vehicleId', sheetName: 'S1', cellAddress: 'A1', label: 'S1!A1 (vehicle.vehicleId)' },
    ];
    const preview = buildReportPreview({ applied: [], missingRequiredFields: missing });
    expect(preview.missingRequiredFields).toEqual(missing);
  });

  it('produces an empty preview when nothing was populated', () => {
    const preview = buildReportPreview({ applied: [], missingRequiredFields: [] });
    expect(preview.sheets).toEqual([]);
    expect(preview.populatedSheetNames).toEqual([]);
    expect(preview.totalPopulatedCells).toBe(0);
  });
});
