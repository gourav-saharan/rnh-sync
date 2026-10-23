// Shared domain models, constants, and helpers for the R&H Tyre Testing System.
//
// This package is the single source of truth for the domain types consumed by
// both the Mobile_PWA and the Laptop_Web_App. It is intentionally free of any
// Firebase or React dependency so it can be imported by any layer.
//
// See .kiro/specs/rnh-tyre-testing-system/design.md (Data Models section) for
// the authoritative interface definitions and requirement traceability.

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

/**
 * Backend-neutral timestamp representation.
 *
 * Firestore stamps writes with its own `Timestamp` type; to keep this package
 * dependency-free we model a timestamp as milliseconds since the Unix epoch.
 * Data-access adapters convert between this and the Firestore `Timestamp` at
 * the boundary.
 */
export type Timestamp = number;

// ---------------------------------------------------------------------------
// Auth and roles (Requirement 1)
// ---------------------------------------------------------------------------

/** The single role assigned to each authenticated user (R1.3). */
export type Role = 'Tester' | 'Report_Viewer';

/** All valid roles, for validation and iteration. */
export const ROLES: readonly Role[] = ['Tester', 'Report_Viewer'] as const;

/** The authenticated user exposed by the Auth_Service (R1.6). */
export interface AuthUser {
  uid: string;
  email: string;
  /** Exactly one role (R1.3). */
  role: Role;
}

/** The `users/{uid}` Firestore document (R1.3). */
export interface UserDoc {
  uid: string;
  email: string;
  role: Role;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Templates (Requirement 2)
// ---------------------------------------------------------------------------

/** One sheet's extracted structure within a Customer_Template. */
export interface SheetStructure {
  name: string;
  /** Zero-based position that preserves sheet order (R8.3). */
  index: number;
  rowCount: number;
  /** Cell dimensions of the sheet (R2.5). */
  columnCount: number;
  /** Merged ranges in A1 notation, e.g. "A1:D1". */
  mergedRanges: string[];
}

/** The ordered structure extracted from an uploaded workbook (R2.2, R2.5, R8.3). */
export interface TemplateStructure {
  sheets: SheetStructure[];
}

/** The `customerTemplates/{templateId}` Firestore document. */
export interface CustomerTemplate {
  templateId: string;
  /** Named customer the template belongs to (R2.1). */
  customerName: string;
  /** Cloud Storage path to the raw original.xlsx blob. */
  storagePath: string;
  uploadDate: Timestamp;
  /** Sheets, order, dimensions, merges (R2.2, R2.5, R8.3). */
  structure: TemplateStructure;
  /** uid of the Report_Viewer who created it. */
  createdBy: string;
}

/** Projection used when listing templates without their full structure (R2.4). */
export interface CustomerTemplateSummary {
  templateId: string;
  customerName: string;
  uploadDate: Timestamp;
}

// ---------------------------------------------------------------------------
// Field mappings (Requirement 3)
// ---------------------------------------------------------------------------

/** The category of Mobile_PWA input a Field_Mapping binds to. */
export type FieldType = 'tyreSet' | 'vehicle' | 'condition' | 'rhRating' | 'rhNote' | 'meta';

/**
 * The Field_Mapping binds a Mobile_PWA input field to a precise template
 * location, qualified by sheet. Stored under
 * `customerTemplates/{templateId}/fieldMappings/{mappingId}`.
 */
export interface FieldMapping {
  mappingId: string;
  templateId: string;
  /** Which sheet the target cell lives on (R3.3, R8.4) — REQUIRED. */
  sheetName: string;
  /** A1-style address, e.g. "C7" (R3.2). */
  cellAddress: string;
  /**
   * Mobile_PWA field key following the {@link inputFieldKey} conventions,
   * e.g. "tyreSet[0].make", "rhRating.ride.smoothRoad",
   * "vehicle.frontAxlePressure".
   */
  inputFieldKey: string;
  fieldType: FieldType;
  /** Set when this mapping defines an R&H_Parameter (R6.6). */
  rhParameterName?: string;
  /** Drives missing-required-field reporting (R8.5). */
  required: boolean;
}

// ---------------------------------------------------------------------------
// Test sessions (Requirement 6)
// ---------------------------------------------------------------------------

/** Sync lifecycle state of a Test_Session (R10.3, R10.4). */
export type SyncState = 'unsynced' | 'synced';

/** A group of tyre details evaluated within a Test_Session (R6.1). */
export interface TyreSet {
  /** e.g. "Set A", "Ref", "3B-RB". */
  groupName: string;
  make: string;
  pattern: string;
  /** "SR" | "LR" or a customer-specific variant. */
  srlr: 'SR' | 'LR' | string;
  weekCode: string;
  dot: string;
}

/** Vehicle details captured for a Test_Session (R6.2). */
export interface VehicleDetails {
  vehicleId: string;
  tyreSize: string;
  rimSize: string;
  frontAxlePressure: number;
  rearAxlePressure: number;
}

/** Test condition details captured for a Test_Session (R6.3). */
export interface TestConditions {
  testTrack: string;
  driverName: string;
  loadOfCar: string;
  airTempC: number;
  roadTempC: number;
  /** Used for report file naming (R9.3). */
  testDate: string;
}

/** A single R&H_Parameter rating and its note (R6.4). */
export interface RHParameterEntry {
  /** e.g. "Smooth Road", "Damping", "Rear Tracking". */
  name: string;
  /** Increments of 0.25 within the parameter's configured range (R5.4). */
  rating: number;
  /** Per-parameter note (R6.4). */
  note: string;
}

/** A category (Ride or Handling) of R&H_Parameters plus its derived average (R6.4, R6.5). */
export interface RHCategory {
  parameters: RHParameterEntry[];
  /** Derived arithmetic mean of the parameter ratings (R6.5). */
  averageRating: number;
}

/** The `testSessions/{sessionId}` Firestore document. */
export interface TestSession {
  sessionId: string;
  /** Selected Customer_Template, or null before one is chosen. */
  templateId: string | null;
  /** Tester uid. */
  createdBy: string;

  tyreSets: TyreSet[]; // R6.1
  vehicle: VehicleDetails; // R6.2
  conditions: TestConditions; // R6.3
  ride: RHCategory; // R6.4
  handling: RHCategory; // R6.4

  syncState: SyncState; // R10.3, R10.4
  /** Per-field server timestamp for conflict resolution (R7.4). */
  fieldTimestamps: Record<string, Timestamp>;
  updatedAt: Timestamp;
}

/**
 * The Mobile_PWA local (IndexedDB) shape: the full {@link TestSession} plus
 * offline bookkeeping. This is the offline source of truth (R4.4, R10.1, R10.2).
 */
export interface LocalTestSession extends TestSession {
  /** True while there are local edits not yet confirmed as synced. */
  dirty: boolean;
  /** When the session first became dirty and awaited sync. */
  pendingSince: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Rating grid constants (Requirement 5.4)
// ---------------------------------------------------------------------------

/** The fixed rating increment (R5.4). */
export const RATING_INCREMENT = 0.25;

/** Numeric range configuration for an R&H_Parameter's rating. */
export interface RatingRange {
  min: number;
  max: number;
}

/**
 * The default rating range applied to parameters without a specific override.
 * R&H subjective scores are conventionally captured on a 1–10 scale.
 */
export const DEFAULT_RATING_RANGE: RatingRange = { min: 1, max: 10 };

/** Definition of a single default R&H_Parameter, including its category. */
export interface RHParameterDef {
  name: string;
  category: 'ride' | 'handling';
  range: RatingRange;
}

/**
 * The default R&H_Parameter set presented when a Customer_Template does not
 * define parameters through Field_Mappings (R6.7). Split across the Ride and
 * Handling categories (R6.4).
 */
export const DEFAULT_RH_PARAMETERS: readonly RHParameterDef[] = [
  { name: 'Smooth Road', category: 'ride', range: DEFAULT_RATING_RANGE },
  { name: 'Speed Breaker', category: 'ride', range: DEFAULT_RATING_RANGE },
  { name: 'Rough Road', category: 'ride', range: DEFAULT_RATING_RANGE },
  { name: 'Damping', category: 'ride', range: DEFAULT_RATING_RANGE },
  { name: 'Roll Level & Damping', category: 'handling', range: DEFAULT_RATING_RANGE },
  { name: 'Rear Tracking', category: 'handling', range: DEFAULT_RATING_RANGE },
] as const;

// ---------------------------------------------------------------------------
// Uniqueness key + inputFieldKey helpers (Requirements 3.2, 3.3)
// ---------------------------------------------------------------------------

/**
 * The uniqueness triple that identifies a Field_Mapping target. A second
 * mapping to the same triple is a duplicate-target conflict (R3.5).
 */
export interface MappingTargetKey {
  templateId: string;
  sheetName: string;
  cellAddress: string;
}

/**
 * Builds a stable string key for the `(templateId, sheetName, cellAddress)`
 * uniqueness triple (R3.3, R3.5). Cell addresses are compared case-insensitively
 * (Excel A1 references are case-insensitive) so "c7" and "C7" collide.
 */
export function mappingTargetKey(
  target: Pick<FieldMapping, 'templateId' | 'sheetName' | 'cellAddress'>,
): string {
  const cell = target.cellAddress.trim().toUpperCase();
  // Use a delimiter unlikely to appear in a sheet name; escape the sheet name
  // so a name containing the delimiter cannot forge a collision.
  const sheet = target.sheetName.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  return `${target.templateId}|${sheet}|${cell}`;
}

/** Fields recognised at the top level of an {@link inputFieldKey}. */
export type InputFieldRoot = 'tyreSet' | 'vehicle' | 'condition' | 'rhRating' | 'rhNote' | 'meta';

/**
 * `inputFieldKey` naming conventions for {@link FieldMapping.inputFieldKey}.
 *
 * A key is a dotted path rooted at one of {@link InputFieldRoot}:
 *  - `tyreSet[i].<field>`         e.g. "tyreSet[0].make"
 *  - `vehicle.<field>`            e.g. "vehicle.frontAxlePressure"
 *  - `condition.<field>`          e.g. "condition.testDate"
 *  - `rhRating.<category>.<param>`  e.g. "rhRating.ride.smoothRoad"
 *  - `rhNote.<category>.<param>`    e.g. "rhNote.handling.rearTracking"
 *  - `meta.<field>`               e.g. "meta.customerName"
 *
 * These builders keep key construction in one place so producers (Mapping_Editor)
 * and consumers (Report_Generator) agree on the format.
 */
export const inputFieldKey = {
  tyreSet(index: number, field: keyof TyreSet): string {
    return `tyreSet[${index}].${field}`;
  },
  vehicle(field: keyof VehicleDetails): string {
    return `vehicle.${field}`;
  },
  condition(field: keyof TestConditions): string {
    return `condition.${field}`;
  },
  rhRating(category: 'ride' | 'handling', parameterName: string): string {
    return `rhRating.${category}.${parameterName}`;
  },
  rhNote(category: 'ride' | 'handling', parameterName: string): string {
    return `rhNote.${category}.${parameterName}`;
  },
  meta(field: string): string {
    return `meta.${field}`;
  },
} as const;

// Firebase backend wiring: SDK initialization (Auth, Firestore, Cloud
// Storage), environment-based config, the Firestore collection layout, and the
// Cloud Storage path convention. Consumed by both apps.
export * from './firebase';

// Auth_Service: Firebase-Auth-backed sign-in/out, current-user, auth-change
// subscription, single-role resolution, and the pure role-based access helper
// (Requirement 1). Consumed by both apps' route guards.
export * from './auth';

// Template & Mapping Engine — ingest side. Template structure extraction from
// uploaded workbooks (R2.2, R2.3, R2.5, R8.3).
export * from './template';

// Pure R&H subjective-rating logic: rating validation (R5.4) and category
// average derivation (R6.5). Consumed by both apps and the property tests.
export * from './rh/rating';

// Pure R&H_Parameter set selection: derive the active parameter set (and rating
// ranges) for a session from the selected Customer_Template's Field_Mappings,
// falling back to the default set when unmapped (R6.6, R6.7). Consumed by the
// Mobile_PWA capture UI and the property tests.
export * from './rh/parameterSet';

// Data-access layer - Mapping_Editor persistence (Laptop_Web_App): begin,
// loadExisting, and conflict-aware save over Firestore (R3.1, R3.4, R3.5, R3.6).
export * from './data-access/mappingEditor.index';

// Data-access layer - Template_Manager persistence (Laptop_Web_App): upload,
// list, inspect, and confirmation-gated delete over Firestore + Cloud Storage
// (R2.1, R2.4, R2.5, R2.6).
export * from './data-access/templateManager.index';

// Sync_Engine conflict merge: pure, per-field, latest-server-timestamp merge of
// two Test_Session versions that never discards R&H_Parameter notes (R7.4,
// R6.4, Property 12). Consumed by the Mobile_PWA Sync_Service as its
// MergeStrategy and by the property tests.
export * from './sync/mergeSession';

// Report_Generator — fidelity-by-preservation fill (Laptop_Web_App): load the
// original template workbook and write each mapped Test_Session value to its
// mapped (sheet, cell), preserving all non-mapped cells, formatting, and
// formulas (R7.2, R7.3, R7.7 / R8.1, R8.2, R8.4, R3.3, R3.7).
export * from './report/index';
