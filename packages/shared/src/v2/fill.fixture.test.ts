// Fixture tests: fill the real customer workbooks with an 8-tyre session and
// re-open the output (R11.1–R11.6).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readSheetGrids, structureOf, type SheetGrid } from './grid';
import { proposeBlock, proposeSchema } from './detect';
import { fillWorkbookV2, preflight, reportFileName, testFillWorkbook } from './fill';
import {
  cellKey,
  emptySchema,
  type Mapping,
  type TemplateSchema,
  type TemplateVersion,
  type TestSessionV2,
  type TyreSetV2,
} from './model';
import { blankTyreSetV2 } from './session';

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url))),
  );
}

function versionOf(
  grids: SheetGrid[],
  schema: TemplateSchema,
  mappings: Mapping[],
): TemplateVersion {
  return {
    templateId: 'tpl',
    customerName: 'Cust',
    templateName: 'Tpl',
    version: 1,
    storagePath: 'x',
    structure: structureOf(grids),
    schema,
    mappings,
    publishedBy: 'u',
    publishedAt: 0,
  };
}

/** Session with `n` tyre sets; every cell rated 6 + 0.25*(slot-1) except one Unrated. */
function sessionOf(
  schema: TemplateSchema,
  n: number,
): Pick<TestSessionV2, 'header' | 'tyreSets' | 'cells'> {
  const tyreSets: Record<string, TyreSetV2> = {};
  const cells: TestSessionV2['cells'] = {};
  for (let slot = 1; slot <= n; slot += 1) {
    const t = blankTyreSetV2(slot, slot === 1, slot === 1 ? 'Ref' : `MU${slot - 1}`);
    tyreSets[t.tyreSetId] = t;
    schema.parameters.forEach((p, i) => {
      if (slot === 2 && i === 0) return; // Unrated cell stays blank
      cells[cellKey(p.paramId, t.tyreSetId)] = {
        rating: 6 + 0.25 * ((slot - 1) % 4),
        comment: `c${slot}-${i}`,
        updatedAt: 0,
        updatedBy: 'u',
      };
    });
  }
  return { header: {}, tyreSets, cells };
}

async function reopen(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return wb;
}

describe('report fill on real customer workbooks', () => {
  let mmBytes: Uint8Array;
  let msilBytes: Uint8Array;
  let mm: SheetGrid[];
  let msil: SheetGrid[];

  beforeAll(async () => {
    mmBytes = fixture('mm-u171.xlsx');
    msilBytes = fixture('msil.xlsx');
    [mm, msil] = await Promise.all([readSheetGrids(mmBytes), readSheetGrids(msilBytes)]);
  }, 60_000);

  function mmVersion(): TemplateVersion {
    const g = mm[0];
    const p = proposeSchema(g, 'C8:C26');
    const schema: TemplateSchema = {
      ...emptySchema(),
      categories: p.categories,
      parameters: p.parameters,
      slotCount: 8,
    };
    const b = proposeBlock(g, 'E8:T26', schema, { rowOf: p.rowOf });
    return versionOf(mm, schema, [b.mapping]);
  }

  function msilVersion(): TemplateVersion {
    const g1 = msil.find((s) => s.name === 'dryhandling1')!;
    const g2 = msil.find((s) => s.name === 'dryhandling2')!;
    const p = proposeSchema(g1, 'B11:B31');
    const schema: TemplateSchema = {
      ...emptySchema(),
      categories: p.categories,
      parameters: p.parameters,
      slotCount: 8,
    };
    const b1 = proposeBlock(g1, 'D12:S31', schema, { rowOf: p.rowOf, firstSlot: 1 });
    const b2 = proposeBlock(g2, 'D12:S31', schema, { rowOf: p.rowOf, firstSlot: 5 });
    return versionOf(msil, schema, [b1.mapping, b2.mapping]);
  }

  it('M&M: writes 8 tyre sets, Unrated stays blank, re-opens cleanly', async () => {
    const version = mmVersion();
    const session = sessionOf(version.schema, 8);
    const { bytes, preflight: pf } = await fillWorkbookV2(mmBytes, session, version);
    expect(pf.blockers).toEqual([]);
    expect(pf.warnings.some((w) => w.kind === 'unrated')).toBe(true);
    const ws = (await reopen(bytes)).worksheets[0];
    expect(ws.getCell('E8').value).toBe(6);
    expect(ws.getCell('F8').value).toBe('c1-0');
    expect(ws.getCell('G8').value).toBeNull(); // Unrated
    expect(ws.getCell('S8').value).toBe(6.75);
    expect(ws.getCell('T26').value).toBe('c8-18');
    expect(ws.getCell('C8').value).not.toBeNull(); // labels untouched
  }, 60_000);

  it('M&M: unused slots keep the original template content', async () => {
    const version = mmVersion();
    const ws = (
      await reopen((await fillWorkbookV2(mmBytes, sessionOf(version.schema, 5), version)).bytes)
    ).worksheets[0];
    expect(ws.getCell('M8').value).toBe(6); // slot 5 written
    expect(ws.getCell('Q8').value).toBe(7); // slot 7 original
    expect(ws.getCell('R8').value).toBe('ok');
  }, 60_000);

  it('MSIL: slots continue onto dryhandling2 and formulas are preserved', async () => {
    const version = msilVersion();
    const { bytes } = await fillWorkbookV2(msilBytes, sessionOf(version.schema, 8), version);
    const wb = await reopen(bytes);
    const d1 = wb.getWorksheet('dryhandling1')!;
    const d2 = wb.getWorksheet('dryhandling2')!;
    expect(d1.getCell('D12').value).toBe(6);
    expect(d1.getCell('H12').value).toBeNull(); // slot 2 first param Unrated
    expect(d2.getCell('D12').value).toBe(6); // slot 5
    expect(d2.getCell('P12').value).toBe(6.75); // slot 8
    expect(d1.getCell('D17').formula).toMatch(/AVERAGE/i);
    expect(d2.getCell('D31').formula).toMatch(/AVERAGE/i);
    expect(wb.worksheets.map((s) => s.name)).toEqual(msil.map((s) => s.name));
  }, 60_000);

  it('blocks generation when there are more tyre sets than mapped slots', () => {
    const version = mmVersion();
    const tooMany = { ...version, schema: { ...version.schema, slotCount: 9 } };
    const pf = preflight(sessionOf(tooMany.schema, 9), tooMany);
    expect(pf.blockers).toHaveLength(1);
  });

  it('test fill writes one placeholder per target', async () => {
    const version = mmVersion();
    const { bytes, count } = await testFillWorkbook(mmBytes, version);
    expect(count).toBe(19 * 8 * 2);
    const ws = (await reopen(bytes)).worksheets[0];
    expect(String(ws.getCell('E8').value)).toMatch(/^R:.+\/S1$/);
    expect(String(ws.getCell('F8').value)).toMatch(/^C:.+\/S1$/);
  }, 60_000);

  it('builds a safe report file name', () => {
    expect(
      reportFileName('{customer}_{vehicle}_{tyreSize}_{testDate} - R&H', {
        customer: 'M&M',
        vehicle: 'U171',
        tyreSize: '235/60 R18',
        testDate: '2026-09-15',
      }),
    ).toBe('M&M_U171_235-60 R18_2026-09-15 - R&H.xlsx');
    expect(reportFileName('{customer}_{vehicle} - R&H', { customer: 'MSIL' })).toBe(
      'MSIL - R&H.xlsx',
    );
  });
});
