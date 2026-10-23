// Report_Generator — missing-required-field reporting + workbook serialization
// (task 10.5).
//
// This module sits on top of the fidelity-by-preservation fill step
// (fillWorkbook, task 10.1) and completes the Report Generation Pipeline of the
// design (design.md, "Report_Generator (Laptop_Web_App)"):
//
//   - fillWorkbook loads the original template bytes, writes each mapped
//     Test_Session value into its mapped (sheet, cell), leaves unmapped cells
//     untouched, and — for every `required` mapping whose value was absent —
//     leaves the cell blank and collects the mapping into `missing` (R8.2,
//     R8.4, R8.5).
//   - This step turns that outcome into the pipeline's output: it serializes
//     the filled workbook to `.xlsx` bytes (usable as a Blob in the browser,
//     R8.6/R9.1) and describes each required-but-missing field so the UI can
//     list them (R8.5).
//
// It maps onto the design's `GeneratedReport` shape:
//
//   interface GeneratedReport {
//     workbookBlob: Blob;              // .xlsx (R9.1)
//     suggestedFileName: string;       // customerName + testDate (R9.3)
//     missingRequiredFields: string[]; // R8.5
//     preview: ReportPreview;          // R9.4
//   }
//
// SCOPE (task 10.5): the bytes + `missingRequiredFields` report + warnings.
// The Blob wrapper, suggested file name (R9.3), and preview (R9.4) are later
// UI/export tasks that consume these bytes; keeping serialization here as raw
// bytes lets both the browser (new Blob([bytes])) and Node consume the result.

import { fillWorkbook, type FillWorkbookOptions, type GenerationWarning, type WorkbookBytes } from './fillWorkbook';
import type { FieldMapping, TestSession } from '../index';

/**
 * A single required field that had no value on the Test_Session and was left
 * blank in the generated workbook (R8.5). Carries enough to identify the field
 * in the UI (the human-facing key) and to locate the blank cell in the output.
 */
export interface MissingRequiredField {
  /** The mapping's Mobile_PWA input field key, e.g. "tyreSet[0].make". */
  inputFieldKey: string;
  /** The sheet holding the cell that was left blank. */
  sheetName: string;
  /** The A1 address of the cell that was left blank. */
  cellAddress: string;
  /** A user-facing description, e.g. `Ratings!C7 (rhRating.ride.Smooth Road)`. */
  label: string;
}

/** The outcome of generating a report from a template + Test_Session. */
export interface GenerateReportResult {
  /**
   * The serialized filled workbook as `.xlsx` bytes. In the Laptop_Web_App wrap
   * these in a Blob for download: `new Blob([bytes], { type: XLSX_MIME_TYPE })`
   * (R8.6, R9.1). In Node they are usable directly as a buffer.
   */
  bytes: Uint8Array;
  /**
   * Each `required` field the Test_Session had no value for; the corresponding
   * cell was left blank in `bytes` (R8.5).
   */
  missingRequiredFields: MissingRequiredField[];
  /**
   * Non-fatal issues from the fill step, e.g. a mapping naming a sheet absent
   * from the template (R8.1). Surfaced alongside the report.
   */
  warnings: GenerationWarning[];
}

/**
 * The MIME type of an `.xlsx` (Office Open XML spreadsheet) workbook. Callers
 * building a browser Blob for download should tag it with this type (R9.1).
 */
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Options for {@link generateReport}. Forwarded to the underlying fill step. */
export type GenerateReportOptions = FillWorkbookOptions;

/**
 * Builds a user-facing label for a missing required field: the blank cell's
 * `Sheet!Address` followed by the input field key, so a Report_Viewer can see
 * both which field is missing and where the blank landed.
 */
function describeMissing(mapping: FieldMapping, cellAddress: string): MissingRequiredField {
  return {
    inputFieldKey: mapping.inputFieldKey,
    sheetName: mapping.sheetName,
    cellAddress,
    label: `${mapping.sheetName}!${cellAddress} (${mapping.inputFieldKey})`,
  };
}

/**
 * Normalizes ExcelJS's `writeBuffer()` output to a `Uint8Array`. ExcelJS types
 * the return as an ArrayBuffer-like `Buffer`; a Node `Buffer` already is a
 * `Uint8Array`, while a plain `ArrayBuffer` needs wrapping. This keeps the
 * result usable both as a browser `Blob` part and as Node bytes.
 */
function toUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

/**
 * Generates a report by filling the template workbook with a Test_Session's
 * mapped values and serializing the result to `.xlsx` bytes (task 10.5; R8.5,
 * R8.6, R9.1).
 *
 * Delegates the actual cell writing to {@link fillWorkbook} (fidelity by
 * preservation: only mapped cells are touched, everything else — sheets, sheet
 * order, merged cells, formatting, formulas — is preserved). It then:
 *  - Collects every `required` mapping whose value was absent into
 *    `missingRequiredFields`, each described with its blank cell location and
 *    input field key. Those cells are left blank in the output (R8.5).
 *  - Serializes the filled workbook via `workbook.xlsx.writeBuffer()` and
 *    returns the bytes (a `Uint8Array` usable as a browser `Blob` part) so the
 *    export/download step can deliver an `.xlsx` (R8.6, R9.1).
 *  - Passes through the fill step's non-fatal warnings (e.g. a mapping naming a
 *    sheet not present in the template, R8.1).
 *
 * @param bytes the original template workbook bytes.
 * @param mappings the template's Field_Mappings.
 * @param session the Test_Session providing values.
 * @param options optional report-generation metadata (forwarded to the fill step).
 * @returns the serialized workbook bytes, the missing-required-field report,
 *   and any warnings.
 */
export async function generateReport(
  bytes: WorkbookBytes,
  mappings: readonly FieldMapping[],
  session: TestSession,
  options: GenerateReportOptions = {},
): Promise<GenerateReportResult> {
  const { workbook, missing, warnings } = await fillWorkbook(bytes, mappings, session, options);

  // The fill step already left required-but-missing cells blank; describe each
  // so the UI can list them (R8.5). Resolve the same merge anchor the fill step
  // would have written to for an accurate blank-cell location is not needed —
  // fillWorkbook records the mapping, and we report its mapped cellAddress.
  const missingRequiredFields = missing.map((mapping) =>
    describeMissing(mapping, mapping.cellAddress),
  );

  // Serialize the filled workbook to .xlsx bytes. Re-saving the loaded workbook
  // preserves its structure/formatting and yields a file Excel opens without a
  // repair prompt (R8.6).
  const written = (await workbook.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;

  return {
    bytes: toUint8Array(written),
    missingRequiredFields,
    warnings,
  };
}
