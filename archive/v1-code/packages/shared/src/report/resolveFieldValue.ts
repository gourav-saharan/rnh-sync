// Report_Generator — inputFieldKey value resolution.
//
// The Report_Generator (design.md, Report Generation Pipeline, step 2) walks
// each Field_Mapping and writes "the corresponding Test_Session value" into the
// mapped cell. This module is the pure lookup that turns a mapping's
// `inputFieldKey` into the concrete value held on a Test_Session.
//
// It is the inverse of the `inputFieldKey` conventions builder in @rnh/shared:
// the builder produces keys like "tyreSet[0].make", "vehicle.frontAxlePressure",
// "condition.testDate", "rhRating.ride.smoothRoad", "rhNote.handling.rearTracking",
// and "meta.<field>"; this resolver parses those keys back into the matching
// value on a TestSession (plus optional report-generation metadata).
//
// Kept pure/side-effect-free so the fill step (fillWorkbook) and the property
// tests can consume it directly. Requirements: 8.2 (write each Test_Session
// value into its mapped cell), 3.3 (mappings on any sheet).

import type {
  RHCategory,
  RHParameterEntry,
  TestConditions,
  TestSession,
  TyreSet,
  VehicleDetails,
} from '../index';

/**
 * Report-generation metadata not held directly on a Test_Session but needed to
 * resolve `meta.*` input field keys (e.g. the customer name for a header cell).
 * Optional: absent entries resolve to `undefined` (an unset value).
 */
export interface ReportMeta {
  [field: string]: string | number | undefined;
}

/**
 * A resolved input value. `undefined` means the Test_Session has no value for
 * that field key — the fill step leaves the cell untouched/blank and, when the
 * mapping is `required`, records it as a missing field (R8.5, handled by the
 * fill step, not here).
 */
export type ResolvedValue = string | number | undefined;

// A category name as it appears in an `rhRating`/`rhNote` key.
type CategoryName = 'ride' | 'handling';

// ---------------------------------------------------------------------------
// Key parsing
// ---------------------------------------------------------------------------

// "tyreSet[0].make" -> index 0, field "make".
const TYRE_SET_KEY = /^tyreSet\[(\d+)\]\.(.+)$/;
// "vehicle.frontAxlePressure" -> field "frontAxlePressure".
const VEHICLE_KEY = /^vehicle\.(.+)$/;
// "condition.testDate" -> field "testDate".
const CONDITION_KEY = /^condition\.(.+)$/;
// "rhRating.ride.Smooth Road" -> category "ride", parameter "Smooth Road".
const RH_RATING_KEY = /^rhRating\.(ride|handling)\.(.+)$/;
// "rhNote.handling.Rear Tracking" -> category "handling", parameter "Rear Tracking".
const RH_NOTE_KEY = /^rhNote\.(ride|handling)\.(.+)$/;
// "meta.customerName" -> field "customerName".
const META_KEY = /^meta\.(.+)$/;

/**
 * Normalises a parameter-name segment for comparison. The `inputFieldKey`
 * builder embeds the parameter name verbatim (e.g. "Smooth Road" or a
 * camelCase form such as "smoothRoad"); Test_Session entries carry the display
 * name ("Smooth Road"). To match robustly across those forms we compare on a
 * lowercased, non-alphanumeric-stripped key so "smoothRoad", "Smooth Road" and
 * "smooth road" all collide.
 */
function normalizeParamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Finds the RHParameterEntry in a category matching the given parameter name. */
function findParameter(
  category: RHCategory,
  parameterName: string,
): RHParameterEntry | undefined {
  const target = normalizeParamName(parameterName);
  return category.parameters.find((p) => normalizeParamName(p.name) === target);
}

// ---------------------------------------------------------------------------
// Field lookups
// ---------------------------------------------------------------------------

function resolveTyreSet(session: TestSession, index: number, field: string): ResolvedValue {
  const tyreSet = session.tyreSets[index];
  if (!tyreSet) {
    return undefined;
  }
  if (field in tyreSet) {
    const value = tyreSet[field as keyof TyreSet];
    return value as ResolvedValue;
  }
  return undefined;
}

function resolveVehicle(session: TestSession, field: string): ResolvedValue {
  const vehicle = session.vehicle;
  if (vehicle && field in vehicle) {
    return vehicle[field as keyof VehicleDetails] as ResolvedValue;
  }
  return undefined;
}

function resolveCondition(session: TestSession, field: string): ResolvedValue {
  const conditions = session.conditions;
  if (conditions && field in conditions) {
    return conditions[field as keyof TestConditions] as ResolvedValue;
  }
  return undefined;
}

function categoryFor(session: TestSession, category: CategoryName): RHCategory {
  return category === 'ride' ? session.ride : session.handling;
}

function resolveRhRating(
  session: TestSession,
  category: CategoryName,
  parameterName: string,
): ResolvedValue {
  const entry = findParameter(categoryFor(session, category), parameterName);
  return entry ? entry.rating : undefined;
}

function resolveRhNote(
  session: TestSession,
  category: CategoryName,
  parameterName: string,
): ResolvedValue {
  const entry = findParameter(categoryFor(session, category), parameterName);
  return entry ? entry.note : undefined;
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the Test_Session value a Field_Mapping's `inputFieldKey` points at
 * (design.md Report Generation Pipeline, step 2; R8.2).
 *
 * The key is a dotted path following the {@link inputFieldKey} conventions:
 *  - `tyreSet[i].<field>`          -> session.tyreSets[i][field]
 *  - `vehicle.<field>`             -> session.vehicle[field]
 *  - `condition.<field>`           -> session.conditions[field]
 *  - `rhRating.<category>.<param>` -> matching parameter's rating
 *  - `rhNote.<category>.<param>`   -> matching parameter's note
 *  - `meta.<field>`                -> report-generation metadata
 *
 * Returns `undefined` when the session carries no value for the key (an unset
 * field, an out-of-range Tyre_Set index, or an unknown R&H_Parameter). The fill
 * step treats `undefined` as "leave blank" and, for `required` mappings, as a
 * missing field (R8.5).
 *
 * @param key the mapping's `inputFieldKey`.
 * @param session the Test_Session providing the values.
 * @param meta optional report-generation metadata for `meta.*` keys.
 * @returns the resolved value, or `undefined` when unset/unknown.
 */
export function resolveFieldValue(
  key: string,
  session: TestSession,
  meta: ReportMeta = {},
): ResolvedValue {
  const trimmed = key.trim();

  let m = TYRE_SET_KEY.exec(trimmed);
  if (m) {
    return resolveTyreSet(session, Number.parseInt(m[1], 10), m[2]);
  }

  m = RH_RATING_KEY.exec(trimmed);
  if (m) {
    return resolveRhRating(session, m[1] as CategoryName, m[2]);
  }

  m = RH_NOTE_KEY.exec(trimmed);
  if (m) {
    return resolveRhNote(session, m[1] as CategoryName, m[2]);
  }

  m = VEHICLE_KEY.exec(trimmed);
  if (m) {
    return resolveVehicle(session, m[1]);
  }

  m = CONDITION_KEY.exec(trimmed);
  if (m) {
    return resolveCondition(session, m[1]);
  }

  m = META_KEY.exec(trimmed);
  if (m) {
    return meta[m[1]];
  }

  // Unrecognised key shape: nothing to resolve.
  return undefined;
}

/**
 * True when a resolved value counts as "present" for missing-required-field
 * reporting (R8.5). `undefined` and empty/whitespace-only strings are treated
 * as absent; numbers (including 0) and non-empty strings are present.
 */
export function hasValue(value: ResolvedValue): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}
