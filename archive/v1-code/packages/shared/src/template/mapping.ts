// Template/mapping engine — ingest side: Field_Mapping creation, duplicate
// target-cell conflict detection, and merge-anchor resolution.
//
// This module implements the pure logic behind the Mapping_Editor described in
// design.md (Mapping_Editor section):
//
//   "createMapping(m: FieldMapping): MappingDraftResult"  (R3.2, R3.3, R3.5)
//
//   "If two distinct input fields map to the same template cell, the editor
//    shows a conflict warning, withholds only the conflicting mapping, and
//    saves the rest (R3.5)."
//
// and the cell-targeting note (design.md, "Design note on cell targeting"):
//
//   "Merged cells are always written to the top-left anchor cell of their
//    range... The engine resolves any mapped cellAddress that falls inside a
//    merged range to that range's anchor before writing."
//
// It is intentionally pure/side-effect-free: persistence to Firestore is a
// separate concern handled by the Mapping_Editor persistence layer (task 8.2).
//
// Requirements: 3.2 (create a Field_Mapping), 3.3 (target cells on any sheet),
// 3.5 (duplicate-target conflict: warn, withhold only the conflicting mapping,
// keep the rest).

import type { FieldMapping } from '../index';
import { mappingTargetKey } from '../index';

/** The reason a proposed Field_Mapping was withheld as a conflict (R3.5). */
export type MappingConflictReason = 'duplicate-target-cell';

/** A proposed Field_Mapping that conflicts with an already-accepted one (R3.5). */
export interface MappingConflict {
  mapping: FieldMapping;
  reason: MappingConflictReason;
}

/**
 * The outcome of drafting a set of Field_Mappings: the accepted mappings and
 * the conflicting ones that were withheld (design.md, Mapping_Editor).
 */
export interface MappingDraftResult {
  accepted: FieldMapping[];
  conflicts: MappingConflict[];
}

// ---------------------------------------------------------------------------
// A1 cell-address parsing (per-sheet addressing, design cell-targeting note)
// ---------------------------------------------------------------------------

/** A parsed A1 cell reference: 1-based row and column. */
interface CellRef {
  row: number;
  col: number;
}

/**
 * Converts a spreadsheet column letter run (e.g. "A", "Z", "AA") to a 1-based
 * column number. Case-insensitive: Excel references are case-insensitive.
 */
function columnLettersToNumber(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64); // 'A' -> 1
  }
  return col;
}

/**
 * Converts a 1-based column number back to its column letters (1 -> "A",
 * 26 -> "Z", 27 -> "AA").
 */
function columnNumberToLetters(col: number): string {
  let n = col;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// A1 cell reference: optional `$`, column letters, optional `$`, row digits.
const CELL_REF = /^\$?([A-Za-z]+)\$?([0-9]+)$/;

/**
 * Parses an A1 cell address (e.g. "C7", "$A$1") into a {@link CellRef}, or
 * returns `null` when the address is not a single-cell A1 reference.
 */
function parseCellRef(address: string): CellRef | null {
  const match = CELL_REF.exec(address.trim());
  if (!match) {
    return null;
  }
  const col = columnLettersToNumber(match[1]);
  const row = Number.parseInt(match[2], 10);
  if (col <= 0 || row <= 0) {
    return null;
  }
  return { row, col };
}

/** A parsed A1 range with its inclusive top-left / bottom-right corners. */
interface RangeBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * Parses an A1 range (e.g. "A1:D1") into its inclusive bounds, normalising so
 * `top`/`left` are the minima regardless of how the corners were written.
 * Returns `null` when the string is not a valid two-cell range.
 */
function parseRange(range: string): RangeBounds | null {
  const parts = range.trim().split(':');
  if (parts.length !== 2) {
    return null;
  }
  const a = parseCellRef(parts[0]);
  const b = parseCellRef(parts[1]);
  if (!a || !b) {
    return null;
  }
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

/** True when the cell falls within (or on the edge of) the range bounds. */
function cellWithin(cell: CellRef, bounds: RangeBounds): boolean {
  return (
    cell.row >= bounds.top &&
    cell.row <= bounds.bottom &&
    cell.col >= bounds.left &&
    cell.col <= bounds.right
  );
}

/**
 * Resolves a cell address to the top-left anchor of any merged range that
 * contains it, per the design's cell-targeting note: Excel stores a merged
 * region's value in its top-left anchor cell, so a mapping to any non-anchor
 * cell of a merge must be redirected to the anchor before writing.
 *
 * - If `cellAddress` falls inside one of `mergedRanges`, the returned address
 *   is that range's top-left anchor (in canonical uppercase A1 form).
 * - If it falls inside no range (or the address / ranges are unparseable), the
 *   original address is returned unchanged (trimmed).
 *
 * Cell addresses are compared case-insensitively (Excel A1 references are
 * case-insensitive).
 *
 * @param cellAddress An A1 address, e.g. "B1" or "$C$3".
 * @param mergedRanges A sheet's merged ranges in A1 notation, e.g. ["A1:D1"].
 * @returns The anchor address when inside a merge, else the original address.
 */
export function resolveMergeAnchor(
  cellAddress: string,
  mergedRanges: readonly string[],
): string {
  const cell = parseCellRef(cellAddress);
  if (!cell) {
    // Not a parseable single-cell reference; return as-is (trimmed).
    return cellAddress.trim();
  }

  for (const range of mergedRanges) {
    const bounds = parseRange(range);
    if (bounds && cellWithin(cell, bounds)) {
      return `${columnNumberToLetters(bounds.left)}${bounds.top}`;
    }
  }

  // Outside every merge: canonicalise to uppercase A1 so equal addresses that
  // differ only by case resolve identically.
  return `${columnNumberToLetters(cell.col)}${cell.row}`;
}

/**
 * Applies {@link resolveMergeAnchor} to a Field_Mapping's `cellAddress` using
 * the given sheet merges, returning a mapping whose `cellAddress` points at the
 * merge anchor (or the canonicalised original when not inside a merge).
 *
 * @param mapping The proposed Field_Mapping (R3.2).
 * @param mergedRangesBySheet Merged ranges keyed by sheet name; a mapping's
 *   sheet with no entry is treated as having no merges.
 */
export function resolveMappingAnchor(
  mapping: FieldMapping,
  mergedRangesBySheet: Readonly<Record<string, readonly string[]>>,
): FieldMapping {
  const merges = mergedRangesBySheet[mapping.sheetName] ?? [];
  const cellAddress = resolveMergeAnchor(mapping.cellAddress, merges);
  if (cellAddress === mapping.cellAddress) {
    return mapping;
  }
  return { ...mapping, cellAddress };
}

// ---------------------------------------------------------------------------
// Mapping creation + duplicate-target-cell conflict detection (R3.2, R3.5)
// ---------------------------------------------------------------------------

/**
 * Options for {@link createMapping}.
 */
export interface CreateMappingOptions {
  /**
   * Merged ranges keyed by sheet name (from {@link TemplateStructure}). When
   * provided, each proposed mapping's `cellAddress` is resolved to its merge
   * anchor before conflict detection, so two fields targeting different cells
   * of the same merged region are correctly detected as a duplicate-target
   * conflict (design cell-targeting note; R3.3).
   */
  mergedRangesBySheet?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Drafts a set of proposed Field_Mappings into accepted mappings and
 * withheld duplicate-target-cell conflicts (R3.2, R3.3, R3.5).
 *
 * Processing is order-sensitive and deterministic: proposals are considered in
 * order; the first mapping to claim a `(templateId, sheetName, cellAddress)`
 * target (after merge-anchor resolution) is accepted, and any later mapping
 * targeting the same cell is withheld as a `duplicate-target-cell` conflict.
 * This mirrors the design's "withhold only the conflicting mapping, save the
 * rest" behaviour (R3.5).
 *
 * The returned `accepted` mappings carry their merge-anchor-resolved
 * `cellAddress` so downstream persistence and report generation write to the
 * cell Excel actually stores the value in.
 *
 * @param proposed One or more proposed Field_Mappings (accepts a single
 *   mapping or an array, matching the design's `createMapping` surface).
 * @param options Optional merge information for anchor resolution.
 * @returns The {@link MappingDraftResult} of accepted mappings and conflicts.
 */
export function createMapping(
  proposed: FieldMapping | readonly FieldMapping[],
  options: CreateMappingOptions = {},
): MappingDraftResult {
  const proposals = Array.isArray(proposed)
    ? (proposed as readonly FieldMapping[])
    : [proposed as FieldMapping];
  const mergedRangesBySheet = options.mergedRangesBySheet ?? {};

  const accepted: FieldMapping[] = [];
  const conflicts: MappingConflict[] = [];
  const claimedTargets = new Set<string>();

  for (const original of proposals) {
    const mapping = resolveMappingAnchor(original, mergedRangesBySheet);
    const key = mappingTargetKey(mapping);

    if (claimedTargets.has(key)) {
      // A distinct earlier mapping already claimed this target cell (R3.5).
      conflicts.push({ mapping: original, reason: 'duplicate-target-cell' });
      continue;
    }

    claimedTargets.add(key);
    accepted.push(mapping);
  }

  return { accepted, conflicts };
}
