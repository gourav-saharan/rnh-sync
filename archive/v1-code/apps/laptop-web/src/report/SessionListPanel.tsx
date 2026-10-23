// Session review/list UI (Laptop_Web_App, task 16.1).
//
// Lists synchronized Test_Sessions live (they appear without a manual reload
// as the Mobile_PWA Sync_Engine pushes them, R7.2), lets the Report_Viewer
// review a session's details, and offers a confirmation-gated deletion of a
// synchronized Test_Session (R10.5) — on confirm, the shared data-access layer
// removes the Firestore document, which propagates the deletion to every
// device (R10.6).
//
// The live list and deletion both come from the injected report-viewer store
// so the component tests drive it with a fake and no Firebase.

import { useEffect, useMemo, useState } from 'react';
import type { TestSession } from '@rnh/shared';
import { createReportViewerStore, type ReportViewerStore } from '../data-access';

export interface SessionListPanelProps {
  /** Live session source + deletion. Defaults to the shared report-viewer store. */
  reportViewerStore?: ReportViewerStore;
}

/**
 * The session review/list panel. Shows the live list of synced Test_Sessions,
 * expands a selected session's details, and gates deletion behind an explicit
 * confirmation (R10.5).
 */
export function SessionListPanel({
  reportViewerStore,
}: SessionListPanelProps): JSX.Element {
  const store = useMemo<ReportViewerStore>(
    () => reportViewerStore ?? createReportViewerStore(),
    [reportViewerStore],
  );

  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = store.subscribeTestSessions(
      (items) => {
        setSessions(items);
        setLoaded(true);
      },
      (err) => {
        setError(err.message);
        setLoaded(true);
      },
    );
    return unsubscribe;
  }, [store]);

  const selected = sessions.find((s) => s.sessionId === selectedId) ?? null;

  async function confirmDelete(sessionId: string): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      // Confirmation-gated deletion of a synchronized Test_Session (R10.5).
      await store.deleteTestSession(sessionId, { confirmed: true });
      setNotice('Session deleted.');
      if (selectedId === sessionId) {
        setSelectedId(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <section aria-labelledby="session-list-heading">
      <h2 id="session-list-heading">Test sessions</h2>

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

      {!loaded && (
        <p className="loading-indicator">Loading sessions…</p>
      )}

      <ul aria-label="Session list">
        {loaded && sessions.length === 0 && (
          <li className="state-note">No sessions synced yet.</li>
        )}
        {sessions.map((session) => (
          <li key={session.sessionId} data-testid={`session-${session.sessionId}`}>
            <button type="button" onClick={() => setSelectedId(session.sessionId)}>
              {session.sessionId}
              {session.conditions?.testDate ? ` — ${session.conditions.testDate}` : ''}
            </button>
            <span>{session.syncState === 'synced' ? ' (synced)' : ' (unsynced)'}</span>
            {pendingDeleteId === session.sessionId ? (
              <>
                <span role="status">Delete this session?</span>
                <button
                  type="button"
                  onClick={() => void confirmDelete(session.sessionId)}
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
                onClick={() => setPendingDeleteId(session.sessionId)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {selected !== null && (
        <div aria-label="Session details">
          <h3>Session {selected.sessionId}</h3>
          <dl>
            <dt>Driver</dt>
            <dd>{selected.conditions?.driverName || '—'}</dd>
            <dt>Test track</dt>
            <dd>{selected.conditions?.testTrack || '—'}</dd>
            <dt>Test date</dt>
            <dd>{selected.conditions?.testDate || '—'}</dd>
            <dt>Vehicle</dt>
            <dd>{selected.vehicle?.vehicleId || '—'}</dd>
            <dt>Tyre sets</dt>
            <dd>{selected.tyreSets?.length ?? 0}</dd>
            <dt>Ride average</dt>
            <dd>{selected.ride?.averageRating ?? '—'}</dd>
            <dt>Handling average</dt>
            <dd>{selected.handling?.averageRating ?? '—'}</dd>
          </dl>
        </div>
      )}
    </section>
  );
}
