// Excel-like grid rendering of one SheetGrid (R2.3, R4.5, R12.1). Merged
// ranges span rows/columns, column widths follow the workbook, formula cells
// are marked "ƒ", and highlighted cells are outlined by kind (with a text
// marker as well as colour, R15.4). Clicking a cell reports its address.

import { useMemo } from 'react';
import { colToLetters, parseRange, toA1, type SheetGrid } from '@rnh/shared/v2';

export type HighlightKind =
  'rating' | 'comment' | 'header' | 'slotDetail' | 'written' | 'select' | 'problem';

export interface SheetViewProps {
  grid: SheetGrid;
  /** A1 -> highlight kind. */
  highlights?: Record<string, HighlightKind>;
  /** A1 -> override text (e.g. filled report values). */
  values?: Record<string, string | number | null>;
  /** Rendering cap for very large sheets. */
  maxRows?: number;
  maxCols?: number;
  onCellClick?: (address: string, shift: boolean) => void;
  /** Extra hover text per cell, e.g. what a mapping writes there. */
  cellTitle?: (address: string) => string;
}

const MARK: Record<HighlightKind, string> = {
  rating: 'R',
  comment: 'C',
  header: 'H',
  slotDetail: 'T',
  written: '✎',
  select: '',
  problem: '!',
};

export function SheetView({
  grid,
  highlights = {},
  values,
  maxRows = 80,
  maxCols = 30,
  onCellClick,
  cellTitle,
}: SheetViewProps): JSX.Element {
  const rows = Math.min(grid.rowCount || 1, maxRows);
  const cols = Math.min(grid.columnCount || 1, maxCols);

  // Merge map: master -> span, covered cells -> skip.
  const { spans, covered } = useMemo(() => {
    const spans = new Map<string, { rowSpan: number; colSpan: number }>();
    const covered = new Set<string>();
    for (const m of grid.mergedRanges) {
      const r = parseRange(m);
      if (!r) continue;
      spans.set(toA1(r.top, r.left), {
        rowSpan: r.bottom - r.top + 1,
        colSpan: r.right - r.left + 1,
      });
      for (let y = r.top; y <= r.bottom; y += 1) {
        for (let x = r.left; x <= r.right; x += 1) {
          if (y !== r.top || x !== r.left) covered.add(toA1(y, x));
        }
      }
    }
    return { spans, covered };
  }, [grid]);

  const body: JSX.Element[] = [];
  for (let r = 1; r <= rows; r += 1) {
    const tds: JSX.Element[] = [
      <th key="h" scope="row" className="sv__rowhead">
        {r}
      </th>,
    ];
    for (let c = 1; c <= cols; c += 1) {
      const a = toA1(r, c);
      if (covered.has(a)) continue;
      const span = spans.get(a);
      const cell = grid.cells[a];
      const hl = highlights[a];
      const shown = values && a in values ? values[a] : (cell?.v ?? null);
      const isFormula = cell?.f !== undefined;
      tds.push(
        <td
          key={a}
          rowSpan={span ? Math.min(span.rowSpan, rows - r + 1) : undefined}
          colSpan={span ? Math.min(span.colSpan, cols - c + 1) : undefined}
          className={`sv__cell${hl ? ` sv__cell--${hl}` : ''}${isFormula ? ' sv__cell--formula' : ''}`}
          title={[isFormula ? `${a}: =${cell!.f}` : a, cellTitle?.(a) ?? '']
            .filter(Boolean)
            .join(' · ')}
          onClick={onCellClick ? (e) => onCellClick(a, e.shiftKey) : undefined}
        >
          {hl && MARK[hl] ? (
            <span className="sv__mark" aria-hidden="true">
              {MARK[hl]}
            </span>
          ) : null}
          {isFormula ? (
            <span className="sv__f" aria-label="formula">
              ƒ
            </span>
          ) : null}
          {shown === null || shown === undefined ? '' : String(shown)}
        </td>,
      );
    }
    body.push(<tr key={r}>{tds}</tr>);
  }

  return (
    <div className="sv" role="region" aria-label={`Sheet ${grid.name}`}>
      <table className="sv__table">
        <colgroup>
          <col style={{ width: 36 }} />
          {Array.from({ length: cols }, (_, i) => (
            <col
              key={i}
              style={{ width: Math.round(Math.min(40, grid.columnWidths[i + 1] ?? 8.43) * 7 + 8) }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sv__corner" />
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} scope="col" className="sv__colhead">
                {colToLetters(i + 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
      {grid.rowCount > rows || grid.columnCount > cols ? (
        <p className="l-muted l-small">
          Showing {rows} of {grid.rowCount} rows and {cols} of {grid.columnCount} columns.
        </p>
      ) : null}
    </div>
  );
}
