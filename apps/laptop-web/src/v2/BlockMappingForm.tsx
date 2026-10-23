// Template Studio · rating block mapping (R4.1–R4.3). The admin selects the
// rating table region; proposeBlock binds rows to parameters and reads the
// first column / stride / comment offset. Every value stays editable.

import { useState } from 'react';
import {
  colToLetters,
  lettersToCol,
  newId,
  proposeBlock,
  type BlockMapping,
  type SheetGrid,
  type TemplateSchema,
} from '@rnh/shared/v2';

export interface BlockMappingFormProps {
  grid: SheetGrid;
  schema: TemplateSchema;
  region: string;
  nextSlot: number;
  onAdd: (m: BlockMapping) => void;
}

export function BlockMappingForm({
  grid,
  schema,
  region,
  nextSlot,
  onAdd,
}: BlockMappingFormProps): JSX.Element {
  const [draft, setDraft] = useState<BlockMapping | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const propose = () => {
    setError(null);
    setNote(null);
    try {
      const p = proposeBlock(grid, region.trim().toUpperCase(), schema, { firstSlot: nextSlot });
      setDraft({ ...p.mapping, mappingId: newId('m') });
      const parts: string[] = [
        `Layout read from the ${p.layoutSource === 'default' ? 'region edge' : p.layoutSource}.`,
      ];
      if (p.unboundParamIds.length)
        parts.push(`${p.unboundParamIds.length} parameter(s) have no row here.`);
      if (p.unboundRows.length) parts.push(`Rows not bound: ${p.unboundRows.join(', ')}.`);
      setNote(parts.join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that region.');
      setDraft(null);
    }
  };

  const num = (k: 'firstSlot' | 'slotCount' | 'stride' | 'ratingOffset', v: string) =>
    draft && setDraft({ ...draft, [k]: Math.max(k === 'ratingOffset' ? 0 : 1, Number(v) || 0) });

  return (
    <div className="l-subcard" aria-label="Rating block">
      <div className="l-row">
        <p className="l-small">
          Region: <strong>{region || '— select cells on the sheet —'}</strong>
        </p>
        <button
          type="button"
          className="l-btn l-btn--primary"
          disabled={!region || schema.parameters.length === 0}
          onClick={propose}
        >
          Detect rating block
        </button>
      </div>
      {schema.parameters.length === 0 ? (
        <p className="l-muted l-small">Define parameters first (step 2).</p>
      ) : null}
      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {draft ? (
        <>
          {note ? <p className="l-muted l-small">{note}</p> : null}
          <div className="l-form-grid">
            <label className="l-field">
              <span>First tyre slot</span>
              <input
                type="number"
                min={1}
                value={draft.firstSlot}
                onChange={(e) => num('firstSlot', e.target.value)}
              />
            </label>
            <label className="l-field">
              <span>Tyre slots in block</span>
              <input
                type="number"
                min={1}
                value={draft.slotCount}
                onChange={(e) => num('slotCount', e.target.value)}
              />
            </label>
            <label className="l-field">
              <span>First rating column</span>
              <input
                value={colToLetters(draft.firstColumn)}
                onChange={(e) => {
                  const c = lettersToCol(e.target.value.replace(/[^A-Za-z]/g, ''));
                  if (c > 0) setDraft({ ...draft, firstColumn: c });
                }}
              />
            </label>
            <label className="l-field">
              <span>Columns per tyre (stride)</span>
              <input
                type="number"
                min={1}
                value={draft.stride}
                onChange={(e) => num('stride', e.target.value)}
              />
            </label>
            <label className="l-field">
              <span>Comment column offset</span>
              <select
                value={draft.commentOffset === null ? '' : String(draft.commentOffset)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    commentOffset: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">No comment column</option>
                {Array.from({ length: Math.max(1, draft.stride - 1) }, (_, i) => i + 1).map((o) => (
                  <option key={o} value={o}>
                    +{o} (rating in {colToLetters(draft.firstColumn)}, comment in{' '}
                    {colToLetters(draft.firstColumn + o)})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="l-small">
            {draft.rows.length} parameter rows × {draft.slotCount} tyres → slots {draft.firstSlot}–
            {draft.firstSlot + draft.slotCount - 1} (
            {draft.rows.length * draft.slotCount * (draft.commentOffset === null ? 1 : 2)} cells)
          </p>
          <button
            type="button"
            className="l-btn l-btn--success"
            onClick={() => {
              onAdd(draft);
              setDraft(null);
              setNote(null);
            }}
          >
            Add rating block
          </button>
        </>
      ) : null}
    </div>
  );
}
