// Fixture tests: schema + block detection on the three real customer workbooks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readSheetGrids, type SheetGrid } from './grid';
import { proposeBlock, proposeSchema } from './detect';
import { expandMappings } from './expand';
import { emptySchema, type TemplateSchema } from './model';
import { structureOf } from './grid';

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url))),
  );
}

function schemaFrom(p: ReturnType<typeof proposeSchema>, slotCount: number): TemplateSchema {
  return { ...emptySchema(), categories: p.categories, parameters: p.parameters, slotCount };
}

describe('detection on real customer workbooks', () => {
  let mm: SheetGrid[];
  let msil: SheetGrid[];
  let hy: SheetGrid[];

  beforeAll(async () => {
    [mm, msil, hy] = await Promise.all([
      readSheetGrids(fixture('mm-u171.xlsx')),
      readSheetGrids(fixture('msil.xlsx')),
      readSheetGrids(fixture('hyundai.xlsx')),
    ]);
  }, 60_000);

  it('M&M U171: 19 parameters in 4 categories, block E8 stride 2 x 8 slots', () => {
    const g = mm[0];
    const p = proposeSchema(g, 'C8:C26');
    expect(p.parameters).toHaveLength(19);
    expect(p.categories.map((c) => c.name)).toEqual([
      'Ride',
      'Handling',
      'Steering',
      'Noise & Vibration',
    ]);
    const schema = schemaFrom(p, 8);
    const b = proposeBlock(g, 'E8:T26', schema, { rowOf: p.rowOf });
    expect(b.mapping.firstColumn).toBe(5);
    expect(b.mapping.stride).toBe(2);
    expect(b.mapping.slotCount).toBe(8);
    expect(b.mapping.commentOffset).toBe(1);
    expect(b.mapping.rows).toHaveLength(19);
    const ex = expandMappings({ structure: structureOf(mm), schema, mappings: [b.mapping] });
    expect(ex.problems.filter((x) => x.severity === 'error')).toEqual([]);
    expect(ex.targets).toHaveLength(19 * 8 * 2);
  });

  it('MSIL: 14 parameters in 3 categories, Average rows excluded, two blocks of 4 slots', () => {
    const g1 = msil.find((s) => s.name === 'dryhandling1')!;
    const g2 = msil.find((s) => s.name === 'dryhandling2')!;
    const p = proposeSchema(g1, 'B11:B31');
    expect(p.parameters).toHaveLength(14);
    expect(p.categories).toHaveLength(3);
    expect(p.excludedRows.filter((r) => r.reason === 'average')).toHaveLength(4);
    const schema = schemaFrom(p, 8);
    const b1 = proposeBlock(g1, 'D12:S31', schema, { rowOf: p.rowOf, firstSlot: 1 });
    const b2 = proposeBlock(g2, 'D12:S31', schema, { rowOf: p.rowOf, firstSlot: 5 });
    for (const b of [b1, b2]) {
      expect(b.mapping.firstColumn).toBe(4);
      expect(b.mapping.stride).toBe(4);
      expect(b.mapping.slotCount).toBe(4);
      expect(b.mapping.rows).toHaveLength(14);
    }
    const ex = expandMappings({
      structure: structureOf(msil),
      schema,
      mappings: [b1.mapping, b2.mapping],
    });
    expect(ex.problems.filter((x) => x.severity === 'error')).toEqual([]);
    expect(ex.targets).toHaveLength(14 * 8 * 2);
  });

  it('Hyundai: 19 parameters with weights, block E12 stride 4', () => {
    const g = hy.find((s) => s.name === 'dryhandling1')!;
    const p = proposeSchema(g, 'B11:B37');
    expect(p.parameters).toHaveLength(19);
    expect(p.weightColumn).toBe(4);
    expect(p.parameters.filter((x) => typeof x.weight === 'number').length).toBeGreaterThanOrEqual(
      15,
    );
    const schema = schemaFrom(p, 8);
    const b = proposeBlock(g, 'E12:T37', schema, { rowOf: p.rowOf });
    expect(b.mapping.firstColumn).toBe(5);
    expect(b.mapping.stride).toBe(4);
    expect(b.mapping.slotCount).toBe(4);
  });

  it('records formula cells so they can never be mapped', () => {
    const g1 = msil.find((s) => s.name === 'dryhandling1')!;
    expect(g1.formulaCells).toContain('D17');
    expect(g1.formulaCells).toContain('D31');
  });
});
