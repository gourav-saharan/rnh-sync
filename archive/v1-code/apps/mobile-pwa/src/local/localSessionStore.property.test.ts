// Property-based test for the local (IndexedDB) persistence layer.
//
// Feature: rnh-tyre-testing-system, Property 8: Local Test_Session persistence
// round-trip — For any Test_Session state (including all Tyre_Set, vehicle,
// condition, and per-parameter rating/note fields), persisting it to local
// storage and then reloading it yields an identical Test_Session state.
//
// Validates: Requirements 4.4, 5.6, 6.1, 6.2, 6.3, 6.4, 10.2
//
// Uses fast-check with a minimum of 100 iterations. Each run gets a fresh,
// isolated Dexie database (fake-indexeddb is registered in the test setup) so
// the round-trip result cannot leak between examples.

import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type {
  LocalTestSession,
  RHCategory,
  RHParameterEntry,
  SyncState,
  TestConditions,
  TyreSet,
  VehicleDetails,
} from '@rnh/shared';
import { RATING_INCREMENT } from '@rnh/shared';
import { LocalSessionDatabase, LocalSessionStore } from './localSessionStore';

// ---------------------------------------------------------------------------
// Arbitraries — generate full LocalTestSession states across every field type.
// ---------------------------------------------------------------------------

/** Full unicode text, including empty strings and non-ASCII content. */
const textArb = fc.string({ maxLength: 40 });

/** A finite number safe to round-trip through IndexedDB structured clone. */
const finiteNumberArb = fc.double({
  min: -1e6,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A rating: a multiple of 0.25 within a plausible subjective range. */
const ratingArb = fc
  .integer({ min: 0, max: 40 })
  .map((steps) => steps * RATING_INCREMENT);

const tyreSetArb: fc.Arbitrary<TyreSet> = fc.record({
  groupName: textArb,
  make: textArb,
  pattern: textArb,
  // srlr is 'SR' | 'LR' | string — cover the presets and arbitrary variants.
  srlr: fc.oneof(
    fc.constant('SR'),
    fc.constant('LR'),
    textArb,
  ),
  weekCode: textArb,
  dot: textArb,
});

const vehicleArb: fc.Arbitrary<VehicleDetails> = fc.record({
  vehicleId: textArb,
  tyreSize: textArb,
  rimSize: textArb,
  frontAxlePressure: finiteNumberArb,
  rearAxlePressure: finiteNumberArb,
});

const conditionsArb: fc.Arbitrary<TestConditions> = fc.record({
  testTrack: textArb,
  driverName: textArb,
  loadOfCar: textArb,
  airTempC: finiteNumberArb,
  roadTempC: finiteNumberArb,
  testDate: textArb,
});

const parameterEntryArb: fc.Arbitrary<RHParameterEntry> = fc.record({
  name: textArb,
  rating: ratingArb,
  note: textArb,
});

/** A category with its parameter list; averageRating is the stored derived value. */
const categoryArb: fc.Arbitrary<RHCategory> = fc.record({
  parameters: fc.array(parameterEntryArb, { maxLength: 8 }),
  averageRating: finiteNumberArb,
});

const syncStateArb: fc.Arbitrary<SyncState> = fc.constantFrom(
  'unsynced',
  'synced',
);

/** Per-field server timestamp map used for conflict resolution (R7.4). */
const fieldTimestampsArb: fc.Arbitrary<Record<string, number>> = fc.dictionary(
  textArb,
  fc.integer({ min: 0, max: 4_000_000_000_000 }),
  { maxKeys: 5 },
);

const localTestSessionArb: fc.Arbitrary<LocalTestSession> = fc.record({
  sessionId: fc.uuid(),
  templateId: fc.option(textArb, { nil: null }),
  createdBy: textArb,
  tyreSets: fc.array(tyreSetArb, { maxLength: 4 }),
  vehicle: vehicleArb,
  conditions: conditionsArb,
  ride: categoryArb,
  handling: categoryArb,
  syncState: syncStateArb,
  fieldTimestamps: fieldTimestampsArb,
  updatedAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
  dirty: fc.boolean(),
  pendingSince: fc.option(fc.integer({ min: 0, max: 4_000_000_000_000 }), {
    nil: null,
  }),
});

// ---------------------------------------------------------------------------
// Isolated database lifecycle: a fresh DB per property run.
// ---------------------------------------------------------------------------

let dbCounter = 0;
const openDbs: LocalSessionDatabase[] = [];

function freshStore(): { db: LocalSessionDatabase; store: LocalSessionStore } {
  const db = new LocalSessionDatabase(`prop-db-${dbCounter++}`);
  openDbs.push(db);
  return { db, store: new LocalSessionStore(db) };
}

afterEach(async () => {
  // Tear down every database opened during the property runs.
  while (openDbs.length > 0) {
    const db = openDbs.pop()!;
    await db.delete();
  }
});

describe('Property 8: Local Test_Session persistence round-trip', () => {
  it('reloads an identical Test_Session state for any persisted session', async () => {
    await fc.assert(
      fc.asyncProperty(localTestSessionArb, async (session) => {
        const { store } = freshStore();

        await store.save(session);
        const loaded = await store.load(session.sessionId);

        // Reloading yields an identical Test_Session state, field for field.
        expect(loaded).toEqual(session);
      }),
      { numRuns: 100 },
    );
  });
});
