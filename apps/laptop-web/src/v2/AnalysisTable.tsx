// Analysis results: rows (total / categories / parameters) x tyre groups.
// Each cell shows the mean, the number of ratings (n) and the spread on hover.
// The best group per row is marked with ★ as well as colour (R15.4).

import {
  bestColumnPerRow,
  formatDiff,
  type AnalysisResult,
  type AnalysisValue,
} from '@rnh/shared/v2';

export interface AnalysisTableProps {
  result: AnalysisResult;
  value: AnalysisValue;
}

function fmt(v: number, value: AnalysisValue): string {
  return value === 'diffToRef' ? formatDiff(v) || '0' : v.toFixed(2);
}

/** Background tint by value so strong / weak results stand out at a glance. */
function tone(v: number, value: AnalysisValue): string {
  if (value === 'diffToRef') return v > 0.05 ? 'l-an--pos' : v < -0.05 ? 'l-an--neg' : '';
  if (v >= 7) return 'l-an--pos';
  if (v < 6) return 'l-an--neg';
  return '';
}

export function AnalysisTable({ result, value }: AnalysisTableProps): JSX.Element {
  const best = bestColumnPerRow(result);
  let lastGroup = '';

  return (
    <div className="l-table-wrap">
      <table className="l-table l-table--compact l-an" aria-label="Analysis results">
        <thead>
          <tr>
            <th scope="col">Row</th>
            {result.columns.map((c) => (
              <th key={c.key} scope="col" title={`${c.sessions} test(s)`}>
                {c.label}
                <div className="l-muted l-small">
                  {c.sessions} test{c.sessions === 1 ? '' : 's'}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => {
            const header =
              r.group && r.group !== lastGroup ? (
                <tr key={`g-${r.key}`} className="l-an__group">
                  <th scope="rowgroup" colSpan={result.columns.length + 1}>
                    {r.group}
                  </th>
                </tr>
              ) : null;
            lastGroup = r.group;
            return [
              header,
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                {result.columns.map((c) => {
                  const st = result.cells[`${r.key}|${c.key}`];
                  if (!st) {
                    return (
                      <td key={c.key} className="l-an__empty" aria-label="no data">
                        –
                      </td>
                    );
                  }
                  const isBest = best[r.key] === c.key && result.columns.length > 1;
                  return (
                    <td
                      key={c.key}
                      className={`l-an__cell ${tone(st.mean, value)}${isBest ? ' l-an--best' : ''}`}
                      title={`n=${st.n} · min ${st.min.toFixed(2)} · max ${st.max.toFixed(2)} · sd ${st.sd.toFixed(2)}`}
                    >
                      <span className="l-an__mean">
                        {isBest ? (
                          <span className="l-an__best" aria-label="best">
                            ★{' '}
                          </span>
                        ) : null}
                        {fmt(st.mean, value)}
                      </span>
                      <span className="l-an__n">n={st.n}</span>
                    </td>
                  );
                })}
              </tr>,
            ];
          })}
          <tr className="l-an__overall">
            <th scope="row">Overall</th>
            {result.columns.map((c) => (
              <td key={c.key}>
                {c.overall ? (
                  <>
                    <span className="l-an__mean">{fmt(c.overall.mean, value)}</span>
                    <span className="l-an__n">n={c.overall.n}</span>
                  </>
                ) : (
                  '–'
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
