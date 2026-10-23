import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_RATING_RANGE,
  DEFAULT_RH_PARAMETERS,
  type FieldMapping,
  type RHParameterDef,
} from '../index';
import { deriveActiveRHParameters } from './parameterSet';

/**
 * Property-based test for the active R&H_Parameter set selection.
 *
 * Feature: rnh-tyre-testing-system, Property 10: R&H_Parameter set selection
 * Validates: Requirements 6.6, 6.7
 *
 * For any Customer_Template, the R&H_Parameters presented for a Test_Session
 * equal exactly the parameters defined by that template's Field_Mappings when
 * such mappings exist (deduped by name, first-seen order), and equal the
 * default parameter set when no such mappings exist.
 */

const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------

/**
 * A mapping "defines" a parameter when it carries a non-empty (after trimming)
 * rhParameterName. Independent of the implementation's private predicate.
 */
function oracleDefines(m: FieldMapping): boolean {
  return typeof m.rhParameterName === 'string' && m.rhParameterName.trim().length > 0;
}

/** Independent category inference from the inputFieldKey convention. */
function oracleCategory(m: FieldMapping): 'ride' | 'handling' {
  const category = m.inputFieldKey.split('.')[1];
  return category === 'handling' ? 'handling' : 'ride';
}

/**
 * Independent oracle reproducing the Property 10 specification from scratch:
 *  - collect the trimmed names of defining mappings, deduped by first-seen;
 *  - if any exist, that ordered named set (with default range) is the answer;
 *  - otherwise the answer is the default parameter set.
 */
function oracleActiveParameters(mappings: readonly FieldMapping[]): RHParameterDef[] {
  const seen = new Set<string>();
  const defined: RHParameterDef[] = [];
  for (const m of mappings) {
    if (!oracleDefines(m)) continue;
    const name = m.rhParameterName!.trim();
    if (seen.has(name)) continue;
    seen.add(name);
    defined.push({
      name,
      category: oracleCategory(m),
      range: { ...DEFAULT_RATING_RANGE },
    });
  }
  if (defined.length > 0) return defined;
  return DEFAULT_RH_PARAMETERS.map((p) => ({
    name: p.name,
    category: p.category,
    range: { ...p.range },
  }));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary A1-style cell address. */
const cellArb = fc
  .tuple(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F'), fc.integer({ min: 1, max: 99 }))
  .map(([col, row]) => `${col}${row}`);

/** A non-empty parameter name (may carry surrounding whitespace). */
const paramNameArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.trim().length > 0)
  .chain((core) =>
    fc.constantFrom('', '  ', ' ').map((pad) => `${pad}${core}${pad}`),
  );

/** A mapping that DEFINES an R&H_Parameter (non-empty rhParameterName). */
const definingMappingArb: fc.Arbitrary<FieldMapping> = fc
  .record({
    mappingId: fc.string({ minLength: 1, maxLength: 8 }),
    templateId: fc.constant('t1'),
    sheetName: fc.constantFrom('MU1', 'MU2', 'Sheet1'),
    cellAddress: cellArb,
    category: fc.constantFrom('ride', 'handling'),
    param: paramNameArb,
    fieldType: fc.constantFrom('rhRating', 'rhNote'),
    required: fc.boolean(),
  })
  .map((r) => ({
    mappingId: r.mappingId,
    templateId: r.templateId,
    sheetName: r.sheetName,
    cellAddress: r.cellAddress,
    inputFieldKey: `${r.fieldType}.${r.category}.p`,
    fieldType: r.fieldType as FieldMapping['fieldType'],
    rhParameterName: r.param,
    required: r.required,
  }));

/** A mapping that does NOT define an R&H_Parameter. */
const nonDefiningMappingArb: fc.Arbitrary<FieldMapping> = fc
  .record({
    mappingId: fc.string({ minLength: 1, maxLength: 8 }),
    sheetName: fc.constantFrom('MU1', 'MU2', 'Sheet1'),
    cellAddress: cellArb,
    inputFieldKey: fc.constantFrom(
      'vehicle.frontAxlePressure',
      'tyreSet[0].make',
      'condition.testDate',
      'meta.customerName',
    ),
    fieldType: fc.constantFrom('vehicle', 'tyreSet', 'condition', 'meta'),
    // rhParameterName absent, empty, or whitespace-only — none of these define.
    rhParameterName: fc.constantFrom(undefined, '', '   ', '\t'),
    required: fc.boolean(),
  })
  .map((r) => ({
    mappingId: r.mappingId,
    templateId: 't1',
    sheetName: r.sheetName,
    cellAddress: r.cellAddress,
    inputFieldKey: r.inputFieldKey,
    fieldType: r.fieldType as FieldMapping['fieldType'],
    ...(r.rhParameterName === undefined ? {} : { rhParameterName: r.rhParameterName }),
    required: r.required,
  }));

const anyMappingArb = fc.oneof(
  { weight: 2, arbitrary: definingMappingArb },
  { weight: 1, arbitrary: nonDefiningMappingArb },
);

describe('Property 10: R&H_Parameter set selection', () => {
  it('presents exactly the template-defined parameters, or the default set when none (Feature: rnh-tyre-testing-system, Property 10: R&H_Parameter set selection)', () => {
    fc.assert(
      fc.property(fc.array(anyMappingArb, { maxLength: 20 }), (mappings) => {
        const actual = deriveActiveRHParameters(mappings);
        const expected = oracleActiveParameters(mappings);

        // Exact structural equality: names, categories, ranges, and order.
        expect(actual).toEqual(expected);

        const anyDefines = mappings.some(oracleDefines);
        if (anyDefines) {
          // No default fallback leaked in when the template defines parameters.
          const expectedNames = expected.map((p) => p.name);
          // Deduped by name, first-seen order preserved.
          expect(new Set(expectedNames).size).toBe(expectedNames.length);
          expect(actual.map((p) => p.name)).toEqual(expectedNames);
        } else {
          // Fallback: exactly the default set by name/category.
          expect(actual.map((p) => `${p.name}|${p.category}`)).toEqual(
            DEFAULT_RH_PARAMETERS.map((p) => `${p.name}|${p.category}`),
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('with at least one defining mapping, returns exactly the named parameters deduped by first-seen order (Feature: rnh-tyre-testing-system, Property 10: R&H_Parameter set selection)', () => {
    fc.assert(
      fc.property(
        fc.array(definingMappingArb, { minLength: 1, maxLength: 20 }),
        fc.array(nonDefiningMappingArb, { maxLength: 10 }),
        (defining, nonDefining) => {
          // Interleave defining and non-defining mappings arbitrarily is not
          // needed for correctness of the oracle; concatenation exercises the
          // "at least one defines" branch while keeping ordering deterministic.
          const mappings = [...nonDefining, ...defining];
          const actual = deriveActiveRHParameters(mappings);
          const expected = oracleActiveParameters(mappings);
          expect(actual).toEqual(expected);
          // Result must never equal the default set here, unless the named set
          // happens to coincide — assert it matches the oracle-derived names.
          expect(actual.map((p) => p.name)).toEqual(expected.map((p) => p.name));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('with no defining mapping, returns exactly the default parameter set (Feature: rnh-tyre-testing-system, Property 10: R&H_Parameter set selection)', () => {
    fc.assert(
      fc.property(fc.array(nonDefiningMappingArb, { maxLength: 20 }), (mappings) => {
        const actual = deriveActiveRHParameters(mappings);
        expect(actual.map((p) => p.name)).toEqual(
          DEFAULT_RH_PARAMETERS.map((p) => p.name),
        );
        expect(actual.map((p) => p.category)).toEqual(
          DEFAULT_RH_PARAMETERS.map((p) => p.category),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
