// Property-based test for template structure extraction fidelity.
//
// Feature: rnh-tyre-testing-system, Property 3: Template structure extraction fidelity
//
// Property 3 (Template structure extraction fidelity): For any uploaded
// workbook, the extracted TemplateStructure lists every sheet, in the same
// order, with the same sheet names and correct row/column dimensions as the
// source workbook.
//
// Validates: Requirements 2.2, 2.5

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractTemplateStructure } from './extract';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 120;

/**
 * A description of one sheet to build into a generated workbook. This is the
 * source-of-truth model the test generates; we build a real .xlsx from it and
 * then assert the extracted structure matches an independently-computed oracle.
 */
interface SheetSpec {
  name: string;
  /** Cells to write. `row`/`col` are 1-based (ExcelJS convention). */
  cells: Array<{ row: number; col: number; value: string }>;
  /** Merge ranges in A1 notation, e.g. "A1:B2". */
  merges: string[];
}

/**
 * Sheet-name arbitrary. Excel sheet names have real constraints: 1..31 chars,
 * cannot be blank, and cannot contain any of : \ / ? * [ ]. We deliberately
 * include odd-but-legal names: unicode, spaces, punctuation, digits.
 */
const sheetNameArb: fc.Arbitrary<string> = fc
  .string({ unit: 'grapheme', minLength: 1, maxLength: 31 })
  // Strip characters Excel forbids in sheet names and collapse whitespace-only.
  .map((s) => s.replace(/[:\\/?*[\]]/g, '_'))
  .map((s) => s.replace(/\s+/g, ' ').trim())
  // Excel also forbids a leading/trailing apostrophe.
  .map((s) => s.replace(/^'+|'+$/g, ''))
  .filter((s) => s.length >= 1 && s.length <= 31);

/**
 * Some hand-picked odd-but-valid names to guarantee they appear regularly
 * alongside the fully random ones.
 */
const oddNameArb: fc.Arbitrary<string> = fc.constantFrom(
  'MU1',
  'dryhandling1',
  'Description',
  'Ride Comfort',
  'Handling & Steering',
  'Tabelle',
  '2024 Data',
  'a b c',
  'Δοκιμή',
  '试验',
);

const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: sheetNameArb },
  { weight: 2, arbitrary: oddNameArb },
);

/** A single sheet spec with a used region and optional non-overlapping merges. */
function sheetSpecArb(): fc.Arbitrary<Omit<SheetSpec, 'name'>> {
  return fc
    .record({
      maxRow: fc.integer({ min: 1, max: 12 }),
      maxCol: fc.integer({ min: 1, max: 10 }),
      // Whether to also include a merge anchored at the top-left corner.
      mergeRows: fc.integer({ min: 1, max: 4 }),
      mergeCols: fc.integer({ min: 1, max: 4 }),
      includeMerge: fc.boolean(),
    })
    .map(({ maxRow, maxCol, mergeRows, mergeCols, includeMerge }) => {
      // Always write cells at (1,1) and (maxRow, maxCol) so the used dimensions
      // are deterministic and equal to (maxRow, maxCol).
      const cells: SheetSpec['cells'] = [
        { row: 1, col: 1, value: 'x' },
        { row: maxRow, col: maxCol, value: 'y' },
      ];

      const merges: string[] = [];
      // Build a merge inside the used region that stays within bounds and is
      // more than one cell (a 1x1 merge is meaningless).
      const mr = Math.min(mergeRows, maxRow);
      const mc = Math.min(mergeCols, maxCol);
      if (includeMerge && (mr > 1 || mc > 1)) {
        // ExcelJS mergeCells(top, left, bottom, right) uses 1-based indices.
        const range = `${colLetter(1)}1:${colLetter(mc)}${mr}`;
        merges.push(range);
      }

      return { cells, merges };
    });
}

/** Convert a 1-based column index to its A1 column letters (1 -> A, 27 -> AA). */
function colLetter(col: number): string {
  let n = col;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Generates a list of sheet specs with unique names (Excel requires unique,
 * case-insensitive sheet names within a workbook).
 */
const workbookSpecArb: fc.Arbitrary<SheetSpec[]> = fc
  .array(fc.tuple(nameArb, sheetSpecArb()), { minLength: 1, maxLength: 6 })
  .map((entries) => {
    const used = new Set<string>();
    const sheets: SheetSpec[] = [];
    let counter = 0;
    for (const [rawName, body] of entries) {
      // Ensure uniqueness (case-insensitive) while staying within 31 chars.
      let name = rawName;
      while (used.has(name.toLowerCase())) {
        const suffix = `_${counter++}`;
        name = (rawName.slice(0, 31 - suffix.length) + suffix) || `S${counter}`;
      }
      used.add(name.toLowerCase());
      sheets.push({ name, ...body });
    }
    return sheets;
  });

/** Builds a real .xlsx workbook (as bytes) from the sheet specs. */
async function buildWorkbook(specs: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const spec of specs) {
    const ws = wb.addWorksheet(spec.name);
    for (const cell of spec.cells) {
      ws.getCell(cell.row, cell.col).value = cell.value;
    }
    for (const range of spec.merges) {
      ws.mergeCells(range);
    }
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/**
 * Independent oracle: from the source spec compute the expected used
 * dimensions. Because each sheet writes cells at (1,1) and (maxRow, maxCol),
 * the used dimensions are exactly the max row/col written.
 */
function expectedDimensions(spec: SheetSpec): { rowCount: number; columnCount: number } {
  const rowCount = Math.max(...spec.cells.map((c) => c.row));
  const columnCount = Math.max(...spec.cells.map((c) => c.col));
  return { rowCount, columnCount };
}

describe('Property 3: Template structure extraction fidelity', () => {
  it('extracts every sheet in order, with matching names and dimensions', async () => {
    await fc.assert(
      fc.asyncProperty(workbookSpecArb, async (specs) => {
        const bytes = await buildWorkbook(specs);
        const structure = await extractTemplateStructure(bytes);

        // Same number of sheets (every sheet is listed — R2.2).
        expect(structure.sheets).toHaveLength(specs.length);

        // Same names in the same order (R2.2, R8.3).
        expect(structure.sheets.map((s) => s.name)).toEqual(
          specs.map((s) => s.name),
        );

        // Index preserves order, zero-based.
        expect(structure.sheets.map((s) => s.index)).toEqual(
          specs.map((_, i) => i),
        );

        // Correct per-sheet row/column dimensions (R2.5).
        structure.sheets.forEach((sheet, i) => {
          const { rowCount, columnCount } = expectedDimensions(specs[i]);
          expect(sheet.rowCount).toBe(rowCount);
          expect(sheet.columnCount).toBe(columnCount);
        });

        // Merged ranges from the source appear in the extracted structure.
        structure.sheets.forEach((sheet, i) => {
          for (const range of specs[i].merges) {
            expect(sheet.mergedRanges).toContain(range);
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
