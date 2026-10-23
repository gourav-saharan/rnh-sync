// Property-based test for mapped-cell write fidelity across sheets.
//
// Feature: rnh-tyre-testing-system, Property 11: Mapped-cell write fidelity across sheets
//
// Property 11 (Mapped-cell write fidelity across sheets): For any Test_Session
// and any set of Field_Mappings across multiple sheets, the generated workbook
// has, at every mapped (sheet, cell), exactly the corresponding Test_Session
// value — at the correct sheet and cell, not merely the first sheet. This
// guards the Report Generation Pipeline's step 2 ("resolve mappings per sheet")
// against a write landing on the wrong sheet or the wrong cell.
//
// The test builds a real multi-sheet ExcelJS workbook, fills it with
// fillWorkbook, serializes it with workbook.xlsx.writeBuffer(), reloads it, and
// asserts every mapped cell on its own sheet holds exactly the value
// resolveFieldValue (the oracle) reports for that mapping's inputFieldKey.
//
// Validates: Requirements 7.2, 8.2, 8.4, 3.3

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { FieldMapping, TestSession } from '../index';
import { fillWorkbook, loadWorkbook } from './fillWorkbook';
import { resolveFieldValue } from './resolveFieldValue';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 150;

// ---------------------------------------------------------------------------
// A1 address helpers
//
// To keep the property focused on "correct sheet + correct cell" we target
// distinct, non-merged cells. We lay candidate targets out on a wide grid
// (columns spread out, one row per target) so no two mappings on the same sheet
// ever collide and no merge-anchor resolution is involved — the written
// address equals the mapped address.
// ---------------------------------------------------------------------------

/** Zero-based column index -> Excel column letters (0 -> "A", 26 -> "AA"). */
function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/** A1 address for the i-th target: a fresh column, row 2 + i (keeps A1 free). */
function targetAddress(i: number): string {
  return `${columnLetter(i)}${i + 2}`;
}

// ---------------------------------------------------------------------------
// Arbitraries for a populated Test_Session
//
// The oracle only needs values that count as "present" (non-empty strings,
// finite numbers) so the fill step actually writes them. Numbers are kept
// finite and simple to avoid Excel float-formatting surprises; strings are
// constrained to be non-empty and free of leading/trailing whitespace so
// resolveFieldValue's hasValue() treats them as present and ExcelJS round-trips
// them verbatim.
// ---------------------------------------------------------------------------

const presentString: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((s) => s.replace(/\s/g, '_'))
  .filter((s) => s.trim().length > 0);

const presentNumber: fc.Arbitrary<number> = fc.integer({ min: -100000, max: 100000 });

const ratingArb: fc.Arbitrary<number> = fc
  .integer({ min: 4, max: 40 })
  .map((n) => n * 0.25);

const tyreSetArb = fc.record({
  groupName: presentString,
  make: presentString,
  pattern: presentString,
  srlr: fc.constantFrom('SR', 'LR'),
  weekCode: presentString,
  dot: presentString,
});

const vehicleArb = fc.record({
  vehicleId: presentString,
  tyreSize: presentString,
  rimSize: presentString,
  frontAxlePressure: presentNumber,
  rearAxlePressure: presentNumber,
});

const conditionsArb = fc.record({
  testTrack: presentString,
  driverName: presentString,
  loadOfCar: presentString,
  airTempC: presentNumber,
  roadTempC: presentNumber,
  testDate: presentString,
});

/** Distinct R&H parameter names so a rhRating/rhNote key resolves unambiguously. */
const RIDE_PARAMS = ['Smooth Road', 'Speed Breaker', 'Rough Road', 'Damping'] as const;
const HANDLING_PARAMS = ['Roll Level', 'Rear Tracking', 'Steering Feel', 'Turn In'] as const;

function categoryArb(names: readonly string[]) {
  return fc.record({
    parameters: fc.constant(
      names.map((name) => ({ name, rating: 0, note: '' })),
    ),
    averageRating: fc.constant(0),
  }).chain((cat) =>
    // Fill each parameter with a present rating + note.
    fc
      .tuple(...cat.parameters.map(() => fc.tuple(ratingArb, presentString)))
      .map((filled) => ({
        parameters: cat.parameters.map((p, idx) => ({
          name: p.name,
          rating: filled[idx][0],
          note: filled[idx][1],
        })),
        averageRating: 0,
      })),
  );
}

const sessionArb: fc.Arbitrary<TestSession> = fc
  .record({
    tyreSets: fc.array(tyreSetArb, { minLength: 1, maxLength: 3 }),
    vehicle: vehicleArb,
    conditions: conditionsArb,
    ride: categoryArb(RIDE_PARAMS),
    handling: categoryArb(HANDLING_PARAMS),
  })
  .map((parts) => ({
    sessionId: 's-prop',
    templateId: 't-prop',
    createdBy: 'u-prop',
    tyreSets: parts.tyreSets,
    vehicle: parts.vehicle,
    conditions: parts.conditions,
    ride: parts.ride,
    handling: parts.handling,
    syncState: 'synced' as const,
    fieldTimestamps: {},
    updatedAt: 0,
  }));

// ---------------------------------------------------------------------------
// Building the set of inputFieldKeys that resolve to PRESENT values for a
// given session. Each key is paired with the oracle value so mappings only ever
// target resolvable fields (the property is about correct placement, not about
// missing-field handling, which Property/other tasks cover).
// ---------------------------------------------------------------------------

function resolvableKeys(session: TestSession): string[] {
  const keys: string[] = [];
  session.tyreSets.forEach((_, i) => {
    keys.push(
      `tyreSet[${i}].make`,
      `tyreSet[${i}].pattern`,
      `tyreSet[${i}].groupName`,
      `tyreSet[${i}].weekCode`,
      `tyreSet[${i}].dot`,
    );
  });
  keys.push(
    'vehicle.vehicleId',
    'vehicle.tyreSize',
    'vehicle.rimSize',
    'vehicle.frontAxlePressure',
    'vehicle.rearAxlePressure',
    'condition.testTrack',
    'condition.driverName',
    'condition.loadOfCar',
    'condition.airTempC',
    'condition.roadTempC',
    'condition.testDate',
  );
  RIDE_PARAMS.forEach((p) => {
    keys.push(`rhRating.ride.${p}`, `rhNote.ride.${p}`);
  });
  HANDLING_PARAMS.forEach((p) => {
    keys.push(`rhRating.handling.${p}`, `rhNote.handling.${p}`);
  });
  // Keep only keys whose oracle value is actually present for this session.
  return keys.filter((k) => {
    const v = resolveFieldValue(k, session);
    if (v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return Number.isFinite(v);
  });
}

// ---------------------------------------------------------------------------
// Scenario: a multi-sheet workbook + a set of mappings spread across >= 2
// sheets, each targeting a distinct (sheet, cell) with a resolvable field.
// ---------------------------------------------------------------------------

interface Scenario {
  session: TestSession;
  sheetNames: string[];
  mappings: FieldMapping[];
}

function mapping(
  index: number,
  sheetName: string,
  cellAddress: string,
  inputFieldKey: string,
): FieldMapping {
  return {
    mappingId: `m-${index}`,
    templateId: 't-prop',
    sheetName,
    cellAddress,
    inputFieldKey,
    fieldType: 'meta', // fieldType is not consulted by the fill step; value comes from inputFieldKey
    required: false,
  };
}

const scenarioArb: fc.Arbitrary<Scenario> = sessionArb.chain((session) => {
  const keys = resolvableKeys(session);
  // Distinct sheet names; at least two so the "not just the first sheet"
  // clause is exercised.
  const sheetNamesArb = fc
    .integer({ min: 2, max: 4 })
    .map((count) => Array.from({ length: count }, (_, i) => `Sheet ${i + 1}`));

  return sheetNamesArb.chain((sheetNames) =>
    // Choose how many mappings to create, then for each pick a sheet and a key.
    fc
      .integer({ min: sheetNames.length, max: sheetNames.length * 4 })
      .chain((mappingCount) =>
        fc
          .tuple(
            // A sheet index per mapping...
            fc.array(fc.integer({ min: 0, max: sheetNames.length - 1 }), {
              minLength: mappingCount,
              maxLength: mappingCount,
            }),
            // ...and a resolvable key per mapping.
            fc.array(fc.constantFrom(...keys), {
              minLength: mappingCount,
              maxLength: mappingCount,
            }),
          )
          .map(([sheetIndices, chosenKeys]) => {
            // Force coverage of at least the first two sheets so we always
            // assert writes land on more than one sheet.
            sheetIndices[0] = 0;
            sheetIndices[1] = 1;

            // Assign each mapping a distinct cell address per sheet (fresh
            // column + row) to avoid duplicate-target collisions and merges.
            const perSheetCount = new Map<number, number>();
            const mappings = sheetIndices.map((si, idx) => {
              const n = perSheetCount.get(si) ?? 0;
              perSheetCount.set(si, n + 1);
              return mapping(idx, sheetNames[si], targetAddress(n), chosenKeys[idx]);
            });
            return { session, sheetNames, mappings };
          }),
      ),
  );
});

// ---------------------------------------------------------------------------
// Build a real multi-sheet .xlsx from a scenario. Every sheet exists (so no
// mapping is skipped) and carries a little untouched content so the workbook is
// a genuine multi-sheet file rather than empty sheets.
// ---------------------------------------------------------------------------

async function buildWorkbookBytes(sheetNames: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  sheetNames.forEach((name, i) => {
    const ws = wb.addWorksheet(name);
    // A1 carries a label on every sheet; it must never be overwritten because
    // no mapping targets A1 (targets start at row 2).
    ws.getCell('A1').value = `label-${i}`;
  });
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** The value ExcelJS round-trips a cell to, normalised for comparison. */
function readCellValue(cell: ExcelJS.Cell): string | number | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  return v as unknown as string | number;
}

describe('Property 11: Mapped-cell write fidelity across sheets', () => {
  it('places every mapped value at its correct (sheet, cell) after fill + round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ session, sheetNames, mappings }) => {
        const bytes = await buildWorkbookBytes(sheetNames);

        const { workbook } = await fillWorkbook(bytes, mappings, session);

        // Serialize and reload so the assertion is against persisted bytes, not
        // just the in-memory ExcelJS model (R7.2 preview/export fidelity).
        const out = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
        const reloaded = await loadWorkbook(out);

        // Sanity: at least two distinct sheets were actually mapped, so the
        // "not just the first sheet" clause is genuinely exercised.
        const mappedSheets = new Set(mappings.map((m) => m.sheetName));
        expect(mappedSheets.size).toBeGreaterThanOrEqual(2);

        for (const m of mappings) {
          const oracle = resolveFieldValue(m.inputFieldKey, session);
          const ws = reloaded.getWorksheet(m.sheetName);
          expect(ws, `sheet ${m.sheetName} should exist`).toBeDefined();
          const actual = readCellValue(ws!.getCell(m.cellAddress));
          // Exactly the resolved Test_Session value at this (sheet, cell).
          expect(actual).toBe(oracle);
        }

        // The untouched A1 label on each sheet must survive unchanged, proving
        // writes did not leak onto the wrong cell/sheet.
        sheetNames.forEach((name, i) => {
          const ws = reloaded.getWorksheet(name)!;
          expect(readCellValue(ws.getCell('A1'))).toBe(`label-${i}`);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60000);
});
