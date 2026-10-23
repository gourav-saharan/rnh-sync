// One test in the Mobile_PWA home list: customer, tyre sets, progress and
// the per-test sync state (R8.6). State is shown in text, not colour alone.

import { progressPercent, type LocalTestSessionV2 } from '@rnh/shared/v2';

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionCard({
  s,
  onOpen,
}: {
  s: LocalTestSessionV2;
  onOpen: () => void;
}): JSX.Element {
  const pct = progressPercent(s.progress);
  const sets = Object.keys(s.tyreSets).length;
  const monogram = (s.customerName.trim().slice(0, 2) || 'RH').toUpperCase();

  // Status computation matching design specs:
  // Green for synced/ready, amber for pending/in_progress, red for errors/deleted
  let statusTone: 'ok' | 'warn' | 'danger' = 'ok';
  let statusText = 'Synced';

  if (s.deletedOnServer) {
    statusTone = 'danger';
    statusText = 'Deleted on laptop';
  } else if (s.syncState === 'error') {
    statusTone = 'danger';
    statusText = 'Sync error';
  } else if (s.syncState === 'syncing') {
    statusTone = 'warn';
    statusText = 'Syncing…';
  } else if (s.syncState === 'saved_local') {
    statusTone = 'warn';
    statusText = s.status === 'ready' ? 'Ready · Pending' : 'Saved locally';
  } else if (s.status === 'ready') {
    statusTone = 'ok';
    statusText = 'Ready';
  } else if (s.status === 'reported') {
    statusTone = 'ok';
    statusText = 'Reported';
  } else {
    // In progress, synced
    statusTone = 'ok';
    statusText = 'Synced';
  }

  return (
    <article
      className="list__item session-card card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {/* Top Row: Monogram Avatar, Titles, Metadata Chips, Chevron Arrow */}
      <div className="session-card__head">
        <div className="session-card__avatar" aria-hidden="true">
          {monogram}
        </div>
        <div className="session-card__titles">
          <h3 className="session-card__main list__main">
            {s.customerName} <span className="session-card__dot">·</span>{' '}
            <span className="session-card__template list__sub">{s.templateName}</span>
          </h3>
          <div className="session-card__chips">
            <span className="session-card__chip">
              <span aria-hidden="true">🛞</span> {sets} set{sets === 1 ? '' : 's'}
            </span>
            <span className="session-card__chip">
              <span aria-hidden="true">🕒</span> {when(s.updatedAt)}
            </span>
          </div>
        </div>
        <span className="session-card__chevron" aria-hidden="true">
          ›
        </span>
      </div>

      {/* Progress Section: Sleek track with percentage aligned on right */}
      <div className="session-card__progress-section">
        <div className="progress session-card__progress-bar-wrap" aria-hidden="true">
          <div className="progress__bar" style={{ width: `${pct}%` }} />
        </div>
        <span className="session-card__pct">{pct}%</span>
      </div>

      {/* Footer Row: Status Pill on bottom left */}
      <div className="session-card__footer">
        <span
          className={`sync sync--${s.deletedOnServer ? 'error' : s.syncState} sync-pill sync-pill--${statusTone}`}
          role="status"
        >
          <span className="sync-pill__dot" aria-hidden="true">
            ●
          </span>
          <span className="sync-pill__text">{statusText}</span>
        </span>
      </div>
    </article>
  );
}
