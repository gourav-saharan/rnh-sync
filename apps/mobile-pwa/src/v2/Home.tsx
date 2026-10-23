// Mobile_PWA v2 home: the Tester's tests on this phone with per-test sync
// state (R8.6), resume (R8.2), and "New test" from a cached published
// template (R5.1, R8.3, R8.4).

import { useEffect, useState } from 'react';
import { createSessionV2, type LocalTestSessionV2, type TemplateVersion } from '@rnh/shared/v2';
import { useServices, useSyncStatus } from './context';
import type { CachedVersion } from './store';
import { SessionCard } from './SessionCard';
import { resolveDeletedOnServer, type DeletedChoice } from './syncEngine';

/** Keep & send / Discard for a test deleted on the laptop (R13.3). */
export function DeletedDecision({
  busy,
  onChoose,
  onCancel,
}: {
  busy: boolean;
  onChoose: (choice: DeletedChoice) => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="card decide" role="region" aria-label="Test deleted on the laptop">
      <p className="note note--warn">
        This test was deleted on the laptop, but this phone has ratings that were not sent yet.
      </p>
      <button
        type="button"
        className="btn btn--primary btn--full"
        disabled={busy}
        onClick={() => onChoose('keep')}
      >
        Keep & send to laptop
      </button>
      <button
        type="button"
        className="btn btn--danger-outline btn--full"
        disabled={busy}
        onClick={() => onChoose('discard')}
      >
        Discard from this phone
      </button>
      <button type="button" className="btn btn--ghost btn--full" disabled={busy} onClick={onCancel}>
        Decide later
      </button>
    </div>
  );
}

export interface HomeProps {
  onOpen: (s: LocalTestSessionV2) => void;
  onSettings: () => void;
  pickingExternal?: boolean;
  onSetPickingExternal?: (p: boolean) => void;
}

/** Case-insensitive match on customer, template, header values and tyre sets. */
export function filterSessions(list: LocalTestSessionV2[], query: string): LocalTestSessionV2[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) =>
    [
      s.customerName,
      s.templateName,
      ...Object.values(s.header).map((v) => String(v ?? '')),
      ...Object.values(s.tyreSets).map((t) => `${t.label} ${t.make} ${t.pattern}`),
    ]
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
}

export function Home({ onOpen, onSettings, pickingExternal, onSetPickingExternal }: HomeProps): JSX.Element {
  const { local, remote, user, sync } = useServices();
  const status = useSyncStatus();
  const [sessions, setSessions] = useState<LocalTestSessionV2[] | null>(null);
  const [templates, setTemplates] = useState<CachedVersion[]>([]);
  const [localPicking, setLocalPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'ready' | 'reported'>('all');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const picking = pickingExternal ?? localPicking;
  const setPicking = onSetPickingExternal ?? setLocalPicking;

  useEffect(() => {
    let active = true;
    void (async () => {
      const [all, latest, ids] = await Promise.all([
        local.listSessions(),
        local.latestVersions(),
        local.activeTemplateIds(),
      ]);
      if (!active) return;
      setSessions(all.filter((s) => s.createdBy === user.uid || s.assignedTo.includes(user.uid)));
      setTemplates(ids ? latest.filter((v) => ids.includes(v.templateId)) : latest);
    })();
    return () => {
      active = false;
    };
  }, [local, user.uid, status.syncing, status.pendingCount, reload]);

  const start = async (v: TemplateVersion) => {
    setError(null);
    try {
      const previous = (sessions ?? []).find((s) => s.templateId === v.templateId);
      const s = createSessionV2({ version: v, user, previousHeader: previous?.header });
      await local.saveSession(s);
      sync.notify();
      setPicking(false);
      onOpen(s);
    } catch {
      setError('Could not create the test on this phone. Free some storage and try again.');
    }
  };

  const decide = async (sessionId: string, choice: DeletedChoice) => {
    setBusy(true);
    setError(null);
    try {
      await resolveDeletedOnServer({ local, remote }, sessionId, choice, user.uid);
      setDeciding(null);
      setReload((n) => n + 1);
      if (choice === 'keep') sync.notify();
    } catch {
      setError(
        choice === 'keep'
          ? 'Could not restore the test. Check the connection and try again.'
          : 'Could not remove the test from this phone. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const filteredByStatus = (sessions ?? []).filter((s) => {
    if (statusFilter === 'all') return true;
    return s.status === statusFilter;
  });

  const shown = filterSessions(filteredByStatus, query);

  return (
    <main className="screen screen--home">
      {/* Native App Top Header */}
      <header className="app-header">
        <div className="app-header__main">
          <div className="app-header__brand">
            <div className="app-header__logo-wrap" aria-hidden="true">
              <svg
                className="app-header__logo-svg"
                viewBox="0 0 48 48"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect width="48" height="48" rx="14" fill="url(#wheelGrad)" />
                <circle cx="24" cy="24" r="18" fill="#1E293B" stroke="#0F172A" strokeWidth="2.5" />
                <circle
                  cx="24"
                  cy="24"
                  r="14"
                  fill="#334155"
                  stroke="#64748B"
                  strokeWidth="1.5"
                  strokeDasharray="2 2"
                />
                <circle cx="24" cy="24" r="10" fill="#94A3B8" stroke="#E2E8F0" strokeWidth="1.5" />
                <circle cx="24" cy="24" r="5" fill="#E2E8F0" stroke="#64748B" strokeWidth="1" />
                <circle cx="24" cy="24" r="2.5" fill="#145DA0" />
                <line x1="24" y1="14" x2="24" y2="19" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <line x1="14.5" y1="21" x2="19.5" y2="22.5" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <line x1="18" y1="31" x2="21.5" y2="27" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <line x1="30" y1="31" x2="26.5" y2="27" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <line x1="33.5" y1="21" x2="28.5" y2="22.5" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <defs>
                  <linearGradient id="wheelGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#38BDF8" />
                    <stop offset="1" stopColor="#0284C7" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="app-header__titles">
              <h1 className="app-header__title topbar__title">R&H Tests</h1>
              <p className="app-header__subtitle">
                <span>VEHICLE DYNAMICS</span>
                <span>TYRE EVALUATIONS</span>
              </p>
            </div>
          </div>
          <div className="app-header__actions">
            <div
              className={`header-sync-pill header-sync-pill--${status.syncing ? 'syncing' : !status.online ? 'offline' : status.pendingCount > 0 ? 'pending' : 'synced'}`}
              role="status"
              title={
                status.syncing
                  ? 'Syncing data…'
                  : !status.online
                    ? 'Working offline'
                    : status.pendingCount > 0
                      ? `${status.pendingCount} pending upload`
                      : 'All tests synced'
              }
              onClick={() => {
                if (status.online && !status.syncing) {
                  void sync.syncNow();
                  setReload((n) => n + 1);
                }
              }}
            >
              <span className="header-sync-pill__dot" aria-hidden="true">
                ●
              </span>
              <span className="header-sync-pill__text">
                {status.syncing
                  ? 'Syncing…'
                  : !status.online
                    ? 'Offline'
                    : status.pendingCount > 0
                      ? 'Pending'
                      : 'Synced'}
              </span>
            </div>

            <button
              type="button"
              className="icon-btn app-header__action-btn"
              disabled={status.syncing || !status.online}
              onClick={() => {
                void sync.syncNow();
                setReload((n) => n + 1);
              }}
              aria-label="Refresh and sync"
              title="Refresh and sync"
            >
              <span className={`icon-btn__glyph${status.syncing ? ' icon-btn__glyph--spin' : ''}`}>
                ↻
              </span>
            </button>
            <button
              type="button"
              className="icon-btn app-header__action-btn"
              onClick={onSettings}
              aria-label="Settings"
              title="Settings"
            >
              <span className="icon-btn__glyph">⚙</span>
            </button>
          </div>
        </div>
      </header>

      {status.lastError ? <p className="note note--warn">{status.lastError}</p> : null}
      {error ? (
        <p className="note note--warn" role="alert">
          {error}
        </p>
      ) : null}

      {/* Primary Action Button directly below Header */}
      <div className="home-action-bar">
        <button
          type="button"
          className="btn btn--primary btn--xl btn--full btn--pill home-action-bar__btn"
          onClick={() => setPicking(!picking)}
        >
          {picking ? '✕ Cancel' : '+ New test'}
        </button>
      </div>

      {/* Native Action Sheet / Bottom Drawer for Template Picker */}
      {picking ? (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a customer template"
          onClick={() => setPicking(false)}
        >
          <div className="bottom-sheet card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <div>
                <h2 className="sheet-title card__title">Customer template</h2>
                <p className="sheet-subtitle">Select a template to configure and start testing</p>
              </div>
              <button
                type="button"
                className="icon-btn sheet-close"
                onClick={() => setPicking(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {templates.length === 0 ? (
              <p className="note">
                No published templates on this phone yet. Connect to the internet once so they can
                download, or ask the Template Admin to publish one.
              </p>
            ) : (
              <ul className="sheet-list">
                {templates.map((v) => {
                  const mono = (v.customerName.trim().slice(0, 2) || 'RH').toUpperCase();
                  const paramCount = v.schema?.parameters?.length ?? 0;
                  const slotCount = v.schema?.slotCount ?? 4;
                  return (
                    <li key={v.key} className="sheet-list__item">
                      <button
                        type="button"
                        className="template-choice-btn"
                        onClick={() => void start(v)}
                      >
                        <div className="template-choice-btn__icon" aria-hidden="true">
                          {mono}
                        </div>
                        <div className="template-choice-btn__info">
                          <span className="template-choice-btn__title">
                            {v.customerName}
                          </span>
                          <span className="template-choice-btn__sub">
                            {v.templateName} · v{v.version} · {paramCount} parameters · up to {slotCount} tyres
                          </span>
                        </div>
                        <span className="template-choice-btn__arrow" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Tests Section with Native Search & Filter Tabs */}
      <section className="home-tests-section" aria-label="My tests">
        <div className="home-tests-section__head">
          <div className="home-tests-section__title-row">
            <div className="home-tests-section__title-wrap">
              <h2 className="section-title">My tests</h2>
              <span className="section-count-badge" aria-label={`${sessions?.length ?? 0} tests`}>
                {sessions?.length ?? 0}
              </span>
            </div>
            <div className="home-tests-section__search-group">
              {searchOpen || query.length > 0 ? (
                <div className="native-search-bar native-search-bar--active">
                  <span className="native-search-bar__icon" aria-hidden="true">
                    🔍
                  </span>
                  <input
                    type="search"
                    className="native-search-bar__input"
                    value={query}
                    placeholder="Search…"
                    autoFocus
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button
                    type="button"
                    className="native-search-bar__clear"
                    onClick={() => {
                      setQuery('');
                      setSearchOpen(false);
                    }}
                    aria-label="Close search"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="icon-btn home-tests-section__search-btn"
                  aria-label="Search tests"
                  title="Search tests"
                  onClick={() => setSearchOpen(true)}
                >
                  🔍
                </button>
              )}
            </div>
          </div>

          {/* Quick Filter Segmented Pills */}
          <div className="status-filter-pills" role="tablist" aria-label="Filter test status">
            <button
              type="button"
              className={`filter-pill${statusFilter === 'all' ? ' filter-pill--active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`filter-pill${statusFilter === 'in_progress' ? ' filter-pill--active' : ''}`}
              onClick={() => setStatusFilter('in_progress')}
            >
              In progress
            </button>
            <button
              type="button"
              className={`filter-pill${statusFilter === 'ready' ? ' filter-pill--active' : ''}`}
              onClick={() => setStatusFilter('ready')}
            >
              Ready
            </button>
            <button
              type="button"
              className={`filter-pill${statusFilter === 'reported' ? ' filter-pill--active' : ''}`}
              onClick={() => setStatusFilter('reported')}
            >
              Reported
            </button>
          </div>
        </div>

        {sessions === null ? (
          <div className="native-loading-card">
            <div className="native-spinner" aria-hidden="true" />
            <p className="note">Loading tests…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="empty-state-native card">
            <div className="empty-state-native__icon-wrap">
              <span className="empty-state-native__icon" role="img" aria-label="Clipboard">
                📋
              </span>
            </div>
            <p className="empty-state-native__title">No tests on this phone</p>
            <p className="empty-state-native__subtitle list__sub">
              Tap “+ New test” above to start rating tyre sets, or pull tests assigned to you.
            </p>
            <button
              type="button"
              className="btn btn--primary btn--pill"
              onClick={() => setPicking(true)}
            >
              + Create first test
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="note" role="status">
            No tests match “{query.trim()}”.
          </p>
        ) : (
          <ul className="list native-sessions-list">
            {shown.map((s) => (
              <li key={s.sessionId} className="native-sessions-list__item">
                <SessionCard
                  s={s}
                  onOpen={() =>
                    s.deletedOnServer
                      ? setDeciding(deciding === s.sessionId ? null : s.sessionId)
                      : onOpen(s)
                  }
                />
                {deciding === s.sessionId ? (
                  <DeletedDecision
                    busy={busy}
                    onChoose={(choice) => void decide(s.sessionId, choice)}
                    onCancel={() => setDeciding(null)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
