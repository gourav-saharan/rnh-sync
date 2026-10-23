// Feature: rnh-tyre-testing-system, Property 5: Block expansion places every
// (parameter, slot) rating/comment at firstColumn + (slot - firstSlot) * stride
// + offset on the parameter's row. Validates: Requirements 4.1, 4.3.
// Feature: rnh-tyre-testing-system, Property 7: No (sheet, cell) is written
// twice; every repeat is reported as duplicateTarget. Validates: 4.7.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseA1 } from './a1';
import { expandMappings, rawTargetsOf } from './expand';
import type { BlockMapping, Mapping, ParameterDef, TemplateStructureV2 } from './model';

function params(n: number): ParameterDef[] {
  return Array.from({ length: n }, (_, i) => ({
    paramId: `p${i}`,
    categoryId: 'c',
    name: `P${i}`,
    order: i,
  }));
}

function structure(): TemplateStructureV2 {
  return {
    sheets: [
      {
        name: 'S1',
        index: 0,
        rowCount: 200,
        columnCount: 200,
        mergedRanges: [],
        formulaCells: [],
        columnWidths: [],
      },
      {
        name: 'S2',
        index: 1,
        rowCount: 200,
        columnCount: 200,
        mergedRanges: [],
        formulaCells: [],
        columnWidths: [],
      },
    ],
  };
}

const blockArb = (paramCount: number, slotLimit: number) =>
  fc
    .record({
      sheetName: fc.constantFrom('S1', 'S2'),
      firstRow: fc.integer({ min: 1, max: 50 }),
      firstSlot: fc.integer({ min: 1, max: slotLimit }),
      firstColumn: fc.integer({ min: 1, max: 20 }),
      stride: fc.integer({ min: 1, max: 5 }),
      withComment: fc.boolean(),
      id: fc.integer({ min: 0, max: 1e6 }),
    })
    .chain((b) =>
      fc.integer({ min: 1, max: slotLimit - b.firstSlot + 1 }).map((slotCount): BlockMapping => {
        const ratingOffset = 0;
        // Comment must sit in a different column from the rating, inside the stride.
        const commentOffset = b.withComment && b.stride > 1 ? 1 : null;
        return {
          kind: 'block',
          mappingId: `m${b.id}`,
          sheetName: b.sheetName,
          rows: Array.from({ length: paramCount }, (_, i) => ({
            row: b.firstRow + i,
            paramId: `p${i}`,
          })),
          firstSlot: b.firstSlot,
          slotCount,
          firstColumn: b.firstColumn,
          stride: b.stride,
          ratingOffset,
          commentOffset,
        };
      }),
    );

describe('Property 5: block expansion', () => {
  it('writes each (parameter, slot) at the computed row/column, once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }).chain((n) => fc.tuple(fc.constant(n), blockArb(n, 8))),
        ([n, block]) => {
          const schema = { parameters: params(n), headerFields: [], slotCount: 8 };
          const { targets, problems } = expandMappings({
            structure: structure(),
            schema,
            mappings: [block],
          });
          expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
          const perCell = block.commentOffset === null ? 1 : 2;
          expect(targets).toHaveLength(n * block.slotCount * perCell);
          for (const t of targets) {
            const src = t.source;
            if (src.kind !== 'rating' && src.kind !== 'comment')
              throw new Error('unexpected source');
            const pos = parseA1(t.cellAddress)!;
            const rowBinding = block.rows.find((r) => r.paramId === src.paramId)!;
            const offset = src.kind === 'rating' ? block.ratingOffset : block.commentOffset!;
            expect(pos.row).toBe(rowBinding.row);
            expect(pos.col).toBe(
              block.firstColumn + (src.slot - block.firstSlot) * block.stride + offset,
            );
            expect(src.slot).toBeGreaterThanOrEqual(block.firstSlot);
            expect(src.slot).toBeLessThan(block.firstSlot + block.slotCount);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Property 7: duplicate target detection', () => {
  it('never returns the same (sheet, cell) twice and reports every repeat', () => {
    fc.assert(
      fc.property(
        fc.array(blockArb(5, 8), { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            sheet: fc.constantFrom('S1', 'S2'),
            row: fc.integer({ min: 1, max: 60 }),
            col: fc.integer({ min: 1, max: 40 }),
          }),
          { maxLength: 10 },
        ),
        (blocks, cells) => {
          // Unique mapping ids so problems can be attributed.
          const mappings: Mapping[] = [
            ...blocks.map((b, i) => ({ ...b, mappingId: `b${i}` })),
            ...cells.map((c, i): Mapping => ({
              kind: 'slotDetail',
              mappingId: `d${i}`,
              sheetName: c.sheet,
              detail: 'make',
              cells: [
                {
                  slot: 1,
                  cellAddress: `${String.fromCharCode(64 + ((c.col - 1) % 26) + 1)}${c.row}`,
                },
              ],
            })),
          ];
          const schema = { parameters: params(5), headerFields: [], slotCount: 8 };
          const { targets, problems } = expandMappings({
            structure: structure(),
            schema,
            mappings,
          });

          const keys = targets.map((t) => `${t.sheetName}!${t.cellAddress}`);
          expect(new Set(keys).size).toBe(keys.length);

          // Oracle: count raw claims per cell; everything beyond the first is a duplicate.
          const raw = new Map<string, number>();
          for (const m of mappings) {
            for (const r of rawTargetsOf(m)) {
              const k = `${m.sheetName}!${r.cellAddress}`;
              raw.set(k, (raw.get(k) ?? 0) + 1);
            }
          }
          const expectedDupes = [...raw.values()].reduce((a, n) => a + (n - 1), 0);
          expect(problems.filter((p) => p.kind === 'duplicateTarget')).toHaveLength(expectedDupes);
          expect(targets).toHaveLength(raw.size);
        },
      ),
      { numRuns: 200 },
    );
  });
});
