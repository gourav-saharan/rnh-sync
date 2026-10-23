// v2 mapping expansion (design.md v2 "Mapping engine").
//
// `expandMappings` is the ONE place that turns Block / Header / SlotDetail
// mappings into concrete (sheet, cell) targets. The Mapping_Editor highlight
// (R4.5), the coverage summary (R4.10), "Test fill" (R4.9) and the
// Report_Generator (R11) all consume it, so what the Template_Admin sees is
// exactly what gets written. Pure: no ExcelJS, no Firebase.

import { mergeMaster, parseA1, toA1 } from './a1';
import type {
  Mapping,
  ResolvedTarget,
  TargetSource,
  TemplateSchema,
  TemplateStructureV2,
} from './model';

export type ExpandProblemKind =
  | 'sheetMissing'
  | 'formulaCell'
  | 'duplicateTarget'
  | 'mergeRedirect'
  | 'unknownParam'
  | 'unknownField'
  | 'slotOutOfRange'
  | 'badAddress';

export interface ExpandProblem {
  kind: ExpandProblemKind;
  /** 'error' blocks publish/save; 'info' is shown but allowed (R4.8). */
  severity: 'error' | 'info';
  mappingId: string;
  sheetName: string;
  cellAddress?: string;
  /** For duplicateTarget: the mapping that claimed the cell first. */
  otherMappingId?: string;
  message: string;
}

export interface ExpandResult {
  targets: ResolvedTarget[];
  problems: ExpandProblem[];
}

export interface ExpandInput {
  structure: TemplateStructureV2 | null;
  schema: Pick<TemplateSchema, 'parameters' | 'headerFields' | 'slotCount'>;
  mappings: readonly Mapping[];
}

/** Raw (pre-validation) targets of a single mapping, in a stable order. */
export function rawTargetsOf(mapping: Mapping): { cellAddress: string; source: TargetSource }[] {
  const out: { cellAddress: string; source: TargetSource }[] = [];
  if (mapping.kind === 'block') {
    for (let i = 0; i < mapping.slotCount; i += 1) {
      const slot = mapping.firstSlot + i;
      const base = mapping.firstColumn + i * mapping.stride;
      for (const { row, paramId } of mapping.rows) {
        out.push({
          cellAddress: toA1(row, base + mapping.ratingOffset),
          source: { kind: 'rating', paramId, slot },
        });
        if (mapping.commentOffset !== null) {
          out.push({
            cellAddress: toA1(row, base + mapping.commentOffset),
            source: { kind: 'comment', paramId, slot },
          });
        }
      }
    }
  } else if (mapping.kind === 'header') {
    out.push({
      cellAddress: mapping.cellAddress,
      source: { kind: 'header', fieldId: mapping.fieldId },
    });
  } else {
    for (const c of mapping.cells) {
      out.push({
        cellAddress: c.cellAddress,
        source: { kind: 'slotDetail', detail: mapping.detail, slot: c.slot },
      });
    }
  }
  return out;
}

/** Human label for a target source, e.g. "Rating · Smooth Road · slot 2". */
export function describeSource(
  source: TargetSource,
  schema: Pick<TemplateSchema, 'parameters' | 'headerFields'>,
): string {
  if (source.kind === 'rating' || source.kind === 'comment') {
    const p = schema.parameters.find((x) => x.paramId === source.paramId);
    const what = source.kind === 'rating' ? 'Rating' : 'Comment';
    return `${what} · ${p ? p.shortName || p.name : source.paramId} · slot ${source.slot}`;
  }
  if (source.kind === 'header') {
    const f = schema.headerFields.find((x) => x.fieldId === source.fieldId);
    return `Header · ${f ? f.label : source.fieldId}`;
  }
  return `Tyre ${source.detail} · slot ${source.slot}`;
}

/**
 * Expand every mapping into concrete, validated targets (R4.1–R4.8).
 * Merge cells redirect to the master (info), formula cells are refused,
 * a (sheet, cell) claimed twice keeps the first, unknown params / fields and
 * out-of-range slots are errors. Only valid targets are returned.
 */
export function expandMappings(input: ExpandInput): ExpandResult {
  const targets: ResolvedTarget[] = [];
  const problems: ExpandProblem[] = [];
  const sheets = new Map((input.structure?.sheets ?? []).map((s) => [s.name, s]));
  const paramIds = new Set(input.schema.parameters.map((p) => p.paramId));
  const fieldIds = new Set(input.schema.headerFields.map((f) => f.fieldId));
  const claimed = new Map<string, string>();

  for (const mapping of input.mappings) {
    const sheet = sheets.get(mapping.sheetName);
    if (input.structure && !sheet) {
      problems.push({
        kind: 'sheetMissing',
        severity: 'error',
        mappingId: mapping.mappingId,
        sheetName: mapping.sheetName,
        message: `Sheet "${mapping.sheetName}" is not in the workbook.`,
      });
      continue;
    }
    const formulas = new Set(sheet?.formulaCells ?? []);
    const merges = sheet?.mergedRanges ?? [];

    for (const raw of rawTargetsOf(mapping)) {
      const base = {
        mappingId: mapping.mappingId,
        sheetName: mapping.sheetName,
        cellAddress: raw.cellAddress,
      };
      const err = (kind: ExpandProblemKind, message: string, cellAddress = raw.cellAddress) =>
        problems.push({ ...base, cellAddress, kind, severity: 'error', message });
      if (!parseA1(raw.cellAddress)) {
        err('badAddress', `"${raw.cellAddress}" is not a valid cell address.`);
        continue;
      }
      const src = raw.source;
      if ((src.kind === 'rating' || src.kind === 'comment') && !paramIds.has(src.paramId)) {
        err('unknownParam', `Row is bound to an unknown parameter (${src.paramId}).`);
        continue;
      }
      if (src.kind === 'header' && !fieldIds.has(src.fieldId)) {
        err('unknownField', `Cell is bound to an unknown header field (${src.fieldId}).`);
        continue;
      }
      if (src.kind !== 'header' && (src.slot < 1 || src.slot > input.schema.slotCount)) {
        err('slotOutOfRange', `Tyre slot ${src.slot} is outside 1–${input.schema.slotCount}.`);
        continue;
      }
      const master = mergeMaster(raw.cellAddress, merges);
      if (master.redirected) {
        problems.push({
          ...base,
          kind: 'mergeRedirect',
          severity: 'info',
          message: `${raw.cellAddress} is inside a merged range; writing to ${master.address} instead.`,
        });
      }
      const address = master.address;
      if (formulas.has(address)) {
        err('formulaCell', `${address} contains a formula and cannot be mapped.`, address);
        continue;
      }
      const key = `${mapping.sheetName}!${address}`;
      const other = claimed.get(key);
      if (other !== undefined) {
        problems.push({
          ...base,
          cellAddress: address,
          kind: 'duplicateTarget',
          severity: 'error',
          otherMappingId: other,
          message: `${key} is already mapped by another mapping.`,
        });
        continue;
      }
      claimed.set(key, mapping.mappingId);
      targets.push({
        sheetName: mapping.sheetName,
        cellAddress: address,
        source: src,
        mappingId: mapping.mappingId,
      });
    }
  }
  return { targets, problems };
}

export function hasBlockingProblems(problems: readonly ExpandProblem[]): boolean {
  return problems.some((p) => p.severity === 'error');
}

// ---------------------------------------------------------------------------
// Coverage summary (R4.10)
// ---------------------------------------------------------------------------

export interface ParamSlotCoverage {
  paramId: string;
  slot: number;
  rating: boolean;
  comment: boolean;
}

export interface CoverageSummary {
  /** One entry per (parameter, slot 1..slotCount). */
  cells: ParamSlotCoverage[];
  /** fieldId -> mapped. */
  headerFields: Record<string, boolean>;
  /** Slots with at least one rating cell mapped. */
  mappedSlots: number[];
  ratingMapped: number;
  ratingTotal: number;
  commentMapped: number;
}

/** Which ratings / comments / header fields have a valid target (R4.10). */
export function coverageOf(
  input: ExpandInput,
  targets?: readonly ResolvedTarget[],
): CoverageSummary {
  const list = targets ?? expandMappings(input).targets;
  const rating = new Set<string>();
  const comment = new Set<string>();
  const header = new Set<string>();
  const slots = new Set<number>();
  for (const t of list) {
    const s = t.source;
    if (s.kind === 'rating') {
      rating.add(`${s.paramId}#${s.slot}`);
      slots.add(s.slot);
    } else if (s.kind === 'comment') {
      comment.add(`${s.paramId}#${s.slot}`);
    } else if (s.kind === 'header') {
      header.add(s.fieldId);
    }
  }
  const cells: ParamSlotCoverage[] = [];
  for (const p of input.schema.parameters) {
    for (let slot = 1; slot <= input.schema.slotCount; slot += 1) {
      const k = `${p.paramId}#${slot}`;
      cells.push({ paramId: p.paramId, slot, rating: rating.has(k), comment: comment.has(k) });
    }
  }
  const headerFields: Record<string, boolean> = {};
  for (const f of input.schema.headerFields) headerFields[f.fieldId] = header.has(f.fieldId);
  return {
    cells,
    headerFields,
    mappedSlots: [...slots].sort((a, b) => a - b),
    ratingMapped: cells.filter((c) => c.rating).length,
    ratingTotal: cells.length,
    commentMapped: cells.filter((c) => c.comment).length,
  };
}
