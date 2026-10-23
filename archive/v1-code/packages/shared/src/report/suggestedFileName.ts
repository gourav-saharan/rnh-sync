// Report_Generator — suggested download filename (task 10.8; R9.3).
//
// The design's GeneratedReport carries a `suggestedFileName` derived from the
// customer name plus the Test_Session test date (design.md, Report_Generator;
// R9.3, requirements 9.3: "name the downloaded file using the customer name and
// the Test_Session test date"). This module is the pure, deterministic helper
// that produces that name.
//
// It is intentionally side-effect-free and framework-agnostic so the export UI
// (task 16.1) and the download-filename property test (Property 17, task 10.9)
// can consume it directly. The shape is `<customerName>_<testDate>.xlsx`, with
// both parts sanitized so the result is safe to hand to a browser download or a
// filesystem write on any OS.

/** The extension the generated report is always saved with (R9.1). */
export const REPORT_FILE_EXTENSION = '.xlsx';

/** Fallback segment used when a source part sanitizes to nothing. */
const FALLBACK_SEGMENT = 'report';

/**
 * Characters that are illegal in filenames across common filesystems
 * (Windows/macOS/Linux) plus control characters. Windows is the strictest, so
 * matching its reserved set keeps the name portable: < > : " / \ | ? * and the
 * ASCII control range.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Sanitizes a single filename segment (the customer name or the test date):
 *  - trims surrounding whitespace,
 *  - replaces filesystem-illegal and control characters with `_`,
 *  - collapses internal whitespace runs to a single `_`,
 *  - collapses repeated `_` and trims leading/trailing separator/dot noise
 *    (Windows also forbids trailing dots/spaces).
 *
 * Returns an empty string when nothing usable remains; the caller substitutes a
 * fallback so the final filename is never empty or malformed.
 */
function sanitizeSegment(part: string): string {
  return part
    .trim()
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
}

/** Inputs for {@link suggestedFileName}. */
export interface SuggestedFileNameInput {
  /** The Customer_Template's customer name (R2.1). */
  customerName: string;
  /** The Test_Session's test date, e.g. "2026-09-15" (R6.3). */
  testDate: string;
}

/**
 * Builds the deterministic suggested download filename for a generated report
 * (R9.3): `<customerName>_<testDate>.xlsx`.
 *
 * Both the customer name and the test date are sanitized for filesystem-illegal
 * characters (see {@link sanitizeSegment}) so the result is portable across
 * Windows, macOS, and Linux and safe to use as a browser download name. If
 * either part sanitizes to nothing (e.g. an empty or symbol-only value), a
 * stable fallback (`report`) is substituted so the filename is always non-empty
 * and always ends in `.xlsx`.
 *
 * The function is pure and deterministic: identical inputs always yield an
 * identical name.
 *
 * @param input the customer name and Test_Session test date.
 * @returns a sanitized `<customerName>_<testDate>.xlsx` filename.
 */
export function suggestedFileName(input: SuggestedFileNameInput): string {
  const customer = sanitizeSegment(input.customerName ?? '') || FALLBACK_SEGMENT;
  const date = sanitizeSegment(input.testDate ?? '') || FALLBACK_SEGMENT;
  return `${customer}_${date}${REPORT_FILE_EXTENSION}`;
}
