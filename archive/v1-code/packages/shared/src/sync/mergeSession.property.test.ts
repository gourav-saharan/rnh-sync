// Property-based tests for the Sync_Engine per-field conflict merge.
//
// Feature: rnh-tyre-testing-system, Property 16: Per-field conflict merge
//
// Property 16 (Per-field conflict merge): For any two concurrent edits of the
// same Test_Session, the merged result takes, per field, the value carrying
// the latest Firebase-server-received timestamp (with the documented
// tie -> remote rule), and preserves BOTH R&H_Parameter note texts so that no
// non-empty note is ever lost.
//
// Validates: Requirements 7.4, 6.4

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  inputFieldKey,
  type LocalTestSession,
  type RHCategory,
  type RHParameterEntry,
  type TestSession,
  type TestConditions,
  type Timestamp,
  type TyreSet,
  type VehicleDetails,
} from '../index';
import { mergeSession } from './mergeSession';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 300;

// ---------------------------------------------------------------------------
// Fixed R&H_Parameter set shared by both sides so parameters always match by
// name (the merge unions by name; a matched name is what forces a per-field
// conflict and a note merge). Two parameters per category is enough to
// exercise independent per-field resolution.
// ---------------------------------------------------------------------------

const RIDE_PARAMS = ['Smooth Road', 'Rough Road'] as const;
const HANDLING_PARAMS = ['Roll Level & Damping', 'Rear Tracking'] as const;

/**
 * Every scalar/grouped field key the merge resolves independently, paired with
 * a reader that extracts the corresponding value from a merged/side session.
 * The R&H rating keys are added dynamically below.
 */
const SCALAR_FIELDS: ReadonlyArray<{
  key: string;
  read: (s: TestSession) => unknown;
}> = [
  { key: 'tyreSets', read: (s) => s.tyreSets },
  { key: 'vehicle', read: (s) => s.vehicle },
  { key: 'conditions', read: (s) => s.conditions },
  { key: 'templateId', read: (s) => s.templateId },
  { key: 'ride.averageRating', read: (s) => s.ride.averageRating },
  { key: 'handling.averageRating', read: (s) => s.handling.averageRating },
];

// ---------------------------------------------------------------------------
// Independent oracle for the per-field timestamp winner.
//
// Deliberately re-derived from the acceptance criteria rather than reusing the
// implementation's helpers: an absent timestamp is treated as -Infinity, and a
// strict local win requires local > remote; anything else (equal, or both
// absent) resolves to remote (the documented tie -> remote rule, R7.4).
// ---------------------------------------------------------------------------

function tsAt(session: TestSession, key: string): number {
  const value = session.fieldTimestamps[key];
  return typeof value === 'number' ? value : Number.NEGATIVE_INFINITY;
}

/** Oracle: true iff the local value should win for `key`. */
function localWinsOracle(local: TestSession, remote: TestSession, key: string): boolean {
  return tsAt(local, key) > tsAt(remote, key);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const tyreSetArb: fc.Arbitrary<TyreSet> = fc.record({
  groupName: fc.constant('Set A'), // identity-ish; content differs via other fields
  make: fc.string({ minLength: 1, maxLength: 6 }),
  pattern: fc.string({ minLength: 1, maxLength: 6 }),
  srlr: fc.constantFrom<'SR' | 'LR'>('SR', 'LR'),
  weekCode: fc.string({ maxLength: 4 }),
  dot: fc.string({ maxLength: 4 }),
});

const vehicleArb: fc.Arbitrary<VehicleDetails> = fc.record({
  vehicleId: fc.string({ minLength: 1, maxLength: 6 }),
  tyreSize: fc.string({ minLength: 1, maxLength: 10 }),
  rimSize: fc.string({ maxLength: 4 }),
  frontAxlePressure: fc.integer({ min: 20, max: 45 }),
  rearAxlePressure: fc.integer({ min: 20, max: 45 }),
});

const conditionsArb: fc.Arbitrary<TestConditions> = fc.record({
  testTrack: fc.string({ minLength: 1, maxLength: 8 }),
  driverName: fc.string({ minLength: 1, maxLength: 8 }),
  loadOfCar: fc.string({ maxLength: 6 }),
  airTempC: fc.integer({ min: -10, max: 50 }),
  roadTempC: fc.integer({ min: -10, max: 60 }),
  testDate: fc.constantFrom('2026-09-15', '2026-09-16', '2026-10-01'),
});

/** Ratings on the R&H grid (0.25 increments, 1..10). */
const ratingArb: fc.Arbitrary<number> = fc
  .integer({ min: 4, max: 40 })
  .map((q) => q / 4);

/**
 * Note text arbitrary that frequently produces empty notes (so the
 * "only one side has a note" and "both empty" cases are exercised) and
 * otherwise produces short non-empty strings.
 */
const noteArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 3, arbitrary: fc.string({ minLength: 1, maxLength: 12 }) },
);

function categoryArb(names: readonly string[]): fc.Arbitrary<RHCategory> {
  return fc
    .tuple(
      ...names.map((name) =>
        fc
          .record({ rating: ratingArb, note: noteArb })
          .map(({ rating, note }): RHParameterEntry => ({ name, rating, note })),
      ),
      ratingArb, // averageRating (independent value; not recomputed by merge)
    )
    .map((tuple) => {
      const parameters = tuple.slice(0, names.length) as RHParameterEntry[];
      const averageRating = tuple[names.length] as number;
      return { parameters, averageRating };
    });
}

/** A single side (local or remote) of the same session. */
const sideArb: fc.Arbitrary<TestSession> = fc.record({
  sessionId: fc.constant('session-1'),
  templateId: fc.constantFrom<string | null>(null, 'tmpl-A', 'tmpl-B'),
  createdBy: fc.constant('tester-1'),
  tyreSets: fc.array(tyreSetArb, { minLength: 1, maxLength: 2 }),
  vehicle: vehicleArb,
  conditions: conditionsArb,
  ride: categoryArb(RIDE_PARAMS),
  handling: categoryArb(HANDLING_PARAMS),
  syncState: fc.constant<'unsynced'>('unsynced'),
  fieldTimestamps: fc.constant<Record<string, Timestamp>>({}),
  updatedAt: fc.integer({ min: 0, max: 1000 }),
});

/** All per-field timestamp keys that both sides carry. */
const ALL_FIELD_KEYS: readonly string[] = [
  'tyreSets',
  'vehicle',
  'conditions',
  'templateId',
  'ride.averageRating',
  'handling.averageRating',
  ...RIDE_PARAMS.map((p) => inputFieldKey.rhRating('ride', p)),
  ...HANDLING_PARAMS.map((p) => inputFieldKey.rhRating('handling', p)),
];

/**
 * Per-field timestamp arbitrary. For each key we independently choose a local
 * and a remote timestamp, occasionally forcing a tie or an absent timestamp on
 * one side, so which side "wins" varies per field across the whole key set.
 */
const timestampsArb: fc.Arbitrary<{
  local: Record<string, Timestamp>;
  remote: Record<string, Timestamp>;
}> = fc
  .tuple(
    ...ALL_FIELD_KEYS.map(() =>
      fc.record({
        // 0 = local present, 1 = remote present, 2 = both, 3 = tie (equal)
        mode: fc.constantFrom(0, 1, 2, 3),
        a: fc.integer({ min: 0, max: 5000 }),
        b: fc.integer({ min: 0, max: 5000 }),
      }),
    ),
  )
  .map((entries) => {
    const local: Record<string, Timestamp> = {};
    const remote: Record<string, Timestamp> = {};
    ALL_FIELD_KEYS.forEach((key, i) => {
      const { mode, a, b } = entries[i];
      if (mode === 0) {
        local[key] = a;
      } else if (mode === 1) {
        remote[key] = b;
      } else if (mode === 2) {
        local[key] = a;
        remote[key] = b;
      } else {
        // Explicit tie to exercise the tie -> remote rule.
        local[key] = a;
        remote[key] = a;
      }
    });
    return { local, remote };
  });

/** Assemble a concurrent (local, remote) pair of the same session. */
const conflictArb: fc.Arbitrary<{ local: LocalTestSession; remote: TestSession }> = fc
  .record({
    localSide: sideArb,
    remoteSide: sideArb,
    stamps: timestampsArb,
  })
  .map(({ localSide, remoteSide, stamps }) => {
    const remote: TestSession = { ...remoteSide, fieldTimestamps: stamps.remote };
    const local: LocalTestSession = {
      ...localSide,
      fieldTimestamps: stamps.local,
      dirty: true,
      pendingSince: localSide.updatedAt,
    };
    return { local, remote };
  });

// ---------------------------------------------------------------------------
// Property 16
// ---------------------------------------------------------------------------

describe('Property 16: Per-field conflict merge', () => {
  it('takes, per field, the value with the latest server timestamp (tie -> remote)', () => {
    fc.assert(
      fc.property(conflictArb, ({ local, remote }) => {
        const merged = mergeSession(local, remote);
        const localSession = local as TestSession;

        // Scalar / grouped fields.
        for (const { key, read } of SCALAR_FIELDS) {
          const expected = localWinsOracle(localSession, remote, key)
            ? read(localSession)
            : read(remote);
          expect(read(merged)).toEqual(expected);
        }

        // R&H ratings: resolved per parameter by rhRating.<category>.<name>.
        for (const [category, names] of [
          ['ride', RIDE_PARAMS],
          ['handling', HANDLING_PARAMS],
        ] as const) {
          for (const name of names) {
            const key = inputFieldKey.rhRating(category, name);
            const localEntry = localSession[category].parameters.find((p) => p.name === name)!;
            const remoteEntry = remote[category].parameters.find((p) => p.name === name)!;
            const expectedRating = localWinsOracle(localSession, remote, key)
              ? localEntry.rating
              : remoteEntry.rating;
            const mergedEntry = merged[category].parameters.find((p) => p.name === name)!;
            expect(mergedEntry.rating).toBe(expectedRating);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves both R&H_Parameter note texts on conflict (no non-empty note lost)', () => {
    fc.assert(
      fc.property(conflictArb, ({ local, remote }) => {
        const merged = mergeSession(local, remote);
        const localSession = local as TestSession;

        for (const category of ['ride', 'handling'] as const) {
          for (const mergedEntry of merged[category].parameters) {
            const localEntry = localSession[category].parameters.find(
              (p) => p.name === mergedEntry.name,
            );
            const remoteEntry = remote[category].parameters.find(
              (p) => p.name === mergedEntry.name,
            );
            const localNote = (localEntry?.note ?? '').trim();
            const remoteNote = (remoteEntry?.note ?? '').trim();

            // Every non-empty note text from either side survives verbatim.
            if (localNote !== '') {
              expect(mergedEntry.note).toContain(localNote);
            }
            if (remoteNote !== '') {
              expect(mergedEntry.note).toContain(remoteNote);
            }
            // If both sides were empty, the merged note is empty too.
            if (localNote === '' && remoteNote === '') {
              expect(mergedEntry.note.trim()).toBe('');
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
