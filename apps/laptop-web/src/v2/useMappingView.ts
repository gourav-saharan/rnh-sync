// Mapping editor state helpers: expansion, grid highlights / hover titles for
// the current sheet, and the "Test fill" download (R4.5, R4.9).

import { useMemo, useState } from 'react';
import {
  describeSource,
  expandMappings,
  hasBlockingProblems,
  testFillWorkbook,
  type Mapping,
  type TemplateSchema,
  type TemplateStructureV2,
} from '@rnh/shared/v2';
import { XLSX_MIME } from '@rnh/shared/v2data';
import { downloadBytes, plainError } from './context';
import type { HighlightKind } from './SheetView';
import { selectOf } from './MappingList';

export function useMappingView(
  structure: TemplateStructureV2 | null,
  schema: TemplateSchema,
  draft: Mapping[],
  sheetName: string | undefined,
  region: string,
) {
  const input = useMemo(() => ({ structure, schema, mappings: draft }), [structure, schema, draft]);
  const expanded = useMemo(() => expandMappings(input), [input]);
  const blocking = hasBlockingProblems(expanded.problems);

  const { highlights, titles } = useMemo(() => {
    const hl: Record<string, HighlightKind> = {};
    const tt: Record<string, string> = {};
    for (const t of expanded.targets) {
      if (t.sheetName !== sheetName) continue;
      hl[t.cellAddress] = t.source.kind;
      tt[t.cellAddress] = describeSource(t.source, schema);
    }
    for (const pr of expanded.problems) {
      if (pr.severity === 'error' && pr.sheetName === sheetName && pr.cellAddress)
        hl[pr.cellAddress] = 'problem';
    }
    return { highlights: { ...selectOf(region), ...hl }, titles: tt };
  }, [expanded, sheetName, region, schema]);

  const nextSlot =
    draft.reduce(
      (max, m) => (m.kind === 'block' ? Math.max(max, m.firstSlot + m.slotCount - 1) : max),
      0,
    ) + 1;

  return { input, expanded, blocking, highlights, titles, nextSlot };
}

export function useTestFill(
  loadBytes: () => Promise<Uint8Array>,
  structure: TemplateStructureV2 | null,
  schema: TemplateSchema,
  fileBase: string,
) {
  const [busy, setBusy] = useState(false);
  const run = async (mappings: Mapping[]): Promise<{ ok: boolean; text: string }> => {
    if (!structure) return { ok: false, text: 'Upload a workbook first.' };
    setBusy(true);
    try {
      const bytes = await loadBytes();
      const out = await testFillWorkbook(bytes, { structure, schema, mappings });
      downloadBytes(out.bytes, `${fileBase} - TEST FILL.xlsx`, XLSX_MIME);
      return {
        ok: true,
        text: `Test fill downloaded: ${out.count} cells filled with placeholders like "R:Smooth Road/S1". Open it in Excel to check every value lands in the right cell.`,
      };
    } catch (e) {
      return { ok: false, text: `Test fill failed: ${plainError(e)}` };
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
