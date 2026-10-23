// Report_Generator — full GeneratedReport assembly with filename + preview
// (task 10.8; R9.3, R9.4).
//
// generateReport (task 10.5) returns the pipeline's core output: the filled
// `.xlsx` bytes, the required-but-missing fields, and warnings. The design's
// GeneratedReport (design.md, Report_Generator) additionally carries a
// `suggestedFileName` (R9.3) and a `preview` (R9.4) for the export UI. This
// wrapper assembles those on top of the fill step's outcome without modifying
// generateReport or fillWorkbook — it reuses the same fill so the bytes, the
// missing report, and the preview all describe one consistent generation.
//
// Kept additive: callers that only need bytes + missing keep using
// generateReport; callers driving the download UX (task 16.1) use this to get
// the filename and preview alongside.

import { fillWorkbook, type WorkbookBytes } from './fillWorkbook';
import {
  XLSX_MIME_TYPE,
  type GenerateReportOptions,
  type MissingRequiredField,
} from './generateReport';
import { buildReportPreview, type ReportPreview } from './reportPreview';
import { suggestedFileName } from './suggestedFileName';
import type { FieldMapping, TestSession } from '../index';

/** Report-generation metadata plus the parts needed to name the file (R9.3). */
export interface GenerateReportWithPreviewOptions extends GenerateReportOptions {
  /**
   * Customer name for the suggested filename (R9.3). Falls back to
   * `meta.customerName` when omitted here.
   */
  customerName?: string;
}

/**
 * The full report output matching the design's GeneratedReport shape, with the
 * workbook delivered as raw bytes (wrap in a Blob for browser download:
 * `new Blob([bytes], { type: XLSX_MIME_TYPE })`).
 */
export interface GeneratedReportWithPreview {
  /** The serialized filled workbook as `.xlsx` bytes (R8.6, R9.1). */
  bytes: Uint8Array;
  /** The MIME type to tag a download Blob with (R9.1). */
  mimeType: typeof XLSX_MIME_TYPE;
  /** Deterministic `<customerName>_<testDate>.xlsx` download name (R9.3). */
  suggestedFileName: string;
  /** Required fields left blank in the workbook (R8.5). */
  missingRequiredFields: MissingRequiredField[];
  /** UI-renderable summary of the populated report (R9.4). */
  preview: ReportPreview;
}

function toUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

function describeMissing(mapping: FieldMapping): MissingRequiredField {
  return {
    inputFieldKey: mapping.inputFieldKey,
    sheetName: mapping.sheetName,
    cellAddress: mapping.cellAddress,
    label: `${mapping.sheetName}!${mapping.cellAddress} (${mapping.inputFieldKey})`,
  };
}

/**
 * Generates a report and assembles the design's full GeneratedReport (task
 * 10.8): the filled `.xlsx` bytes, the suggested download filename (R9.3), the
 * required-but-missing fields (R8.5), and a preview of the populated report
 * (R9.4).
 *
 * Runs the same fidelity-by-preservation fill as {@link generateReport}, then:
 *  - serializes the filled workbook to `.xlsx` bytes,
 *  - derives `<customerName>_<testDate>.xlsx` from the customer name (from
 *    `options.customerName`, falling back to `options.meta.customerName`) and
 *    the Test_Session's `conditions.testDate` (R9.3),
 *  - builds a per-sheet {@link ReportPreview} from the applied writes and the
 *    missing required fields (R9.4).
 *
 * @param bytes the original template workbook bytes.
 * @param mappings the template's Field_Mappings.
 * @param session the Test_Session providing values.
 * @param options report metadata plus the customer name for the filename.
 * @returns the full report output (bytes, filename, missing fields, preview).
 */
export async function generateReportWithPreview(
  bytes: WorkbookBytes,
  mappings: readonly FieldMapping[],
  session: TestSession,
  options: GenerateReportWithPreviewOptions = {},
): Promise<GeneratedReportWithPreview> {
  const { workbook, applied, missing, warnings: _warnings } = await fillWorkbook(
    bytes,
    mappings,
    session,
    options,
  );

  const missingRequiredFields = missing.map(describeMissing);
  const written = (await workbook.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;

  const customerName =
    options.customerName ?? (options.meta?.customerName as string | undefined) ?? '';

  return {
    bytes: toUint8Array(written),
    mimeType: XLSX_MIME_TYPE,
    suggestedFileName: suggestedFileName({
      customerName,
      testDate: session.conditions.testDate,
    }),
    missingRequiredFields,
    preview: buildReportPreview({ applied, missingRequiredFields }),
  };
}
