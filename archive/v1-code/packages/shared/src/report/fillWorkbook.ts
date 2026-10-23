// Report_Generator — fidelity-by-preservation workbook fill (task 10.1).
//
// This module implements the core of the Report Generation Pipeline described
// in design.md (Report Generation Pipeline):
//
//   1. Load original. Download the stored workbook and open it with ExcelJS.
//      Because the original bytes carry all styles, merges, sheet order, and
//      sheet names, opening and re-saving without structural edits preserves
//      them (R8.3, R8.6).
//   2. Resolve mappings per sheet. For each Field_Mapping, look up the
//      worksheet by `sheetName`, resolve `cellAddress` (accounting for merges),
//      and write the corresponding Test_Session value — and nothing else
//      (R8.2, R8.4).
//   3. Leave unmapped cells alone. Cells without a mapping retain their
//      original template content (R3.7).
//
// and the design's error-handling row:
//
//   "Sheet named in a mapping not found in template -> Skip that mapping,
//    record a generation warning surfaced in preview (R8.1, R8.3)."
//
// SCOPE (task 10.1): load the original workbook and write each mapped
// Test_Session value to its mapped (sheet, cell), preserving all non-mapped
// cells, formatting, and formulas. Missing-required-field collection and Blob
// serialization are task 10.5; this module returns the loaded workbook and the
// warnings/writes so that step can serialize and report on top of it.

// ExcelJS is imported type-only here so it is erased from the module graph at
// compile time. The actual (large) ExcelJS runtime is pulled in lazily via a
// dynamic import inside `loadWorkbook`, so it is not part of the initial
// application chunk and is only downloaded when a report is generated/previewed.
import type ExcelJS from 'exceljs';
import type { FieldMapping, TestSession } from '../index';
import { resolveMergeAnchor } from '../template/mapping';
import { hasValue, resolveFieldValue, type ReportMeta, type ResolvedValue } from './resolveFieldValue';

/**
 * The bytes of the original template workbook. Accepts the common in-browser
 * and in-Node representations so the same fill step works in the Laptop_Web_App
 * (Blob -> ArrayBuffer) and in tests/back-end (Buffer/Uint8Array).
 */
export type WorkbookBytes = ArrayBuffer | Uint8Array | Buffer;

/** A single cell write the fill step applied (mapping + resolved value). */
export interface AppliedWrite {
  mapping: FieldMapping;
  /** The sheet the value was written to. */
  sheetName: string;
  /** The merge-anchor-resolved A1 address the value was written to. */
  cellAddress: string;
  /** The value written into the cell. */
  value: string | number;
}

/** A non-fatal issue encountered while filling the workbook. */
export interface GenerationWarning {
  /** The mapping the warning is about. */
  mapping: FieldMapping;
  reason: 'sheet-not-found';
  message: string;
}

/** The outcome of filling a loaded workbook with a Test_Session's values. */
export interface FillResult {
  /** The loaded workbook with mapped cells written; unmapped cells untouched. */
  workbook: ExcelJS.Workbook;
  /** The writes that were applied (present values only). */
  applied: AppliedWrite[];
  /**
   * Required mappings whose Test_Session value was absent. The cell is left
   * blank; task 10.5 turns these into the reported `missingRequiredFields`.
   */
  missing: FieldMapping[];
  /** Non-fatal warnings, e.g. a mapping naming a sheet absent from the template. */
  warnings: GenerationWarning[];
}

/** Options for {@link fillWorkbook}. */
export interface FillWorkbookOptions {
  /** Report-generation metadata for `meta.*` input field keys. */
  meta?: ReportMeta;
}

/**
 * Loads a template workbook from raw bytes with ExcelJS, preserving styles,
 * merged cells, sheet names, and sheet order (fidelity-by-preservation).
 *
 * Kept separate so the fill step and other pipeline stages (preview,
 * serialization) can share one loader.
 *
 * @param bytes the original template workbook bytes.
 * @returns the loaded ExcelJS workbook.
 */
export async function loadWorkbook(bytes: WorkbookBytes): Promise<ExcelJS.Workbook> {
  // Lazily load the ExcelJS runtime so it stays out of the initial app chunk
  // (it is only needed once a report is actually generated or previewed).
  const { default: ExcelJSRuntime } = await import('exceljs');
  const workbook = new ExcelJSRuntime.Workbook();
  // ExcelJS's public signature names ArrayBuffer; the underlying reader also
  // accepts a Node Buffer/Uint8Array. Normalise to a Buffer for Node and pass
  // ArrayBuffers straight through in the browser.
  const input =
    bytes instanceof ArrayBuffer ? bytes : Buffer.from(bytes as Uint8Array | Buffer);
  await workbook.xlsx.load(input as ArrayBuffer);
  return workbook;
}

/**
 * Collects a worksheet's merged ranges in A1 notation (e.g. "A1:D1") so a
 * mapping's `cellAddress` can be resolved to its merge anchor before writing
 * (design "Design note on cell targeting").
 */
function mergedRangesOf(worksheet: ExcelJS.Worksheet): string[] {
  const modelMerges = (worksheet.model as unknown as { merges?: string[] }).merges;
  if (Array.isArray(modelMerges)) {
    return modelMerges;
  }
  const mergeMap = (worksheet as unknown as {
    _merges?: Record<string, { range?: string } | undefined>;
  })._merges;
  if (!mergeMap) {
    return [];
  }
  return Object.values(mergeMap)
    .map((m) => m?.range)
    .filter((r): r is string => typeof r === 'string');
}

/**
 * Writes a value into a cell without disturbing its formatting. Setting
 * `cell.value` on an ExcelJS cell replaces only the value and leaves the cell's
 * style intact, which is exactly the targeted-edit path the design relies on
 * for fidelity. Formula cells are only touched when they are actually mapped —
 * unmapped formula cells are never visited, so their formulas are preserved.
 */
function writeCell(worksheet: ExcelJS.Worksheet, address: string, value: string | number): void {
  worksheet.getCell(address).value = value;
}

/**
 * Fills a template workbook with a Test_Session's mapped values, preserving all
 * non-mapped cells, formatting, and formulas (task 10.1; R8.2, R8.4, R3.3, R3.7).
 *
 * For each Field_Mapping:
 *  - Resolve the worksheet by `sheetName`. If absent, skip the mapping and
 *    record a `sheet-not-found` warning (design error-handling row; R8.1).
 *  - Resolve `cellAddress` to its merge anchor for the target sheet.
 *  - Resolve the Test_Session value for the mapping's `inputFieldKey`. When a
 *    value is present, write it to the anchor cell (touching only that cell's
 *    value). When absent and the mapping is `required`, leave the cell blank
 *    and record it as missing (surfaced by task 10.5). When absent and not
 *    required, leave the cell as-is.
 *
 * The workbook is loaded from the original bytes and only mapped cells are
 * mutated, so sheets, sheet names, sheet order, merged ranges, cell formatting,
 * and every unmapped cell's content (including formulas) are preserved.
 *
 * @param bytes the original template workbook bytes.
 * @param mappings the template's Field_Mappings.
 * @param session the Test_Session providing values.
 * @param options optional report-generation metadata.
 * @returns the loaded workbook plus applied writes, missing required fields,
 *   and warnings.
 */
export async function fillWorkbook(
  bytes: WorkbookBytes,
  mappings: readonly FieldMapping[],
  session: TestSession,
  options: FillWorkbookOptions = {},
): Promise<FillResult> {
  const workbook = await loadWorkbook(bytes);
  const meta = options.meta ?? {};

  const applied: AppliedWrite[] = [];
  const missing: FieldMapping[] = [];
  const warnings: GenerationWarning[] = [];

  // Cache merged ranges per worksheet so we parse each sheet's merges once even
  // when many mappings target the same sheet.
  const mergesCache = new Map<string, string[]>();

  for (const mapping of mappings) {
    const worksheet = workbook.getWorksheet(mapping.sheetName);
    if (!worksheet) {
      // The named sheet is absent from the template: skip and warn (R8.1).
      warnings.push({
        mapping,
        reason: 'sheet-not-found',
        message:
          `Mapping "${mapping.inputFieldKey}" targets sheet "${mapping.sheetName}", ` +
          'which is not present in the template. The mapping was skipped.',
      });
      continue;
    }

    let merges = mergesCache.get(mapping.sheetName);
    if (!merges) {
      merges = mergedRangesOf(worksheet);
      mergesCache.set(mapping.sheetName, merges);
    }

    const anchorAddress = resolveMergeAnchor(mapping.cellAddress, merges);
    const value: ResolvedValue = resolveFieldValue(mapping.inputFieldKey, session, meta);

    if (!hasValue(value)) {
      // No value for this field. Leave the cell blank (do not touch it). Record
      // required-but-missing fields for task 10.5's reporting (R8.5).
      if (mapping.required) {
        missing.push(mapping);
      }
      continue;
    }

    // Write only the mapped cell's value, preserving its formatting (R8.2).
    writeCell(worksheet, anchorAddress, value as string | number);
    applied.push({
      mapping,
      sheetName: mapping.sheetName,
      cellAddress: anchorAddress,
      value: value as string | number,
    });
  }

  return { workbook, applied, missing, warnings };
}
