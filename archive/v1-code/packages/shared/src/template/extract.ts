// Template/mapping engine — ingest side: template structure extraction.
//
// This module implements the first step of the Template & Mapping Engine
// described in design.md (Template & Mapping Engine, Components section):
//
//   "On upload, ExcelJS parses the workbook. The engine extracts
//    TemplateStructure (ordered sheet names, per-sheet dimensions, merged
//    ranges) and stores the raw blob unchanged in Cloud Storage."
//
// It is intentionally pure/side-effect-free: it takes workbook bytes and
// returns a TemplateStructure (or throws a descriptive error for invalid
// input). Persisting the blob and metadata is a separate concern handled by
// the Template_Manager (task 8.1).
//
// Requirements: 2.2 (preserve all sheets and names), 2.3 (reject invalid
// .xlsx with a descriptive error), 2.5 (sheet dimensions), 8.3 (preserve
// sheet order / structure).

// ExcelJS is imported type-only so it is erased at compile time; the runtime is
// loaded lazily via a dynamic import inside `extractTemplateStructure`, keeping
// the large ExcelJS library out of the initial application chunk.
import type ExcelJS from 'exceljs';
import type { SheetStructure, TemplateStructure } from '../index';

/**
 * Error thrown when an uploaded file cannot be parsed as a valid `.xlsx`
 * workbook. Carries a descriptive, user-facing message (R2.3).
 */
export class InvalidTemplateFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'InvalidTemplateFileError';
    if (options?.cause !== undefined) {
      // Preserve the underlying error for diagnostics without leaking it into
      // the user-facing message.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * The bytes of an uploaded workbook. Accepts the common in-browser and
 * in-Node representations so the same extractor works in the Laptop_Web_App
 * (File/Blob -> ArrayBuffer) and in tests/back-end (Buffer/Uint8Array).
 */
export type WorkbookBytes = ArrayBuffer | Uint8Array | Buffer;

// The first four bytes of any ZIP-based file (and therefore any real .xlsx,
// which is a ZIP container): "PK\x03\x04". A plain-text or otherwise non-xlsx
// file will not carry this signature, letting us reject obvious junk before
// handing it to the parser.
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/**
 * Normalises the accepted byte representations to a Node `Buffer`, which is
 * what ExcelJS's `xlsx.load` consumes.
 */
function toBuffer(bytes: WorkbookBytes): Buffer {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes);
  }
  // ArrayBuffer
  return Buffer.from(new Uint8Array(bytes));
}

/**
 * Quick structural check: does the buffer begin with the ZIP local-file-header
 * signature that every real `.xlsx` (a ZIP container) starts with? This gives
 * a fast, descriptive rejection for plainly-invalid input (e.g. a `.txt` or
 * `.csv` renamed to `.xlsx`, or an empty file) before the heavier parse.
 */
function hasZipSignature(buf: Buffer): boolean {
  if (buf.length < ZIP_SIGNATURE.length) {
    return false;
  }
  return ZIP_SIGNATURE.every((byte, i) => buf[i] === byte);
}

/**
 * Extracts the {@link SheetStructure} for a single worksheet.
 *
 * - `name` and `index` (worksheet order) preserve sheet identity and order
 *   (R2.2, R8.3). ExcelJS worksheets carry a 1-based `orderNo`/position; we
 *   normalise to a zero-based `index` matching {@link SheetStructure.index}.
 * - `rowCount` / `columnCount` are the used cell dimensions (R2.5).
 * - `mergedRanges` are the A1-notation merge ranges (e.g. "A1:D1"), sorted for
 *   a stable, comparable ordering.
 */
function extractSheet(worksheet: ExcelJS.Worksheet, index: number): SheetStructure {
  // ExcelJS exposes merged ranges as full A1 range strings (e.g. "A1:D1")
  // through `worksheet.model.merges`. The internal `_merges` map is keyed by
  // anchor cell only, so we prefer the model's ranges. Each `_merges` value
  // also carries the full range, giving a robust fallback.
  const modelMerges = (worksheet.model as unknown as { merges?: string[] }).merges;
  let mergedRanges: string[];
  if (Array.isArray(modelMerges) && modelMerges.length > 0) {
    mergedRanges = modelMerges;
  } else {
    const mergeMap = (worksheet as unknown as {
      _merges?: Record<string, { range?: string } | undefined>;
    })._merges;
    mergedRanges = mergeMap
      ? Object.values(mergeMap)
          .map((m) => m?.range)
          .filter((r): r is string => typeof r === 'string')
      : [];
  }
  // De-duplicate (the anchor-keyed map can repeat a range) for stability.
  mergedRanges = [...new Set(mergedRanges)];

  return {
    name: worksheet.name,
    index,
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    mergedRanges: [...mergedRanges].sort(),
  };
}

/**
 * Parses an uploaded workbook and extracts its {@link TemplateStructure}:
 * ordered sheet names, per-sheet row/column dimensions, and merged ranges
 * (R2.2, R2.5, R8.3).
 *
 * Validates that the input is a real `.xlsx` workbook and rejects invalid
 * files with a descriptive {@link InvalidTemplateFileError} (R2.3).
 *
 * @param bytes The raw workbook bytes (ArrayBuffer, Uint8Array, or Buffer).
 * @returns The extracted template structure with sheets in source order.
 * @throws {InvalidTemplateFileError} when the bytes are not a valid `.xlsx`
 *   workbook, or when the workbook contains no worksheets.
 */
export async function extractTemplateStructure(
  bytes: WorkbookBytes,
): Promise<TemplateStructure> {
  const buffer = toBuffer(bytes);

  if (buffer.length === 0) {
    throw new InvalidTemplateFileError(
      'The uploaded file is empty and is not a valid .xlsx workbook.',
    );
  }

  if (!hasZipSignature(buffer)) {
    throw new InvalidTemplateFileError(
      'The uploaded file is not a valid .xlsx workbook. Expected an Excel ' +
        'workbook (.xlsx), but the file does not have the expected format.',
    );
  }

  // Lazily load the ExcelJS runtime so it stays out of the initial app chunk
  // (it is only needed when a template workbook is actually parsed).
  const { default: ExcelJSRuntime } = await import('exceljs');
  const workbook = new ExcelJSRuntime.Workbook();
  try {
    // ExcelJS types accept a Node Buffer here even though the public signature
    // names ArrayBuffer; the underlying reader handles Buffer.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (cause) {
    throw new InvalidTemplateFileError(
      'The uploaded file could not be read as a valid .xlsx workbook. It may ' +
        'be corrupt or in an unsupported format.',
      { cause },
    );
  }

  // A workbook with no worksheets cannot be used as a report template.
  const worksheets = workbook.worksheets;
  if (worksheets.length === 0) {
    throw new InvalidTemplateFileError(
      'The uploaded workbook contains no sheets and cannot be used as a template.',
    );
  }

  // Preserve source sheet order (R2.2, R8.3). ExcelJS returns worksheets in
  // their workbook order; we assign a zero-based index reflecting that order.
  const sheets: SheetStructure[] = worksheets.map((worksheet, i) =>
    extractSheet(worksheet, i),
  );

  return { sheets };
}
