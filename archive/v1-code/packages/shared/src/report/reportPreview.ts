// Report_Generator — report preview summary (task 10.8; R9.4).
//
// The design's GeneratedReport carries a `preview: ReportPreview` describing the
// filled report so the Laptop_Web_App can show a Report_Viewer what the report
// contains before download (design.md, Report_Generator; R9.4, requirements
// 9.4: "display a preview of the report contents before download").
//
// This module is the pure builder for that preview. It derives a UI-renderable
// summary from the fill step's outcome (the `applied` writes + `missing`
// required fields from fillWorkbook / generateReport), grouping applied writes
// by sheet so the UI can render one section per populated sheet, and surfacing
// the required-but-missing fields alongside. It performs no I/O and mutates
// nothing, so the export UI (task 16.1) and its tests can consume it directly.

import type { AppliedWrite } from './fillWorkbook';
import type { MissingRequiredField } from './generateReport';

/** A single populated cell as shown in the preview. */
export interface PreviewCell {
  /** The merge-anchor-resolved A1 address the value landed in. */
  cellAddress: string;
  /** The Mobile_PWA input field key that supplied the value. */
  inputFieldKey: string;
  /** The value written into the cell, rendered as a string for display. */
  value: string;
}

/** The populated cells of one sheet, in the order they were written. */
export interface PreviewSheet {
  /** The worksheet name. */
  sheetName: string;
  /** The cells populated on this sheet (present values only). */
  cells: PreviewCell[];
}

/**
 * A UI-renderable summary of a generated report (R9.4). Groups the applied
 * writes by sheet (`sheets`), reports totals, and lists the required fields
 * that were left blank (`missingRequiredFields`) so the preview can both show
 * what will be in the file and warn about gaps before download.
 */
export interface ReportPreview {
  /** Populated sheets, in first-write order, each with its populated cells. */
  sheets: PreviewSheet[];
  /** Total number of cells populated across all sheets. */
  totalPopulatedCells: number;
  /** Names of the sheets that received at least one value, in order. */
  populatedSheetNames: string[];
  /** Required fields with no value; their cells were left blank (R8.5). */
  missingRequiredFields: MissingRequiredField[];
}

/** Inputs for {@link buildReportPreview}: the fill step's outcome. */
export interface BuildReportPreviewInput {
  /** The writes the fill step applied (present values only). */
  applied: readonly AppliedWrite[];
  /** The required fields left blank (R8.5). */
  missingRequiredFields: readonly MissingRequiredField[];
}

/**
 * Renders an applied write's value as a display string. Numbers are stringified
 * with their natural representation; strings pass through unchanged.
 */
function renderValue(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

/**
 * Builds a {@link ReportPreview} from the fill step's outcome (task 10.8; R9.4).
 *
 * Applied writes are grouped into one {@link PreviewSheet} per worksheet,
 * preserving the order sheets were first written and the order of writes within
 * each sheet, so the preview mirrors what the generated workbook contains. The
 * required-but-missing fields are carried through unchanged so the UI can list
 * the gaps the report was generated with.
 *
 * Pure and deterministic: the same applied/missing inputs always produce the
 * same preview.
 *
 * @param input the applied writes and missing required fields (from
 *   {@link generateReport} / {@link fillWorkbook}).
 * @returns the preview summary for the UI.
 */
export function buildReportPreview(input: BuildReportPreviewInput): ReportPreview {
  const sheets: PreviewSheet[] = [];
  const bySheet = new Map<string, PreviewSheet>();

  for (const write of input.applied) {
    let sheet = bySheet.get(write.sheetName);
    if (!sheet) {
      sheet = { sheetName: write.sheetName, cells: [] };
      bySheet.set(write.sheetName, sheet);
      sheets.push(sheet);
    }
    sheet.cells.push({
      cellAddress: write.cellAddress,
      inputFieldKey: write.mapping.inputFieldKey,
      value: renderValue(write.value),
    });
  }

  return {
    sheets,
    totalPopulatedCells: input.applied.length,
    populatedSheetNames: sheets.map((s) => s.sheetName),
    missingRequiredFields: [...input.missingRequiredFields],
  };
}
