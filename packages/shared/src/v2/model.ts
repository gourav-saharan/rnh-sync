// R&H Tyre Testing System — v2 domain model (design.md v2 "Data Models").
//
// A Test_Session is a Rating_Matrix: R&H_Parameters (rows) x Tyre_Sets
// (columns), each cell holding a rating (or null = Unrated) and a comment.
// Everything here is pure TypeScript: no React, no Firebase.

export type Timestamp = number;

// ---------------------------------------------------------------------------
// Users and roles (R1.3)
// ---------------------------------------------------------------------------

export type Role = 'Tester' | 'Report_Viewer' | 'Template_Admin';
export const ALL_ROLES: readonly Role[] = ['Tester', 'Report_Viewer', 'Template_Admin'];

export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  roles: Role[];
  createdAt: Timestamp;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  roles: Role[];
}

export function hasRole(user: Pick<AppUser, 'roles'> | null | undefined, role: Role): boolean {
  return !!user && user.roles.includes(role);
}

// ---------------------------------------------------------------------------
// Template schema (R3)
// ---------------------------------------------------------------------------

export interface RatingScale {
  min: number;
  max: number;
  step: 0.25 | 0.5;
  pointLabels?: Record<string, string>;
}

export const DEFAULT_SCALE: RatingScale = {
  min: 1,
  max: 10,
  step: 0.25,
  pointLabels: {
    '10': 'excellent',
    '9': 'very good',
    '8': 'good',
    '7': 'satisfactory',
    '6': 'acceptable',
    '5': 'improvement necessary',
    '4': 'bad',
    '3': 'very bad',
  },
};

export const DEFAULT_QUICK_COMMENTS: readonly string[] = [
  'ok',
  'similar to ref',
  'slightly better',
  'slightly inferior',
  'better than ref',
  'inferior to ref',
  'slightly more',
  'more',
  'less',
  'at high speed',
  'at low speed',
];

export const DEFAULT_FILE_NAME_PATTERN = '{customer}_{vehicle}_{tyreSize}_{testDate} - R&H';

export interface CategoryDef {
  categoryId: string;
  name: string;
  order: number;
}

export interface ParameterDef {
  paramId: string;
  categoryId: string;
  name: string;
  shortName?: string;
  description?: string;
  weight?: number;
  order: number;
}

export type HeaderFieldType = 'text' | 'number' | 'date' | 'choice' | 'pressure';

export interface HeaderFieldDef {
  fieldId: string;
  label: string;
  type: HeaderFieldType;
  unit?: string;
  choices?: string[];
  required: boolean;
  defaultValue?: string | number;
  prefill?: 'today' | 'userDisplayName' | 'lastSession';
}

export type TyreDetailKey =
  | 'label'
  | 'make'
  | 'pattern'
  | 'size'
  | 'srlr'
  | 'weekCode'
  | 'dot'
  | 'compound'
  | 'airTempC'
  | 'roadTempC'
  | 'overallComment';

export const TYRE_DETAIL_KEYS: readonly TyreDetailKey[] = [
  'label',
  'make',
  'pattern',
  'size',
  'srlr',
  'weekCode',
  'dot',
  'compound',
  'airTempC',
  'roadTempC',
  'overallComment',
];

export const TYRE_DETAIL_LABELS: Record<TyreDetailKey, string> = {
  label: 'Label / group name',
  make: 'Tyre make',
  pattern: 'Pattern',
  size: 'Tyre size',
  srlr: 'SR / LR',
  weekCode: 'Week code',
  dot: 'DOT',
  compound: 'Compound',
  airTempC: 'Air temp °C',
  roadTempC: 'Road temp °C',
  overallComment: 'Overall comment',
};

export interface TemplateSchema {
  categories: CategoryDef[];
  parameters: ParameterDef[];
  headerFields: HeaderFieldDef[];
  scale: RatingScale;
  slotCount: number;
  quickComments: string[];
  fileNamePattern: string;
}

// ---------------------------------------------------------------------------
// Mappings (R4)
// ---------------------------------------------------------------------------

export interface BlockMapping {
  kind: 'block';
  mappingId: string;
  sheetName: string;
  rows: { row: number; paramId: string }[];
  firstSlot: number;
  slotCount: number;
  firstColumn: number;
  stride: number;
  ratingOffset: number;
  commentOffset: number | null;
}

export interface HeaderCellMapping {
  kind: 'header';
  mappingId: string;
  sheetName: string;
  cellAddress: string;
  fieldId: string;
}

export interface SlotCellMapping {
  kind: 'slotDetail';
  mappingId: string;
  sheetName: string;
  detail: TyreDetailKey;
  cells: { slot: number; cellAddress: string }[];
}

export type Mapping = BlockMapping | HeaderCellMapping | SlotCellMapping;

export type TargetSource =
  | { kind: 'rating'; paramId: string; slot: number }
  | { kind: 'comment'; paramId: string; slot: number }
  | { kind: 'header'; fieldId: string }
  | { kind: 'slotDetail'; detail: TyreDetailKey; slot: number };

export interface ResolvedTarget {
  sheetName: string;
  cellAddress: string;
  source: TargetSource;
  mappingId: string;
}

// ---------------------------------------------------------------------------
// Templates and versions (R2)
// ---------------------------------------------------------------------------

export interface SheetStructureV2 {
  name: string;
  index: number;
  rowCount: number;
  columnCount: number;
  mergedRanges: string[];
  /** A1 addresses holding formulas (R4.6, R11.4). */
  formulaCells: string[];
  /** 1-based index -> width in Excel character units (index 0 unused). */
  columnWidths: number[];
}

export interface TemplateStructureV2 {
  sheets: SheetStructureV2[];
}

export interface CustomerTemplateV2 {
  templateId: string;
  customerName: string;
  templateName: string;
  archived: boolean;
  latestVersion: number;
  latestPublishedAt: Timestamp | null;
  draft: {
    storagePath: string | null;
    workbookBytes?: unknown;
    structure: TemplateStructureV2 | null;
    schema: TemplateSchema;
    mappings: Mapping[];
    updatedAt: Timestamp;
    updatedBy: string;
  };
  createdBy: string;
  createdAt: Timestamp;
}

export interface TemplateVersion {
  templateId: string;
  customerName: string;
  templateName: string;
  version: number;
  storagePath: string;
  workbookBytes?: unknown;
  structure: TemplateStructureV2;
  schema: TemplateSchema;
  mappings: Mapping[];
  publishedBy: string;
  publishedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Test session (R5–R10)
// ---------------------------------------------------------------------------

export type SessionStatus = 'in_progress' | 'ready' | 'reported';

export interface TyreSetV2 {
  tyreSetId: string;
  slot: number;
  isReference: boolean;
  label: string;
  make: string;
  pattern: string;
  size: string;
  srlr: string;
  weekCode: string;
  dot: string;
  compound: string;
  airTempC: number | null;
  roadTempC: number | null;
  overallComment: string;
  photoPaths: string[];
}

export interface RatingCell {
  /** null = Unrated (R7.2). */
  rating: number | null;
  comment: string;
  updatedAt: Timestamp;
  updatedBy: string;
  /** Set when both devices edited the comment since last sync (R9.4). */
  conflict?: boolean;
}

export type HeaderValue = string | number | null;

export interface TestSessionV2 {
  sessionId: string;
  schemaVersion: 2;
  templateId: string;
  templateVersion: number;
  customerName: string;
  templateName: string;
  status: SessionStatus;
  createdBy: string;
  createdByName: string;
  assignedTo: string[];
  header: Record<string, HeaderValue>;
  tyreSets: Record<string, TyreSetV2>;
  cells: Record<string, RatingCell>;
  fieldTimestamps: Record<string, Timestamp>;
  progress: { rated: number; total: number };
  lastReport?: { at: Timestamp; by: string; templateVersion: number } | null;
  deletedAt: Timestamp | null;
  deletedBy: string | null;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
}

export type CaptureOrder = 'byTyre' | 'byParam';

export type LocalSyncState = 'saved_local' | 'syncing' | 'synced' | 'error';

export interface SessionCursor {
  paramId: string;
  tyreSetId: string;
  order: CaptureOrder;
  /** Last screen the Tester was on, for resume (R8.2). */
  screen: 'setup' | 'drive' | 'summary';
}

export interface LocalTestSessionV2 extends TestSessionV2 {
  dirtyPaths: string[];
  /** True until the first successful push (document does not exist remotely). */
  isNew: boolean;
  syncState: LocalSyncState;
  lastError: string | null;
  cursor: SessionCursor;
  /** Set when the server copy was trashed while local edits were pending (R13.3). */
  deletedOnServer?: boolean;
}

export interface HistoryEntry {
  path: string;
  before: unknown;
  after: unknown;
  by: string;
  byName: string;
  at: Timestamp;
}

// ---------------------------------------------------------------------------
// Keys and ids
// ---------------------------------------------------------------------------

const CELL_KEY_SEP = '__';

/** Rating_Matrix key for one (parameter, tyre set) pair. Ids never contain "__". */
export function cellKey(paramId: string, tyreSetId: string): string {
  return `${paramId}${CELL_KEY_SEP}${tyreSetId}`;
}

export function parseCellKey(key: string): { paramId: string; tyreSetId: string } | null {
  const i = key.indexOf(CELL_KEY_SEP);
  if (i <= 0 || i + CELL_KEY_SEP.length >= key.length) return null;
  return { paramId: key.slice(0, i), tyreSetId: key.slice(i + CELL_KEY_SEP.length) };
}

/** Random, URL/Firestore-path-safe id with a prefix, e.g. "t_k3f9x2". */
export function newId(prefix: string, length = 8): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (const b of bytes) out += alphabet[b % alphabet.length];
  } else {
    for (let i = 0; i < length; i += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  return `${prefix}_${out}`;
}

/** Turn a display name into a stable id fragment: "Smooth Road" -> "smoothRoad". */
export function slugId(prefix: string, name: string, taken: ReadonlySet<string>): string {
  const words = name
    .normalize('NFKD')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  const camel =
    words
      .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join('') || 'item';
  let id = `${prefix}_${camel}`;
  let n = 2;
  while (taken.has(id)) {
    id = `${prefix}_${camel}${n}`;
    n += 1;
  }
  return id;
}

/** Normalise free text for fuzzy matching of sheet labels to parameter names. */
export function normalizeLabel(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function emptySchema(): TemplateSchema {
  return {
    categories: [],
    parameters: [],
    headerFields: [],
    scale: { ...DEFAULT_SCALE, pointLabels: { ...DEFAULT_SCALE.pointLabels } },
    slotCount: 4,
    quickComments: [...DEFAULT_QUICK_COMMENTS],
    fileNamePattern: DEFAULT_FILE_NAME_PATTERN,
  };
}

/** Parameters sorted by category order, then parameter order. */
export function orderedParameters(schema: TemplateSchema): ParameterDef[] {
  const catOrder = new Map(schema.categories.map((c) => [c.categoryId, c.order]));
  return [...schema.parameters].sort(
    (a, b) =>
      (catOrder.get(a.categoryId) ?? 1e9) - (catOrder.get(b.categoryId) ?? 1e9) ||
      a.order - b.order,
  );
}

export function orderedCategories(schema: TemplateSchema): CategoryDef[] {
  return [...schema.categories].sort((a, b) => a.order - b.order);
}

/** Tyre sets sorted by slot. */
export function orderedTyreSets(session: Pick<TestSessionV2, 'tyreSets'>): TyreSetV2[] {
  return Object.values(session.tyreSets).sort((a, b) => a.slot - b.slot);
}

export function referenceSet(session: Pick<TestSessionV2, 'tyreSets'>): TyreSetV2 | undefined {
  return Object.values(session.tyreSets).find((t) => t.isReference);
}

export function displayName(p: ParameterDef): string {
  return p.shortName && p.shortName.trim() ? p.shortName : p.name;
}
