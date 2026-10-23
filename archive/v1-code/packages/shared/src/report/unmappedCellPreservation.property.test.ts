// Property-based test for unmapped cell preservation (task 10.3).
//
// Feature: rnh-tyre-testing-system, Property 6: Unmapped cell preservation
//
// Property 6 (Unmapped cell preservation): For any template and any
// Test_Session, every cell in the generated workbook that is not a mapping
// target is byte-for-byte identical (value, formula, formatting) to the
// corresponding cell in the original template.
//
// Strategy (fidelity-by-preservation):
//   1. Generate an arbitrary template workbook (ExcelJS) with a mix of value
//      cells, formula cells, and cells carrying number formats / styles, plus
//      arbitrary merged ranges.
//   2. Generate an arbitrary Test_Session and a set of Field_Mappings that
//      target a subset of the template's cells.
//   3. Run fillWorkbook, serialize the result and reload it. Reload the
//      ORIGINAL template bytes the same way so both sides are compared after an
//      identical serialize/parse round-trip (this cancels out any lossless
//      normalisation ExcelJS applies on save, isolating the property to genuine
//      differences introduced by the fill step).
//   4. The mapping target set is computed via merge-anchor resolution
//      (resolveMergeAnchor) so a mapping to any cell inside a merged range
//      counts the range's top-left anchor as the target. Assert every cell that
//      is NOT a target is identical (value, formula, numFmt, style) between the
//      reloaded original and the reloaded filled workbook.
//
// Validates: Requirements 7.3, 8.6

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  inputFieldKey,
  mappingTargetKey,
  type FieldMapping,
  type TestSession,
} from '../index';
import { resolveMergeAnchor } from '../template/mapping';
import { fillWorkbook, loadWorkbook } from './fillWorkbook';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 120;

// ---------------------------------------------------------------------------
// Cell address helpers (A1 <-> row/col) kept local to the test so it does not
// depend on the module under test for address maths.
// ---------------------------------------------------------------------------

function columnLetters(col: number): string {
  let n = col;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function addressOf(row: number, col: number): string {
  return `${columnLetters(col)}${row}`;
}

// ---------------------------------------------------------------------------
// Generated-workbook model
// ---------------------------------------------------------------------------

type GenCellKind = 'value' | 'formula' | 'formatted';

interface GenCell {
  row: number;
  col: number;
  kind: GenCellKind;
  value?: string | number;
  formula?: string;
  numFmt?: string;
}

interface GenSheet {
  name: string;
  cells: GenCell[];
  merges: string[];
}

interface GenWorkbook {
  sheets: GenSheet[];
}

// A small pool of number formats and font styles to exercise formatting
// preservation on non-mapped cells.
const NUM_FORMATS = ['0.00', '#,##0', '0.0%', 'yyyy-mm-dd', '"$"#,##0.00'] as const;

/**
 * Builds a real .xlsx workbook (as bytes) from the generated model. Formatted
 * cells additionally receive a bold font + fill so style preservation — not
 * just numFmt — is under test.
 */
async function buildWorkbookBytes(model: GenWorkbook): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of model.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const cell of sheet.cells) {
      const c = ws.getCell(addressOf(cell.row, cell.col));
      if (cell.kind === 'formula' && cell.formula !== undefined) {
        c.value = { formula: cell.formula } as ExcelJS.CellFormulaValue;
      } else if (cell.value !== undefined) {
        c.value = cell.value;
      }
      if (cell.kind === 'formatted') {
        if (cell.numFmt !== undefined) {
          c.numFmt = cell.numFmt;
        }
        c.font = { bold: true, size: 12 };
        c.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFEE00' },
        };
      }
    }
    for (const range of sheet.merges) {
      try {
        ws.mergeCells(range);
      } catch {
        // Overlapping merge ranges are rejected by ExcelJS; skip them. The
        // arbitraries below avoid overlaps, this is a belt-and-braces guard.
      }
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const GRID_ROWS = 6;
const GRID_COLS = 5;

/** All addressable grid coordinates. */
const ALL_COORDS: Array<{ row: number; col: number }> = (() => {
  const coords: Array<{ row: number; col: number }> = [];
  for (let row = 1; row <= GRID_ROWS; row += 1) {
    for (let col = 1; col <= GRID_COLS; col += 1) {
      coords.push({ row, col });
    }
  }
  return coords;
})();

const cellKindArb: fc.Arbitrary<GenCellKind> = fc.constantFrom<GenCellKind>(
  'value',
  'formula',
  'formatted',
);

const cellValueArb: fc.Arbitrary<string | number> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
  fc.integer({ min: -1000, max: 1000 }),
  fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
);

/**
 * Generates a sheet: a subset of the grid populated with a mix of value,
 * formula, and formatted cells, plus a few non-overlapping horizontal merged
 * ranges. Merges are chosen from whole-row segments so they never overlap.
 */
function genSheetArb(name: string): fc.Arbitrary<GenSheet> {
  const cellsArb = fc
    .subarray(ALL_COORDS, { minLength: 1, maxLength: ALL_COORDS.length })
    .chain((coords) =>
      fc.tuple(
        ...coords.map((coord) =>
          fc
            .record({
              kind: cellKindArb,
              value: cellValueArb,
              formula: fc.constantFrom('1+1', 'A1', 'SUM(A1:A2)', 'B1*2'),
              numFmt: fc.constantFrom(...NUM_FORMATS),
            })
            .map<GenCell>((r) => ({
              row: coord.row,
              col: coord.col,
              kind: r.kind,
              value: r.kind === 'formula' ? undefined : r.value,
              formula: r.kind === 'formula' ? r.formula : undefined,
              numFmt: r.kind === 'formatted' ? r.numFmt : undefined,
            })),
        ),
      ),
    );

  // A merge is a horizontal run on a single row: pick a row, a start col, and a
  // length >= 2. Distinct rows guarantee non-overlap.
  const mergeArb = fc
    .record({
      row: fc.integer({ min: 1, max: GRID_ROWS }),
      startCol: fc.integer({ min: 1, max: GRID_COLS - 1 }),
      len: fc.integer({ min: 2, max: GRID_COLS }),
    })
    .map(({ row, startCol, len }) => {
      const endCol = Math.min(GRID_COLS, startCol + len - 1);
      return `${addressOf(row, startCol)}:${addressOf(row, endCol)}`;
    });

  const mergesArb = fc
    .uniqueArray(mergeArb, {
      maxLength: 2,
      selector: (m) => m.split(':')[0].replace(/[0-9]/g, '') + m.split(':')[0].replace(/[A-Z]/g, ''),
    })
    // Ensure merges are on distinct rows so they cannot overlap.
    .map((merges) => {
      const seenRows = new Set<string>();
      return merges.filter((m) => {
        const row = m.split(':')[0].replace(/[A-Z]/g, '');
        if (seenRows.has(row)) return false;
        seenRows.add(row);
        return true;
      });
    });

  return fc.record({ cells: cellsArb, merges: mergesArb }).map(({ cells, merges }) => ({
    name,
    cells,
    merges,
  }));
}

const SHEET_NAMES = ['Info', 'Ratings', 'Conditions'] as const;

const workbookArb: fc.Arbitrary<GenWorkbook> = fc
  .subarray([...SHEET_NAMES], { minLength: 1, maxLength: SHEET_NAMES.length })
  .chain((names) =>
    fc.tuple(...names.map((name) => genSheetArb(name))).map((sheets) => ({ sheets })),
  );

/** Arbitrary Test_Session with fully-populated fields so mapped writes land. */
const sessionArb: fc.Arbitrary<TestSession> = fc.record({
  make: fc.string({ minLength: 1, maxLength: 8 }),
  pattern: fc.string({ minLength: 1, maxLength: 8 }),
  driverName: fc.string({ minLength: 1, maxLength: 8 }),
  frontAxlePressure: fc.integer({ min: 20, max: 40 }),
  rating: fc.constantFrom(1, 2.5, 5, 6.5, 8, 10),
}).map((r) => ({
  sessionId: 's1',
  templateId: 't1',
  createdBy: 'u1',
  tyreSets: [
    { groupName: 'Set A', make: r.make || 'X', pattern: r.pattern || 'P', srlr: 'SR', weekCode: 'W1', dot: 'D1' },
  ],
  vehicle: {
    vehicleId: 'VH-1',
    tyreSize: '235/60 R18',
    rimSize: '18',
    frontAxlePressure: r.frontAxlePressure,
    rearAxlePressure: 30,
  },
  conditions: {
    testTrack: 'Loop',
    driverName: r.driverName || 'Alex',
    loadOfCar: 'GVW',
    airTempC: 25,
    roadTempC: 40,
    testDate: '2026-09-15',
  },
  ride: { parameters: [{ name: 'Smooth Road', rating: r.rating, note: 'ok' }], averageRating: r.rating },
  handling: { parameters: [{ name: 'Rear Tracking', rating: r.rating, note: 'stable' }], averageRating: r.rating },
  syncState: 'synced' as const,
  fieldTimestamps: {},
  updatedAt: 0,
}));

/** The input field keys mappings can bind to (all resolvable on sessionArb). */
const INPUT_FIELD_KEYS: readonly string[] = [
  inputFieldKey.tyreSet(0, 'make'),
  inputFieldKey.tyreSet(0, 'pattern'),
  inputFieldKey.vehicle('frontAxlePressure'),
  inputFieldKey.condition('driverName'),
  inputFieldKey.rhRating('ride', 'Smooth Road'),
  inputFieldKey.rhNote('handling', 'Rear Tracking'),
];

// ---------------------------------------------------------------------------
// Cell snapshot / comparison
// ---------------------------------------------------------------------------

interface CellSnapshot {
  value: unknown;
  numFmt: string | undefined;
  style: string;
}

/**
 * Captures the observable state of a cell for equality comparison: its value
 * (formula cells serialise their `{ formula, result }` object), number format,
 * and a JSON snapshot of its style (font/fill/border/alignment).
 */
function snapshotCell(cell: ExcelJS.Cell): CellSnapshot {
  return {
    value: normaliseValue(cell.value),
    numFmt: cell.numFmt,
    style: JSON.stringify(cell.style ?? {}),
  };
}

/**
 * Normalises a cell value for comparison. Formula cells are compared by their
 * formula string only (the cached `result` is not part of the template's
 * authored content and ExcelJS may recompute/omit it). Everything else is
 * compared structurally via JSON.
 */
function normaliseValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && 'formula' in value) {
    return { formula: (value as ExcelJS.CellFormulaValue).formula };
  }
  return value ?? null;
}

/**
 * Builds the set of mapping target keys (templateId|sheet|CELL) after
 * merge-anchor resolution, so a mapping to any cell of a merged range marks the
 * anchor cell as the target.
 */
function targetKeySet(
  mappings: readonly FieldMapping[],
  mergesBySheet: Record<string, string[]>,
): Set<string> {
  const keys = new Set<string>();
  for (const m of mappings) {
    const anchor = resolveMergeAnchor(m.cellAddress, mergesBySheet[m.sheetName] ?? []);
    keys.add(mappingTargetKey({ templateId: m.templateId, sheetName: m.sheetName, cellAddress: anchor }));
  }
  return keys;
}

/** Collects every populated/known cell address per sheet from a workbook. */
function collectCellAddresses(workbook: ExcelJS.Workbook): Map<string, Set<string>> {
  const perSheet = new Map<string, Set<string>>();
  workbook.eachSheet((ws) => {
    const set = new Set<string>();
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        set.add(cell.address);
      });
    });
    perSheet.set(ws.name, set);
  });
  return perSheet;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 6: Unmapped cell preservation', () => {
  it('leaves every non-target cell byte-for-byte identical to the template', async () => {
    await fc.assert(
      fc.asyncProperty(
        workbookArb,
        sessionArb,
        // Choose which (sheet,cell) coordinates to map and to which field key.
        fc.array(
          fc.record({
            sheetIndex: fc.nat(),
            row: fc.integer({ min: 1, max: GRID_ROWS }),
            col: fc.integer({ min: 1, max: GRID_COLS }),
            keyIndex: fc.nat(),
          }),
          { maxLength: 8 },
        ),
        async (model, session, mappingSeeds) => {
          const templateId = 't1';
          const mergesBySheet: Record<string, string[]> = {};
          for (const sheet of model.sheets) {
            mergesBySheet[sheet.name] = sheet.merges;
          }

          // Build mappings from the seeds, de-duplicating on the resolved
          // target key (fillWorkbook writes per mapping; duplicates on the same
          // anchor are harmless but we keep the target set precise).
          const seenTargets = new Set<string>();
          const mappings: FieldMapping[] = [];
          mappingSeeds.forEach((seed, i) => {
            const sheet = model.sheets[seed.sheetIndex % model.sheets.length];
            const cellAddress = addressOf(seed.row, seed.col);
            const anchor = resolveMergeAnchor(cellAddress, mergesBySheet[sheet.name] ?? []);
            const key = mappingTargetKey({ templateId, sheetName: sheet.name, cellAddress: anchor });
            if (seenTargets.has(key)) return;
            seenTargets.add(key);
            const fieldKey = INPUT_FIELD_KEYS[seed.keyIndex % INPUT_FIELD_KEYS.length];
            mappings.push({
              mappingId: `m${i}`,
              templateId,
              sheetName: sheet.name,
              cellAddress,
              inputFieldKey: fieldKey,
              fieldType: fieldKey.startsWith('tyreSet')
                ? 'tyreSet'
                : fieldKey.startsWith('vehicle')
                  ? 'vehicle'
                  : fieldKey.startsWith('condition')
                    ? 'condition'
                    : fieldKey.startsWith('rhRating')
                      ? 'rhRating'
                      : 'rhNote',
              required: false,
            });
          });

          const originalBytes = await buildWorkbookBytes(model);

          // Reload the ORIGINAL through the same serialize/parse path so both
          // sides are compared post-round-trip (isolates fill-step changes).
          const originalReloaded = await loadWorkbook(originalBytes);

          const { workbook: filled } = await fillWorkbook(originalBytes, mappings, session);
          const filledBytes = Buffer.from((await filled.xlsx.writeBuffer()) as ArrayBuffer);
          const filledReloaded = await loadWorkbook(filledBytes);

          const targets = targetKeySet(mappings, mergesBySheet);

          // Union of all known cell addresses across both workbooks per sheet,
          // so a cell that was somehow dropped is still checked.
          const origCells = collectCellAddresses(originalReloaded);
          const filledCells = collectCellAddresses(filledReloaded);

          for (const [sheetName, origSet] of origCells) {
            const addresses = new Set<string>([...origSet, ...(filledCells.get(sheetName) ?? [])]);
            const origWs = originalReloaded.getWorksheet(sheetName)!;
            const filledWs = filledReloaded.getWorksheet(sheetName)!;

            const sheetMerges = mergesBySheet[sheetName] ?? [];
            for (const address of addresses) {
              // Resolve the cell to its merge anchor before checking target
              // membership: Excel (and ExcelJS) store a merged region's value in
              // its top-left anchor and mirror it across the region's shared
              // cells, so writing a mapped value to a merge anchor legitimately
              // changes every cell of that region. The region as a whole is the
              // mapping target, so a cell whose anchor is a target is excluded.
              const anchor = resolveMergeAnchor(address, sheetMerges);
              const key = mappingTargetKey({ templateId, sheetName, cellAddress: anchor });
              if (targets.has(key)) {
                // This cell belongs to a mapped (possibly merged) target region.
                continue;
              }
              const before = snapshotCell(origWs.getCell(address));
              const after = snapshotCell(filledWs.getCell(address));
              expect(after).toEqual(before);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60000);
});
