// Cross-test analysis (laptop "Analysis" section). Pure.
//
// Pools ratings from many Test_Sessions (possibly from different templates),
// matches parameters / categories across templates by normalised name, groups
// tyre sets (by label, make, pattern, make+pattern or size) and returns
// per-cell statistics. Unrated cells are never counted (R7.2).

import {
  normalizeLabel,
  orderedTyreSets,
  referenceSet,
  type SessionStatus,
  type TemplateVersion,
  type TestSessionV2,
  type TyreSetV2,
} from './model';
import {
  categoryAverageV2,
  ratingOf,
  totalAverage,
  weightedCategoryAverage,
  categoryHasWeights,
} from './rating';

export type AnalysisLevel = 'parameter' | 'category' | 'total';
export type AnalysisValue = 'rating' | 'diffToRef';
export type AnalysisGroupBy = 'label' | 'make' | 'pattern' | 'makePattern' | 'size';

export interface AnalysisFilter {
  customer?: string;
  templateId?: string;
  tester?: string;
  status?: SessionStatus | '';
  /** Inclusive YYYY-MM-DD bounds on the test date. */
  from?: string;
  to?: string;
  /** Free text matched against tyre label / make / pattern / size. */
  text?: string;
  includeReference?: boolean;
}

export interface AnalysisOptions {
  level: AnalysisLevel;
  value: AnalysisValue;
  groupBy: AnalysisGroupBy;
  /** Use template weights for category averages where defined (Hyundai). */
  weighted: boolean;
  filter: AnalysisFilter;
}

export const DEFAULT_ANALYSIS: AnalysisOptions = {
  level: 'category',
  value: 'rating',
  groupBy: 'makePattern',
  weighted: true,
  filter: { includeReference: true },
};

export interface AnalysisInput {
  session: TestSessionV2;
  version: TemplateVersion;
}

export interface Stat {
  n: number;
  mean: number;
  min: number;
  max: number;
  sd: number;
}

export interface AnalysisRow {
  key: string;
  label: string;
  group: string;
}

export interface AnalysisColumn {
  key: string;
  label: string;
  /** Tests contributing at least one value. */
  sessions: number;
  overall: Stat | null;
}

export interface AnalysisResult {
  rows: AnalysisRow[];
  columns: AnalysisColumn[];
  /** `${rowKey}|${columnKey}` -> stats. */
  cells: Record<string, Stat>;
  sessionCount: number;
  observationCount: number;
}

/** Test date: first date header field, else the creation day. */
export function sessionDate(s: TestSessionV2, v: TemplateVersion): string {
  for (const f of v.schema.headerFields) {
    const raw = s.header[f.fieldId];
    if (f.type === 'date' && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw))
      return raw.slice(0, 10);
  }
  return new Date(s.createdAt).toISOString().slice(0, 10);
}

export function sessionMatches(s: TestSessionV2, v: TemplateVersion, f: AnalysisFilter): boolean {
  if (s.deletedAt) return false;
  if (f.customer && s.customerName !== f.customer) return false;
  if (f.templateId && s.templateId !== f.templateId) return false;
  if (f.tester && s.createdByName !== f.tester) return false;
  if (f.status && s.status !== f.status) return false;
  const d = sessionDate(s, v);
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  return true;
}

export function tyreMatches(t: TyreSetV2, f: AnalysisFilter): boolean {
  if (t.isReference && f.includeReference === false) return false;
  const q = (f.text ?? '').trim().toLowerCase();
  if (!q) return true;
  return [t.label, t.make, t.pattern, t.size].some((x) => (x ?? '').toLowerCase().includes(q));
}

export function groupOf(t: TyreSetV2, by: AnalysisGroupBy): { key: string; label: string } {
  const clean = (x: string, empty: string) => (x ?? '').trim() || empty;
  let label: string;
  if (by === 'label') label = clean(t.label, '(no label)');
  else if (by === 'make') label = clean(t.make, '(no make)');
  else if (by === 'pattern') label = clean(t.pattern, '(no pattern)');
  else if (by === 'size') label = clean(t.size, '(no size)');
  else
    label =
      [t.make, t.pattern]
        .map((x) => (x ?? '').trim())
        .filter(Boolean)
        .join(' ') || '(no make / pattern)';
  return { key: label.toLowerCase().replace(/\s+/g, ' '), label };
}

export function statOf(values: readonly number[]): Stat | null {
  if (values.length === 0) return null;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, min: Math.min(...values), max: Math.max(...values), sd: Math.sqrt(variance) };
}

/** One (row, value) pair for a tyre set in a session, before reference diff. */
interface RowValue {
  row: AnalysisRow;
  value: number | null;
}

/** Row values for one tyre set at the chosen level. Rows match across templates by normalised name. */
function rowValues(
  s: TestSessionV2,
  v: TemplateVersion,
  tyreSetId: string,
  level: AnalysisLevel,
  weighted: boolean,
): RowValue[] {
  const schema = v.schema;
  if (level === 'total') {
    return [
      {
        row: { key: 'total', label: 'Total average', group: '' },
        value: totalAverage(s, schema, tyreSetId),
      },
    ];
  }
  const catName = new Map(schema.categories.map((c) => [c.categoryId, c.name]));
  if (level === 'category') {
    return schema.categories.map((c) => ({
      row: { key: `c:${normalizeLabel(c.name)}`, label: c.name, group: '' },
      value:
        weighted && categoryHasWeights(schema, c.categoryId)
          ? weightedCategoryAverage(s, schema, c.categoryId, tyreSetId)
          : categoryAverageV2(s, schema, c.categoryId, tyreSetId),
    }));
  }
  return schema.parameters.map((p) => {
    const cat = catName.get(p.categoryId) ?? '';
    const name = p.shortName?.trim() || p.name;
    return {
      row: { key: `p:${normalizeLabel(cat)}:${normalizeLabel(p.name)}`, label: name, group: cat },
      value: ratingOf(s, p.paramId, tyreSetId),
    };
  });
}

/**
 * Pool the selected sessions into a rows x tyre-groups table of statistics.
 * `diffToRef` subtracts the same session's Reference_Set value per row, so
 * only sessions with a rated Reference contribute; the Reference itself is
 * then excluded (its diff is always 0).
 */
export function analyze(inputs: readonly AnalysisInput[], opts: AnalysisOptions): AnalysisResult {
  const rowOrder: AnalysisRow[] = [];
  const rowSeen = new Set<string>();
  const colLabel = new Map<string, string>();
  const colSessions = new Map<string, Set<string>>();
  const values = new Map<string, number[]>();
  const colValues = new Map<string, number[]>();
  const used = new Set<string>();
  let observations = 0;

  for (const { session: s, version: v } of inputs) {
    if (!sessionMatches(s, v, opts.filter)) continue;
    const ref = referenceSet(s);
    const refRows =
      opts.value === 'diffToRef' && ref
        ? new Map(
            rowValues(s, v, ref.tyreSetId, opts.level, opts.weighted).map((r) => [
              r.row.key,
              r.value,
            ]),
          )
        : null;
    if (opts.value === 'diffToRef' && !refRows) continue;

    for (const t of orderedTyreSets(s)) {
      if (!tyreMatches(t, opts.filter)) continue;
      if (opts.value === 'diffToRef' && t.isReference) continue;
      const g = groupOf(t, opts.groupBy);
      for (const { row, value } of rowValues(s, v, t.tyreSetId, opts.level, opts.weighted)) {
        if (!rowSeen.has(row.key)) {
          rowSeen.add(row.key);
          rowOrder.push(row);
        }
        if (value === null) continue;
        let x = value;
        if (refRows) {
          const r = refRows.get(row.key);
          if (r === null || r === undefined) continue;
          x = value - r;
        }
        const k = `${row.key}|${g.key}`;
        (values.get(k) ?? values.set(k, []).get(k)!).push(x);
        (colValues.get(g.key) ?? colValues.set(g.key, []).get(g.key)!).push(x);
        colLabel.set(g.key, g.label);
        (colSessions.get(g.key) ?? colSessions.set(g.key, new Set()).get(g.key)!).add(s.sessionId);
        used.add(s.sessionId);
        observations += 1;
      }
    }
  }

  const cells: Record<string, Stat> = {};
  for (const [k, list] of values) {
    const st = statOf(list);
    if (st) cells[k] = st;
  }
  const columns: AnalysisColumn[] = [...colLabel.entries()]
    .map(([key, label]) => ({
      key,
      label,
      sessions: colSessions.get(key)?.size ?? 0,
      overall: statOf(colValues.get(key) ?? []),
    }))
    .sort(
      (a, b) =>
        (b.overall?.mean ?? -Infinity) - (a.overall?.mean ?? -Infinity) ||
        a.label.localeCompare(b.label),
    );

  // Only keep rows that have at least one value somewhere.
  const rows = rowOrder.filter((r) => columns.some((c) => cells[`${r.key}|${c.key}`]));
  return { rows, columns, cells, sessionCount: used.size, observationCount: observations };
}

/** Best column (highest mean) per row, for highlighting. */
export function bestColumnPerRow(result: AnalysisResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of result.rows) {
    let best: { key: string; mean: number } | null = null;
    for (const c of result.columns) {
      const st = result.cells[`${r.key}|${c.key}`];
      if (st && (!best || st.mean > best.mean)) best = { key: c.key, mean: st.mean };
    }
    if (best) out[r.key] = best.key;
  }
  return out;
}

/** CSV (comma-separated, quoted) of the result's means, with n per cell. */
export function analysisToCsv(result: AnalysisResult): string {
  const q = (x: string) => `"${x.replace(/"/g, '""')}"`;
  const head = ['Group', 'Row', ...result.columns.flatMap((c) => [c.label, `${c.label} n`])];
  const lines = [head.map(q).join(',')];
  for (const r of result.rows) {
    const cells = result.columns.flatMap((c) => {
      const st = result.cells[`${r.key}|${c.key}`];
      return st ? [st.mean.toFixed(2), String(st.n)] : ['', ''];
    });
    lines.push([q(r.group), q(r.label), ...cells].join(','));
  }
  const overall = result.columns.flatMap((c) =>
    c.overall ? [c.overall.mean.toFixed(2), String(c.overall.n)] : ['', ''],
  );
  lines.push([q(''), q('Overall'), ...overall].join(','));
  return lines.join('\r\n');
}
