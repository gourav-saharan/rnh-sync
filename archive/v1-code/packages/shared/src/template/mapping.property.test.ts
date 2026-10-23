// Property-based tests for Field_Mapping conflict handling.
//
// Feature: rnh-tyre-testing-system, Property 5: Mapping conflict handling
//
// Property 5 (Mapping conflict handling): For any set of proposed
// Field_Mappings, after save the persisted set contains no two mappings
// targeting the same (sheet, cell) and equals the input set minus exactly the
// conflicting duplicates, while every non-conflicting mapping is saved.
//
// Validates: Requirements 3.5

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mappingTargetKey, type FieldMapping, type FieldType } from '../index';
import { createMapping } from './mapping';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 300;

const FIELD_TYPES: readonly FieldType[] = [
  'tyreSet',
  'vehicle',
  'condition',
  'rhRating',
  'rhNote',
  'meta',
];

/**
 * A small pool of target triples `(templateId, sheetName, cellAddress)`. Using
 * a constrained pool (rather than fully random addresses) guarantees frequent
 * collisions so the conflict branch is exercised, while still covering
 * multi-sheet templates.
 */
const templateIdArb = fc.constantFrom('tpl-1', 'tpl-2');
const sheetNameArb = fc.constantFrom('MU1', 'MU7', 'dryhandling1', 'Description');
const cellAddressArb = fc.constantFrom('A1', 'B2', 'C7', 'D10', 'AA100');

/**
 * A Field_Mapping arbitrary. The identifying triple is drawn from the small
 * pools above (so duplicates arise), while the non-target fields
 * (inputFieldKey, fieldType, etc.) vary freely so accepted/withheld mappings
 * are distinguishable by identity.
 */
const fieldMappingArb: fc.Arbitrary<FieldMapping> = fc.record({
  mappingId: fc.uuid(),
  templateId: templateIdArb,
  sheetName: sheetNameArb,
  cellAddress: cellAddressArb,
  inputFieldKey: fc.string({ minLength: 1, maxLength: 20 }),
  fieldType: fc.constantFrom(...FIELD_TYPES),
  required: fc.boolean(),
});

/**
 * A set of proposed Field_Mappings. `createMapping` is order-sensitive (first
 * to claim a target wins), so we keep the generated array order intact.
 * Lengths from 0 to ~12 include the empty case and cases dense enough to
 * produce many duplicate-target collisions.
 */
const proposedSetArb: fc.Arbitrary<FieldMapping[]> = fc.array(fieldMappingArb, {
  minLength: 0,
  maxLength: 12,
});

/**
 * Independent oracle for the partition. Walks the proposals in order and, using
 * `mappingTargetKey` from @rnh/shared to compute each target key, assigns each
 * mapping to `accepted` (first to claim its key) or `conflicts` (a later
 * duplicate of an already-claimed key). Computed independently of the code
 * under test so the test does not merely mirror the implementation.
 */
function oracle(proposals: readonly FieldMapping[]): {
  accepted: FieldMapping[];
  conflicts: FieldMapping[];
} {
  const accepted: FieldMapping[] = [];
  const conflicts: FieldMapping[] = [];
  const claimed = new Set<string>();
  for (const m of proposals) {
    const key = mappingTargetKey(m);
    if (claimed.has(key)) {
      conflicts.push(m);
    } else {
      claimed.add(key);
      accepted.push(m);
    }
  }
  return { accepted, conflicts };
}

describe('Property 5: Mapping conflict handling', () => {
  it('accepted has no two mappings targeting the same (sheet, cell)', () => {
    fc.assert(
      fc.property(proposedSetArb, (proposals) => {
        const { accepted } = createMapping(proposals);
        const keys = accepted.map((m) => mappingTargetKey(m));
        // No duplicate target keys among the accepted mappings.
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepted plus conflicts equals the input (partition, no loss/duplication)', () => {
    fc.assert(
      fc.property(proposedSetArb, (proposals) => {
        const { accepted, conflicts } = createMapping(proposals);

        // Total count is preserved: every input is exactly one of accepted or
        // conflict (no mapping dropped, none duplicated).
        expect(accepted.length + conflicts.length).toBe(proposals.length);

        // The conflicts are returned verbatim (by identity), so multiset
        // equality of the union with the input holds on the identifying triple.
        const conflictMappings = conflicts.map((c) => c.mapping);
        const inputKeyCounts = countKeys(proposals);
        const unionKeyCounts = countKeys([...accepted, ...conflictMappings]);
        expect(unionKeyCounts).toEqual(inputKeyCounts);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every conflict is a genuine duplicate of an earlier accepted mapping', () => {
    fc.assert(
      fc.property(proposedSetArb, (proposals) => {
        const { accepted, conflicts } = createMapping(proposals);
        const acceptedKeys = new Set(accepted.map((m) => mappingTargetKey(m)));
        for (const conflict of conflicts) {
          // Every withheld conflict is flagged as a duplicate target cell...
          expect(conflict.reason).toBe('duplicate-target-cell');
          // ...and collides with an accepted mapping's target.
          expect(acceptedKeys.has(mappingTargetKey(conflict.mapping))).toBe(
            true,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('matches the independent partition oracle exactly (in order)', () => {
    fc.assert(
      fc.property(proposedSetArb, (proposals) => {
        const actual = createMapping(proposals);
        const expected = oracle(proposals);

        // Same target keys accepted, in the same order (first-claim-wins).
        expect(actual.accepted.map((m) => mappingTargetKey(m))).toEqual(
          expected.accepted.map((m) => mappingTargetKey(m)),
        );
        // Same conflicts, in order, returned verbatim by identity.
        expect(actual.conflicts.map((c) => c.mapping)).toEqual(
          expected.conflicts,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/** Counts occurrences of each target key in a list of mappings. */
function countKeys(mappings: readonly FieldMapping[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of mappings) {
    const key = mappingTargetKey(m);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
