// Drive_Mode overview grid (R6.10): parameters (rows, grouped by category)
// x tyre sets (columns). Each cell shows rated / unrated / commented with a
// symbol as well as colour (R15.4). Tap a cell to jump there.

import {
  cellOf,
  displayName,
  orderedCategories,
  orderedTyreSets,
  parametersIn,
  progressPercent,
  setCursorV2,
} from '@rnh/shared/v2';
import { useSession } from './useSession';

export interface OverviewProps {
  sessionId: string;
  onBack: () => void;
  onJump: () => void;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? v.toFixed(0) : String(v);
}

export function Overview({ sessionId, onBack, onJump }: OverviewProps): JSX.Element {
  const { session, version, apply, loading } = useSession(sessionId);
  if (loading) return <p className="app-loading">Opening…</p>;
  if (!session || !version) {
    return (
      <main className="screen">
        <p className="note note--warn">This test is not on this phone.</p>
        <button type="button" className="btn btn--primary" onClick={onBack}>
          Back
        </button>
      </main>
    );
  }
  const schema = version.schema;
  const sets = orderedTyreSets(session);

  const jump = (paramId: string, tyreSetId: string) => {
    void apply((s) => setCursorV2(s, { paramId, tyreSetId, screen: 'drive' })).then(onJump);
  };

  return (
    <main className="screen">
      <header className="topbar">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
        <h1 className="topbar__title">Overview</h1>
        <span className="chip-status">{progressPercent(session.progress)}% rated</span>
      </header>
      <p className="legend">
        <span className="ov ov--rated">6.5</span> rated · <span className="ov ov--empty">·</span>{' '}
        not rated · <span className="ov ov--rated">6.5💬</span> has comment
      </p>
      <div className="ov-wrap">
        <table className="ov-table">
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              {sets.map((t) => (
                <th key={t.tyreSetId} scope="col">
                  {t.label}
                  {t.isReference ? ' (Ref)' : ''}
                </th>
              ))}
            </tr>
          </thead>
          {orderedCategories(schema).map((c) => (
            <tbody key={c.categoryId}>
              <tr className="ov-cat">
                <th colSpan={sets.length + 1} scope="colgroup">
                  {c.name}
                </th>
              </tr>
              {parametersIn(schema, c.categoryId).map((p) => (
                <tr key={p.paramId}>
                  <th scope="row" className="ov-param">
                    {displayName(p)}
                  </th>
                  {sets.map((t) => {
                    const cell = cellOf(session, p.paramId, t.tyreSetId);
                    const rated = typeof cell.rating === 'number';
                    const isCursor =
                      session.cursor.paramId === p.paramId &&
                      session.cursor.tyreSetId === t.tyreSetId;
                    return (
                      <td key={t.tyreSetId}>
                        <button
                          type="button"
                          className={`ov ${rated ? 'ov--rated' : 'ov--empty'}${isCursor ? ' ov--cursor' : ''}`}
                          aria-label={`${displayName(p)}, ${t.label}: ${
                            rated ? `rated ${fmt(cell.rating as number)}` : 'not rated'
                          }${cell.comment ? ', has comment' : ''}`}
                          onClick={() => jump(p.paramId, t.tyreSetId)}
                        >
                          {rated ? fmt(cell.rating as number) : '·'}
                          {cell.comment ? '💬' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </main>
  );
}
