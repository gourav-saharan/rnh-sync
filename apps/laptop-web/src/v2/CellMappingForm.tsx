// Template Studio · single-cell mappings (R4.4): one cell -> a header field,
// or one cell per tyre slot -> a tyre detail (label, make, pattern, DOT, ...).

import { useState } from 'react';
import {
  newId,
  parseA1,
  TYRE_DETAIL_KEYS,
  TYRE_DETAIL_LABELS,
  type HeaderCellMapping,
  type SlotCellMapping,
  type TemplateSchema,
  type TyreDetailKey,
} from '@rnh/shared/v2';

export interface CellMappingFormProps {
  sheetName: string;
  schema: TemplateSchema;
  /** Last clicked cell on the sheet. */
  cell: string;
  onAdd: (m: HeaderCellMapping | SlotCellMapping) => void;
}

export function CellMappingForm({
  sheetName,
  schema,
  cell,
  onAdd,
}: CellMappingFormProps): JSX.Element {
  const [kind, setKind] = useState<'header' | 'slotDetail'>('header');
  const [fieldId, setFieldId] = useState('');
  const [detail, setDetail] = useState<TyreDetailKey>('label');
  const [slot, setSlot] = useState(1);
  const [slotCells, setSlotCells] = useState<{ slot: number; cellAddress: string }[]>([]);
  const valid = !!parseA1(cell);

  return (
    <div className="l-subcard" aria-label="Cell mapping">
      <div className="l-seg" role="radiogroup" aria-label="Mapping kind">
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'header'}
          className={`l-seg__btn${kind === 'header' ? ' l-seg__btn--on' : ''}`}
          onClick={() => setKind('header')}
        >
          Header field
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'slotDetail'}
          className={`l-seg__btn${kind === 'slotDetail' ? ' l-seg__btn--on' : ''}`}
          onClick={() => setKind('slotDetail')}
        >
          Tyre detail per slot
        </button>
      </div>
      <p className="l-small">
        Selected cell: <strong>{valid ? cell : '— click a cell on the sheet —'}</strong>
      </p>
      {kind === 'header' ? (
        <div className="l-row">
          <label className="l-field">
            <span>Header field</span>
            <select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
              <option value="">Choose…</option>
              {schema.headerFields.map((f) => (
                <option key={f.fieldId} value={f.fieldId}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="l-btn l-btn--success"
            disabled={!valid || !fieldId}
            onClick={() =>
              onAdd({
                kind: 'header',
                mappingId: newId('m'),
                sheetName,
                cellAddress: cell.toUpperCase(),
                fieldId,
              })
            }
          >
            Map {cell || 'cell'} → field
          </button>
        </div>
      ) : (
        <>
          <div className="l-row">
            <label className="l-field">
              <span>Tyre detail</span>
              <select
                value={detail}
                onChange={(e) => {
                  setDetail(e.target.value as TyreDetailKey);
                  setSlotCells([]);
                }}
              >
                {TYRE_DETAIL_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {TYRE_DETAIL_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="l-field">
              <span>Slot</span>
              <input
                type="number"
                min={1}
                max={schema.slotCount}
                value={slot}
                onChange={(e) => setSlot(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <button
              type="button"
              className="l-btn l-btn--secondary"
              disabled={!valid}
              onClick={() => {
                setSlotCells((l) =>
                  [
                    ...l.filter((c) => c.slot !== slot),
                    { slot, cellAddress: cell.toUpperCase() },
                  ].sort((a, b) => a.slot - b.slot),
                );
                setSlot((s) => Math.min(schema.slotCount, s + 1));
              }}
            >
              Slot {slot} = {cell || '?'}
            </button>
          </div>
          {slotCells.length ? (
            <p className="l-small">
              {slotCells.map((c) => `S${c.slot}: ${c.cellAddress}`).join(' · ')}
            </p>
          ) : (
            <p className="l-muted l-small">
              Click the cell for slot 1, press the button, then the next slot's cell, and so on.
            </p>
          )}
          <button
            type="button"
            className="l-btn l-btn--success"
            disabled={slotCells.length === 0}
            onClick={() => {
              onAdd({
                kind: 'slotDetail',
                mappingId: newId('m'),
                sheetName,
                detail,
                cells: slotCells,
              });
              setSlotCells([]);
              setSlot(1);
            }}
          >
            Add {TYRE_DETAIL_LABELS[detail]} mapping ({slotCells.length} slots)
          </button>
        </>
      )}
    </div>
  );
}
