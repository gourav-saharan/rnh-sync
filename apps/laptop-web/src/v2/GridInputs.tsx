// Editable cells for the laptop review grid (R10.3). Ratings use the same
// validation as the phone (R7.1); arrow keys / Enter move between rating cells.

import { useState, type KeyboardEvent } from 'react';
import { isValidRating, type RatingScale } from '@rnh/shared/v2';

export function fmtRating(v: number | null): string {
  if (v === null) return '';
  return Number.isInteger(v) ? v.toFixed(0) : String(v);
}

function focusCell(row: number, col: number): void {
  const el = document.querySelector<HTMLInputElement>(`input[data-r="${row}"][data-c="${col}"]`);
  el?.focus();
  el?.select();
}

const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  Enter: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export function RatingInput(props: {
  value: number | null;
  row: number;
  col: number;
  label: string;
  scale: RatingScale;
  onCommit: (v: number | null) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  const commit = (): boolean => {
    if (draft === null) return true;
    const t = draft.trim().replace(',', '.');
    if (t === '') {
      if (props.value !== null) props.onCommit(null);
      setDraft(null);
      setBad(false);
      return true;
    }
    const n = Number(t);
    if (!isValidRating(n, props.scale)) {
      setBad(true);
      return false;
    }
    if (n !== props.value) props.onCommit(n);
    setDraft(null);
    setBad(false);
    return true;
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setDraft(null);
      setBad(false);
      return;
    }
    const m = MOVES[e.key];
    if (!m) return;
    const el = e.currentTarget;
    if (e.key === 'ArrowLeft' && el.selectionStart !== 0) return;
    if (e.key === 'ArrowRight' && el.selectionEnd !== el.value.length) return;
    e.preventDefault();
    if (commit()) focusCell(props.row + m[0], props.col + m[1]);
  };

  const s = props.scale;
  return (
    <input
      className={`l-rate${props.value === null ? ' l-rate--unrated' : ''}${bad ? ' l-rate--bad' : ''}`}
      inputMode="decimal"
      aria-label={props.label}
      aria-invalid={bad}
      title={bad ? `Use ${s.min}–${s.max} in steps of ${s.step}` : undefined}
      data-r={props.row}
      data-c={props.col}
      value={draft ?? fmtRating(props.value)}
      placeholder="–"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        // An invalid value keeps the prior rating (R7.1).
        if (!commit()) {
          setDraft(null);
          setBad(false);
        }
      }}
      onKeyDown={onKey}
    />
  );
}

export function CommentInput(props: {
  value: string;
  label: string;
  onCommit: (v: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <textarea
      className="l-comment"
      rows={1}
      aria-label={props.label}
      value={draft ?? props.value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== props.value) props.onCommit(draft.trim());
        setDraft(null);
      }}
    />
  );
}
