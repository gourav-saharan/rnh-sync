// Report_Viewer workspace (Laptop_Web_App, task 16.1).
//
// Composes the four Report_Viewer screens into one surface, rendered inside the
// report-capability AuthGate:
//   - session review/list with confirmation-gated delete (R7.2, R10.5, R10.6),
//   - Template_Manager (upload/list/inspect/delete) (R2.1, R2.4, R2.5, R2.6),
//   - Mapping_Editor for a selected template, surfacing conflicts (R3.*),
//   - report generation with preview + missing fields + download (R8.*, R9.*).
//
// The screens are presented in an app shell: a sticky header carries the app
// title, the signed-in user's identity, and an in-app sign-out (R1.7), and a
// simple tab navigation switches among the four styled panels so the surface is
// not one long scroll. AuthGate injects the authenticated user + Auth_Service;
// when they are absent (e.g. isolated rendering) the header degrades to just
// the title.
//
// A single injectable report-viewer store is shared across the panels so the
// live template/session lists stay consistent, and a template picker feeds the
// Mapping_Editor. Everything is injectable for tests.

import { useEffect, useMemo, useState } from 'react';
import type { AuthService, AuthUser, CustomerTemplateSummary } from '@rnh/shared';
import { createReportViewerStore, type ReportViewerStore } from '../data-access';
import { SessionListPanel } from './SessionListPanel';
import { TemplateManagerPanel } from './TemplateManagerPanel';
import { MappingEditorPanel } from './MappingEditorPanel';
import { ReportGenerationPanel } from './ReportGenerationPanel';

export interface ReportWorkspaceProps {
  /** Shared live store for the workspace. Defaults to the shared store. */
  reportViewerStore?: ReportViewerStore;
  /** The authenticated user, injected by AuthGate for the header identity. */
  authUser?: AuthUser;
  /** Auth_Service, injected by AuthGate to power in-app sign-out (R1.7). */
  authService?: AuthService;
}

type WorkspaceTab = 'sessions' | 'templates' | 'mapping' | 'generate';

const TABS: ReadonlyArray<{ id: WorkspaceTab; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'templates', label: 'Templates' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'generate', label: 'Generate' },
];

/** The Report_Viewer's composed report surface. */
export function ReportWorkspace({
  reportViewerStore,
  authUser,
  authService,
}: ReportWorkspaceProps): JSX.Element {
  const store = useMemo<ReportViewerStore>(
    () => reportViewerStore ?? createReportViewerStore(),
    [reportViewerStore],
  );

  const [templates, setTemplates] = useState<CustomerTemplateSummary[]>([]);
  const [mappingTemplateId, setMappingTemplateId] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('sessions');

  useEffect(() => {
    const unsubscribe = store.subscribeCustomerTemplates(
      (items) => setTemplates(items),
      () => {
        /* errors are surfaced within the individual panels */
      },
    );
    return unsubscribe;
  }, [store]);

  return (
    <>
      <header className="app-header">
        <div className="app-header__inner">
          <h1 className="app-header__title">R&amp;H Tyre Testing — Report Viewer</h1>
          {authUser && (
            <div className="app-header__user">
              <span className="app-header__identity">
                <span className="app-header__email">{authUser.email}</span>
                <span className="app-header__role">{authUser.role}</span>
              </span>
              {authService && (
                <button
                  type="button"
                  onClick={() => {
                    void authService.signOut();
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="app-shell">
        <nav className="app-nav" aria-label="Report workspace sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                activeTab === tab.id
                  ? 'app-nav__tab app-nav__tab--active'
                  : 'app-nav__tab'
              }
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === 'sessions' && (
          <div className="card">
            <SessionListPanel reportViewerStore={store} />
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="card">
            <TemplateManagerPanel reportViewerStore={store} />
          </div>
        )}

        {activeTab === 'mapping' && (
          <div className="card">
            <section aria-labelledby="mapping-workspace-heading">
              <h2 id="mapping-workspace-heading">Edit mappings</h2>
              <label>
                Template to map
                <select
                  aria-label="Template to map"
                  value={mappingTemplateId}
                  onChange={(e) => setMappingTemplateId(e.target.value)}
                >
                  <option value="">Select a template…</option>
                  {templates.map((t) => (
                    <option key={t.templateId} value={t.templateId}>
                      {t.customerName}
                    </option>
                  ))}
                </select>
              </label>
              {mappingTemplateId === '' ? (
                <p className="state-note">
                  Select a template above to edit its field mappings.
                </p>
              ) : (
                <MappingEditorPanel templateId={mappingTemplateId} />
              )}
            </section>
          </div>
        )}

        {activeTab === 'generate' && (
          <div className="card">
            <ReportGenerationPanel reportViewerStore={store} />
          </div>
        )}
      </main>
    </>
  );
}
