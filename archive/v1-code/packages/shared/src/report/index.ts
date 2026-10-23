// Report_Generator public surface — fidelity-by-preservation fill (task 10.1).
//
// A dedicated barrel scoped to the report-generation modules so it can be
// re-exported from `@rnh/shared` without editing a shared barrel owned by
// parallel tasks. Exposes the workbook loader + mapped-cell fill step and the
// pure inputFieldKey value resolver they build on.
export {
  fillWorkbook,
  loadWorkbook,
  type AppliedWrite,
  type FillResult,
  type FillWorkbookOptions,
  type GenerationWarning,
  type WorkbookBytes as ReportWorkbookBytes,
} from './fillWorkbook';

export {
  resolveFieldValue,
  hasValue,
  type ReportMeta,
  type ResolvedValue,
} from './resolveFieldValue';

export {
  generateReport,
  XLSX_MIME_TYPE,
  type GenerateReportOptions,
  type GenerateReportResult,
  type MissingRequiredField,
} from './generateReport';

export {
  suggestedFileName,
  REPORT_FILE_EXTENSION,
  type SuggestedFileNameInput,
} from './suggestedFileName';

export {
  buildReportPreview,
  type ReportPreview,
  type PreviewSheet,
  type PreviewCell,
  type BuildReportPreviewInput,
} from './reportPreview';

export {
  generateReportWithPreview,
  type GenerateReportWithPreviewOptions,
  type GeneratedReportWithPreview,
} from './generateReportWithPreview';
