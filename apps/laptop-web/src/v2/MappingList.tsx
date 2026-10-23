// Template Studio · list of mappings + expansion problems (R4.6–R4.8).

import type { ExpandProblem, Mapping } from '@rnh/shared/v2';
import type { HighlightKind } from './SheetView';

export function describeMapping(m: Mapping): string {
  if (m.kind === 'block') {
    return `Rating block · ${m.rows.length} rows · slots ${m.firstSlot}–${m.firstSlot + m.slotCount - 1}`;
  }
  if (m.kind === 'header') return `Header field · ${m.cellAddress}`;
  return `Tyre ${m.detail} · ${m.cells.map((c) => `S${c.slot}:${c.cellAddress}`).join(' ')}`;
}

export function MappingList({
  mappings,
  problems,
  onRemove,
}: {
  mappings: Mapping[];
  problems: ExpandProblem[];
  onRemove: (mappingId: string) => void;
}): JSX.Element {
  return (
    <>
      <h3>Mappings ({mappings.length})</h3>
      {mappings.length === 0 ? <p className="l-muted">No mappings yet.</p> : null}
      <ul className="l-list">
        {mappings.map((m) => (
          <li key={m.mappingId} className="l-list__row">
            <span>
              <strong>{m.sheetName}</strong> · {describeMapping(m)}
            </span>
            <button
              type="button"
              className="l-btn l-btn--ghost-danger"
              onClick={() => onRemove(m.mappingId)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {problems.length > 0 ? (
        <ul className="l-list" aria-label="Mapping problems">
          {problems.map((p, i) => (
            <li key={i} className={p.severity === 'error' ? 'l-alert l-alert--danger' : 'l-alert'}>
              {p.severity === 'error' ? '! ' : 'i '}
              {p.message}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Cells of an A1 region, highlighted as the current selection (capped at 200 rows). */
export function selectOf(region: string): Record<string, HighlightKind> {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(region.trim());
  if (!m) return {};
  const toCol = (s: string) =>
    [...s.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const toLetters = (n: number): string =>
    n <= 0 ? '' : toLetters(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26));
  const c1 = toCol(m[1]);
  const c2 = m[3] ? toCol(m[3]) : c1;
  const r1 = Number(m[2]);
  const r2 = m[4] ? Number(m[4]) : r1;
  const top = Math.min(r1, r2);
  const out: Record<string, HighlightKind> = {};
  for (let r = top; r <= Math.max(r1, r2) && r - top < 200; r += 1) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1)
      out[`${toLetters(c)}${r}`] = 'select';
  }
  return out;
}
