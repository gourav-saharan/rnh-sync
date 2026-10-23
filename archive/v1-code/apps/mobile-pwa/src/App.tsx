import { useEffect, useState } from 'react';
import type {
  AuthService,
  AuthUser,
  FieldMapping,
  LocalTestSession,
  MappingEditorStore,
  TemplateManager,
} from '@rnh/shared';
import { localSessionStore } from './local';
import { AuthGate } from './auth';
import { CaptureForm, TemplatePicker, type TemplateSelection } from './capture';
import { useSync } from './sync';
import type { SyncService } from './sync';

/** Optional injection seams for the capture surface (all default to production). */
export interface CaptureProps {
  user: AuthUser;
  /** Pre-built Sync_Service for tests; defaults to the production service. */
  syncService?: SyncService;
  /** Template listing surface for the picker; defaults to the shared manager. */
  templateManager?: TemplateManager;
  /** Mapping loading surface for the picker; defaults to the shared store. */
  mappingEditorStore?: MappingEditorStore;
}

/**
 * The Tester's Test_Session capture surface. Rendered only for an authenticated
 * Tester (gated by {@link AuthGate}, R1.4).
 *
 * On launch it restores the most recent in-progress Test_Session so the tester
 * resumes exactly where they left off (R5.6, R10.2), then hands control to the
 * {@link CaptureForm} which autosaves every change to the local IndexedDB store
 * (R5.3, R10.1). Each successful autosave is handed to the Sync_Service via
 * {@link useSync} so it is pushed to Firestore in the background (R7.1, R10.4);
 * the observed {@link SyncStatus} drives a status line near the capture surface
 * (R10.3). The active R&H_Parameter set derives from the Customer_Template
 * chosen in the {@link TemplatePicker} — its Field_Mappings feed the capture
 * form (R6.6), falling back to the default set when none is selected (R6.7).
 */
function Capture({
  user,
  syncService,
  templateManager,
  mappingEditorStore,
}: CaptureProps) {
  const [restored, setRestored] = useState<LocalTestSession | null>(null);
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<TemplateSelection>({
    templateId: null,
    mappings: [],
  });

  const { status, enqueue } = useSync(syncService);

  useEffect(() => {
    let active = true;
    localSessionStore
      .loadMostRecentInProgress()
      .then((session) => {
        if (active) {
          setRestored(session ?? null);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setRestored(null);
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return <p className="app-loading">Loading session…</p>;
  }

  const templateMappings: readonly FieldMapping[] = selection.mappings;

  return (
    <main className="app-main">
      <h1 className="app-title">R&amp;H Tyre Testing - Mobile PWA</h1>
      <p aria-live="polite" className="sync-summary" data-testid="sync-summary">
        {status.pendingCount > 0 ? (
          <span
            className="status-chip status-chip--unsynced"
            data-testid="sync-summary-unsynced"
          >
            {status.pendingCount} unsynced
          </span>
        ) : (
          <span
            className="status-chip status-chip--synced"
            data-testid="sync-summary-synced"
          >
            All synced
          </span>
        )}
        {status.syncing ? (
          <span className="status-save"> · Syncing…</span>
        ) : null}
        {status.lastError ? (
          <span className="status-save" data-testid="sync-summary-error">
            {' '}
            · Retry pending
          </span>
        ) : null}
      </p>
      <TemplatePicker
        onSelectionChange={setSelection}
        templateManager={templateManager}
        mappingEditorStore={mappingEditorStore}
      />
      <CaptureForm
        store={localSessionStore}
        createdBy={user.uid}
        templateId={selection.templateId}
        templateMappings={templateMappings}
        initialSession={restored}
        onSaved={enqueue}
      />
    </main>
  );
}

/** Optional injection seams surfaced on the app root for deterministic tests. */
export interface AppProps {
  syncService?: SyncService;
  templateManager?: TemplateManager;
  mappingEditorStore?: MappingEditorStore;
  /** Auth_Service seam; defaults to the shared, env-initialized instance. */
  authService?: AuthService;
}

export function App({
  syncService,
  templateManager,
  mappingEditorStore,
  authService,
}: AppProps = {}) {
  // Test_Session capture is gated to the Tester role; unauthenticated users see
  // only the sign-in screen (R1.4, R1.6). The gate hands the authenticated user
  // to the capture surface so the session is keyed to the Tester's uid.
  return (
    <AuthGate capability="capture" authService={authService}>
      {(user) => (
        <Capture
          user={user}
          syncService={syncService}
          templateManager={templateManager}
          mappingEditorStore={mappingEditorStore}
        />
      )}
    </AuthGate>
  );
}
