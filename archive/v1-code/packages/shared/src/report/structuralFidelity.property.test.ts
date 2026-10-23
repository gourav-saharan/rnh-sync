// Property-based tests for report output structural fidelity.
//
// Feature: rnh-tyre-testing-system, Property 12: Output structural fidelity
//
// (The design document / tasks.md number this "Property 14: Output structural
// fidelity"; the delegated task tags it "Property 12". Both refer to the same
// invariant: the fidelity-by-preservation report strategy — load the original
// .xlsx, mutate only mapped cells, never restructure.)
//
// Property: For any template workbook, the generated report preserves the same
// sheets, in the same order, with the same sheet names and merged-cell
// structure as the template.
//
// Validates: Requirements 8.3, 8.6
//
// Strategy (no mocks): generate a real multi-sheet ExcelJS template with varied
// sheet names, sheet order, and merged ranges; generate an arbitrary
// Test_Session and some Field_Mappings; run fillWorkbook; serialize the result
// and reload it as a fresh workbook. Then assert the reloaded output has the
// same sheet count, the same sheet names in the same order, and the same
// per-sheet merged-cell ranges as the original template. Because fillWorkbook
// only writes mapped cell values and never restructures the workbook, these
// structural properties must hold for every generated input.

import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FieldMapping, TestSession } from '../index';
import { fillWorkbook, loadWorkbook } from './fillWorkbook';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

const COL_LETTERS = 'ABCDEFGHIJKLMNOP'; // 16 columns is plenty for tests.

/** Column index (0-based) -> A1 column letters (only needs single letters here). */
function colLetter(index: number): string {
  return COL_LETTERS[index];
}

/** A rectangular merge described by 0-based grid coordinates. */
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
 * Reads a worksheet's merged ranges in a normalized, comparison-friendly form.
 * ExcelJS exposes merges either on `model.merges` (after (re)load) or in the
 * internal `_merges` map (right after `mergeCells`); we accept both so the
 * assertion is robust across the template (freshly built) and the reloaded
 * output. Ranges are upper-cased and sorted so ordering/casing differences do
 * not cause false negatives — we compare the *set* of merged ranges per sheet.
 */
function mergedRangesOf(worksheet: ExcelJS.Worksheet): string[] {
  const modelMerges = (worksheet.model as unknown as { merges?: string[] }).merges;
  let ranges: string[];
  if (Array.isArray(modelMerges)) {
    ranges = modelMerges;
  } else {
    const mergeMap = (worksheet as unknown as {
      _merges?: Record<string, { range?: string } | undefined>;
    })._merges;
    ranges = mergeMap
      ? Object.values(mergeMap)
          .map((m) => m?.range)
          .filter((r): r is string => typeof r === 'string')
      : [];
  }
  return ranges.map((r) => r.toUpperCase()).sort();
}

// ---------------------------------------------------------------------------
// Template workbook generation
// ---------------------------------------------------------------------------

interface SheetSpec {
  name: string;
  /** Non-overlapping merged ranges for the sheet. */
  merges: MergeRect[];
}

/**
 * Generates a set of non-overlapping merge rectangles within an 8-row x 8-col
 * grid. Overlapping merges are invalid in Excel, so we place each rectangle by
 * scanning for a free top-left cell and claiming its span, skipping any that
 * would collide. This keeps generated templates realistic and openable.
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
    const top = req.row; // 1-based row (1..ROWS)
    const left = req.col; // 0-based col (0..COLS-1)
    const bottom = Math.min(top + req.height, ROWS);
    const right = Math.min(left + req.width, COLS - 1);
    // A merge must span more than one cell.
    if (bottom === top && right === left) {
      continue;
    }
    // Check the whole rectangle is free.
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

/**
 * Arbitrary template: 1..4 sheets with distinct names (ExcelJS requires unique,
 * non-empty sheet names) in a generated order, each with 0..4 non-overlapping
 * merged ranges. Names use a varied character set to exercise fidelity.
 */
/**
 * Sanitizes a raw string into a valid Excel sheet name: Excel forbids the
 * characters \ / ? * [ ] :, disallows blank names, caps length at 31, and
 * forbids a leading or trailing single quote. We normalize rather than filter
 * so a wide range of generated strings still yields usable, varied names.
 */
function sanitizeSheetName(raw: string): string {
  let name = raw.replace(/[\\/?*[\]:]/g, '_').trim();
  // A leading/trailing single quote is rejected by Excel/ExcelJS.
  name = name.replace(/^'+/, '').replace(/'+$/, '').trim();
  return name.slice(0, 31);
}

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
          .array(mergeRequestArb, { minLength: 0, maxLength: 4 })
          .map((requests) => ({ name, merges: buildNonOverlappingMerges(requests) })),
      ),
    ),
  );

/** Builds a real .xlsx buffer from a {@link SheetSpec} list. */
async function buildTemplate(spec: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of spec) {
    const ws = wb.addWorksheet(sheet.name);
    // Seed some content so sheets are non-trivial.
    ws.getCell('A1').value = `${sheet.name}-header`;
    for (const rect of sheet.merges) {
      ws.mergeCells(rectToRange(rect));
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Test_Session + Field_Mapping generation
// ---------------------------------------------------------------------------

const sessionArb: fc.Arbitrary<TestSession> = fc.record({
  sessionId: fc.string({ minLength: 1, maxLength: 12 }),
  createdBy: fc.string({ minLength: 1, maxLength: 12 }),
  make: fc.string({ maxLength: 16 }),
  frontAxlePressure: fc.integer({ min: 0, max: 60 }),
  driverName: fc.string({ maxLength: 16 }),
  rideRating: fc.integer({ min: 4, max: 40 }).map((n) => n * 0.25),
  rideNote: fc.string({ maxLength: 16 }),
}).map((r) => ({
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
 * Arbitrary Field_Mappings that target real sheets in the template at addresses
 * within the generated grid. Mappings only ever write cell *values*; they must
 * never change the workbook's structure, which is exactly what this property
 * verifies.
 */
function mappingsArb(sheetNames: string[]): fc.Arbitrary<FieldMapping[]> {
  return fc.array(
    fc.record({
      sheetName: fc.constantFrom(...sheetNames),
      col: fc.integer({ min: 0, max: 7 }),
      row: fc.integer({ min: 1, max: 8 }),
      inputFieldKey: fc.constantFrom(...INPUT_FIELD_KEYS),
      required: fc.boolean(),
    }).map((m): FieldMapping => ({
      mappingId: `${m.sheetName}!${colLetter(m.col)}${m.row}`,
      templateId: 't1',
      sheetName: m.sheetName,
      cellAddress: `${colLetter(m.col)}${m.row}`,
      inputFieldKey: m.inputFieldKey,
      fieldType: 'tyreSet',
      required: m.required,
    })),
    { minLength: 0, maxLength: 6 },
  );
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 12: Output structural fidelity', () => {
  it('preserves sheet count, sheet names/order, and merged ranges through generation', async () => {
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

          // Reference structure taken from the original template.
          const template = await loadWorkbook(templateBytes);
          const templateNames = template.worksheets.map((ws) => ws.name);
          const templateMerges = template.worksheets.map((ws) => mergedRangesOf(ws));

          // Generate the report and round-trip it through serialization.
          const { workbook } = await fillWorkbook(templateBytes, mappings, session);
          const outBytes = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
          const output = await loadWorkbook(outBytes);

          const outputNames = output.worksheets.map((ws) => ws.name);
          const outputMerges = output.worksheets.map((ws) => mergedRangesOf(ws));

          // Same number of sheets (R8.3).
          expect(outputNames).toHaveLength(templateNames.length);
          // Same sheet names, in the same order (R8.3).
          expect(outputNames).toEqual(templateNames);
          // Same merged-cell structure per sheet (R8.3).
          expect(outputMerges).toEqual(templateMerges);
          // The output re-parses without error (a workbook that opens cleanly;
          // R8.6) — reaching here means load + serialize + reload all succeeded.
          expect(output.worksheets.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60000);
});
