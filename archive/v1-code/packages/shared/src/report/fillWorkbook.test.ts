import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { FieldMapping, TestSession } from '../index';
import { fillWorkbook, loadWorkbook } from './fillWorkbook';
import { resolveFieldValue } from './resolveFieldValue';

/**
 * Builds a real .xlsx workbook in memory so the fill step is exercised against
 * genuine ExcelJS output rather than mocks. Cells can carry a value, an
 * explicit number format (to assert formatting preservation), or a formula.
 */
async function buildWorkbook(
  sheets: Array<{
    name: string;
    cells?: Array<{
      address: string;
      value?: string | number;
      numFmt?: string;
      formula?: string;
    }>;
    merges?: string[];
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const cell of sheet.cells ?? []) {
      const c = ws.getCell(cell.address);
      if (cell.formula !== undefined) {
        c.value = { formula: cell.formula } as ExcelJS.CellFormulaValue;
      } else if (cell.value !== undefined) {
        c.value = cell.value;
      }
      if (cell.numFmt !== undefined) {
        c.numFmt = cell.numFmt;
      }
    }
    for (const range of sheet.merges ?? []) {
      ws.mergeCells(range);
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** A minimal, valid Test_Session with a couple of populated fields. */
function makeSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    sessionId: 's1',
    templateId: 't1',
    createdBy: 'u1',
    tyreSets: [
      { groupName: 'Set A', make: 'BrandX', pattern: 'P1', srlr: 'SR', weekCode: 'W12', dot: 'D34' },
    ],
    vehicle: {
      vehicleId: 'VH-1',
      tyreSize: '235/60 R18',
      rimSize: '18',
      frontAxlePressure: 32,
      rearAxlePressure: 30,
    },
    conditions: {
      testTrack: 'North Loop',
      driverName: 'Alex',
      loadOfCar: 'GVW',
      airTempC: 25,
      roadTempC: 40,
      testDate: '2026-09-15',
    },
    ride: {
      parameters: [{ name: 'Smooth Road', rating: 6.5, note: 'ok' }],
      averageRating: 6.5,
    },
    handling: {
      parameters: [{ name: 'Rear Tracking', rating: 7, note: 'stable' }],
      averageRating: 7,
    },
    syncState: 'synced',
    fieldTimestamps: {},
    updatedAt: 0,
    ...overrides,
  };
}

function mapping(partial: Partial<FieldMapping> & Pick<FieldMapping, 'sheetName' | 'cellAddress' | 'inputFieldKey' | 'fieldType'>): FieldMapping {
  return {
    mappingId: `${partial.sheetName}!${partial.cellAddress}`,
    templateId: 't1',
    required: false,
    ...partial,
  } as FieldMapping;
}

describe('resolveFieldValue', () => {
  const session = makeSession();

  it('resolves tyreSet, vehicle, and condition fields', () => {
    expect(resolveFieldValue('tyreSet[0].make', session)).toBe('BrandX');
    expect(resolveFieldValue('vehicle.frontAxlePressure', session)).toBe(32);
    expect(resolveFieldValue('condition.testDate', session)).toBe('2026-09-15');
  });

  it('resolves rhRating and rhNote across categories, matching name forms', () => {
    expect(resolveFieldValue('rhRating.ride.Smooth Road', session)).toBe(6.5);
    // camelCase form used by the inputFieldKey builder still matches display name
    expect(resolveFieldValue('rhRating.ride.smoothRoad', session)).toBe(6.5);
    expect(resolveFieldValue('rhNote.handling.Rear Tracking', session)).toBe('stable');
  });

  it('resolves meta.* from provided metadata', () => {
    expect(resolveFieldValue('meta.customerName', session, { customerName: 'MSIL' })).toBe('MSIL');
  });

  it('returns undefined for unset / unknown keys', () => {
    expect(resolveFieldValue('tyreSet[5].make', session)).toBeUndefined();
    expect(resolveFieldValue('rhRating.ride.Nonexistent', session)).toBeUndefined();
    expect(resolveFieldValue('meta.absent', session)).toBeUndefined();
    expect(resolveFieldValue('garbage', session)).toBeUndefined();
  });
});

describe('fillWorkbook', () => {
  it('writes mapped Test_Session values across multiple sheets at their addresses', async () => {
    const bytes = await buildWorkbook([
      { name: 'Info', cells: [{ address: 'A1', value: 'label' }] },
      { name: 'Ratings' },
    ]);
    const session = makeSession();
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'Info', cellAddress: 'B2', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet' }),
      mapping({ sheetName: 'Info', cellAddress: 'B3', inputFieldKey: 'vehicle.frontAxlePressure', fieldType: 'vehicle' }),
      mapping({ sheetName: 'Ratings', cellAddress: 'C5', inputFieldKey: 'rhRating.ride.Smooth Road', fieldType: 'rhRating' }),
    ];

    const { workbook, applied } = await fillWorkbook(bytes, mappings, session);

    expect(workbook.getWorksheet('Info')!.getCell('B2').value).toBe('BrandX');
    expect(workbook.getWorksheet('Info')!.getCell('B3').value).toBe(32);
    expect(workbook.getWorksheet('Ratings')!.getCell('C5').value).toBe(6.5);
    expect(applied).toHaveLength(3);
  });

  it('preserves unmapped cells, formatting, and formulas', async () => {
    const bytes = await buildWorkbook([
      {
        name: 'S1',
        cells: [
          { address: 'A1', value: 'keep me' },
          { address: 'B1', value: 100, numFmt: '0.00' },
          { address: 'C1', formula: 'A1' },
          { address: 'D1', value: 5 },
        ],
      },
    ]);
    const session = makeSession();
    // Only map D1; everything else must be preserved untouched.
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'S1', cellAddress: 'D1', inputFieldKey: 'vehicle.rearAxlePressure', fieldType: 'vehicle' }),
    ];

    const { workbook } = await fillWorkbook(bytes, mappings, session);
    const ws = workbook.getWorksheet('S1')!;

    // Unmapped value cell unchanged
    expect(ws.getCell('A1').value).toBe('keep me');
    // Unmapped formatting preserved on the numeric cell
    expect(ws.getCell('B1').value).toBe(100);
    expect(ws.getCell('B1').numFmt).toBe('0.00');
    // Unmapped formula preserved
    const c1 = ws.getCell('C1').value as ExcelJS.CellFormulaValue;
    expect(c1.formula).toBe('A1');
    // Mapped cell written
    expect(ws.getCell('D1').value).toBe(30);
  });

  it('resolves a mapped address inside a merged range to the merge anchor', async () => {
    const bytes = await buildWorkbook([
      { name: 'M', cells: [{ address: 'A1', value: 'anchor' }], merges: ['A1:C1'] },
    ]);
    const session = makeSession();
    // Map to B1 (inside the A1:C1 merge) — value must land on the A1 anchor.
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'M', cellAddress: 'B1', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet' }),
    ];

    const { workbook, applied } = await fillWorkbook(bytes, mappings, session);

    expect(workbook.getWorksheet('M')!.getCell('A1').value).toBe('BrandX');
    expect(applied[0].cellAddress).toBe('A1');
  });

  it('skips a mapping whose sheet is absent and records a warning', async () => {
    const bytes = await buildWorkbook([{ name: 'Present' }]);
    const session = makeSession();
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'Absent', cellAddress: 'A1', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet' }),
    ];

    const { applied, warnings } = await fillWorkbook(bytes, mappings, session);

    expect(applied).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('sheet-not-found');
    expect(warnings[0].message).toMatch(/Absent/);
  });

  it('leaves required-but-missing cells blank and records them as missing', async () => {
    const bytes = await buildWorkbook([{ name: 'S1' }]);
    // Session without a value for the mapped field.
    const session = makeSession({
      tyreSets: [
        { groupName: 'Set A', make: '', pattern: '', srlr: 'SR', weekCode: '', dot: '' },
      ],
    });
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'S1', cellAddress: 'B2', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet', required: true }),
    ];

    const { workbook, applied, missing } = await fillWorkbook(bytes, mappings, session);

    expect(applied).toHaveLength(0);
    expect(missing).toHaveLength(1);
    // The cell was not written (left blank).
    expect(workbook.getWorksheet('S1')!.getCell('B2').value).toBeNull();
  });

  it('produces a workbook that re-parses validly after filling', async () => {
    const bytes = await buildWorkbook([{ name: 'S1', cells: [{ address: 'A1', value: 'x' }] }]);
    const session = makeSession();
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'S1', cellAddress: 'B1', inputFieldKey: 'condition.driverName', fieldType: 'condition' }),
    ];

    const { workbook } = await fillWorkbook(bytes, mappings, session);
    const out = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    const reloaded = await loadWorkbook(out);

    expect(reloaded.getWorksheet('S1')!.getCell('B1').value).toBe('Alex');
    expect(reloaded.getWorksheet('S1')!.getCell('A1').value).toBe('x');
  });
});
