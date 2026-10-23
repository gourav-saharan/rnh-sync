// Setup step: Header_Fields rendered by type (R5.3). Numeric keypad for
// numbers/pressures, date picker for dates, chips for choices. Required
// fields are marked but never block driving (R5.9).

import type { HeaderFieldDef, HeaderValue } from '@rnh/shared/v2';

export interface HeaderStepProps {
  fields: readonly HeaderFieldDef[];
  values: Record<string, HeaderValue>;
  onChange: (fieldId: string, value: HeaderValue) => void;
}

function asText(v: HeaderValue | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

export function HeaderStep({ fields, values, onChange }: HeaderStepProps): JSX.Element {
  if (fields.length === 0) {
    return <p className="note">This template has no header fields. Continue to tyre sets.</p>;
  }
  return (
    <div className="form">
      {fields.map((f) => {
        const id = `hf-${f.fieldId}`;
        const label = (
          <span className="field__label">
            {f.label}
            {f.unit ? ` (${f.unit})` : ''}
            {f.required ? <span className="field__req"> · required</span> : null}
          </span>
        );
        if (f.type === 'choice' && f.choices && f.choices.length > 0) {
          return (
            <fieldset key={f.fieldId} className="field">
              <legend className="field__label">{label}</legend>
              <div className="chips">
                {f.choices.map((c) => {
                  const on = values[f.fieldId] === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`chip${on ? ' chip--on' : ''}`}
                      aria-pressed={on}
                      onClick={() => onChange(f.fieldId, on ? null : c)}
                    >
                      {on ? '✓ ' : ''}
                      {c}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        }
        const numeric = f.type === 'number' || f.type === 'pressure';
        return (
          <label key={f.fieldId} className="field" htmlFor={id}>
            {label}
            <input
              id={id}
              type={f.type === 'date' ? 'date' : 'text'}
              inputMode={numeric ? 'decimal' : undefined}
              value={asText(values[f.fieldId])}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') return onChange(f.fieldId, null);
                if (numeric) {
                  const n = Number(raw.replace(',', '.'));
                  return onChange(
                    f.fieldId,
                    Number.isFinite(n) && /^-?\d*[.,]?\d*$/.test(raw) ? n : raw,
                  );
                }
                onChange(f.fieldId, raw);
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

/** Required header fields still empty (R5.9, R10.5). */
export function missingRequired(
  fields: readonly HeaderFieldDef[],
  values: Record<string, HeaderValue>,
): HeaderFieldDef[] {
  return fields.filter(
    (f) =>
      f.required &&
      (values[f.fieldId] === null || values[f.fieldId] === undefined || values[f.fieldId] === ''),
  );
}
