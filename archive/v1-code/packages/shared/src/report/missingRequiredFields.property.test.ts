// Property-based test for missing-required-field reporting.
//
// Feature: rnh-tyre-testing-system, Property 13: Missing required fields reporting
//
// (tasks.md numbers this "Property 15: Missing required fields are reported and
// left blank"; the delegated task tags it "Property 13". Both name the same
// invariant.)
//
// Property 13 (Missing required fields reporting): For any Test_Session and
// template, every required Field_Mapping whose value is absent appears in the
// generated report's missing-required-fields list, its mapped cell is left
// blank in the output, and no non-missing field is reported. This guards the
// Report Generation Pipeline's missing-required-field handling (design.md,
// Report_Generator; R8.5): a required field with no value is surfaced to the
// Report_Viewer and its cell stays blank, while present-required and optional
// fields are never reported.
//
// Strategy (no mocks): build a real single-/multi-sheet ExcelJS template;
// generate a Test_Session with a deliberate mix of present and absent field
// values; generate a set of Field_Mappings mixing required/optional and
// present/absent targets, each at a distinct (sheet, cell). Run generateReport,
// reload the produced bytes, and assert against the oracle
// (resolveFieldValue + hasValue): every required-and-absent mapping appears
// exactly once in missingRequiredFields with its mapped cell blank; no
// required-and-present and no optional mapping appears.
//
// Validates: Requirements 8.5

import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FieldMapping, TestSession } from '../index';
import { generateReport } from './generateReport';
import { loadWorkbook } from './fillWorkbook';
import { hasValue, resolveFieldValue } from './resolveFieldValue';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 150;

// ---------------------------------------------------------------------------
// A1 address helpers
//
// To keep the property focused on missing-required reporting (not merge-anchor
// resolution) we target distinct, non-merged cells: one fresh column + row per
// mapping per sheet, all below row 1 so an untouched A1 label survives.
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

/** A1 address for the i-th target on a sheet: a fresh column, row 2 + i. */
function targetAddress(i: number): string {
  return `${columnLetter(i)}${i + 2}`;
}

// ---------------------------------------------------------------------------
// Value arbitraries
//
// A "present" string is non-empty and free of whitespace-only content so
// hasValue() treats it as present and ExcelJS round-trips it verbatim. An
// "absent" value is either omitted or an empty/whitespace string, which
// hasValue() treats as absent (R8.5). Numbers are always present (including 0).
// ---------------------------------------------------------------------------

const presentString: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/\s/g, '_'))
  .filter((s) => s.trim().length > 0);

/** A string value that hasValue() treats as ABSENT (empty or whitespace-only). */
const absentString: fc.Arbitrary<string> = fc.constantFrom('', '   ', '\t', ' ');

/** A field value that is either present or absent, chosen arbitrarily. */
const maybeString: fc.Arbitrary<string> = fc.oneof(presentString, absentString);

const presentNumber: fc.Arbitrary<number> = fc.integer({ min: -100000, max: 100000 });

// ---------------------------------------------------------------------------
// Test_Session arbitrary
//
// We only populate the fields the mappings can target (tyreSet[0], vehicle,
// conditions, and a few named R&H parameters). String fields are `maybeString`
// so roughly half are absent — this is what makes required-but-missing
// reporting actually fire. Numbers are kept present so numeric targets exercise
// the "required-and-present -> not reported" branch.
// ---------------------------------------------------------------------------

const RIDE_PARAMS = ['Smooth Road', 'Speed Breaker', 'Rough Road'] as const;
const HANDLING_PARAMS = ['Roll Level', 'Rear Tracking', 'Turn In'] as const;

const tyreSetArb = fc.record({
  groupName: maybeString,
  make: maybeString,
  pattern: maybeString,
  srlr: fc.constantFrom('SR', 'LR'),
  weekCode: maybeString,
  dot: maybeString,
});

const vehicleArb = fc.record({
  vehicleId: maybeString,
  tyreSize: maybeString,
  rimSize: maybeString,
  frontAxlePressure: presentNumber,
  rearAxlePressure: presentNumber,
});

const conditionsArb = fc.record({
  testTrack: maybeString,
  driverName: maybeString,
  loadOfCar: maybeString,
  airTempC: presentNumber,
  roadTempC: presentNumber,
  testDate: maybeString,
});

/** Category with each parameter's note maybe-present and rating maybe-present. */
function categoryArb(names: readonly string[]) {
  return fc
    .tuple(
      ...names.map(() =>
        fc.record({
          // Rating: either present (a valid increment) or absent (undefined).
          rating: fc.oneof(
            fc.integer({ min: 4, max: 40 }).map((n) => n * 0.25),
            fc.constant(undefined),
          ),
          note: maybeString,
        }),
      ),
    )
    .map((entries) => ({
      parameters: names.map((name, i) => ({
        name,
        // rating is typed number; undefined models an unset rating for the
        // resolver oracle. hasValue() treats undefined as absent.
        rating: entries[i].rating as unknown as number,
        note: entries[i].note,
      })),
      averageRating: 0,
    }));
}

const sessionArb: fc.Arbitrary<TestSession> = fc
  .record({
    tyreSets: fc.array(tyreSetArb, { minLength: 1, maxLength: 2 }),
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
// Candidate input field keys
//
// A broad pool of keys whose values may be present or absent for a given
// session (driven by the session arbitrary above). We also include keys that
// never resolve (out-of-range tyre set index, unknown parameter) so absent
// targets are well represented.
// ---------------------------------------------------------------------------

function candidateKeys(): string[] {
  const keys: string[] = [];
  // tyreSet[0] and tyreSet[1] string fields (index 1 may be out of range).
  for (const idx of [0, 1]) {
    keys.push(
      `tyreSet[${idx}].make`,
      `tyreSet[${idx}].pattern`,
      `tyreSet[${idx}].groupName`,
      `tyreSet[${idx}].weekCode`,
      `tyreSet[${idx}].dot`,
    );
  }
  keys.push(
    'vehicle.vehicleId',
    'vehicle.tyreSize',
    'vehicle.rimSize',
    'vehicle.frontAxlePressure', // always present (number)
    'vehicle.rearAxlePressure', // always present (number)
    'condition.testTrack',
    'condition.driverName',
    'condition.loadOfCar',
    'condition.testDate',
  );
  RIDE_PARAMS.forEach((p) => keys.push(`rhRating.ride.${p}`, `rhNote.ride.${p}`));
  HANDLING_PARAMS.forEach((p) =>
    keys.push(`rhRating.handling.${p}`, `rhNote.handling.${p}`),
  );
  // A key that never resolves (unknown parameter) -> always absent.
  keys.push('rhRating.ride.Nonexistent Param', 'tyreSet[5].make');
  return keys;
}

const CANDIDATE_KEYS = candidateKeys();

// ---------------------------------------------------------------------------
// Scenario: a template (>= 1 sheet) + mappings, each at a distinct (sheet,
// cell), mixing required/optional and present/absent targets.
// ---------------------------------------------------------------------------

interface Scenario {
  session: TestSession;
  sheetNames: string[];
  mappings: FieldMapping[];
}

function makeMapping(
  index: number,
  sheetName: string,
  cellAddress: string,
  inputFieldKey: string,
  required: boolean,
): FieldMapping {
  return {
    mappingId: `m-${index}`,
    templateId: 't-prop',
    sheetName,
    cellAddress,
    inputFieldKey,
    // fieldType is not consulted by the fill step; value comes from inputFieldKey.
    fieldType: 'meta',
    required,
  };
}

const scenarioArb: fc.Arbitrary<Scenario> = sessionArb.chain((session) => {
  const sheetNamesArb = fc
    .integer({ min: 1, max: 3 })
    .map((count) => Array.from({ length: count }, (_, i) => `Sheet ${i + 1}`));

  return sheetNamesArb.chain((sheetNames) =>
    fc
      .integer({ min: 1, max: 12 })
      .chain((mappingCount) =>
        fc
          .tuple(
            fc.array(fc.integer({ min: 0, max: sheetNames.length - 1 }), {
              minLength: mappingCount,
              maxLength: mappingCount,
            }),
            fc.array(fc.constantFrom(...CANDIDATE_KEYS), {
              minLength: mappingCount,
              maxLength: mappingCount,
            }),
            fc.array(fc.boolean(), {
              minLength: mappingCount,
              maxLength: mappingCount,
            }),
          )
          .map(([sheetIndices, keys, requiredFlags]) => {
            // Assign each mapping a distinct cell per sheet (fresh column+row)
            // so no two mappings on the same sheet collide and no merge anchor
            // resolution is involved.
            const perSheetCount = new Map<number, number>();
            const mappings = sheetIndices.map((si, idx) => {
              const n = perSheetCount.get(si) ?? 0;
              perSheetCount.set(si, n + 1);
              return makeMapping(
                idx,
                sheetNames[si],
                targetAddress(n),
                keys[idx],
                requiredFlags[idx],
              );
            });
            return { session, sheetNames, mappings };
          }),
      ),
  );
});

// ---------------------------------------------------------------------------
// Template builder + cell reader
// ---------------------------------------------------------------------------

async function buildWorkbookBytes(sheetNames: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  sheetNames.forEach((name, i) => {
    const ws = wb.addWorksheet(name);
    // A1 label is never targeted (targets start at row 2); it must survive.
    ws.getCell('A1').value = `label-${i}`;
  });
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** True when a reloaded cell holds no value (was left blank). */
function cellIsBlank(cell: ExcelJS.Cell): boolean {
  const v = cell.value;
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.length === 0;
  return false;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 13: Missing required fields reporting', () => {
  it('reports every required-and-absent field once, leaves its cell blank, and reports no other', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ session, sheetNames, mappings }) => {
        const bytes = await buildWorkbookBytes(sheetNames);

        const { bytes: outBytes, missingRequiredFields, warnings } = await generateReport(
          bytes,
          mappings,
          session,
        );

        // Every sheet exists in the template, so no mapping is skipped.
        expect(warnings).toHaveLength(0);

        // Oracle: partition mappings by (required?, value present?).
        const requiredAbsent = mappings.filter(
          (m) => m.required && !hasValue(resolveFieldValue(m.inputFieldKey, session)),
        );
        const requiredPresent = mappings.filter(
          (m) => m.required && hasValue(resolveFieldValue(m.inputFieldKey, session)),
        );
        const optional = mappings.filter((m) => !m.required);

        // The set of input field keys the report claims are missing.
        const reportedKeys = missingRequiredFields.map((f) => f.inputFieldKey);

        // 1) Every required-and-absent mapping appears exactly once, keyed by
        //    its input field key, and the report points at its mapped cell.
        for (const m of requiredAbsent) {
          const matches = missingRequiredFields.filter(
            (f) =>
              f.inputFieldKey === m.inputFieldKey &&
              f.sheetName === m.sheetName &&
              f.cellAddress === m.cellAddress,
          );
          expect(
            matches.length,
            `required-absent ${m.inputFieldKey} @ ${m.sheetName}!${m.cellAddress} should be reported exactly once`,
          ).toBe(1);
          // The label carries the sheet!cell and the key for the UI (R8.5).
          expect(matches[0].label).toBe(
            `${m.sheetName}!${m.cellAddress} (${m.inputFieldKey})`,
          );
        }

        // The report has no more entries than the required-absent mappings.
        expect(missingRequiredFields).toHaveLength(requiredAbsent.length);

        // 2) No required-and-present mapping's cell is reported as missing.
        for (const m of requiredPresent) {
          const reported = missingRequiredFields.some(
            (f) => f.sheetName === m.sheetName && f.cellAddress === m.cellAddress,
          );
          expect(
            reported,
            `required-present ${m.inputFieldKey} @ ${m.sheetName}!${m.cellAddress} must NOT be reported`,
          ).toBe(false);
        }

        // 3) No optional mapping is ever reported (regardless of presence).
        for (const m of optional) {
          expect(
            reportedKeys.includes(m.inputFieldKey) &&
              missingRequiredFields.some(
                (f) => f.sheetName === m.sheetName && f.cellAddress === m.cellAddress,
              ),
            `optional ${m.inputFieldKey} @ ${m.sheetName}!${m.cellAddress} must NOT be reported`,
          ).toBe(false);
        }

        // 4) Reload the serialized bytes and assert the blank-cell invariant.
        const reloaded = await loadWorkbook(outBytes);

        for (const m of requiredAbsent) {
          const ws = reloaded.getWorksheet(m.sheetName);
          expect(ws, `sheet ${m.sheetName} should exist`).toBeDefined();
          expect(
            cellIsBlank(ws!.getCell(m.cellAddress)),
            `required-absent cell ${m.sheetName}!${m.cellAddress} must be blank`,
          ).toBe(true);
        }

        // Untouched A1 labels survive (no write leaked onto them).
        sheetNames.forEach((name, i) => {
          const ws = reloaded.getWorksheet(name)!;
          expect(ws.getCell('A1').value).toBe(`label-${i}`);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60000);
});
