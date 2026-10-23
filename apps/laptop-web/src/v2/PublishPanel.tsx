// Template Studio · check and publish (R2.4, R2.6, R3.8, R4.7). Publishing is
// blocked while schema or mapping problems exist; each problem is listed.
// Published versions are immutable; sessions keep using the version they
// were started on.

import { useEffect, useMemo, useState } from 'react';
import {
  coverageOf,
  expandMappings,
  hasBlockingProblems,
  validateSchema,
  type CustomerTemplateV2,
  type TemplateVersion,
} from '@rnh/shared/v2';
import { formatDate, plainError, useLaptop } from './context';

export function PublishPanel({
  template,
  onGoToStep,
}: {
  template: CustomerTemplateV2;
  onGoToStep?: (step: number) => void;
}): JSX.Element {
  const { templates, user } = useLaptop();
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const d = template.draft;
  const input = useMemo(
    () => ({ structure: d.structure, schema: d.schema, mappings: d.mappings }),
    [d.structure, d.schema, d.mappings],
  );
  const schemaProblems = useMemo(() => validateSchema(d.schema), [d.schema]);
  const expanded = useMemo(() => expandMappings(input), [input]);
  const coverage = useMemo(() => coverageOf(input, expanded.targets), [input, expanded.targets]);
  const mappingErrors = expanded.problems.filter((p) => p.severity === 'error');
  const noRatings = coverage.ratingMapped === 0;
  const blocked =
    !d.structure ||
    schemaProblems.length > 0 ||
    hasBlockingProblems(expanded.problems) ||
    noRatings;

  const blockingReasons: { text: string; step?: number; label?: string }[] = [];
  if (!d.structure) {
    blockingReasons.push({ text: 'No Excel workbook loaded. Please upload a workbook first.' });
  }
  if (schemaProblems.length > 0) {
    for (const p of schemaProblems) {
      blockingReasons.push({
        text: `Parameters: ${p.message}`,
        step: 0,
        label: 'Go to Step 1 (Parameters)',
      });
    }
  }
  if (mappingErrors.length > 0) {
    for (const p of mappingErrors) {
      blockingReasons.push({
        text: `Mapping: ${p.message}`,
        step: 3,
        label: 'Go to Step 4 (Mapping)',
      });
    }
  }
  if (noRatings) {
    blockingReasons.push({
      text: 'No ratings are mapped yet (0 mapped). At least 1 parameter rating must be mapped to an Excel cell in Step 4 before publishing so tester scores can be written into the report.',
      step: 3,
      label: 'Go to Step 4 (Mapping)',
    });
  }

  useEffect(() => {
    let active = true;
    templates
      .listVersions(template.templateId)
      .then((v) => active && setVersions(v))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [templates, template.templateId, template.latestVersion]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await templates.publish(template.templateId, user.uid);
      setDone(v.version);
    } catch (e) {
      setError(`Publish failed: ${plainError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="l-card" aria-label="Check and publish">
      <h3>Check and publish</h3>
      <ul className="l-list">
        <li className={schemaProblems.length ? 'l-miss' : 'l-ok'}>
          {schemaProblems.length ? '✗' : '✓'} Parameters: {d.schema.parameters.length} in{' '}
          {d.schema.categories.length} categories
        </li>
        <li className={noRatings ? 'l-miss' : 'l-ok'}>
          {noRatings ? '✗' : '✓'} Ratings mapped: {coverage.ratingMapped} / {coverage.ratingTotal} ·
          comments {coverage.commentMapped} · tyre slots {coverage.mappedSlots.join(', ') || 'none'}
        </li>
        <li className={mappingErrors.length ? 'l-miss' : 'l-ok'}>
          {mappingErrors.length ? '✗' : '✓'} Mapping problems: {mappingErrors.length}
        </li>
      </ul>
      {blockingReasons.length > 0 ? (
        <div className="l-alert l-alert--danger" role="alert" style={{ marginBottom: '1rem' }}>
          <p style={{ fontWeight: 600 }}>Cannot publish yet — please complete the following:</p>
          <ul style={{ margin: '0.5rem 0 0.5rem 1.25rem' }}>
            {blockingReasons.map((r, i) => (
              <li key={i}>{r.text}</li>
            ))}
          </ul>
          {onGoToStep ? (
            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="l-btn l-btn--secondary"
                onClick={() => {
                  const targetStep = blockingReasons.find((r) => r.step !== undefined)?.step ?? 3;
                  onGoToStep(targetStep);
                }}
              >
                {blockingReasons.find((r) => r.step !== undefined)?.label ?? 'Go to Step 4 (Mapping)'} →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {coverage.ratingMapped < coverage.ratingTotal && !noRatings ? (
        <p className="l-alert l-alert--warn">
          Some parameter / tyre slot ratings have no cell. Those values will not appear in the
          report.
        </p>
      ) : null}

      <div className="l-row">
        <button
          type="button"
          className="l-btn l-btn--primary"
          disabled={blocked || busy}
          onClick={() => void publish()}
          title={blocked ? blockingReasons.map((r) => r.text).join(' • ') : undefined}
        >
          {busy ? 'Publishing…' : `Publish as version ${(template.latestVersion ?? 0) + 1}`}
        </button>
        <span className="l-muted l-small">
          Testers get the new version on their next sync. Existing tests keep theirs.
        </span>
      </div>
      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="l-alert l-alert--ok">Version {done} published.</p> : null}

      <h4>Published versions</h4>
      {versions.length === 0 ? (
        <p className="l-muted">Not published yet.</p>
      ) : (
        <table className="l-table l-table--compact">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Published</th>
              <th scope="col">Parameters</th>
              <th scope="col">Mappings</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td>v{v.version}</td>
                <td>{formatDate(v.publishedAt)}</td>
                <td>{v.schema.parameters.length}</td>
                <td>{v.mappings.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
