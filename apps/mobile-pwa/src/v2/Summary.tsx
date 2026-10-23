// Mobile_PWA session summary (R5.9, R7.5, R10.6): averages per tyre set, an
// overall comment per tyre set, missing required details and "Mark ready".

import { useEffect, useRef, useState } from 'react';
import { orderedTyreSets, progressPercent, setStatusV2, updateTyreSetV2 } from '@rnh/shared/v2';
import { useSession } from './useSession';
import { missingRequired } from './HeaderStep';
import { SaveBadge } from './SaveBadge';
import { SummaryTable } from './SummaryTable';

export interface SummaryProps {
  sessionId: string;
  onBack: () => void;
  onDrive: () => void;
  onSetup: () => void;
}

/**
 * Overall comment textarea that follows remote changes (for example a laptop
 * correction arriving via sync) while the Tester is not typing in it. Local
 * edits in progress are never overwritten.
 */
export function OverallCommentBox({
  value,
  onCommit,
}: {
  value: string | undefined;
  onCommit: (v: string) => void;
}): JSX.Element {
  const [text, setText] = useState(value ?? '');
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value ?? '');
  }, [value]);
  return (
    <textarea
      className="field__input"
      rows={2}
      value={text}
      placeholder="e.g. Good in R&H, vibration above 60 kmph"
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        editing.current = false;
        onCommit(text.trim());
      }}
    />
  );
}

export function Summary({ sessionId, onBack, onDrive, onSetup }: SummaryProps): JSX.Element {
  const ed = useSession(sessionId);
  const { session, version, apply } = ed;
  const [confirmReady, setConfirmReady] = useState(false);

  if (ed.loading) return <p className="app-loading">Opening…</p>;
  if (!session || !version) {
    return (
      <main className="screen">
        <p className="note note--warn">This test is not on this phone.</p>
        <button type="button" className="btn btn--primary" onClick={onBack}>
          Back
        </button>
      </main>
    );
  }

  const schema = version.schema;
  const sets = orderedTyreSets(session);
  const missing = missingRequired(schema.headerFields, session.header);
  const unrated = session.progress.total - session.progress.rated;

  const markReady = () => {
    if ((unrated > 0 || missing.length > 0) && !confirmReady) {
      setConfirmReady(true);
      return;
    }
    setConfirmReady(false);
    void apply((s, ctx) => setStatusV2(s, 'ready', ctx));
  };

  return (
    <main className="screen">
      <header className="topbar">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ‹ Tests
        </button>
        <h1 className="topbar__title">Summary</h1>
        <SaveBadge state={ed.saveState} error={ed.saveError} />
      </header>

      <p className="subtitle">
        {session.customerName} · {session.templateName} · {progressPercent(session.progress)}% rated
        {session.status === 'ready'
          ? ' · Ready'
          : session.status === 'reported'
            ? ' · Reported'
            : ''}
      </p>

      {missing.length > 0 ? (
        <div className="note note--warn" role="status">
          Missing required details: {missing.map((f) => f.label).join(', ')}.{' '}
          <button type="button" className="link" onClick={onSetup}>
            Fill in
          </button>
        </div>
      ) : null}

      <SummaryTable session={session} schema={schema} />

      <section aria-label="Overall comments">
        <h2 className="section-title">Overall comment per tyre set</h2>
        {sets.map((t) => (
          <label key={t.tyreSetId} className="field">
            <span className="field__label">
              {t.label}
              {t.isReference ? ' (Ref)' : ''}
            </span>
            <OverallCommentBox
              value={t.overallComment}
              onCommit={(v) => {
                if (v === (t.overallComment ?? '')) return;
                void apply((s, ctx) => updateTyreSetV2(s, t.tyreSetId, { overallComment: v }, ctx));
              }}
            />
          </label>
        ))}
      </section>

      {confirmReady ? (
        <div className="note note--warn" role="alert">
          {unrated > 0 ? `${unrated} ratings are still empty. ` : ''}
          {missing.length > 0 ? `${missing.length} required details are missing. ` : ''}
          They will be blank in the report. Tap “Mark ready” again to confirm.
        </div>
      ) : null}

      <div className="actions">
        <button type="button" className="btn btn--secondary" onClick={onDrive}>
          Continue driving
        </button>
        {session.status === 'in_progress' ? (
          <button type="button" className="btn btn--primary" onClick={markReady}>
            Mark ready
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void apply((s, ctx) => setStatusV2(s, 'in_progress', ctx))}
          >
            Reopen
          </button>
        )}
      </div>
    </main>
  );
}
