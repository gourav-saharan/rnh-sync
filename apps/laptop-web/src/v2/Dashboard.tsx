// Laptop_Web_App v2 dashboard (R10.1): every synced test with customer,
// template, date, vehicle, tester, tyre-set count, completeness and status,
// filterable and searchable. Updates live without reload (R9.3).

import { useMemo, useState } from 'react';
import { progressPercent, type TestSessionV2 } from '@rnh/shared/v2';
import { formatDate, useLiveSessions } from './context';

export interface DashboardProps {
  onOpen: (sessionId: string) => void;
}

const STATUS_LABEL: Record<TestSessionV2['status'], string> = {
  in_progress: 'In progress',
  ready: 'Ready',
  reported: 'Reported',
};

/** Best-effort header lookups by common field labels / ids. */
export function headerGuess(s: TestSessionV2, words: readonly string[]): string {
  for (const [k, v] of Object.entries(s.header)) {
    const key = k.toLowerCase();
    if (v !== null && v !== '' && words.some((w) => key.includes(w))) return String(v);
  }
  return '';
}

export function testDateOf(s: TestSessionV2): string {
  return headerGuess(s, ['date']) || new Date(s.createdAt).toISOString().slice(0, 10);
}

/**
 * Inclusive date filter on ISO `YYYY-MM-DD` strings. A test date that is not
 * ISO (free text typed into a header field) passes only when no bound is set.
 */
export function inDateRange(date: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function Dashboard({ onOpen }: DashboardProps): JSX.Element {
  const live = useLiveSessions();
  const [text, setText] = useState('');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState<'' | TestSessionV2['status']>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const active = useMemo(() => live.data.filter((s) => !s.deletedAt), [live.data]);
  const customers = useMemo(() => [...new Set(active.map((s) => s.customerName))].sort(), [active]);

  type SortCol =
    | 'date'
    | 'customer'
    | 'template'
    | 'vehicle'
    | 'tester'
    | 'tyres'
    | 'complete'
    | 'status'
    | 'updated';
  type SortDir = 'asc' | 'desc';
  const [sortCol, setSortCol] = useState<SortCol>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    const filtered = active.filter((s) => {
      if (customer && s.customerName !== customer) return false;
      if (status && s.status !== status) return false;
      if (!inDateRange(testDateOf(s), from, to)) return false;
      if (!q) return true;
      const hay = [
        s.customerName,
        s.templateName,
        s.createdByName,
        ...Object.values(s.header).map((v) => String(v ?? '')),
        ...Object.values(s.tyreSets).map((t) => `${t.label} ${t.make} ${t.pattern}`),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });

    return [...filtered].sort((a, b) => {
      let va: string | number = '';
      let vb: string | number = '';
      switch (sortCol) {
        case 'date':
          va = testDateOf(a);
          vb = testDateOf(b);
          break;
        case 'customer':
          va = a.customerName.toLowerCase();
          vb = b.customerName.toLowerCase();
          break;
        case 'template':
          va = a.templateName.toLowerCase();
          vb = b.templateName.toLowerCase();
          break;
        case 'vehicle':
          va = (headerGuess(a, ['vehicle', 'car']) || '').toLowerCase();
          vb = (headerGuess(b, ['vehicle', 'car']) || '').toLowerCase();
          break;
        case 'tester':
          va = a.createdByName.toLowerCase();
          vb = b.createdByName.toLowerCase();
          break;
        case 'tyres':
          va = Object.keys(a.tyreSets).length;
          vb = Object.keys(b.tyreSets).length;
          break;
        case 'complete':
          va = progressPercent(a.progress);
          vb = progressPercent(b.progress);
          break;
        case 'status':
          va = a.status;
          vb = b.status;
          break;
        case 'updated':
          va = a.updatedAt;
          vb = b.updatedAt;
          break;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [active, text, customer, status, from, to, sortCol, sortDir]);

  return (
    <section className="l-panel" aria-labelledby="dash-h">
      <div className="l-panel__head">
        <h2 id="dash-h">Tests</h2>
        <span className="l-muted" aria-live="polite">
          {live.loading ? 'Loading…' : `${rows.length} of ${active.length}`}
        </span>
      </div>

      <div className="l-filters" role="search">
        <label className="l-field">
          <span>Search</span>
          <input
            type="search"
            value={text}
            placeholder="Vehicle, tyre, tester…"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="l-field">
          <span>Customer</span>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All</option>
            {customers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="l-field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">All</option>
            <option value="in_progress">In progress</option>
            <option value="ready">Ready</option>
            <option value="reported">Reported</option>
          </select>
        </label>
        <label className="l-field">
          <span>Test date from</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="l-field">
          <span>Test date to</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      {live.error ? (
        <p className="l-alert l-alert--error" role="alert">
          {live.error}
        </p>
      ) : null}

      {!live.loading && active.length === 0 ? (
        <p className="l-empty">
          No tests yet. Tests captured on the phone appear here automatically once the phone is
          online.
        </p>
      ) : (
        <div className="l-table-wrap">
          <table className="l-table">
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('date')}
                  title="Sort by test date"
                >
                  Test date {sortCol === 'date' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('customer')}
                  title="Sort by customer"
                >
                  Customer {sortCol === 'customer' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('template')}
                  title="Sort by template"
                >
                  Template {sortCol === 'template' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('vehicle')}
                  title="Sort by vehicle"
                >
                  Vehicle {sortCol === 'vehicle' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('tester')}
                  title="Sort by tester"
                >
                  Tester {sortCol === 'tester' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('tyres')}
                  title="Sort by number of tyres"
                >
                  Tyres {sortCol === 'tyres' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('complete')}
                  title="Sort by completion"
                >
                  Complete {sortCol === 'complete' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('status')}
                  title="Sort by status"
                >
                  Status {sortCol === 'status' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  scope="col"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort('updated')}
                  title="Sort by last updated"
                >
                  Updated {sortCol === 'updated' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const pct = progressPercent(s.progress);
                return (
                  <tr key={s.sessionId} className="l-row-link" onClick={() => onOpen(s.sessionId)}>
                    <td>
                      <button
                        type="button"
                        className="l-link"
                        onClick={(e) => {
                          // The row also opens the test; stop the click reaching it twice.
                          e.stopPropagation();
                          onOpen(s.sessionId);
                        }}
                      >
                        {testDateOf(s)}
                      </button>
                    </td>
                    <td>{s.customerName}</td>
                    <td>
                      {s.templateName} <span className="l-muted">v{s.templateVersion}</span>
                    </td>
                    <td>{headerGuess(s, ['vehicle', 'car']) || '–'}</td>
                    <td>{s.createdByName}</td>
                    <td>{Object.keys(s.tyreSets).length}</td>
                    <td>
                      <span className="l-meter" aria-label={`${pct}% rated`}>
                        <span className="l-meter__bar" style={{ width: `${pct}%` }} />
                      </span>{' '}
                      {pct}%
                    </td>
                    <td>
                      <span className={`l-status l-status--${s.status}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                    </td>
                    <td className="l-muted">{formatDate(s.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
