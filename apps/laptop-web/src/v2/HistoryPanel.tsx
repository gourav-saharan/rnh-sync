// Per-cell change history (R10.4).

import type { HistoryEntry } from '@rnh/shared/v2';
import { formatDate } from './context';

export function describeValue(v: unknown): string {
  if (v && typeof v === 'object' && 'rating' in v) {
    const c = v as { rating: number | null; comment?: string };
    return `${c.rating ?? 'unrated'}${c.comment ? ` “${c.comment}”` : ''}`;
  }
  if (v === null || v === undefined || v === '') return '(empty)';
  return String(v);
}

export function HistoryPanel({
  title,
  items,
  onClose,
}: {
  title: string;
  items: HistoryEntry[];
  onClose: () => void;
}): JSX.Element {
  return (
    <aside className="l-card l-history" aria-label="Change history">
      <div className="l-row l-row--between">
        <h3>History · {title}</h3>
        <button type="button" className="l-btn l-btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {items.length === 0 ? (
        <p className="l-muted">
          No laptop edits recorded for this cell. Phone captures sync without history entries.
        </p>
      ) : (
        <ul className="l-list">
          {items.map((h, i) => (
            <li key={i}>
              {formatDate(h.at)} · {h.byName}: {describeValue(h.before)} → {describeValue(h.after)}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
