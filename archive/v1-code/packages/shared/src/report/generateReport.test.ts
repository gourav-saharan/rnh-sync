import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { FieldMapping, TestSession } from '../index';
import { generateReport, XLSX_MIME_TYPE } from './generateReport';
import { loadWorkbook } from './fillWorkbook';

/** Builds a real .xlsx workbook in memory to exercise generation against genuine ExcelJS output. */
async function buildWorkbook(
  sheets: Array<{
    name: string;
    cells?: Array<{ address: string; value?: string | number; numFmt?: string }>;
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const cell of sheet.cells ?? []) {
      const c = ws.getCell(cell.address);
      if (cell.value !== undefined) {
        c.value = cell.value;
      }
      if (cell.numFmt !== undefined) {
        c.numFmt = cell.numFmt;
      }
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

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
    ride: { parameters: [{ name: 'Smooth Road', rating: 6.5, note: 'ok' }], averageRating: 6.5 },
    handling: { parameters: [{ name: 'Rear Tracking', rating: 7, note: 'stable' }], averageRating: 7 },
    syncState: 'synced',
    fieldTimestamps: {},
    updatedAt: 0,
    ...overrides,
  };
}

function mapping(
  partial: Partial<FieldMapping> &
    Pick<FieldMapping, 'sheetName' | 'cellAddress' | 'inputFieldKey' | 'fieldType'>,
): FieldMapping {
  return {
    mappingId: `${partial.sheetName}!${partial.cellAddress}`,
    templateId: 't1',
    required: false,
    ...partial,
  } as FieldMapping;
}

describe('generateReport', () => {
  it('serializes to .xlsx bytes that re-parse with mapped values written', async () => {
    const bytes = await buildWorkbook([
      { name: 'Info', cells: [{ address: 'A1', value: 'label' }] },
      { name: 'Ratings' },
    ]);
    const session = makeSession();
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'Info', cellAddress: 'B2', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet' }),
      mapping({ sheetName: 'Ratings', cellAddress: 'C5', inputFieldKey: 'rhRating.ride.Smooth Road', fieldType: 'rhRating' }),
    ];

    const result = await generateReport(bytes, mappings, session);

    // Bytes are usable as a Blob part and re-parse validly.
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.byteLength).toBeGreaterThan(0);

    const reloaded = await loadWorkbook(Buffer.from(result.bytes));
    expect(reloaded.getWorksheet('Info')!.getCell('B2').value).toBe('BrandX');
    expect(reloaded.getWorksheet('Info')!.getCell('A1').value).toBe('label');
    expect(reloaded.getWorksheet('Ratings')!.getCell('C5').value).toBe(6.5);

    expect(result.missingRequiredFields).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('reports each required-but-missing field with its blank cell location and leaves the cell blank', async () => {
    const bytes = await buildWorkbook([{ name: 'S1' }]);
    // A session with no value for the required mapped field.
    const session = makeSession({
      tyreSets: [{ groupName: 'Set A', make: '', pattern: '', srlr: '', weekCode: '', dot: '' }],
    });
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'S1', cellAddress: 'B2', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet', required: true }),
    ];

    const result = await generateReport(bytes, mappings, session);

    expect(result.missingRequiredFields).toHaveLength(1);
    const [missing] = result.missingRequiredFields;
    expect(missing.inputFieldKey).toBe('tyreSet[0].make');
    expect(missing.sheetName).toBe('S1');
    expect(missing.cellAddress).toBe('B2');
    expect(missing.label).toBe('S1!B2 (tyreSet[0].make)');

    // The cell was left blank in the serialized output.
    const reloaded = await loadWorkbook(Buffer.from(result.bytes));
    expect(reloaded.getWorksheet('S1')!.getCell('B2').value).toBeNull();
  });

  it('does not report optional (non-required) missing fields', async () => {
    const bytes = await buildWorkbook([{ name: 'S1' }]);
    const session = makeSession({
      tyreSets: [{ groupName: 'Set A', make: '', pattern: '', srlr: '', weekCode: '', dot: '' }],
    });
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'S1', cellAddress: 'B2', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet', required: false }),
    ];

    const result = await generateReport(bytes, mappings, session);

    expect(result.missingRequiredFields).toHaveLength(0);
  });

  it('passes through sheet-not-found warnings from the fill step', async () => {
    const bytes = await buildWorkbook([{ name: 'Present' }]);
    const session = makeSession();
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'Absent', cellAddress: 'A1', inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet' }),
    ];

    const result = await generateReport(bytes, mappings, session);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('sheet-not-found');
  });

  it('forwards meta options to the fill step', async () => {
    const bytes = await buildWorkbook([{ name: 'S1' }]);
    const session = makeSession();
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'S1', cellAddress: 'A1', inputFieldKey: 'meta.customerName', fieldType: 'meta' }),
    ];

    const result = await generateReport(bytes, mappings, session, { meta: { customerName: 'MSIL' } });

    const reloaded = await loadWorkbook(Buffer.from(result.bytes));
    expect(reloaded.getWorksheet('S1')!.getCell('A1').value).toBe('MSIL');
  });

  it('exposes the .xlsx MIME type for Blob construction', () => {
    expect(XLSX_MIME_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});
