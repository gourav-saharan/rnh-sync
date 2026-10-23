// Report generation UI (Laptop_Web_App, task 16.1).
//
// The Report_Viewer picks a Customer_Template and a synced Test_Session, then
// generates a report the shared Report_Generator produces
// (generateReportWithPreview from @rnh/shared), and the panel:
//   - shows a preview of the populated report contents before download (R9.4),
//   - lists any required fields left blank (R8.5),
//   - downloads the .xlsx wrapped as a Blob tagged with XLSX_MIME_TYPE and
//     named with the suggested filename (customer name + test date) (R9.1,
//     R9.3), and
//   - on a generation failure, shows an explicit error and blocks download
//     (R9.2).
//
// The template + mappings + Test_Session all come from the injected live
// stores; the raw template workbook bytes come from an injectable loader that
// defaults to reading the stored original.xlsx from Cloud Storage. Everything
// is injectable so the component tests drive it with fakes and no Firebase.

import { useEffect, useMemo, useState } from 'react';
import {
  generateReportWithPreview,
  getFirebaseServices,
  templateStoragePath,
  XLSX_MIME_TYPE,
  type CustomerTemplateSummary,
  type FieldMapping,
  type GeneratedReportWithPreview,
  type TestSession,
} from '@rnh/shared';
import { createReportViewerStore, type ReportViewerStore } from '../data-access';

/** Loads the raw original.xlsx bytes for a template (for report generation). */
export type TemplateBytesLoader = (templateId: string) => Promise<Uint8Array>;

/** Triggers a browser download of a Blob with a given filename. */
export type Downloader = (blob: Blob, fileName: string) => void;

export interface ReportGenerationPanelProps {
  /** Live template + mapping source. Defaults to the shared report-viewer store. */
  reportViewerStore?: ReportViewerStore;
  /** Loads the template workbook bytes. Defaults to Cloud Storage getBytes. */
  loadTemplateBytes?: TemplateBytesLoader;
  /** Performs the download. Defaults to an anchor-click on an object URL. */
  download?: Downloader;
}

/** Default: fetch the stored original.xlsx bytes from Cloud Storage. */
async function defaultLoadTemplateBytes(templateId: string): Promise<Uint8Array> {
  const { getBytes, ref } = await import('firebase/storage');
  const { storage } = getFirebaseServices();
  const buffer = await getBytes(ref(storage, templateStoragePath(templateId)));
  return new Uint8Array(buffer);
}

/** Default download: object URL + programmatic anchor click (R9.1). */
function defaultDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * The report generation panel: template + session pickers, a Generate action,
 * the preview + missing-required-fields display, and a Download action.
 */
export function ReportGenerationPanel({
  reportViewerStore,
  loadTemplateBytes = defaultLoadTemplateBytes,
  download = defaultDownload,
}: ReportGenerationPanelProps): JSX.Element {
  const store = useMemo<ReportViewerStore>(
    () => reportViewerStore ?? createReportViewerStore(),
    [reportViewerStore],
  );

  const [templates, setTemplates] = useState<CustomerTemplateSummary[]>([]);
  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [sessionId, setSessionId] = useState('');

  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<GeneratedReportWithPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offTemplates = store.subscribeCustomerTemplates(
      (items) => setTemplates(items),
      (err) => setError(err.message),
    );
    const offSessions = store.subscribeTestSessions(
      (items) => setSessions(items),
      (err) => setError(err.message),
    );
    return () => {
      offTemplates();
      offSessions();
    };
  }, [store]);

  const selectedTemplate = templates.find((t) => t.templateId === templateId) ?? null;
  const selectedSession = sessions.find((s) => s.sessionId === sessionId) ?? null;

  async function handleGenerate(): Promise<void> {
    setError(null);
    setReport(null);
    if (!selectedTemplate || !selectedSession) {
      setError('Select both a template and a session.');
      return;
    }
    setGenerating(true);
    try {
      // Load the template's mappings, then the original workbook bytes, then
      // run the shared generator (fidelity-by-preservation fill + preview).
      const mappings = await loadMappings(store, templateId);
      const bytes = await loadTemplateBytes(templateId);
      const generated = await generateReportWithPreview(
        bytes,
        mappings,
        selectedSession,
        { customerName: selectedTemplate.customerName },
      );
      setReport(generated);
    } catch (cause) {
      // Generation failed: show an explicit error and leave no report to
      // download (R9.2).
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGenerating(false);
    }
  }

  function handleDownload(): void {
    if (!report) {
      return;
    }
    try {
      // Copy into a fresh ArrayBuffer-backed view so the Blob part is a plain
      // ArrayBufferView (the .xlsx download, R9.1).
      const part = new Uint8Array(report.bytes);
      const blob = new Blob([part], { type: XLSX_MIME_TYPE });
      download(blob, report.suggestedFileName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section aria-labelledby="report-generation-heading">
      <h2 id="report-generation-heading">Generate report</h2>

      {error !== null && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}

      <label>
        Template
        <select
          aria-label="Report template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">Select a template…</option>
          {templates.map((t) => (
            <option key={t.templateId} value={t.templateId}>
              {t.customerName}
            </option>
          ))}
        </select>
      </label>

      <label>
        Session
        <select
          aria-label="Report session"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
        >
          <option value="">Select a session…</option>
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.sessionId}
              {s.conditions?.testDate ? ` — ${s.conditions.testDate}` : ''}
            </option>
          ))}
        </select>
      </label>

      <button type="button" onClick={() => void handleGenerate()} disabled={generating}>
        {generating ? 'Generating…' : 'Generate'}
      </button>

      {report !== null && (
        <div aria-label="Report preview">
          <h3>Preview</h3>
          <p>{report.preview.totalPopulatedCells} populated cell(s).</p>

          {report.preview.sheets.map((sheet) => (
            <div key={sheet.sheetName} data-testid={`preview-sheet-${sheet.sheetName}`}>
              <h4>{sheet.sheetName}</h4>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Cell</th>
                    <th scope="col">Field</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.cells.map((cell) => (
                    <tr key={`${sheet.sheetName}-${cell.cellAddress}`}>
                      <td>{cell.cellAddress}</td>
                      <td>{cell.inputFieldKey}</td>
                      <td>{cell.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div aria-label="Missing required fields">
            <h4>Missing required fields</h4>
            {report.missingRequiredFields.length === 0 ? (
              <p>None — all required fields have values.</p>
            ) : (
              <ul>
                {report.missingRequiredFields.map((field) => (
                  <li key={`${field.sheetName}-${field.cellAddress}`}>{field.label}</li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" onClick={handleDownload}>
            Download {report.suggestedFileName}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Loads a template's Field_Mappings once from the live subscription. The
 * report generator needs a one-shot snapshot rather than an ongoing listener,
 * so this resolves on the first emission and unsubscribes.
 */
function loadMappings(
  store: ReportViewerStore,
  templateId: string,
): Promise<FieldMapping[]> {
  return new Promise<FieldMapping[]>((resolve, reject) => {
    let settled = false;
    const unsubscribe = store.subscribeFieldMappings(
      templateId,
      (items) => {
        if (settled) {
          return;
        }
        settled = true;
        // Defer unsubscribe so it is defined even for synchronous emissions.
        queueMicrotask(() => unsubscribe());
        resolve(items);
      },
      (err) => {
        if (settled) {
          return;
        }
        settled = true;
        queueMicrotask(() => unsubscribe());
        reject(err);
      },
    );
  });
}
