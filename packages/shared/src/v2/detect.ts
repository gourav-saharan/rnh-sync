// v2 schema + block detection from a customer sheet (R3.1, R3.2, R4.1, R4.2).
//
// proposeSchema: the Template_Admin selects the parameter-name column range
// (e.g. M&M "C8:C26", MSIL "B12:B31"); categories come from the (merged) label
// cells in the column to the left, section-heading and Average rows are
// excluded, and an adjacent "Weight" column is read (Hyundai).
//
// proposeBlock: the Template_Admin selects the rating table region; rows are
// bound to parameters by text match and the first column / stride / comment
// offset are read from the header row above ("Rating" or "Set A" labels).
// Pure: works on SheetGrid, no ExcelJS.

import { inRange, parseA1, parseRange, toA1, colToLetters } from './a1';
import type { SheetGrid } from './grid';
import { cellText } from './grid';
import {
  newId,
  normalizeLabel,
  slugId,
  type BlockMapping,
  type CategoryDef,
  type ParameterDef,
  type TemplateSchema,
} from './model';

export interface ExcludedRow {
  row: number;
  text: string;
  reason: 'average' | 'formula' | 'heading';
  /** Category the row would belong to, for re-inclusion. */
  categoryName: string;
}

export interface SchemaProposal {
  categories: CategoryDef[];
  parameters: ParameterDef[];
  excludedRows: ExcludedRow[];
  /** Sheet row of each proposed parameter (paramId -> row). */
  rowOf: Record<string, number>;
  weightColumn: number | null;
}

const AVERAGE_RE = /^(total\s+)?average\b/i;

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Label of the category cell covering `row` in `col` (merged ranges honoured). */
function categoryLabelAt(
  grid: SheetGrid,
  row: number,
  col: number,
): { text: string; startRow: number } | null {
  for (const range of grid.mergedRanges) {
    const r = parseRange(range);
    if (r && r.left <= col && r.right >= col && inRange({ row, col }, r)) {
      const text = singleLine(cellText(grid, toA1(r.top, r.left)));
      return text ? { text, startRow: r.top } : null;
    }
  }
  const text = singleLine(cellText(grid, toA1(row, col)));
  return text ? { text, startRow: row } : null;
}

function isHeadingText(name: string, categoryName: string): boolean {
  const n = normalizeLabel(name);
  const c = normalizeLabel(categoryName);
  if (!n) return false;
  if (c && (n === c || n.startsWith(c))) return true;
  // Short all-caps section labels such as "NVH".
  return /^[A-Z&]{2,5}$/.test(name.trim());
}

function rowHasFormula(grid: SheetGrid, row: number): boolean {
  return grid.formulaCells.some((a) => parseA1(a)?.row === row);
}

function findWeightColumn(
  grid: SheetGrid,
  nameCol: number,
  top: number,
  bottom: number,
): number | null {
  for (let col = nameCol + 1; col <= nameCol + 3; col += 1) {
    for (let row = Math.max(1, top - 2); row <= bottom; row += 1) {
      if (/^weights?$/i.test(cellText(grid, toA1(row, col)))) return col;
    }
  }
  return null;
}

/**
 * Propose Categories + R&H_Parameters from the parameter-name column range
 * (R3.1). Category labels are read from `categoryCol` (default: the column
 * left of the names). Average / formula / section-heading rows are excluded
 * and reported so the Template_Admin can re-include them (R3.2).
 */
export function proposeSchema(
  grid: SheetGrid,
  nameRange: string,
  categoryCol?: number,
): SchemaProposal {
  const range = parseRange(nameRange);
  if (!range) throw new Error(`"${nameRange}" is not a valid range.`);
  const nameCol = range.left;
  const catCol = categoryCol ?? Math.max(1, nameCol - 1);
  const weightColumn = findWeightColumn(grid, nameCol, range.top, range.bottom);

  const categories: CategoryDef[] = [];
  const parameters: ParameterDef[] = [];
  const excludedRows: ExcludedRow[] = [];
  const rowOf: Record<string, number> = {};
  const catIds = new Set<string>();
  const paramIds = new Set<string>();
  let current: CategoryDef | null = null;
  let currentKey = '';

  for (let row = range.top; row <= range.bottom; row += 1) {
    const label = catCol !== nameCol ? categoryLabelAt(grid, row, catCol) : null;
    if (label) {
      const key = `${label.startRow}:${normalizeLabel(label.text)}`;
      if (key !== currentKey) {
        const existing = categories.find(
          (c) => normalizeLabel(c.name) === normalizeLabel(label.text),
        );
        if (existing) {
          current = existing;
        } else {
          const categoryId = slugId('c', label.text, catIds);
          catIds.add(categoryId);
          current = { categoryId, name: label.text, order: categories.length };
          categories.push(current);
        }
        currentKey = key;
      }
    }
    const name = singleLine(cellText(grid, toA1(row, nameCol)));
    if (!name) continue;
    const categoryName = current?.name ?? '';
    if (AVERAGE_RE.test(name)) {
      excludedRows.push({ row, text: name, reason: 'average', categoryName });
      continue;
    }
    if (grid.cells[toA1(row, nameCol)]?.f !== undefined) {
      excludedRows.push({ row, text: name, reason: 'formula', categoryName });
      continue;
    }
    if (isHeadingText(name, categoryName)) {
      excludedRows.push({ row, text: name, reason: 'heading', categoryName });
      continue;
    }
    if (!current) {
      const categoryId = slugId('c', 'General', catIds);
      catIds.add(categoryId);
      current = { categoryId, name: 'General', order: categories.length };
      categories.push(current);
    }
    const paramId = slugId('p', name, paramIds);
    paramIds.add(paramId);
    const shortName = singleLine(name.replace(/\(.*$/, '')) || name;
    const param: ParameterDef = {
      paramId,
      categoryId: current.categoryId,
      name,
      order: parameters.filter((p) => p.categoryId === current!.categoryId).length,
    };
    if (shortName !== name) param.shortName = shortName;
    if (weightColumn !== null) {
      const w = grid.cells[toA1(row, weightColumn)]?.v;
      if (typeof w === 'number' && w > 0) param.weight = w;
    }
    parameters.push(param);
    rowOf[paramId] = row;
  }
  // Drop categories that ended up with no parameters (e.g. only headings).
  const used = new Set(parameters.map((p) => p.categoryId));
  const kept = categories.filter((c) => used.has(c.categoryId)).map((c, i) => ({ ...c, order: i }));
  // `rowHasFormula` is exposed for callers via excludedRows; keep a reference.
  void rowHasFormula;
  return { categories: kept, parameters, excludedRows, rowOf, weightColumn };
}

export interface SchemaProblem {
  kind: 'noParameters' | 'duplicateName' | 'emptyName' | 'badScale' | 'badSlotCount';
  message: string;
  paramId?: string;
}

/** Publish-blocking schema problems (R3.8). */
export function validateSchema(schema: TemplateSchema): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  if (schema.parameters.length === 0) {
    problems.push({ kind: 'noParameters', message: 'Add at least one R&H parameter.' });
  }
  const seen = new Map<string, string>();
  for (const p of schema.parameters) {
    if (!p.name.trim()) {
      problems.push({ kind: 'emptyName', paramId: p.paramId, message: 'A parameter has no name.' });
      continue;
    }
    const key = `${p.categoryId}|${normalizeLabel(p.name)}`;
    if (seen.has(key)) {
      const cat = schema.categories.find((c) => c.categoryId === p.categoryId)?.name ?? '';
      problems.push({
        kind: 'duplicateName',
        paramId: p.paramId,
        message: `"${p.name}" appears twice in ${cat || 'the same category'}.`,
      });
    } else {
      seen.set(key, p.paramId);
    }
  }
  const s = schema.scale;
  if (!(s.max > s.min) || !(s.step === 0.25 || s.step === 0.5)) {
    problems.push({
      kind: 'badScale',
      message: 'Rating scale needs max > min and step 0.25 or 0.5.',
    });
  }
  if (!Number.isInteger(schema.slotCount) || schema.slotCount < 1 || schema.slotCount > 20) {
    problems.push({ kind: 'badSlotCount', message: 'Tyre slot count must be between 1 and 20.' });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Block proposal (R4.1, R4.2)
// ---------------------------------------------------------------------------

export interface BlockProposal {
  mapping: BlockMapping;
  /** Sheet rows inside the region that were not bound to any parameter. */
  unboundRows: number[];
  /** Parameters with no row in this block. */
  unboundParamIds: string[];
  /** How the column layout was found. */
  layoutSource: 'header' | 'numeric' | 'default';
}

export interface ProposeBlockOptions {
  firstSlot?: number;
  /** Known paramId -> row from proposeSchema on the same sheet. */
  rowOf?: Record<string, number>;
}

function firstWord(text: string): string {
  const m = /[a-z]+/i.exec(text);
  return m ? m[0].toLowerCase() : '';
}

interface LayoutCandidate {
  firstColumn: number;
  stride: number;
  count: number;
}

/** Evenly spaced column groups from header rows above the region. */
function headerLayouts(
  grid: SheetGrid,
  top: number,
  left: number,
  right: number,
): LayoutCandidate[] {
  const out: LayoutCandidate[] = [];
  for (let row = top - 1; row >= Math.max(1, top - 8); row -= 1) {
    const groups = new Map<string, number[]>();
    for (let col = left; col <= right; col += 1) {
      const w = firstWord(cellText(grid, toA1(row, col)));
      if (!w) continue;
      groups.set(w, [...(groups.get(w) ?? []), col]);
    }
    for (const cols of groups.values()) {
      if (cols.length < 2) continue;
      const stride = cols[1] - cols[0];
      const even = cols.every((c, i) => i === 0 || c - cols[i - 1] === stride);
      if (!even || stride < 1) continue;
      out.push({ firstColumn: cols[0], stride, count: cols.length });
    }
  }
  return out;
}

/**
 * Choose the column layout: a header group that agrees with the numeric
 * rating columns wins; else the numeric layout (sample data present); else
 * the largest header group (blank template); else the region's left edge.
 */
function chooseLayout(
  headers: LayoutCandidate[],
  numeric: { firstColumn: number; stride: number } | null,
): { firstColumn: number; stride: number; source: 'header' | 'numeric' } | null {
  const byCount = [...headers].sort((a, b) => b.count - a.count);
  if (numeric) {
    const agree = byCount.find(
      (h) => h.firstColumn === numeric.firstColumn && h.stride === numeric.stride,
    );
    if (agree) return { ...agree, source: 'header' };
    return { ...numeric, source: 'numeric' };
  }
  return byCount[0] ? { ...byCount[0], source: 'header' } : null;
}

/** Columns in the region that hold numbers in the data rows. */
function numericLayout(
  grid: SheetGrid,
  rows: readonly number[],
  left: number,
  right: number,
): { firstColumn: number; stride: number } | null {
  const cols: number[] = [];
  for (let col = left; col <= right; col += 1) {
    if (
      rows.some(
        (r) => typeof grid.cells[toA1(r, col)]?.v === 'number' && !grid.cells[toA1(r, col)]?.f,
      )
    ) {
      cols.push(col);
    }
  }
  if (cols.length === 0) return null;
  if (cols.length === 1) return { firstColumn: cols[0], stride: 2 };
  return { firstColumn: cols[0], stride: Math.max(1, cols[1] - cols[0]) };
}

/**
 * Propose a Block_Mapping for the rating table in `region` (e.g. "E8:T26").
 * Rows are bound to parameters by matching the text left of the region to
 * parameter names (or via `rowOf`), the layout is read from the header row
 * above ("Rating", "Set A"...), falling back to numeric columns.
 */
export function proposeBlock(
  grid: SheetGrid,
  region: string,
  schema: Pick<TemplateSchema, 'parameters' | 'slotCount'>,
  options: ProposeBlockOptions = {},
): BlockProposal {
  const r = parseRange(region);
  if (!r) throw new Error(`"${region}" is not a valid range.`);
  const firstSlot = options.firstSlot ?? 1;

  const byRow = new Map<number, string>();
  if (options.rowOf) {
    for (const [paramId, row] of Object.entries(options.rowOf)) {
      if (row >= r.top && row <= r.bottom && schema.parameters.some((p) => p.paramId === paramId)) {
        byRow.set(row, paramId);
      }
    }
  }
  const used = new Set(byRow.values());
  const unboundRows: number[] = [];
  for (let row = r.top; row <= r.bottom; row += 1) {
    if (byRow.has(row)) continue;
    let bound: string | null = null;
    for (let col = 1; col < r.left && !bound; col += 1) {
      const text = normalizeLabel(cellText(grid, toA1(row, col)));
      if (!text) continue;
      const hit =
        schema.parameters.find((p) => !used.has(p.paramId) && normalizeLabel(p.name) === text) ??
        schema.parameters.find(
          (p) =>
            !used.has(p.paramId) &&
            !!p.shortName &&
            normalizeLabel(p.shortName).length >= 3 &&
            text.startsWith(normalizeLabel(p.shortName)),
        );
      if (hit) bound = hit.paramId;
    }
    if (bound) {
      byRow.set(row, bound);
      used.add(bound);
    } else if (
      grid.cells[toA1(row, 1)] ||
      Array.from({ length: r.left - 1 }, (_, i) => i + 1).some((c) => cellText(grid, toA1(row, c)))
    ) {
      unboundRows.push(row);
    }
  }
  const rows = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, paramId]) => ({ row, paramId }));

  let layoutSource: BlockProposal['layoutSource'] = 'default';
  let firstColumn = r.left;
  let stride = 2;
  const chosen = chooseLayout(
    headerLayouts(grid, r.top, r.left, r.right),
    numericLayout(
      grid,
      rows.map((x) => x.row),
      r.left,
      r.right,
    ),
  );
  if (chosen) {
    firstColumn = chosen.firstColumn;
    stride = chosen.stride;
    layoutSource = chosen.source;
  }

  const fits = Math.floor((r.right - firstColumn) / stride) + 1;
  const slotCount = Math.max(1, Math.min(fits, schema.slotCount - firstSlot + 1));
  const commentOffset = stride >= 2 ? 1 : null;

  const mapping: BlockMapping = {
    kind: 'block',
    mappingId: newId('m'),
    sheetName: grid.name,
    rows,
    firstSlot,
    slotCount,
    firstColumn,
    stride,
    ratingOffset: 0,
    commentOffset,
  };
  return {
    mapping,
    unboundRows,
    unboundParamIds: schema.parameters.filter((p) => !used.has(p.paramId)).map((p) => p.paramId),
    layoutSource,
  };
}

/** "E" style letter for a 1-based column, re-exported for UI labels. */
export const columnLetter = colToLetters;

export interface AutoDetectBlockResult {
  mapping: BlockMapping;
  gridIndex: number;
  sheetName: string;
  matchedCount: number;
}

/**
 * Scan grids to automatically detect a rating block matching the schema parameters.
 * Useful for 1-click mapping in Template Studio.
 */
export function autoDetectRatingBlock(
  grids: SheetGrid[],
  schema: Pick<TemplateSchema, 'parameters' | 'slotCount'>,
  options: { firstSlot?: number; skipSheets?: string[] } = {},
): AutoDetectBlockResult | null {
  if (!schema.parameters.length || !grids.length) return null;
  const skip = new Set(options.skipSheets ?? []);

  for (let gIdx = 0; gIdx < grids.length; gIdx += 1) {
    const grid = grids[gIdx];
    if (skip.has(grid.name)) continue;

    const colHits = new Map<number, { row: number; paramId: string }[]>();
    for (const a1 of Object.keys(grid.cells)) {
      const text = normalizeLabel(cellText(grid, a1));
      if (!text) continue;
      const hit = schema.parameters.find(
        (p) =>
          normalizeLabel(p.name) === text ||
          (p.shortName && normalizeLabel(p.shortName) === text),
      );
      if (hit) {
        const parsed = parseA1(a1);
        if (parsed) {
          const list = colHits.get(parsed.col) ?? [];
          list.push({ row: parsed.row, paramId: hit.paramId });
          colHits.set(parsed.col, list);
        }
      }
    }

    if (colHits.size === 0) continue;

    let bestCol = -1;
    let bestMatches: { row: number; paramId: string }[] = [];
    for (const [col, matches] of colHits.entries()) {
      if (matches.length > bestMatches.length) {
        bestCol = col;
        bestMatches = matches;
      }
    }

    if (bestMatches.length === 0) continue;

    const minRow = Math.min(...bestMatches.map((m) => m.row));
    const maxRow = Math.max(...bestMatches.map((m) => m.row));

    const maxCol = grid.columnCount || bestCol + 20;
    const startCol = bestCol + 1;
    const endCol = Math.min(startCol + 19, maxCol);
    if (startCol > endCol) continue;

    const candidateRegion = `${colToLetters(startCol)}${minRow}:${colToLetters(endCol)}${maxRow}`;
    try {
      const proposal = proposeBlock(grid, candidateRegion, schema, {
        firstSlot: options.firstSlot ?? 1,
      });
      if (proposal.mapping.rows.length > 0) {
        return {
          mapping: proposal.mapping,
          gridIndex: gIdx,
          sheetName: grid.name,
          matchedCount: proposal.mapping.rows.length,
        };
      }
    } catch {
      // Continue searching
    }
  }

  return null;
}

