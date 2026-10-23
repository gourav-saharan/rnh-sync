import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { FieldMapping, TestSession } from '../index';
import { XLSX_MIME_TYPE } from './generateReport';
import { generateReportWithPreview } from './generateReportWithPreview';
import { loadWorkbook } from './fillWorkbook';

async function buildWorkbook(sheetNames: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const name of sheetNames) {
    wb.addWorksheet(name);
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

function mapping(overrides: Partial<FieldMapping>): FieldMapping {
  return {
    templateId: 't1',
    sheetName: 'S1',
    cellAddress: 'A1',
    inputFieldKey: 'vehicle.vehicleId',
    fieldType: 'vehicle',
    required: false,
    ...overrides,
  } as FieldMapping;
}

describe('generateReportWithPreview (R9.3, R9.4)', () => {
  it('produces bytes, filename, preview, and missing fields together', async () => {
    const bytes = await buildWorkbook(['S1', 'S2']);
    const mappings: FieldMapping[] = [
      mapping({ sheetName: 'S1', cellAddress: 'A1', inputFieldKey: 'vehicle.vehicleId' }),
      mapping({ sheetName: 'S2', cellAddress: 'B2', inputFieldKey: 'condition.testTrack', fieldType: 'condition' }),
      mapping({
        sheetName: 'S1',
        cellAddress: 'C3',
        inputFieldKey: 'vehicle.tyreSize',
      }),
    ];

    const result = await generateReportWithPreview(bytes, mappings, makeSession(), {
      customerName: 'Hyundai',
    });

    expect(result.mimeType).toBe(XLSX_MIME_TYPE);
    expect(result.suggestedFileName).toBe('Hyundai_2026-09-15.xlsx');
    expect(result.preview.totalPopulatedCells).toBe(3);
    expect(result.preview.populatedSheetNames).toEqual(['S1', 'S2']);
    expect(result.missingRequiredFields).toEqual([]);

    // Bytes re-parse to a valid workbook with the written values.
    const reloaded = await loadWorkbook(Buffer.from(result.bytes));
    expect(reloaded.getWorksheet('S1')?.getCell('A1').value).toBe('VH-1');
    expect(reloaded.getWorksheet('S2')?.getCell('B2').value).toBe('North Loop');
  });

  it('falls back to meta.customerName for the filename', async () => {
    const bytes = await buildWorkbook(['S1']);
    const result = await generateReportWithPreview(bytes, [], makeSession(), {
      meta: { customerName: 'MSIL' },
    });
    expect(result.suggestedFileName).toBe('MSIL_2026-09-15.xlsx');
  });

  it('reports required-but-missing fields and reflects them in the preview', async () => {
    const bytes = await buildWorkbook(['S1']);
    const mappings: FieldMapping[] = [
      mapping({
        sheetName: 'S1',
        cellAddress: 'A1',
        inputFieldKey: 'vehicle.vehicleId',
      }),
      // A required field with no value on the session -> left blank + reported.
      mapping({
        sheetName: 'S1',
        cellAddress: 'D4',
        inputFieldKey: 'meta.reportNumber',
        fieldType: 'meta',
        required: true,
      }),
    ];

    const result = await generateReportWithPreview(bytes, mappings, makeSession(), {
      customerName: 'Renault',
    });

    expect(result.missingRequiredFields).toHaveLength(1);
    expect(result.missingRequiredFields[0].inputFieldKey).toBe('meta.reportNumber');
    expect(result.preview.missingRequiredFields).toEqual(result.missingRequiredFields);
    expect(result.preview.totalPopulatedCells).toBe(1);
  });
});
