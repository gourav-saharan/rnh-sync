// Template_Manager UI (Laptop_Web_App, task 16.1).
//
// The Report_Viewer's surface for managing Customer_Templates (R2.1, R2.4,
// R2.5, R2.6):
//   - upload a .xlsx as a new Customer_Template for a named customer (R2.1),
//     with the shared Template_Manager rejecting invalid files with a
//     descriptive error it surfaces here (R2.3),
//   - list stored templates with customer name + upload date (R2.4) — live via
//     the injected subscribe function so uploads/deletes elsewhere appear
//     without a reload,
//   - inspect a selected template's sheets and cell dimensions (R2.5),
//   - delete a template behind an explicit confirmation (R2.6).
//
// All persistence is delegated to the shared Template_Manager
// (createTemplateManager from @rnh/shared) and the laptop data-access live
// listener (subscribeCustomerTemplates). Both are injectable so the component
// tests drive it with fakes and no Firebase.

import { useEffect, useMemo, useState } from 'react';
import {
  createTemplateManager,
  type CustomerTemplateSummary,
  type TemplateManager,
  type TemplateStructure,
} from '@rnh/shared';
import { createReportViewerStore, type ReportViewerStore } from '../data-access';

export interface TemplateManagerPanelProps {
  /** Persistence surface. Defaults to the shared, env-initialized manager. */
  templateManager?: TemplateManager;
  /** Live template list source. Defaults to the shared report-viewer store. */
  reportViewerStore?: ReportViewerStore;
}

function formatDate(millis: number): string {
  if (!millis) {
    return '—';
  }
  return new Date(millis).toLocaleString();
}

/**
 * The Template_Manager panel. Renders the upload form, the live template list,
 * an inspect view of the selected template, and a confirmation-gated delete.
 */
export function TemplateManagerPanel({
  templateManager,
  reportViewerStore,
}: TemplateManagerPanelProps): JSX.Element {
  const manager = useMemo<TemplateManager>(
    () => templateManager ?? createTemplateManager(),
    [templateManager],
  );
  const store = useMemo<ReportViewerStore>(
    () => reportViewerStore ?? createReportViewerStore(),
    [reportViewerStore],
  );

  const [templates, setTemplates] = useState<CustomerTemplateSummary[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [inspectId, setInspectId] = useState<string | null>(null);
  const [structure, setStructure] = useState<TemplateStructure | null>(null);
  const [inspecting, setInspecting] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = store.subscribeCustomerTemplates(
      (items) => {
        setTemplates(items);
        setLoaded(true);
      },
      (err) => {
        setError(err.message);
        setLoaded(true);
      },
    );
    return unsubscribe;
  }, [store]);

  async function handleUpload(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!file) {
      setError('Choose an .xlsx file to upload.');
      return;
    }
    if (customerName.trim() === '') {
      setError('Enter a customer name.');
      return;
    }
    setUploading(true);
    try {
      const created = await manager.upload(file, customerName.trim());
      setNotice(`Uploaded template for ${created.customerName}.`);
      setCustomerName('');
      setFile(null);
    } catch (cause) {
      // Invalid .xlsx and other upload errors surface with their descriptive
      // message (R2.3).
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  }

  async function handleInspect(templateId: string): Promise<void> {
    setError(null);
    setInspectId(templateId);
    setInspecting(true);
    setStructure(null);
    try {
      setStructure(await manager.inspect(templateId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInspecting(false);
    }
  }

  async function confirmDelete(templateId: string): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      // Confirmation-gated deletion (R2.6): only reached after the user
      // confirms in the inline prompt below.
      await manager.delete(templateId, true);
      setNotice('Template deleted.');
      if (inspectId === templateId) {
        setInspectId(null);
        setStructure(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <section aria-labelledby="template-manager-heading">
      <h2 id="template-manager-heading">Templates</h2>

      {error !== null && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" style={{ color: '#0a6b0a' }}>
          {notice}
        </p>
      )}

      <form
        aria-label="Upload template"
        onSubmit={(e) => {
          e.preventDefault();
          void handleUpload();
        }}
      >
        <label>
          Customer name
          <input
            type="text"
            aria-label="Customer name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </label>
        <label>
          Template file
          <input
            type="file"
            aria-label="Template file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload template'}
        </button>
      </form>

      {!loaded && <p className="loading-indicator">Loading templates…</p>}

      <ul aria-label="Template list">
        {loaded && templates.length === 0 && (
          <li className="state-note">No templates uploaded yet.</li>
        )}
        {templates.map((template) => (
          <li key={template.templateId} data-testid={`template-${template.templateId}`}>
            <span>{template.customerName}</span>
            <span> — uploaded {formatDate(template.uploadDate)}</span>
            <button type="button" onClick={() => void handleInspect(template.templateId)}>
              Inspect
            </button>
            {pendingDeleteId === template.templateId ? (
              <>
                <span role="status">Delete {template.customerName}?</span>
                <button
                  type="button"
                  onClick={() => void confirmDelete(template.templateId)}
                >
                  Confirm delete
                </button>
                <button type="button" onClick={() => setPendingDeleteId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setPendingDeleteId(template.templateId)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {inspectId !== null && (
        <div aria-label="Template structure">
          <h3>Structure</h3>
          {inspecting && <p className="loading-indicator">Inspecting…</p>}
          {structure !== null && (
            <ul>
              {structure.sheets.map((sheet) => (
                <li key={sheet.index}>
                  {sheet.name}: {sheet.rowCount} rows × {sheet.columnCount} columns
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
