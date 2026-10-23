// Drive_Mode rating pad (R6.2, R6.3, R6.4, R6.7).
//
// Nine large preset buttons (>= 64 x 64 CSS px) centred on an anchor value,
// plus "lower" / "higher" buttons that shift the window across the full scale.
// The selected value is shown by fill AND a check mark (never colour alone,
// R15.4).

import { useEffect, useState } from 'react';
import { padValues, pointLabel, shiftAnchor, type RatingScale } from '@rnh/shared/v2';

export const PAD_BUTTON_MIN_PX = 64;
export const CONTROL_MIN_PX = 48;

export interface RatingPadProps {
  label: string;
  value: number | null;
  anchor: number;
  scale: RatingScale;
  /** Ref rating for this parameter, shown as a marker on its button. */
  referenceValue?: number | null;
  onSelect: (value: number) => void;
  onClear: () => void;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? v.toFixed(0) : String(v);
}

export function RatingPad({
  label,
  value,
  anchor,
  scale,
  referenceValue = null,
  onSelect,
  onClear,
}: RatingPadProps): JSX.Element {
  const [centre, setCentre] = useState(anchor);
  // Re-centre when the Tester moves to another cell.
  useEffect(() => setCentre(anchor), [anchor]);

  const values = padValues(centre, scale, 9);
  const first = values[0];
  const last = values[values.length - 1];
  const canLower = first !== undefined && first > scale.min + 1e-9;
  const canHigher = last !== undefined && last < scale.max - 1e-9;
  const hint = pointLabel(value, scale);

  return (
    <div className="pad" role="group" aria-label={`${label} rating`}>
      <p className="pad__readout" aria-live="polite">
        {value === null ? (
          <span className="pad__unrated">Not rated</span>
        ) : (
          <>
            <span className="pad__value">{fmt(value)}</span>
            {hint ? <span className="pad__hint">{hint}</span> : null}
          </>
        )}
      </p>
      <div className="pad__grid">
        {values.map((v) => {
          const selected = value !== null && Math.abs(v - value) < 1e-9;
          const isRef = referenceValue !== null && Math.abs(v - referenceValue) < 1e-9;
          return (
            <button
              key={v}
              type="button"
              className={`pad__btn${selected ? ' pad__btn--selected' : ''}`}
              aria-pressed={selected}
              aria-label={`Rate ${label} ${fmt(v)}${isRef ? ' (reference rating)' : ''}`}
              style={{ minWidth: PAD_BUTTON_MIN_PX, minHeight: PAD_BUTTON_MIN_PX }}
              onClick={() => onSelect(v)}
            >
              <span className="pad__num">{fmt(v)}</span>
              {selected ? (
                <span className="pad__check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
              {isRef && !selected ? (
                <span className="pad__ref" aria-hidden="true">
                  REF
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pad__shift">
        <button
          type="button"
          className="btn btn--secondary"
          style={{ minHeight: CONTROL_MIN_PX }}
          disabled={!canLower}
          onClick={() => setCentre((c) => shiftAnchor(c, -3, scale))}
        >
          − Lower
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          style={{ minHeight: CONTROL_MIN_PX }}
          disabled={value === null}
          onClick={onClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          style={{ minHeight: CONTROL_MIN_PX }}
          disabled={!canHigher}
          onClick={() => setCentre((c) => shiftAnchor(c, 3, scale))}
        >
          Higher +
        </button>
      </div>
    </div>
  );
}
