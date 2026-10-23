// Template Studio · mapping coverage summary (R4.10): which ratings, comments
// and header fields have a target cell. Missing items are marked with a
// symbol as well as colour (R15.4).

import { coverageOf, displayName, type ExpandInput, type ResolvedTarget } from '@rnh/shared/v2';

export function MappingCoverage({
  input,
  targets,
}: {
  input: ExpandInput;
  targets: ResolvedTarget[];
}): JSX.Element {
  const cov = coverageOf(input, targets);
  const slots = Array.from({ length: input.schema.slotCount }, (_, i) => i + 1);
  const byKey = new Map(cov.cells.map((c) => [`${c.paramId}#${c.slot}`, c]));

  return (
    <section className="l-card" aria-label="Mapping coverage">
      <h3>Coverage</h3>
      <p className="l-small">
        Ratings mapped: <strong>{cov.ratingMapped}</strong> / {cov.ratingTotal} · Comments mapped:{' '}
        <strong>{cov.commentMapped}</strong> / {cov.ratingTotal} · Tyre slots with ratings:{' '}
        <strong>{cov.mappedSlots.length ? cov.mappedSlots.join(', ') : 'none'}</strong>
      </p>
      {input.schema.parameters.length > 0 ? (
        <div className="l-table-wrap">
          <table className="l-table l-table--compact" aria-label="Coverage by parameter and slot">
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                {slots.map((s) => (
                  <th key={s} scope="col">
                    S{s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {input.schema.parameters.map((p) => (
                <tr key={p.paramId}>
                  <th scope="row">{displayName(p)}</th>
                  {slots.map((s) => {
                    const c = byKey.get(`${p.paramId}#${s}`);
                    const r = !!c?.rating;
                    const m = !!c?.comment;
                    return (
                      <td
                        key={s}
                        className={r ? 'l-cov l-cov--ok' : 'l-cov l-cov--miss'}
                        aria-label={`${displayName(p)} slot ${s}: rating ${r ? 'mapped' : 'missing'}, comment ${m ? 'mapped' : 'missing'}`}
                      >
                        {r ? '✓' : '✗'}
                        {m ? 'c' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {input.schema.headerFields.length > 0 ? (
        <ul className="l-list l-list--inline" aria-label="Header field coverage">
          {input.schema.headerFields.map((f) => (
            <li key={f.fieldId} className={cov.headerFields[f.fieldId] ? 'l-ok' : 'l-miss'}>
              {cov.headerFields[f.fieldId] ? '✓' : '✗'} {f.label}
              {f.required && !cov.headerFields[f.fieldId] ? ' (required)' : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
