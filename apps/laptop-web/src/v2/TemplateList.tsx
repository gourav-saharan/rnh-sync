// Template Studio list (R2.6–R2.8): every Customer_Template with its latest
// published version, plus upload, duplicate and archive. Only
// Template_Admins can change anything (rules enforce it too).

import { useState } from 'react';
import { formatDate, plainError, useLaptop, useLiveTemplates } from './context';
import { UploadTemplateForm } from './UploadTemplateForm';
import { ConfirmDialog } from './ConfirmDialog';

export interface TemplateListProps {
  onOpen: (templateId: string) => void;
}

export function TemplateList({ onOpen }: TemplateListProps): JSX.Element {
  const { templates, user } = useLaptop();
  const live = useLiveTemplates();
  const isAdmin = true;
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [copying, setCopying] = useState<{
    tid: string;
    customerName: string;
    templateName: string;
  } | null>(null);

  const duplicate = async (tid: string, next: string, templateName: string) => {
    setCopying(null);
    if (!next.trim()) return;
    try {
      const copy = await templates.duplicate(tid, next, templateName, user.uid);
      onOpen(copy.templateId);
    } catch (err) {
      setError(plainError(err));
    }
  };

  const list = live.data.filter((t) => showArchived || !t.archived);

  return (
    <section className="l-page" aria-labelledby="tpl-heading">
      <div className="l-page__head">
        <h2 id="tpl-heading" className="l-page__title">
          Customer templates
        </h2>
        <label className="l-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{' '}
          Show archived
        </label>
      </div>

      {isAdmin ? (
        <UploadTemplateForm onCreated={onOpen} />
      ) : (
        <p className="l-alert">
          You can view templates. Creating and editing them needs the Template_Admin role.
        </p>
      )}

      {copying ? (
        <ConfirmDialog
          title="Duplicate template"
          confirmLabel="Create copy"
          inputLabel="Customer name for the copy"
          inputDefault={`${copying.customerName} (copy)`}
          onCancel={() => setCopying(null)}
          onConfirm={(name) => void duplicate(copying.tid, name, copying.templateName)}
        >
          <p>The copy starts as a draft with the same workbook, parameters and mappings.</p>
        </ConfirmDialog>
      ) : null}

      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {live.error ? <p className="l-alert l-alert--danger">{live.error}</p> : null}

      {live.loading ? (
        <p className="l-loading">Loading templates…</p>
      ) : list.length === 0 ? (
        <p className="l-empty">
          {live.data.length > 0
            ? 'All templates are archived. Tick "Show archived" to see them.'
            : isAdmin
              ? "No templates yet. Upload the customer's Excel report above."
              : 'No templates yet. Ask a Template Admin to upload one.'}
        </p>
      ) : (
        <div className="l-table-wrap">
          <table className="l-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Template</th>
                <th scope="col">Published</th>
                <th scope="col">Parameters</th>
                <th scope="col">Draft updated</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr
                  key={t.templateId}
                  className={`l-row-link ${t.archived ? 'l-row--muted' : ''}`}
                  onClick={() => onOpen(t.templateId)}
                >
                  <td>
                    <button
                      type="button"
                      className="l-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(t.templateId);
                      }}
                    >
                      {t.customerName}
                    </button>
                    {t.archived ? <span className="l-tag l-tag--muted">archived</span> : null}
                  </td>
                  <td>{t.templateName}</td>
                  <td>
                    {t.latestVersion > 0
                      ? `v${t.latestVersion} · ${formatDate(t.latestPublishedAt)}`
                      : 'Draft only'}
                  </td>
                  <td>{t.draft?.schema?.parameters?.length ?? 0}</td>
                  <td>{formatDate(t.draft.updatedAt)}</td>
                  <td className="l-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="l-btn l-btn--small"
                      onClick={() => onOpen(t.templateId)}
                    >
                      {isAdmin ? 'Edit' : 'View'}
                    </button>
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          className="l-btn l-btn--small l-btn--ghost"
                          onClick={() =>
                            setCopying({
                              tid: t.templateId,
                              customerName: t.customerName,
                              templateName: t.templateName,
                            })
                          }
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="l-btn l-btn--small l-btn--ghost"
                          onClick={() =>
                            void templates
                              .setArchived(t.templateId, !t.archived, user.uid)
                              .catch((err) => setError(plainError(err)))
                          }
                        >
                          {t.archived ? 'Restore' : 'Archive'}
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
