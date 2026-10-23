// Cross-test analysis: pooling, grouping, reference diff, filters, CSV.
import { describe, expect, it } from 'vitest';
import {
  analysisToCsv,
  analyze,
  bestColumnPerRow,
  DEFAULT_ANALYSIS,
  type AnalysisOptions,
} from './analysis';
import {
  cellKey,
  emptySchema,
  type TemplateVersion,
  type TestSessionV2,
  type TyreSetV2,
} from './model';
import { blankTyreSetV2 } from './session';

function version(id: string, paramNames: string[]): TemplateVersion {
  const schema = emptySchema();
  schema.categories = [{ categoryId: `${id}_ride`, name: 'Ride', order: 0 }];
  schema.parameters = paramNames.map((name, i) => ({
    paramId: `${id}_p${i}`,
    categoryId: `${id}_ride`,
    name,
    order: i,
  }));
  schema.slotCount = 8;
  return {
    templateId: id,
    customerName: id.toUpperCase(),
    templateName: 'T',
    version: 1,
    storagePath: '',
    structure: { sheets: [] },
    schema,
    mappings: [],
    publishedBy: 'u',
    publishedAt: 0,
  };
}

function session(
  sid: string,
  v: TemplateVersion,
  sets: { t: Partial<TyreSetV2>; ratings: (number | null)[] }[],
): TestSessionV2 {
  const tyreSets: Record<string, TyreSetV2> = {};
  const cells: TestSessionV2['cells'] = {};
  sets.forEach(({ t, ratings }, i) => {
    const ts = { ...blankTyreSetV2(i + 1, i === 0), ...t };
    tyreSets[ts.tyreSetId] = ts;
    ratings.forEach((r, j) => {
      const p = v.schema.parameters[j];
      if (p)
        cells[cellKey(p.paramId, ts.tyreSetId)] = {
          rating: r,
          comment: '',
          updatedAt: 0,
          updatedBy: 'u',
        };
    });
  });
  return {
    sessionId: sid,
    schemaVersion: 2,
    templateId: v.templateId,
    templateVersion: 1,
    customerName: v.customerName,
    templateName: 'T',
    status: 'ready',
    createdBy: 'u',
    createdByName: 'Tester',
    assignedTo: [],
    header: {},
    tyreSets,
    cells,
    fieldTimestamps: {},
    progress: { rated: 0, total: 0 },
    lastReport: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: Date.UTC(2026, 8, 1),
    updatedBy: 'u',
    updatedAt: 0,
  };
}

const opts = (o: Partial<AnalysisOptions>): AnalysisOptions => ({
  ...DEFAULT_ANALYSIS,
  ...o,
  filter: { ...DEFAULT_ANALYSIS.filter, ...o.filter },
});

describe('analyze', () => {
  const a = version('a', ['Smooth road', 'Harshness']);
  const b = version('b', ['Smooth Road', 'Noise']);
  const s1 = session('s1', a, [
    { t: { make: 'CEAT', pattern: 'X1' }, ratings: [7, 6] },
    { t: { make: 'MRF', pattern: 'Z' }, ratings: [6.5, null] },
  ]);
  const s2 = session('s2', b, [
    { t: { make: 'CEAT', pattern: 'X1' }, ratings: [7.5, 6] },
    { t: { make: 'MRF', pattern: 'Z' }, ratings: [7, 5] },
  ]);

  it('pools matching parameters across templates by name and skips Unrated', () => {
    const r = analyze(
      [
        { session: s1, version: a },
        { session: s2, version: b },
      ],
      opts({ level: 'parameter' }),
    );
    const smooth = r.rows.find((x) => x.label.toLowerCase() === 'smooth road')!;
    expect(r.cells[`${smooth.key}|ceat x1`]).toMatchObject({ n: 2, mean: 7.25 });
    const harsh = r.rows.find((x) => x.label === 'Harshness')!;
    // MRF's Harshness was Unrated: no cell rather than a zero.
    expect(r.cells[`${harsh.key}|mrf z`]).toBeUndefined();
    expect(r.sessionCount).toBe(2);
  });

  it('computes the difference to the reference and excludes the reference', () => {
    const r = analyze(
      [
        { session: s1, version: a },
        { session: s2, version: b },
      ],
      opts({ level: 'parameter', value: 'diffToRef' }),
    );
    expect(r.columns.map((c) => c.key)).toEqual(['mrf z']);
    const smooth = r.rows.find((x) => x.label.toLowerCase() === 'smooth road')!;
    expect(r.cells[`${smooth.key}|mrf z`].mean).toBeCloseTo(-0.5, 6);
  });

  it('applies filters and marks the best column', () => {
    const r = analyze(
      [
        { session: s1, version: a },
        { session: s2, version: b },
      ],
      opts({ level: 'total', filter: { customer: 'A' } }),
    );
    expect(r.sessionCount).toBe(1);
    expect(bestColumnPerRow(r)).toEqual({ total: 'ceat x1' });
    expect(analysisToCsv(r).split('\r\n')[0]).toContain('"CEAT X1"');
  });
});
