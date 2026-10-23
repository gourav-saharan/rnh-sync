// Analysis section: compare tyres across many tests. The user chooses the
// filters, the rows (total / categories / parameters), the value (rating or
// difference to the Reference) and how tyres are grouped, saves views, and
// exports the table as CSV for Excel.

import { useEffect, useMemo, useState } from 'react';
import { analysisToCsv, analyze, DEFAULT_ANALYSIS, type AnalysisOptions } from '@rnh/shared/v2';
import { downloadBytes, useLaptop } from './context';
import { useAnalysisData } from './useAnalysisData';
import { AnalysisControls, type AnalysisChoices } from './AnalysisControls';
import { AnalysisTable } from './AnalysisTable';
import { deleteView, loadLast, loadViews, saveLast, saveView, type SavedView } from './savedViews';

/** True when any filter narrows the tests (the Reference toggle counts only when off). */
export function hasFilters(o: AnalysisOptions): boolean {
  const f = o.filter;
  return Boolean(
    f.customer ||
    f.templateId ||
    f.tester ||
    f.status ||
    f.from ||
    f.to ||
    f.text?.trim() ||
    f.includeReference === false,
  );
}

/** Explains why the result is empty instead of always blaming the filters. */
export function emptyMessage(
  testCount: number,
  filtered: boolean,
  value: AnalysisOptions['value'],
): string {
  if (testCount === 0)
    return 'No tests to analyse yet. Tests captured on the phone appear here once they sync.';
  if (value === 'diffToRef') {
    return filtered
      ? 'No matching tests with a rated Reference tyre. Try "Average rating" or clear some filters.'
      : 'No test has a rated Reference tyre yet. Try "Average rating" instead.';
  }
  return filtered
    ? 'No ratings match these filters. Widen the date range or clear some filters.'
    : `${testCount} test(s) found, but none has any ratings yet.`;
}

export function AnalysisPage(): JSX.Element {
  const { user } = useLaptop();
  const data = useAnalysisData();
  const [opts, setOpts] = useState<AnalysisOptions>(() => loadLast(user.uid));
  const [views, setViews] = useState<SavedView[]>(() => loadViews(user.uid));
  const [viewName, setViewName] = useState('');

  useEffect(() => saveLast(user.uid, opts), [user.uid, opts]);

  const choices = useMemo<AnalysisChoices>(() => {
    const uniq = (xs: string[]) =>
      [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const tpl = new Map<string, string>();
    for (const i of data.inputs)
      tpl.set(i.session.templateId, `${i.session.customerName} · ${i.session.templateName}`);
    return {
      customers: uniq(data.inputs.map((i) => i.session.customerName)),
      testers: uniq(data.inputs.map((i) => i.session.createdByName)),
      templates: [...tpl.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [data.inputs]);

  const result = useMemo(() => analyze(data.inputs, opts), [data.inputs, opts]);

  const exportCsv = () => {
    // BOM so Excel opens UTF-8 (°C, ±, names) correctly.
    const bytes = new TextEncoder().encode(`\uFEFF${analysisToCsv(result)}`);
    downloadBytes(bytes, `RnH-analysis-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  return (
    <main className="l-page" aria-label="Analysis">
      <header className="l-page__head">
        <div className="l-page__titles">
          <h2 className="l-page__title">Analysis</h2>
          <p className="l-muted l-small">
            Compare tyres across tests. Tests from different templates are combined by matching
            category and parameter names. Empty ratings are never counted.
          </p>
        </div>
        <div className="l-row">
          <button
            type="button"
            className="l-btn"
            disabled={result.rows.length === 0}
            onClick={exportCsv}
          >
            ⬇ Export CSV
          </button>
        </div>
      </header>

      <section className="l-card" aria-label="Saved views">
        <form
          className="l-save-view"
          onSubmit={(e) => {
            e.preventDefault();
            if (!viewName.trim()) return;
            setViews(saveView(user.uid, viewName, opts));
            setViewName('');
          }}
        >
          <label className="l-field">
            <span className="l-field__label">Save this view as</span>
            <input
              className="l-input"
              value={viewName}
              placeholder="e.g. MSIL handling, last 3 months"
              onChange={(e) => setViewName(e.target.value)}
            />
          </label>
          <button type="submit" className="l-btn l-btn--primary" disabled={!viewName.trim()}>
            Save view
          </button>
        </form>
        {views.length > 0 ? (
          <ul className="l-chips l-saved-list" aria-label="Saved views list">
            {views.map((v) => (
              <li key={v.name} className="l-chip">
                <button type="button" className="l-link" onClick={() => setOpts(v.opts)}>
                  {v.name}
                </button>
                <button
                  type="button"
                  className="l-chip__x"
                  aria-label={`Delete view ${v.name}`}
                  onClick={() => setViews(deleteView(user.uid, v.name))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <AnalysisControls
        opts={opts}
        choices={choices}
        onChange={setOpts}
        onReset={() => setOpts(DEFAULT_ANALYSIS)}
      />

      {data.error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {data.error}
        </p>
      ) : null}
      {data.skipped > 0 ? (
        <p className="l-alert l-alert--warn">
          {data.skipped} test(s) skipped because their template could not be loaded.
        </p>
      ) : null}

      {data.loading ? (
        <p className="l-loading">Loading tests…</p>
      ) : result.rows.length === 0 ? (
        <div className="l-empty" role="status">
          <p>{emptyMessage(data.inputs.length, hasFilters(opts), opts.value)}</p>
          {hasFilters(opts) ? (
            <button type="button" className="l-btn" onClick={() => setOpts(DEFAULT_ANALYSIS)}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <section aria-label="Results">
          <p className="l-muted l-small" role="status">
            {result.sessionCount} test(s) · {result.observationCount} values ·{' '}
            {result.columns.length} tyre group(s). Hover a cell for min / max / spread. ★ = best in
            the row.
          </p>
          <AnalysisTable result={result} value={opts.value} />
        </section>
      )}
    </main>
  );
}
