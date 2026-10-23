// Template Studio settings (R3.5, R3.6, R12.4): rating scale, tyre slot
// count, quick comments and the report file-name pattern.

import { useEffect, useState } from 'react';
import { DEFAULT_QUICK_COMMENTS, type TemplateSchema } from '@rnh/shared/v2';

function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  onCommit: (n: number) => void;
}): JSX.Element {
  const [v, setV] = useState(String(props.value));
  useEffect(() => setV(String(props.value)), [props.value]);
  return (
    <label className="l-field">
      <span className="l-field__label">{props.label}</span>
      <input
        className="l-input l-input--num"
        type="number"
        step={props.step ?? 1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (v.trim() !== '' && Number.isFinite(n) && n !== props.value) props.onCommit(n);
          else setV(String(props.value));
        }}
      />
    </label>
  );
}

export function SettingsEditor({
  schema,
  onChange,
}: {
  schema: TemplateSchema;
  onChange: (s: TemplateSchema) => void;
}): JSX.Element {
  const [newQc, setNewQc] = useState('');
  const scale = schema.scale;

  return (
    <section className="l-card" aria-label="Scale and settings">
      <h3>Rating scale and settings</h3>
      <div className="l-form-grid">
        <NumberField
          label="Scale min"
          value={scale.min}
          step={0.5}
          onCommit={(min) => onChange({ ...schema, scale: { ...scale, min } })}
        />
        <NumberField
          label="Scale max"
          value={scale.max}
          step={0.5}
          onCommit={(max) => onChange({ ...schema, scale: { ...scale, max } })}
        />
        <label className="l-field">
          <span className="l-field__label">Step</span>
          <select
            className="l-input"
            value={scale.step}
            onChange={(e) =>
              onChange({
                ...schema,
                scale: { ...scale, step: Number(e.target.value) as 0.25 | 0.5 },
              })
            }
          >
            <option value={0.25}>0.25</option>
            <option value={0.5}>0.5</option>
          </select>
        </label>
        <NumberField
          label="Tyre sets (slots) per test"
          value={schema.slotCount}
          onCommit={(slotCount) => onChange({ ...schema, slotCount: Math.round(slotCount) })}
        />
      </div>

      <h4>Quick comments (one tap on the phone)</h4>
      <div className="l-chips">
        {schema.quickComments.map((q) => (
          <span key={q} className="l-chip l-chip--static">
            {q}
            <button
              type="button"
              className="l-chip__x"
              aria-label={`Remove quick comment ${q}`}
              onClick={() =>
                onChange({ ...schema, quickComments: schema.quickComments.filter((x) => x !== q) })
              }
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="l-row">
        <input
          className="l-input"
          aria-label="New quick comment"
          placeholder="e.g. understeer is more"
          value={newQc}
          onChange={(e) => setNewQc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newQc.trim()) {
              onChange({
                ...schema,
                quickComments: [...new Set([...schema.quickComments, newQc.trim()])],
              });
              setNewQc('');
            }
          }}
        />
        <button
          type="button"
          className="l-btn l-btn--secondary"
          disabled={!newQc.trim()}
          onClick={() => {
            onChange({
              ...schema,
              quickComments: [...new Set([...schema.quickComments, newQc.trim()])],
            });
            setNewQc('');
          }}
        >
          + Add
        </button>
        <button
          type="button"
          className="l-btn l-btn--ghost"
          onClick={() => onChange({ ...schema, quickComments: [...DEFAULT_QUICK_COMMENTS] })}
        >
          Reset to defaults
        </button>
      </div>

      <h4>Report file name</h4>
      <label className="l-field">
        <span className="l-field__label">
          Pattern: {'{customer}'} {'{vehicle}'} {'{tyreSize}'} {'{testDate}'} {'{template}'}
        </span>
        <input
          className="l-input"
          value={schema.fileNamePattern}
          onChange={(e) => onChange({ ...schema, fileNamePattern: e.target.value })}
        />
      </label>
    </section>
  );
}
