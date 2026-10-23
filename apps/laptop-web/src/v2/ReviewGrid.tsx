// Laptop review grid (R10.2, R10.3, R10.5): R&H_Parameters as rows grouped by
// Category, Tyre_Sets as columns (rating + comment), Category averages and the
// difference to the Reference_Set. Unrated cells are highlighted.

import {
  categoryAverageV2,
  categoryDiffToReference,
  categoryHasWeights,
  cellOf,
  diffToReference,
  displayName,
  formatAverage,
  formatDiff,
  orderedCategories,
  orderedTyreSets,
  parametersIn,
  totalAverage,
  weightedCategoryAverage,
  type TemplateVersion,
  type TestSessionV2,
} from '@rnh/shared/v2';
import { CommentInput, RatingInput } from './GridInputs';

export interface ReviewGridProps {
  session: TestSessionV2;
  version: TemplateVersion;
  onRating: (paramId: string, tyreSetId: string, value: number | null) => void;
  onComment: (paramId: string, tyreSetId: string, comment: string) => void;
  onHistory: (paramId: string, tyreSetId: string) => void;
}

function diffClass(d: number): string {
  return d < 0 ? 'l-diff l-diff--neg' : d > 0 ? 'l-diff l-diff--pos' : 'l-diff';
}

export function ReviewGrid({
  session,
  version,
  onRating,
  onComment,
  onHistory,
}: ReviewGridProps): JSX.Element {
  const schema = version.schema;
  const sets = orderedTyreSets(session);
  let rowIndex = 0;

  return (
    <div className="l-table-wrap l-grid-wrap">
      <table className="l-grid" aria-label="Rating matrix">
        <thead>
          <tr>
            <th scope="col" className="l-grid__param">
              Parameter
            </th>
            {sets.map((t) => (
              <th
                key={t.tyreSetId}
                scope="colgroup"
                colSpan={2}
                className={t.isReference ? 'l-grid__ref' : ''}
              >
                {t.label} {t.isReference ? <span className="l-tag">REF</span> : null}
                <div className="l-muted l-small">
                  {[t.make, t.pattern].filter(Boolean).join(' · ') || `slot ${t.slot}`}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        {orderedCategories(schema).map((c) => {
          const weighted = categoryHasWeights(schema, c.categoryId);
          return (
            <tbody key={c.categoryId}>
              <tr className="l-grid__cat">
                <th scope="rowgroup" colSpan={1 + sets.length * 2}>
                  {c.name}
                </th>
              </tr>
              {parametersIn(schema, c.categoryId).map((p) => {
                const r = rowIndex++;
                const name = displayName(p);
                return (
                  <tr key={p.paramId}>
                    <th scope="row" className="l-grid__param" title={p.name}>
                      {name}
                      {typeof p.weight === 'number' ? (
                        <span className="l-muted l-small"> ×{p.weight}</span>
                      ) : null}
                    </th>
                    {sets.flatMap((t, ci) => {
                      const cell = cellOf(session, p.paramId, t.tyreSetId);
                      const d = diffToReference(session, p.paramId, t.tyreSetId);
                      return [
                        <td key={`${t.tyreSetId}r`} className="l-grid__rate">
                          <RatingInput
                            value={cell.rating}
                            row={r}
                            col={ci}
                            label={`${name} rating for ${t.label}`}
                            scale={schema.scale}
                            onCommit={(v) => onRating(p.paramId, t.tyreSetId, v)}
                          />
                          {d !== null ? (
                            <span className={diffClass(d)}>{formatDiff(d)}</span>
                          ) : null}
                          <button
                            type="button"
                            className="l-hist-btn"
                            aria-label={`History of ${name} for ${t.label}`}
                            onClick={() => onHistory(p.paramId, t.tyreSetId)}
                          >
                            ⟲
                          </button>
                        </td>,
                        <td
                          key={`${t.tyreSetId}c`}
                          className={`l-grid__comment${cell.conflict ? ' l-grid--conflict' : ''}`}
                        >
                          <CommentInput
                            value={cell.comment}
                            label={`${name} comment for ${t.label}`}
                            onCommit={(v) => onComment(p.paramId, t.tyreSetId, v)}
                          />
                          {cell.conflict ? (
                            <span className="l-small l-warn">edited on two devices</span>
                          ) : null}
                        </td>,
                      ];
                    })}
                  </tr>
                );
              })}
              <tr className="l-grid__avg">
                <th scope="row">{c.name} average</th>
                {sets.map((t) => {
                  const d = categoryDiffToReference(session, schema, c.categoryId, t.tyreSetId);
                  return (
                    <td key={t.tyreSetId} colSpan={2}>
                      <strong>
                        {formatAverage(
                          categoryAverageV2(session, schema, c.categoryId, t.tyreSetId),
                        )}
                      </strong>
                      {weighted ? (
                        <span className="l-muted l-small">
                          {' '}
                          · weighted{' '}
                          {formatAverage(
                            weightedCategoryAverage(session, schema, c.categoryId, t.tyreSetId),
                          )}
                        </span>
                      ) : null}
                      {d !== null ? <span className={diffClass(d)}> {formatDiff(d)}</span> : null}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          );
        })}
        <tfoot>
          <tr className="l-grid__total">
            <th scope="row">Total average</th>
            {sets.map((t) => (
              <td key={t.tyreSetId} colSpan={2}>
                <strong>{formatAverage(totalAverage(session, schema, t.tyreSetId))}</strong>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
