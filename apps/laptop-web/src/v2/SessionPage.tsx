// Laptop session page (R10.2–R10.6, R12, R13.2, R13.4): live review grid with
// in-place edits (same pure operations + validation as the phone), per-cell
// history, "Mark ready" with warnings, report generation, trash and JSON export.

import { useEffect, useState } from 'react';
import {
  cellKey,
  orderedTyreSets,
  preflight,
  remoteChanges,
  setCommentV2,
  setRatingV2,
  setStatusV2,
  type EditContext,
  type HistoryEntry,
  type LocalTestSessionV2,
  type TemplateVersion,
} from '@rnh/shared/v2';
import { downloadBytes, formatDate, plainError, useLaptop, useLiveSession } from './context';
import { ReviewGrid } from './ReviewGrid';
import { SessionDetails } from './SessionDetails';
import { ReportDialog } from './ReportDialog';
import { HistoryPanel } from './HistoryPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { TyrePhotos } from './TyrePhotos';
import { AssignPanel } from './AssignPanel';

export function SessionPage({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}): JSX.Element {
  const { sessions, templates, user } = useLaptop();
  const live = useLiveSession(sessionId);
  const s = live.data;
  const [version, setVersion] = useState<TemplateVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ title: string; items: HistoryEntry[] } | null>(null);
  const [report, setReport] = useState(false);
  const [confirm, setConfirm] = useState<'ready' | 'delete' | null>(null);
  const tid = s?.templateId;
  const tver = s?.templateVersion;

  useEffect(() => {
    if (!tid || !tver) return;
    let active = true;
    templates
      .getVersion(tid, tver)
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch((e) => {
        if (active) setError(plainError(e));
      });
    return () => {
      active = false;
    };
  }, [templates, tid, tver]);

  if (live.loading) return <p className="l-loading">Loading test…</p>;
  if (!s) {
    // Either a real "not found" or a read failure: never leave the user stuck.
    return (
      <div className="l-panel">
        <p className={`l-alert ${live.error ? 'l-alert--error' : 'l-alert--warn'}`} role="alert">
          {live.error
            ? `Could not load this test: ${live.error}`
            : 'This test no longer exists. It may have been deleted permanently.'}
        </p>
        <div className="l-row">
          <button type="button" className="l-btn l-btn--primary" onClick={onBack}>
            ‹ Back to tests
          </button>
        </div>
      </div>
    );
  }
  if (!version) {
    if (!error) return <p className="l-loading">Loading template…</p>;
    return (
      <div className="l-panel">
        <p className="l-alert l-alert--error" role="alert">
          Could not load template {s.templateName} v{s.templateVersion}: {error}
        </p>
        <div className="l-row">
          <button type="button" className="l-btn" onClick={onBack}>
            ‹ Back to tests
          </button>
          <button
            type="button"
            className="l-btn l-btn--primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const edit = async (fn: (x: LocalTestSessionV2, ctx: EditContext) => LocalTestSessionV2) => {
    setError(null);
    const ctx: EditContext = { userId: user.uid, version };
    const changes = remoteChanges(s, (x) => fn(x, ctx));
    if (changes.length === 0) return;
    try {
      await sessions.updateFields(s.sessionId, changes, { uid: user.uid, name: user.displayName });
    } catch (e) {
      setError(plainError(e));
    }
  };

  const showHistory = async (paramId: string, tyreSetId: string) => {
    const key = cellKey(paramId, tyreSetId);
    const p = version.schema.parameters.find((x) => x.paramId === paramId);
    try {
      const all = await sessions.listHistory(s.sessionId);
      setHistory({
        title: `${p?.shortName || p?.name || paramId} · ${s.tyreSets[tyreSetId]?.label ?? ''}`,
        items: all.filter((h) => h.path === `cells.${key}` || h.path.startsWith(`cells.${key}.`)),
      });
    } catch (e) {
      setError(plainError(e));
    }
  };

  const readyIssues = () => {
    const pf = preflight(s, version);
    return [...pf.blockers, ...pf.warnings].map((i) => i.message);
  };

  const markReady = () => {
    if (readyIssues().length > 0) {
      setConfirm('ready');
      return;
    }
    void edit((x, ctx) => setStatusV2(x, 'ready', ctx));
  };

  const trash = async () => {
    setConfirm(null);
    try {
      await sessions.trash(s.sessionId, user.uid);
      onBack();
    } catch (e) {
      setError(plainError(e));
    }
  };

  const exportJson = () => {
    const bytes = new TextEncoder().encode(JSON.stringify(s, null, 2));
    const name = `${s.customerName}_${s.sessionId}.json`.replace(/[\\/:*?"<>|]/g, '-');
    downloadBytes(bytes, name, 'application/json');
  };

  return (
    <section className="l-page" aria-label="Test review">
      <header className="l-page__head">
        <button type="button" className="l-btn l-btn--ghost" onClick={onBack}>
          ‹ All tests
        </button>
        <div className="l-page__titles">
          <h2 className="l-page__title">
            {s.customerName} · {s.templateName} v{s.templateVersion}
          </h2>
          <p className="l-muted l-small">
            Tester {s.createdByName} · updated {formatDate(s.updatedAt)} · status{' '}
            {s.status.replace('_', ' ')}
            {s.lastReport ? ` · last report ${formatDate(s.lastReport.at)}` : ''}
          </p>
        </div>
        <div className="l-row">
          {s.status === 'in_progress' ? (
            <button type="button" className="l-btn" onClick={markReady}>
              ✓ Mark ready
            </button>
          ) : (
            <button
              type="button"
              className="l-btn"
              onClick={() => void edit((x, c) => setStatusV2(x, 'in_progress', c))}
            >
              Reopen
            </button>
          )}
          <button type="button" className="l-btn l-btn--primary" onClick={() => setReport(true)}>
            📄 Generate report
          </button>
          <button type="button" className="l-btn" onClick={exportJson}>
            Export JSON
          </button>
          <button
            type="button"
            className="l-btn l-btn--danger"
            onClick={() => setConfirm('delete')}
          >
            Delete
          </button>
        </div>
      </header>

      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}

      {s.deletedAt ? (
        <div className="l-alert l-alert--warn l-row l-row--between" role="status">
          <span>
            This test is in the Trash (deleted {formatDate(s.deletedAt)}). Restore it before editing
            or reporting.
          </span>
          <button
            type="button"
            className="l-btn l-btn--secondary l-btn--small"
            onClick={() => {
              setError(null);
              sessions.restore(s.sessionId, user.uid).catch((e) => setError(plainError(e)));
            }}
          >
            Restore
          </button>
        </div>
      ) : null}

      <SessionDetails session={s} version={version} onEdit={edit} />

      <AssignPanel
        session={s}
        onSave={(next) =>
          sessions.updateFields(
            s.sessionId,
            [{ path: 'assignedTo', before: s.assignedTo ?? [], after: next }],
            { uid: user.uid, name: user.displayName },
          )
        }
      />

      <TyrePhotos sets={orderedTyreSets(s)} />

      <ReviewGrid
        session={s}
        version={version}
        onRating={(p, t, v) => void edit((x, c) => setRatingV2(x, p, t, v, c))}
        onComment={(p, t, v) => void edit((x, c) => setCommentV2(x, p, t, v, c))}
        onHistory={(p, t) => void showHistory(p, t)}
      />

      {history ? (
        <HistoryPanel
          title={history.title}
          items={history.items}
          onClose={() => setHistory(null)}
        />
      ) : null}

      {report ? (
        <ReportDialog session={s} version={version} onClose={() => setReport(false)} />
      ) : null}

      {confirm === 'ready' ? (
        <ConfirmDialog
          title="Mark as ready anyway?"
          confirmLabel="Mark ready"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void edit((x, ctx) => setStatusV2(x, 'ready', ctx));
          }}
        >
          <p>These will be blank or flagged in the report:</p>
          <ul>
            {readyIssues().map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </ConfirmDialog>
      ) : null}

      {confirm === 'delete' ? (
        <ConfirmDialog
          title="Move this test to the trash?"
          confirmLabel="Move to trash"
          danger
          requireText="DELETE"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void trash()}
        >
          <p>
            {s.customerName} · {s.templateName}, tested by {s.createdByName}. It can be restored
            from Trash for 30 days. At the next sync the Tester's phone removes its copy, unless it
            still has unsent ratings; then the Tester is asked to keep and send them or discard
            them.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
