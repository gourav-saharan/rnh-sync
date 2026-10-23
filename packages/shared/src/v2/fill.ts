// v2 Report_Generator (design.md v2 "Report engine", R11).
//
// Fidelity by preservation: load the pinned Template_Version workbook, write
// ONLY the targets produced by expandMappings, and save. Formula cells are
// never targets (expandMappings refuses them), Unrated cells are written as
// empty, unused tyre slots keep the template's original content, and the
// workbook is flagged to recalculate on open so customer AVERAGE and
// cross-sheet formulas show the new values (R11.4).

import { loadWorkbookV2, type WorkbookBytesV2 } from './grid';
import { expandMappings, type ExpandProblem } from './expand';
import {
  cellKey,
  orderedTyreSets,
  type HeaderFieldDef,
  type ResolvedTarget,
  type TemplateVersion,
  type TestSessionV2,
  type TyreSetV2,
} from './model';

export type FillValue = string | number | Date | null;

export interface PlannedWrite {
  target: ResolvedTarget;
  value: FillValue;
}

export interface PreflightIssue {
  kind: 'unmappedTyreSet' | 'unrated' | 'missingHeader' | 'mappingProblem';
  severity: 'blocker' | 'warning';
  message: string;
}

export interface Preflight {
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
  /** Highest slot any mapping writes a rating to. */
  mappedSlots: number;
  writes: PlannedWrite[];
}

type SessionLike = Pick<TestSessionV2, 'header' | 'tyreSets' | 'cells'>;
type VersionLike = Pick<TemplateVersion, 'schema' | 'structure' | 'mappings'>;

function isoDateToDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  // Excel dates are timezone-less: UTC midnight so the day never shifts.
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function headerValue(field: HeaderFieldDef | undefined, raw: unknown): FillValue {
  if (raw === null || raw === undefined || raw === '') return null;
  if (field?.type === 'date' && typeof raw === 'string') return isoDateToDate(raw) ?? raw;
  if ((field?.type === 'number' || field?.type === 'pressure') && typeof raw === 'string') {
    const n = Number(raw);
    return raw.trim() !== '' && Number.isFinite(n) ? n : raw;
  }
  return raw as string | number;
}

function detailValue(set: TyreSetV2, detail: keyof TyreSetV2): FillValue {
  const v = set[detail];
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number') return v;
  return null;
}

/** The value a target receives, or undefined = leave the template cell alone. */
export function valueForTarget(
  target: ResolvedTarget,
  session: SessionLike,
  version: Pick<TemplateVersion, 'schema'>,
): FillValue | undefined {
  const src = target.source;
  if (src.kind === 'header') {
    const field = version.schema.headerFields.find((f) => f.fieldId === src.fieldId);
    return headerValue(field, session.header[src.fieldId]);
  }
  const set = orderedTyreSets(session).find((t) => t.slot === src.slot);
  // Unused slot: keep the template's original content (R11.6).
  if (!set) return undefined;
  if (src.kind === 'slotDetail') return detailValue(set, src.detail);
  const cell = session.cells[cellKey(src.paramId, set.tyreSetId)];
  if (src.kind === 'rating') return cell && typeof cell.rating === 'number' ? cell.rating : null;
  const comment = cell?.comment?.trim() ?? '';
  return comment === '' ? null : comment;
}

function mappingIssues(problems: readonly ExpandProblem[]): PreflightIssue[] {
  return problems
    .filter((p) => p.severity === 'error')
    .map((p) => ({
      kind: 'mappingProblem' as const,
      severity: 'warning' as const,
      message: p.message,
    }));
}

/**
 * Everything generation needs to know before touching the workbook (R11.5,
 * R11.7): blockers (tyre sets beyond mapped slots), warnings (Unrated cells,
 * missing required header fields, mapping problems) and the planned writes.
 */
export function preflight(session: SessionLike, version: VersionLike): Preflight {
  const { targets, problems } = expandMappings({
    structure: version.structure,
    schema: version.schema,
    mappings: version.mappings,
  });
  const blockers: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = mappingIssues(problems);

  const mappedSlots = targets.reduce(
    (max, t) => (t.source.kind === 'rating' ? Math.max(max, t.source.slot) : max),
    0,
  );
  const sets = orderedTyreSets(session);
  for (const set of sets) {
    if (set.slot > mappedSlots) {
      blockers.push({
        kind: 'unmappedTyreSet',
        severity: 'blocker',
        message: `Tyre set "${set.label}" (slot ${set.slot}) has no columns in this template (it maps ${mappedSlots} tyre sets).`,
      });
    }
  }

  let unrated = 0;
  for (const set of sets) {
    for (const p of version.schema.parameters) {
      const cell = session.cells[cellKey(p.paramId, set.tyreSetId)];
      if (!cell || typeof cell.rating !== 'number') unrated += 1;
    }
  }
  if (unrated > 0) {
    warnings.push({
      kind: 'unrated',
      severity: 'warning',
      message: `${unrated} rating cell${unrated === 1 ? ' is' : 's are'} not rated and will be left blank.`,
    });
  }
  for (const f of version.schema.headerFields) {
    const v = session.header[f.fieldId];
    if (f.required && (v === null || v === undefined || String(v).trim() === '')) {
      warnings.push({
        kind: 'missingHeader',
        severity: 'warning',
        message: `Required field "${f.label}" is empty and will be left blank.`,
      });
    }
  }

  const writes: PlannedWrite[] = [];
  for (const target of targets) {
    const value = valueForTarget(target, session, version);
    if (value !== undefined) writes.push({ target, value });
  }
  return { blockers, warnings, mappedSlots, writes };
}

export interface FillResultV2 {
  bytes: Uint8Array;
  writes: PlannedWrite[];
  preflight: Preflight;
}

/** Write planned values into the workbook bytes and serialise (R11.1–R11.4). */
export async function writeWorkbook(
  templateBytes: WorkbookBytesV2,
  writes: readonly PlannedWrite[],
): Promise<Uint8Array> {
  const wb = await loadWorkbookV2(templateBytes);
  for (const { target, value } of writes) {
    const ws = wb.getWorksheet(target.sheetName);
    if (!ws) continue;
    const cell = ws.getCell(target.cellAddress);
    // Never overwrite a formula, even if the structure snapshot was stale.
    const current = cell.value as unknown;
    if (
      current &&
      typeof current === 'object' &&
      ('formula' in current || 'sharedFormula' in current)
    ) {
      continue;
    }
    cell.value = value;
  }
  // Recalculate customer formulas when Excel opens the file (R11.4).
  const w = wb as unknown as { calcProperties?: Record<string, unknown> };
  w.calcProperties = { ...(w.calcProperties ?? {}), fullCalcOnLoad: true };
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}

/**
 * Generate the customer report. Throws when blockers exist so no partial
 * file is ever offered (R11.5, R12.3).
 */
export async function fillWorkbookV2(
  templateBytes: WorkbookBytesV2,
  session: SessionLike,
  version: VersionLike,
): Promise<FillResultV2> {
  const pf = preflight(session, version);
  if (pf.blockers.length > 0) {
    throw new Error(pf.blockers.map((b) => b.message).join(' '));
  }
  const bytes = await writeWorkbook(templateBytes, pf.writes);
  return { bytes, writes: pf.writes, preflight: pf };
}

// ---------------------------------------------------------------------------
// Test fill (R4.9) and file naming (R12.4)
// ---------------------------------------------------------------------------

/** Labelled placeholder for one target, e.g. "R:Smooth Road/S1". */
export function placeholderFor(
  target: ResolvedTarget,
  version: Pick<TemplateVersion, 'schema'>,
): string {
  const src = target.source;
  if (src.kind === 'rating' || src.kind === 'comment') {
    const p = version.schema.parameters.find((x) => x.paramId === src.paramId);
    const name = p ? p.shortName || p.name : src.paramId;
    return `${src.kind === 'rating' ? 'R' : 'C'}:${name}/S${src.slot}`;
  }
  if (src.kind === 'header') {
    const f = version.schema.headerFields.find((x) => x.fieldId === src.fieldId);
    return `H:${f ? f.label : src.fieldId}`;
  }
  return `T:${src.detail}/S${src.slot}`;
}

/** A sample report with every mapped cell holding its placeholder (R4.9). */
export async function testFillWorkbook(
  templateBytes: WorkbookBytesV2,
  version: VersionLike,
): Promise<{ bytes: Uint8Array; problems: ExpandProblem[]; count: number }> {
  const { targets, problems } = expandMappings({
    structure: version.structure,
    schema: version.schema,
    mappings: version.mappings,
  });
  const writes = targets.map((target) => ({ target, value: placeholderFor(target, version) }));
  const bytes = await writeWorkbook(templateBytes, writes);
  return { bytes, problems, count: writes.length };
}

// Control characters are invalid in Windows file names, so matching them is intended.
// eslint-disable-next-line no-control-regex
const INVALID_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Replace characters that are invalid in Windows / macOS file names. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(INVALID_FILE_CHARS, '-').replace(/\s+/g, ' ').trim();
  return cleaned.replace(/[. ]+$/, '') || 'report';
}

export interface FileNameContext {
  customer: string;
  vehicle?: string;
  tyreSize?: string;
  testDate?: string;
  template?: string;
}

/**
 * Build the report file name from a pattern with `{customer}`, `{vehicle}`,
 * `{tyreSize}`, `{testDate}`, `{template}` placeholders (R12.4). Empty parts
 * and their dangling separators are removed.
 */
export function reportFileName(pattern: string, ctx: FileNameContext): string {
  const filled = pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = (ctx as unknown as Record<string, string | undefined>)[key];
    return v ? v.trim() : '';
  });
  const tidy = filled
    .replace(/_{2,}/g, '_')
    .replace(/^[_\s-]+|[_\s-]+$/g, '')
    .replace(/_\s*-/g, ' -');
  const base = sanitizeFileName(tidy || ctx.customer || 'report');
  return base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
}
