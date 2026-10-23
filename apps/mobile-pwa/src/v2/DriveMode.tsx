// Drive_Mode (R6): one R&H_Parameter per screen for the active Tyre_Set.
// Tap a rating -> saved to IndexedDB first -> haptic -> auto-advance after the
// configured delay (a second tap inside the delay replaces the rating).
// Between tyre sets a "change tyres" card makes it obvious which set is on
// the car. Undo restores the previous rating + comment of the affected cell.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  anchorFor,
  appendCommentV2,
  cellOf,
  displayName,
  ratingOf,
  referenceSet,
  restoreCellV2,
  setCommentV2,
  setCursorV2,
  setRatingV2,
  type CaptureOrder,
  type RatingCell,
} from '@rnh/shared/v2';
import { useSession } from './useSession';
import { RatingPad } from './RatingPad';
import { CommentPanel } from './CommentPanel';
import { crossesTyreSet, indexOfStep, nextIndex, positionInSet, sequenceOf } from './driveNav';
import { haptic, useWakeLock } from './useWakeLock';
import { loadPrefs } from './context';
import { SaveBadge } from './SaveBadge';

export interface DriveModeProps {
  sessionId: string;
  onExit: () => void;
  onSummary: () => void;
  onOverview: () => void;
}

interface UndoEntry {
  paramId: string;
  tyreSetId: string;
  snapshot: RatingCell | undefined;
}

function fmt(v: number | null): string {
  if (v === null) return '–';
  return Number.isInteger(v) ? v.toFixed(0) : String(v);
}

export function DriveMode({
  sessionId,
  onExit,
  onSummary,
  onOverview,
}: DriveModeProps): JSX.Element {
  const ed = useSession(sessionId);
  const { session, version, apply } = ed;
  const prefs = useMemo(() => loadPrefs(), []);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [changeCard, setChangeCard] = useState<{
    from: string;
    to: string;
    nextIndex: number;
  } | null>(null);
  const [showComment, setShowComment] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useWakeLock(true);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const order: CaptureOrder = session?.cursor.order ?? 'byTyre';
  const seq = useMemo(
    () => (session && version ? sequenceOf(session, version.schema, order) : []),
    [session, version, order],
  );
  const idx = session
    ? indexOfStep(seq, { paramId: session.cursor.paramId, tyreSetId: session.cursor.tyreSetId })
    : 0;
  const step = seq[idx];

  // Make sure the persisted cursor points at a real step and screen = drive.
  useEffect(() => {
    if (!session || !step) return;
    if (
      session.cursor.screen !== 'drive' ||
      session.cursor.paramId !== step.paramId ||
      session.cursor.tyreSetId !== step.tyreSetId
    ) {
      void apply((s) => setCursorV2(s, { ...step, screen: 'drive' }));
    }
  }, [session, step, apply]);

  const goTo = useCallback(
    (j: number) => {
      const target = seq[j];
      if (!target) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setShowComment(false);
      void apply((s) => setCursorV2(s, { paramId: target.paramId, tyreSetId: target.tyreSetId }));
    },
    [seq, apply],
  );

  const advance = useCallback(() => {
    if (!session) return;
    const j = nextIndex(seq, idx, session, false);
    if (j === null) {
      onSummary();
      return;
    }
    if (order === 'byTyre' && crossesTyreSet(seq, idx, j)) {
      const from = session.tyreSets[seq[idx].tyreSetId]?.label ?? '';
      const to = session.tyreSets[seq[j].tyreSetId]?.label ?? '';
      setChangeCard({ from, to, nextIndex: j });
      return;
    }
    goTo(j);
  }, [session, seq, idx, order, goTo, onSummary]);

  const pushUndo = (paramId: string, tyreSetId: string) => {
    if (!session) return;
    const snapshot = session.cells[`${paramId}__${tyreSetId}`];
    setUndo((u) => [
      ...u.slice(-49),
      { paramId, tyreSetId, snapshot: snapshot ? { ...snapshot } : undefined },
    ]);
  };

  const onRate = async (value: number) => {
    if (!step) return;
    pushUndo(step.paramId, step.tyreSetId);
    const ok = await apply((s, ctx) => setRatingV2(s, step.paramId, step.tyreSetId, value, ctx));
    // Never advance when the local write failed (R8.1).
    if (!ok) return;
    haptic(prefs.haptics);
    if (timer.current) clearTimeout(timer.current);
    if (prefs.autoAdvanceMs > 0 && !showComment) {
      timer.current = setTimeout(() => {
        timer.current = null;
        advance();
      }, prefs.autoAdvanceMs);
    }
  };

  const onUndo = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setUndo((u) => u.slice(0, -1));
    void apply((s, ctx) => {
      const restored = restoreCellV2(s, last.paramId, last.tyreSetId, last.snapshot, ctx);
      return setCursorV2(restored, { paramId: last.paramId, tyreSetId: last.tyreSetId });
    });
  };

  if (ed.loading) return <p className="app-loading">Opening test…</p>;
  if (ed.notFound || !session || !version) {
    return (
      <main className="screen">
        <p className="note note--warn">This test or its template is not on this phone.</p>
        <button type="button" className="btn btn--primary" onClick={onExit}>
          Back to tests
        </button>
      </main>
    );
  }
  if (!step) {
    return (
      <main className="screen">
        <p className="note">Add at least one tyre set and one parameter before driving.</p>
        <button type="button" className="btn btn--primary" onClick={onExit}>
          Back
        </button>
      </main>
    );
  }

  const schema = version.schema;
  const param = schema.parameters.find((p) => p.paramId === step.paramId);
  const category = schema.categories.find((c) => c.categoryId === param?.categoryId);
  const set = session.tyreSets[step.tyreSetId];
  const ref = referenceSet(session);
  const value = ratingOf(session, step.paramId, step.tyreSetId);
  const refValue =
    ref && ref.tyreSetId !== step.tyreSetId ? ratingOf(session, step.paramId, ref.tyreSetId) : null;
  const anchor = anchorFor(session, schema, step.paramId, step.tyreSetId);
  const cell = cellOf(session, step.paramId, step.tyreSetId);
  const pos = order === 'byTyre' ? positionInSet(seq, idx) : { n: idx + 1, of: seq.length };
  const others = Object.values(session.tyreSets)
    .filter((t) => t.tyreSetId !== step.tyreSetId)
    .sort((a, b) => a.slot - b.slot);
  const label = param ? displayName(param) : step.paramId;

  if (changeCard) {
    return (
      <main className="screen drive drive--change" aria-live="assertive">
        <div className="change-card">
          <div
            className="change-card__icon"
            aria-hidden="true"
            style={{ fontSize: '3rem', margin: '0.5rem 0' }}
          >
            🔄 🛞
          </div>
          <p className="change-card__done">✓ Set {changeCard.from} completed</p>
          <p className="change-card__next">Swap tyres on vehicle now</p>
          <p className="change-card__label">Set {changeCard.to}</p>
          <button
            type="button"
            className="btn btn--primary btn--xl"
            onClick={() => {
              const j = changeCard.nextIndex;
              setChangeCard(null);
              goTo(j);
            }}
          >
            ✓ Set {changeCard.to} is on car · Continue
          </button>
          <button type="button" className="btn btn--secondary" onClick={onSummary}>
            Stop here · View summary
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen drive">
      <header className="drive__top">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onExit}
          aria-label="Stop and show summary"
        >
          ‹ Summary
        </button>
        <span className="drive__set" aria-label={`Tyre set ${set?.label ?? ''}`}>
          {set?.label ?? ''}
          {set?.isReference ? <span className="tag">REF</span> : null}
        </span>
        <SaveBadge state={ed.saveState} error={ed.saveError} />
      </header>

      <div className="drive__param">
        <p className="drive__cat">
          {category?.name ?? ''} · {pos.n} / {pos.of}
        </p>
        <h1 className="drive__name">{label}</h1>
        {param && param.shortName && param.shortName !== param.name ? (
          <p className="drive__full">{param.name}</p>
        ) : null}
      </div>

      <RatingPad
        label={label}
        value={value}
        anchor={anchor}
        scale={schema.scale}
        referenceValue={refValue}
        onSelect={(v) => void onRate(v)}
        onClear={() => {
          pushUndo(step.paramId, step.tyreSetId);
          void apply((s, ctx) => setRatingV2(s, step.paramId, step.tyreSetId, null, ctx));
        }}
      />

      {others.length > 0 ? (
        <ul className="others" aria-label="Other tyre sets for this parameter">
          {others.map((t) => (
            <li key={t.tyreSetId} className="others__item">
              <span className="others__label">{t.label}</span>
              <span className="others__val">
                {fmt(ratingOf(session, step.paramId, t.tyreSetId))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        className="btn btn--secondary btn--full"
        aria-expanded={showComment}
        onClick={() => {
          if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
          }
          setShowComment((v) => !v);
        }}
      >
        {showComment ? 'Hide comment' : cell.comment ? `💬 ${cell.comment}` : '💬 Add comment'}
      </button>
      {showComment ? (
        <CommentPanel
          comment={cell.comment}
          quickComments={schema.quickComments}
          onAppend={(t) =>
            void apply((s, ctx) => appendCommentV2(s, step.paramId, step.tyreSetId, t, ctx))
          }
          onReplace={(t) =>
            void apply((s, ctx) => setCommentV2(s, step.paramId, step.tyreSetId, t, ctx))
          }
        />
      ) : null}

      <nav className="drive__nav" aria-label="Drive navigation">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={idx === 0}
          onClick={() => goTo(idx - 1)}
        >
          ‹ Prev
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={undo.length === 0}
          onClick={onUndo}
        >
          ↶ Undo
        </button>
        <button type="button" className="btn btn--secondary" onClick={onOverview}>
          ▦ Grid
        </button>
        <button type="button" className="btn btn--primary" onClick={advance}>
          Next ›
        </button>
      </nav>
      <div className="drive__order">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() =>
            void apply((s) => setCursorV2(s, { order: order === 'byTyre' ? 'byParam' : 'byTyre' }))
          }
        >
          Order: {order === 'byTyre' ? 'by tyre' : 'by parameter'} (switch)
        </button>
      </div>
    </main>
  );
}
