// v2 workbook reader: turns uploaded .xlsx bytes into serialisable SheetGrids
// (values, formulas, merges, widths) for the Template Studio grid preview
// (R2.3), schema detection (R3.1) and formula protection (R4.6).
// ExcelJS is loaded lazily so it stays out of the initial app chunk.

import type ExcelJS from 'exceljs';
import { toA1 } from './a1';
import type { SheetStructureV2, TemplateStructureV2 } from './model';

export type WorkbookBytesV2 = ArrayBuffer | Uint8Array;

export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

export class TemplateFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateFileError';
  }
}

export interface GridCell {
  /** Display value: text, number, or null when empty. */
  v: string | number | null;
  /** Formula text without the leading "=", when the cell holds a formula. */
  f?: string;
}

export interface SheetGrid extends SheetStructureV2 {
  /** A1 -> cell, non-empty cells only. */
  cells: Record<string, GridCell>;
  /** 1-based index -> height in points (index 0 unused). */
  rowHeights: number[];
}

function toUint8(bytes: WorkbookBytesV2): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** Reject non-xlsx, encrypted and oversized files with a plain reason (R2.2). */
export function checkTemplateBytes(bytes: WorkbookBytesV2): void {
  const b = toUint8(bytes);
  if (b.length === 0) throw new TemplateFileError('The file is empty.');
  if (b.length > MAX_TEMPLATE_BYTES) {
    throw new TemplateFileError(
      'The file is larger than 10 MB. Remove images or unused sheets and try again.',
    );
  }
  // Password-protected workbooks are stored as an OLE compound file, not a ZIP.
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    throw new TemplateFileError(
      'The workbook is password-protected (or an old .xls file). Remove the password or save as .xlsx and upload again.',
    );
  }
  if (!(b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)) {
    throw new TemplateFileError('This is not an Excel .xlsx file.');
  }
}

export async function loadWorkbookV2(bytes: WorkbookBytesV2): Promise<ExcelJS.Workbook> {
  checkTemplateBytes(bytes);
  const { default: ExcelJSRuntime } = await import('exceljs');
  const wb = new ExcelJSRuntime.Workbook();
  try {
    const u8 = toUint8(bytes);
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    await wb.xlsx.load(ab);
  } catch {
    throw new TemplateFileError(
      'The workbook could not be read. It may be damaged; open and re-save it in Excel.',
    );
  }
  if (wb.worksheets.length === 0) throw new TemplateFileError('The workbook has no sheets.');
  return wb;
}

export function mergesOf(ws: ExcelJS.Worksheet): string[] {
  const model = (ws.model as unknown as { merges?: string[] }).merges;
  if (Array.isArray(model) && model.length > 0) return [...new Set(model)].sort();
  const map = (ws as unknown as { _merges?: Record<string, { range?: string } | undefined> })
    ._merges;
  const list = map
    ? Object.values(map)
        .map((m) => m?.range)
        .filter((r): r is string => !!r)
    : [];
  return [...new Set(list)].sort();
}

/** Excel default column width (characters) and row height (points). */
export const DEFAULT_COL_WIDTH = 8.43;
export const DEFAULT_ROW_HEIGHT = 15;

/** Formula text of a cell (without "="), including shared-formula cells. */
export function formulaOf(cell: ExcelJS.Cell): string | undefined {
  const v = cell.value as unknown;
  if (v && typeof v === 'object') {
    const o = v as { formula?: string; sharedFormula?: string };
    if (typeof o.formula === 'string' && o.formula) return o.formula;
    if (typeof o.sharedFormula === 'string') {
      const f = (cell as unknown as { formula?: string }).formula;
      return typeof f === 'string' && f ? f : `(shared ${o.sharedFormula})`;
    }
  }
  return undefined;
}

/** Plain display value of any ExcelJS cell value. */
export function displayValueOf(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const o = value as {
      richText?: { text: string }[];
      text?: unknown;
      result?: unknown;
      error?: string;
      formula?: string;
      sharedFormula?: string;
    };
    if (Array.isArray(o.richText)) {
      const t = o.richText.map((r) => r.text).join('');
      return t === '' ? null : t;
    }
    if (o.formula !== undefined || o.sharedFormula !== undefined) {
      return displayValueOf(o.result);
    }
    if (typeof o.error === 'string') return o.error;
    if (o.text !== undefined) return displayValueOf(o.text);
  }
  return null;
}

/** Read one worksheet into a serialisable grid. */
export function readSheet(ws: ExcelJS.Worksheet, index: number): SheetGrid {
  const cells: Record<string, GridCell> = {};
  const formulaCells: string[] = [];
  let maxRow = 0;
  let maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      // Non-master cells of a merge hold no value of their own.
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      const f = formulaOf(cell);
      const v = displayValueOf(cell.value);
      if (v === null && f === undefined) return;
      const address = toA1(r, c);
      cells[address] = f !== undefined ? { v, f } : { v };
      if (f !== undefined) formulaCells.push(address);
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    });
  });
  const mergedRanges = mergesOf(ws);
  const rowCount = Math.max(maxRow, ws.rowCount || 0);
  const columnCount = Math.max(maxCol, ws.columnCount || 0);
  const columnWidths: number[] = [0];
  for (let c = 1; c <= columnCount; c += 1) {
    const w = ws.getColumn(c).width;
    columnWidths.push(typeof w === 'number' && w > 0 ? w : DEFAULT_COL_WIDTH);
  }
  const rowHeights: number[] = [0];
  for (let r = 1; r <= rowCount; r += 1) {
    const h = ws.getRow(r).height;
    rowHeights.push(typeof h === 'number' && h > 0 ? h : DEFAULT_ROW_HEIGHT);
  }
  return {
    name: ws.name,
    index,
    rowCount,
    columnCount,
    mergedRanges,
    formulaCells: formulaCells.sort(),
    columnWidths,
    cells,
    rowHeights,
  };
}

/** Read every sheet of a workbook, in workbook order (R2.3). */
export async function readSheetGrids(bytes: WorkbookBytesV2): Promise<SheetGrid[]> {
  const wb = await loadWorkbookV2(bytes);
  return wb.worksheets.map((ws, i) => readSheet(ws, i));
}

/** The structure part of the grids (what gets stored on the template). */
export function structureOf(grids: readonly SheetGrid[]): TemplateStructureV2 {
  return {
    sheets: grids.map((g) => ({
      name: g.name,
      index: g.index,
      rowCount: g.rowCount,
      columnCount: g.columnCount,
      mergedRanges: [...g.mergedRanges],
      formulaCells: [...g.formulaCells],
      columnWidths: [...g.columnWidths],
    })),
  };
}

/** Text of a grid cell (trimmed), or '' when empty / numeric-only formula. */
export function cellText(grid: SheetGrid, address: string): string {
  const c = grid.cells[address];
  if (!c || c.v === null) return '';
  return String(c.v).replace(/\s+/g, ' ').trim();
}
