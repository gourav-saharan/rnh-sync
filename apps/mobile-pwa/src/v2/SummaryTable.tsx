// Per-category averages per tyre set with the difference to the Reference
// (R7.3–R7.5). Unrated cells are excluded; "–" means nothing rated yet.

import {
  categoryAverageV2,
  categoryDiffToReference,
  categoryHasWeights,
  formatAverage,
  formatDiff,
  orderedCategories,
  orderedTyreSets,
  totalAverage,
  weightedCategoryAverage,
  type TemplateSchema,
  type TestSessionV2,
} from '@rnh/shared/v2';

export interface SummaryTableProps {
  session: Pick<TestSessionV2, 'cells' | 'tyreSets'>;
  schema: TemplateSchema;
}

export function SummaryTable({ session, schema }: SummaryTableProps): JSX.Element {
  const sets = orderedTyreSets(session);
  const cats = orderedCategories(schema);
  return (
    <div className="ov-wrap">
      <table className="sum-table">
        <caption className="sr-only">Category averages per tyre set</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            {sets.map((t) => (
              <th key={t.tyreSetId} scope="col">
                {t.label}
                {t.isReference ? ' (Ref)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => {
            const weighted = categoryHasWeights(schema, c.categoryId);
            return (
              <tr key={c.categoryId}>
                <th scope="row">{c.name}</th>
                {sets.map((t) => {
                  const avg = categoryAverageV2(session, schema, c.categoryId, t.tyreSetId);
                  const diff = t.isReference
                    ? null
                    : categoryDiffToReference(session, schema, c.categoryId, t.tyreSetId);
                  const w = weighted
                    ? weightedCategoryAverage(session, schema, c.categoryId, t.tyreSetId)
                    : null;
                  return (
                    <td key={t.tyreSetId}>
                      <span className="sum-avg">{formatAverage(avg)}</span>
                      {diff !== null ? (
                        <span
                          className={`sum-diff${diff < 0 ? ' sum-diff--neg' : diff > 0 ? ' sum-diff--pos' : ''}`}
                          aria-label={`difference to reference ${formatDiff(diff)}`}
                        >
                          {formatDiff(diff)}
                        </span>
                      ) : null}
                      {weighted ? (
                        <span className="sum-sub">weighted {formatAverage(w)}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          <tr className="sum-total">
            <th scope="row">Total</th>
            {sets.map((t) => (
              <td key={t.tyreSetId}>{formatAverage(totalAverage(session, schema, t.tyreSetId))}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
