// Setup step: Tyre_Sets (R5.5–R5.7). Add up to the template's slot count,
// exactly one Reference, copy from previous, reorder (= report slot order).

import { useState } from 'react';
import type { TyreSetV2 } from '@rnh/shared/v2';

export interface TyreSetsStepProps {
  sets: TyreSetV2[];
  slotCount: number;
  suggestions: { make: string[]; pattern: string[]; size: string[] };
  onAdd: (copyPrevious: boolean) => void;
  onUpdate: (id: string, patch: Partial<TyreSetV2>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onReference: (id: string) => void;
  /** Attach a photo (sidewall / DOT) to a tyre set (R5.8). */
  onPhoto?: (id: string, file: File) => void;
  photoError?: string | null;
}

const TEXT_FIELDS: {
  key: 'label' | 'make' | 'pattern' | 'size' | 'srlr' | 'weekCode' | 'dot' | 'compound';
  label: string;
  list?: 'make' | 'pattern' | 'size';
}[] = [
  { key: 'label', label: 'Label (e.g. Ref, MU1, 3B-RB)' },
  { key: 'make', label: 'Make', list: 'make' },
  { key: 'pattern', label: 'Pattern', list: 'pattern' },
  { key: 'size', label: 'Size', list: 'size' },
  { key: 'srlr', label: 'SR / LR' },
  { key: 'weekCode', label: 'Week code' },
  { key: 'dot', label: 'DOT' },
  { key: 'compound', label: 'Compound' },
];

export function TyreSetsStep(p: TyreSetsStepProps): JSX.Element {
  const full = p.sets.length >= p.slotCount;
  const [removing, setRemoving] = useState<string | null>(null);
  const armed = p.sets.find((t) => t.tyreSetId === removing);
  return (
    <div className="form">
      {(['make', 'pattern', 'size'] as const).map((k) => (
        <datalist key={k} id={`sugg-${k}`}>
          {p.suggestions[k].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}
      {p.sets.map((t, i) => (
        <section key={t.tyreSetId} className="card" aria-label={`Tyre set ${t.slot}: ${t.label}`}>
          <div className="card__head">
            <h3 className="card__title">
              Slot {t.slot} · {t.label || '—'}{' '}
              {t.isReference ? <span className="badge">REFERENCE</span> : null}
            </h3>
            <div className="card__tools">
              <button
                type="button"
                className="btn btn--ghost"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => p.onMove(t.tyreSetId, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                aria-label="Move down"
                disabled={i === p.sets.length - 1}
                onClick={() => p.onMove(t.tyreSetId, 1)}
              >
                ↓
              </button>
            </div>
          </div>
          <div className="field-grid">
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span className="field__label">{f.label}</span>
                <input
                  value={t[f.key]}
                  list={f.list ? `sugg-${f.list}` : undefined}
                  onChange={(e) => p.onUpdate(t.tyreSetId, { [f.key]: e.target.value })}
                />
              </label>
            ))}
            {(['airTempC', 'roadTempC'] as const).map((k) => (
              <label key={k} className="field">
                <span className="field__label">
                  {k === 'airTempC' ? 'Air temp °C' : 'Road temp °C'}
                </span>
                <input
                  inputMode="decimal"
                  value={t[k] ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(',', '.'));
                    p.onUpdate(t.tyreSetId, {
                      [k]: e.target.value === '' || !Number.isFinite(n) ? null : n,
                    });
                  }}
                />
              </label>
            ))}
          </div>
          <div className="card__actions">
            {p.onPhoto ? (
              <label className="btn btn--secondary">
                📷 Photo{t.photoPaths.length ? ` (${t.photoPaths.length})` : ''}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  aria-label={`Add photo for ${t.label || `slot ${t.slot}`}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) p.onPhoto?.(t.tyreSetId, f);
                    e.target.value = '';
                  }}
                />
              </label>
            ) : null}
            {!t.isReference ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => p.onReference(t.tyreSetId)}
              >
                Make reference
              </button>
            ) : null}
            {p.sets.length > 1 ? (
              <button
                type="button"
                className="btn btn--ghost-danger"
                aria-pressed={removing === t.tyreSetId}
                onClick={() => {
                  // Two taps: first arms, second removes (no browser pop-up).
                  if (removing === t.tyreSetId) {
                    setRemoving(null);
                    p.onRemove(t.tyreSetId);
                  } else {
                    setRemoving(t.tyreSetId);
                  }
                }}
              >
                {removing === t.tyreSetId ? 'Tap again to remove' : 'Remove'}
              </button>
            ) : null}
          </div>
        </section>
      ))}
      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={full}
          onClick={() => p.onAdd(false)}
        >
          + Add tyre set
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={full || p.sets.length === 0}
          onClick={() => p.onAdd(true)}
        >
          + Copy previous
        </button>
      </div>
      {armed ? (
        <p className="note note--warn" role="alert">
          Removing {armed.label || `slot ${armed.slot}`} takes it out of this test: its ratings and
          comments are no longer shown or written to the report. Tap “Tap again to remove” to
          confirm.
        </p>
      ) : null}
      {p.photoError ? (
        <p className="note note--warn" role="alert">
          {p.photoError}
        </p>
      ) : null}
      {full ? (
        <p className="note">
          This template has {p.slotCount} tyre columns, so no more sets can be added.
        </p>
      ) : null}
    </div>
  );
}
