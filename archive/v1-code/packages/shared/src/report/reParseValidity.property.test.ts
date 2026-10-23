// Property-based tests for generated workbook re-parse validity.
//
// Feature: rnh-tyre-testing-system, Property 15: Generated workbook re-parse validity
//
// Property: For any template workbook and Test_Session, the report produced by
// generateReport is a valid .xlsx workbook that re-parses without error — it
// loads cleanly into a fresh ExcelJS workbook and yields at least one worksheet
// with the expected sheet names present. This is the executable stand-in for
// "opens without repair prompts in Microsoft Excel" (a valid workbook is one a
// fresh parser accepts without throwing).
//
// Validates: Requirements 8.6
//
// Strategy (no mocks): generate a real, varied multi-sheet ExcelJS template
// (values, formulas, number formats, and non-overlapping merged ranges), an
// arbitrary Test_Session, and a set of Field_Mappings. Run generateReport to
// obtain .xlsx bytes, then load those bytes with a FRESH ExcelJS Workbook via
// loadWorkbook and assert the load resolves (no throw), the reloaded workbook
// has at least one worksheet, and every original template sheet name is present
// in the output. Because generation is fidelity-by-preservation (only mapped
// cell values change), the round trip must succeed for every generated input.

import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FieldMapping, TestSession } from '../index';
import { loadWorkbook } from './fillWorkbook';
import { generateReport } from './generateReport';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Grid / merge helpers
// ---------------------------------------------------------------------------

const COL_LETTERS = 'ABCDEFGHIJKLMNOP'; // 16 columns is plenty for tests.

/** Column index (0-based) -> A1 column letter. */
function colLetter(index: number): string {
  return COL_LETTERS[index];
}

/** A rectangular merge described by grid coordinates. */
interface MergeRect {
  top: number; // 1-based row
  left: number; // 0-based column index
  bottom: number; // 1-based row
  right: number; // 0-based column index
}

/** Renders a {@link MergeRect} as an A1 range, e.g. "A1:C2". */
function rectToRange(rect: MergeRect): string {
  return `${colLetter(rect.left)}${rect.top}:${colLetter(rect.right)}${rect.bottom}`;
}

/**
 * Places merge requests as non-overlapping rectangles within an 8x8 grid.
 * Overlapping merges are invalid in Excel, so each rectangle is only kept when
 * its whole span is free; this keeps generated templates realistic and openable.
 */
function buildNonOverlappingMerges(
  requests: Array<{ row: number; col: number; height: number; width: number }>,
): MergeRect[] {
  const ROWS = 8;
  const COLS = 8;
  const occupied: boolean[][] = Array.from({ length: ROWS + 1 }, () =>
    Array.from({ length: COLS }, () => false),
  );
  const merges: MergeRect[] = [];

  for (const req of requests) {
    const top = req.row;
    const left = req.col;
    const bottom = Math.min(top + req.height, ROWS);
    const right = Math.min(left + req.width, COLS - 1);
    // A merge must span more than one cell.
    if (bottom === top && right === left) {
      continue;
    }
    let free = true;
    for (let r = top; r <= bottom && free; r += 1) {
      for (let c = left; c <= right; c += 1) {
        if (occupied[r][c]) {
          free = false;
          break;
        }
      }
    }
    if (!free) {
      continue;
    }
    for (let r = top; r <= bottom; r += 1) {
      for (let c = left; c <= right; c += 1) {
        occupied[r][c] = true;
      }
    }
    merges.push({ top, left, bottom, right });
  }
  return merges;
}

const mergeRequestArb = fc.record({
  row: fc.integer({ min: 1, max: 7 }),
  col: fc.integer({ min: 0, max: 6 }),
  height: fc.integer({ min: 0, max: 3 }),
  width: fc.integer({ min: 0, max: 3 }),
});

// ---------------------------------------------------------------------------
// Template workbook generation (varied content: values, formulas, formats, merges)
// ---------------------------------------------------------------------------

interface SheetSpec {
  name: string;
  /** Non-overlapping merged ranges for the sheet. */
  merges: MergeRect[];
  /** A number format applied to a seeded numeric cell, exercising formatting. */
  numberFormat: string;
  /** A seeded text value, exercising string content. */
  textValue: string;
  /** A seeded numeric value, exercising numeric content. */
  numericValue: number;
}

/**
 * Sanitizes a raw string into a valid Excel sheet name: Excel forbids the
 * characters \ / ? * [ ] :, disallows blank names, caps length at 31, and
 * forbids a leading or trailing single quote. Normalizing (rather than
 * filtering) keeps a wide range of generated strings usable and varied.
 */
function sanitizeSheetName(raw: string): string {
  let name = raw.replace(/[\\/?*[\]:]/g, '_').trim();
  name = name.replace(/^'+/, '').replace(/'+$/, '').trim();
  return name.slice(0, 31);
}

const NUMBER_FORMATS = ['General', '0.00', '#,##0', '0.0%', 'yyyy-mm-dd'] as const;

/**
 * Arbitrary template: 1..4 sheets with distinct, non-empty names in a generated
 * order, each with 0..4 non-overlapping merged ranges plus varied seeded
 * content (a text cell, a formatted numeric cell, and a formula cell). The
 * varied content exercises the parser's handling of values, formulas, and
 * number formats through the generate -> re-parse round trip.
 */
const templateSpecArb: fc.Arbitrary<SheetSpec[]> = fc
  .uniqueArray(
    fc
      .string({ minLength: 1, maxLength: 20 })
      .map(sanitizeSheetName)
      .filter((s) => s.length > 0),
    { minLength: 1, maxLength: 4, selector: (s) => s.toLowerCase() },
  )
  .chain((names) =>
    fc.tuple(
      ...names.map((name) =>
        fc
          .record({
            merges: fc.array(mergeRequestArb, { minLength: 0, maxLength: 4 }),
            numberFormat: fc.constantFrom(...NUMBER_FORMATS),
            textValue: fc.string({ maxLength: 24 }),
            numericValue: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
          })
          .map(
            (r): SheetSpec => ({
              name,
              merges: buildNonOverlappingMerges(r.merges),
              numberFormat: r.numberFormat,
              textValue: r.textValue,
              numericValue: r.numericValue,
            }),
          ),
      ),
    ),
  );

/** Builds a real .xlsx buffer from a {@link SheetSpec} list. */
async function buildTemplate(spec: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of spec) {
    const ws = wb.addWorksheet(sheet.name);
    // Text content.
    ws.getCell('A1').value = `${sheet.name}-header`;
    ws.getCell('A2').value = sheet.textValue;
    // Numeric content with a number format (formatting fidelity through re-parse).
    const numCell = ws.getCell('B2');
    numCell.value = sheet.numericValue;
    numCell.numFmt = sheet.numberFormat;
    // Seed operands and a formula that references them.
    ws.getCell('C2').value = 10;
    ws.getCell('D2').value = 5;
    ws.getCell('E2').value = { formula: 'C2+D2', result: 15 } as ExcelJS.CellFormulaValue;
    // Apply merges last so they do not clobber seeded anchors unexpectedly.
    for (const rect of sheet.merges) {
      ws.mergeCells(rectToRange(rect));
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Test_Session + Field_Mapping generation
// ---------------------------------------------------------------------------

const sessionArb: fc.Arbitrary<TestSession> = fc
  .record({
    sessionId: fc.string({ minLength: 1, maxLength: 12 }),
    createdBy: fc.string({ minLength: 1, maxLength: 12 }),
    make: fc.string({ maxLength: 16 }),
    frontAxlePressure: fc.integer({ min: 0, max: 60 }),
    driverName: fc.string({ maxLength: 16 }),
    rideRating: fc.integer({ min: 4, max: 40 }).map((n) => n * 0.25),
    rideNote: fc.string({ maxLength: 16 }),
  })
  .map((r) => ({
    sessionId: r.sessionId,
    templateId: 't1',
    createdBy: r.createdBy,
    tyreSets: [
      { groupName: 'Set A', make: r.make, pattern: 'P1', srlr: 'SR', weekCode: 'W1', dot: 'D1' },
    ],
    vehicle: {
      vehicleId: 'VH-1',
      tyreSize: '235/60 R18',
      rimSize: '18',
      frontAxlePressure: r.frontAxlePressure,
      rearAxlePressure: 30,
    },
    conditions: {
      testTrack: 'North Loop',
      driverName: r.driverName,
      loadOfCar: 'GVW',
      airTempC: 25,
      roadTempC: 40,
      testDate: '2026-09-15',
    },
    ride: {
      parameters: [{ name: 'Smooth Road', rating: r.rideRating, note: r.rideNote }],
      averageRating: r.rideRating,
    },
    handling: {
      parameters: [{ name: 'Rear Tracking', rating: 7, note: 'stable' }],
      averageRating: 7,
    },
    syncState: 'synced',
    fieldTimestamps: {},
    updatedAt: 0,
  }));

const INPUT_FIELD_KEYS = [
  'tyreSet[0].make',
  'vehicle.frontAxlePressure',
  'condition.driverName',
  'rhRating.ride.Smooth Road',
  'rhNote.ride.Smooth Road',
  // A key that resolves to nothing (leaves the cell blank) to exercise that path.
  'tyreSet[9].make',
] as const;

/**
 * Arbitrary Field_Mappings targeting real sheets in the template at addresses
 * within the generated grid. Mappings only ever write cell *values*, so the
 * generated report is expected to remain a valid, re-parseable workbook.
 */
function mappingsArb(sheetNames: string[]): fc.Arbitrary<FieldMapping[]> {
  return fc.array(
    fc
      .record({
        sheetName: fc.constantFrom(...sheetNames),
        col: fc.integer({ min: 0, max: 7 }),
        row: fc.integer({ min: 1, max: 8 }),
        inputFieldKey: fc.constantFrom(...INPUT_FIELD_KEYS),
        required: fc.boolean(),
      })
      .map(
        (m): FieldMapping => ({
          mappingId: `${m.sheetName}!${colLetter(m.col)}${m.row}`,
          templateId: 't1',
          sheetName: m.sheetName,
          cellAddress: `${colLetter(m.col)}${m.row}`,
          inputFieldKey: m.inputFieldKey,
          fieldType: 'tyreSet',
          required: m.required,
        }),
      ),
    { minLength: 0, maxLength: 6 },
  );
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 15: Generated workbook re-parse validity', () => {
  it('produces .xlsx bytes that re-parse without error into a workbook with the expected sheets', async () => {
    await fc.assert(
      fc.asyncProperty(
        templateSpecArb.chain((spec) =>
          fc.record({
            spec: fc.constant(spec),
            session: sessionArb,
            mappings: mappingsArb(spec.map((s) => s.name)),
          }),
        ),
        async ({ spec, session, mappings }) => {
          const templateBytes = await buildTemplate(spec);
          const expectedNames = spec.map((s) => s.name);

          // Generate the report -> .xlsx bytes.
          const { bytes } = await generateReport(templateBytes, mappings, session);

          // The output must be non-empty bytes.
          expect(bytes.byteLength).toBeGreaterThan(0);

          // Re-parse with a FRESH ExcelJS workbook: this must not throw, which
          // is the executable meaning of "opens cleanly / without repair"
          // (R8.6). loadWorkbook constructs a brand-new ExcelJS.Workbook.
          const reparsed = await loadWorkbook(bytes);

          // A valid workbook has at least one worksheet.
          expect(reparsed.worksheets.length).toBeGreaterThan(0);

          // The expected sheet names are present in the re-parsed workbook.
          const reparsedNames = reparsed.worksheets.map((ws) => ws.name);
          for (const name of expectedNames) {
            expect(reparsedNames).toContain(name);
          }
          // Same sheet count as the template (no sheets lost or added).
          expect(reparsedNames).toHaveLength(expectedNames.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60000);
});
