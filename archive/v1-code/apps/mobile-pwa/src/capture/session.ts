// Helpers for constructing and mutating the Mobile_PWA's in-progress
// Test_Session, kept free of React so they are easy to unit test.
//
// The capture UI keeps a single LocalTestSession in state, autosaving it to the
// IndexedDB store on every change (R5.3, R10.1). These helpers build a blank
// session and derive the Ride/Handling categories from the active
// R&H_Parameter set (R6.4, R6.6, R6.7).

import {
  DEFAULT_RATING_RANGE,
  categoryAverage,
  type LocalTestSession,
  type RHCategory,
  type RHParameterDef,
  type RHParameterEntry,
  type TyreSet,
} from '@rnh/shared';

/** A fresh, empty Tyre_Set group (R6.1). */
export function blankTyreSet(groupName = 'Set A'): TyreSet {
  return {
    groupName,
    make: '',
    pattern: '',
    srlr: 'SR',
    weekCode: '',
    dot: '',
  };
}

/**
 * Build the per-category R&H entries from the active parameter set. Ratings
 * start at the low end of each parameter's range (the tester single-taps a
 * preset value to record an actual score, R5.2).
 */
function entriesForCategory(
  activeParameters: readonly RHParameterDef[],
  category: 'ride' | 'handling',
): RHParameterEntry[] {
  return activeParameters
    .filter((param) => param.category === category)
    .map((param) => ({
      name: param.name,
      rating: param.range.min,
      note: '',
    }));
}

/** Recompute a category's derived average from its parameter ratings (R6.5). */
export function withDerivedAverage(parameters: RHParameterEntry[]): RHCategory {
  return {
    parameters,
    averageRating:
      parameters.length > 0
        ? categoryAverage(parameters.map((p) => p.rating))
        : 0,
  };
}

/**
 * Create a blank in-progress Test_Session for the active parameter set.
 *
 * @param sessionId stable id for the session.
 * @param createdBy the Tester uid.
 * @param activeParameters the derived R&H_Parameter set (R6.6, R6.7).
 * @param templateId the selected Customer_Template, or null.
 * @param now current epoch-ms timestamp.
 */
export function createBlankSession(
  sessionId: string,
  createdBy: string,
  activeParameters: readonly RHParameterDef[],
  templateId: string | null,
  now: number,
): LocalTestSession {
  return {
    sessionId,
    templateId,
    createdBy,
    tyreSets: [blankTyreSet()],
    vehicle: {
      vehicleId: '',
      tyreSize: '',
      rimSize: '',
      frontAxlePressure: 0,
      rearAxlePressure: 0,
    },
    conditions: {
      testTrack: '',
      driverName: '',
      loadOfCar: '',
      airTempC: 0,
      roadTempC: 0,
      testDate: '',
    },
    ride: withDerivedAverage(entriesForCategory(activeParameters, 'ride')),
    handling: withDerivedAverage(
      entriesForCategory(activeParameters, 'handling'),
    ),
    syncState: 'unsynced',
    fieldTimestamps: {},
    updatedAt: now,
    dirty: true,
    pendingSince: now,
  };
}

/**
 * Preset rating values a tester can single-tap for a given range: every 0.25
 * step from `range.min` to `range.max` inclusive (R5.2, R5.4). Defaults to the
 * shared default range.
 */
export function presetRatingsFor(
  range: { min: number; max: number } = DEFAULT_RATING_RANGE,
): number[] {
  const values: number[] = [];
  // Guard against a malformed range that would loop forever.
  if (range.max < range.min) {
    return values;
  }
  for (let v = range.min; v <= range.max + 1e-9; v += 0.25) {
    // Round to avoid floating drift accumulating across many steps.
    values.push(Math.round(v * 100) / 100);
  }
  return values;
}
