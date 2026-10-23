// Analysis controls: filters (customer, template, tester, status, dates,
// tyre text), what to show (level, rating vs difference to Ref) and how to
// group tyre sets.

import type { AnalysisOptions, SessionStatus } from '@rnh/shared/v2';
import { GROUPS, LEVELS, STATUSES, Seg, VALUES } from './AnalysisSeg';

export interface AnalysisChoices {
  customers: string[];
  templates: { id: string; label: string }[];
  testers: string[];
}

export interface AnalysisControlsProps {
  opts: AnalysisOptions;
  choices: AnalysisChoices;
  onChange: (o: AnalysisOptions) => void;
  onReset: () => void;
}

export function AnalysisControls({
  opts,
  choices,
  onChange,
  onReset,
}: AnalysisControlsProps): JSX.Element {
  const f = opts.filter;
  const setF = (patch: Partial<AnalysisOptions['filter']>) =>
    onChange({ ...opts, filter: { ...f, ...patch } });

  return (
    <section className="l-card" aria-label="Analysis settings">
      <div className="l-row l-row--between l-an-head">
        <h3 className="l-card__title">What to analyse</h3>
        <button type="button" className="l-btn l-btn--ghost l-btn--small" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="l-an-filters">
        <label className="l-field">
          <span className="l-field__label">Customer</span>
          <select
            className="l-input"
            value={f.customer ?? ''}
            onChange={(e) => setF({ customer: e.target.value || undefined })}
          >
            <option value="">All customers</option>
            {choices.customers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="l-field">
          <span className="l-field__label">Template</span>
          <select
            className="l-input"
            value={f.templateId ?? ''}
            onChange={(e) => setF({ templateId: e.target.value || undefined })}
          >
            <option value="">All templates</option>
            {choices.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="l-field">
          <span className="l-field__label">Tester</span>
          <select
            className="l-input"
            value={f.tester ?? ''}
            onChange={(e) => setF({ tester: e.target.value || undefined })}
          >
            <option value="">All testers</option>
            {choices.testers.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="l-field">
          <span className="l-field__label">Status</span>
          <select
            className="l-input"
            value={f.status ?? ''}
            onChange={(e) => setF({ status: e.target.value as '' | SessionStatus })}
          >
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="l-field">
          <span className="l-field__label">Test date from</span>
          <input
            className="l-input"
            type="date"
            value={f.from ?? ''}
            max={f.to || undefined}
            onChange={(e) => setF({ from: e.target.value || undefined })}
          />
        </label>
        <label className="l-field">
          <span className="l-field__label">Test date to</span>
          <input
            className="l-input"
            type="date"
            value={f.to ?? ''}
            min={f.from || undefined}
            onChange={(e) => setF({ to: e.target.value || undefined })}
          />
        </label>
        <label className="l-field">
          <span className="l-field__label">Tyre contains</span>
          <input
            className="l-input"
            value={f.text ?? ''}
            placeholder="make, pattern, size or label"
            onChange={(e) => setF({ text: e.target.value || undefined })}
          />
        </label>
      </div>

      <div className="l-an-view">
        <Seg
          label="Rows"
          value={opts.level}
          items={LEVELS}
          onPick={(level) => onChange({ ...opts, level })}
        />
        <Seg
          label="Value"
          value={opts.value}
          items={VALUES}
          onPick={(value) => onChange({ ...opts, value })}
        />
        <Seg
          label="Compare tyres by"
          value={opts.groupBy}
          items={GROUPS}
          onPick={(groupBy) => onChange({ ...opts, groupBy })}
        />
      </div>

      <div className="l-an-checks">
        <label className="l-check">
          <input
            type="checkbox"
            checked={f.includeReference !== false}
            onChange={(e) => setF({ includeReference: e.target.checked })}
          />
          Include Reference tyres
        </label>
        <label className="l-check">
          <input
            type="checkbox"
            checked={opts.weighted}
            disabled={opts.level === 'parameter'}
            onChange={(e) => onChange({ ...opts, weighted: e.target.checked })}
          />
          Use template weights for category and total averages
          {opts.level === 'parameter' ? (
            <span className="l-muted"> (not used for parameter rows)</span>
          ) : null}
        </label>
      </div>
    </section>
  );
}
