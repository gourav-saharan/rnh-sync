// Single-tap R&H rating control on the 0.25 grid (R5.1, R5.2, R5.4).
//
// The control renders a row of preset buttons, one per 0.25 step within the
// parameter's configured range. Tapping a button records that rating in a
// single tap (R5.2). Every button meets the >=44x44 CSS px touch-target
// minimum (R5.1). Values off the 0.25 grid or outside the range are never
// offered as presets, and any proposed change is run through the shared
// `applyRating` so an invalid value keeps the prior value (R5.4).

import { applyRating, type RatingRange } from '@rnh/shared';
import { presetRatingsFor } from './session';

/** Minimum touch-target size in CSS pixels (R5.1). */
export const MIN_TOUCH_TARGET_PX = 44;

interface RatingControlProps {
  /** The R&H_Parameter name this control rates (used for labelling). */
  parameterName: string;
  /** The currently recorded rating. */
  value: number;
  /** The parameter's configured range; presets are drawn from it (R5.4). */
  range: RatingRange;
  /**
   * Called with the value that should be kept after a tap. Invalid proposals
   * resolve back to the prior value via {@link applyRating} (R5.4).
   */
  onChange: (next: number) => void;
}

/**
 * Renders preset rating buttons on the 0.25 grid. Selecting a preset records
 * the rating in a single tap; the value is validated so only in-range 0.25
 * multiples are ever applied.
 */
export function RatingControl({
  parameterName,
  value,
  range,
  onChange,
}: RatingControlProps): JSX.Element {
  const presets = presetRatingsFor(range);

  return (
    <div
      role="group"
      aria-label={`${parameterName} rating`}
      className="rating__grid"
    >
      {presets.map((preset) => {
        const selected = Math.abs(preset - value) < 1e-9;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={selected}
            aria-label={`Rate ${parameterName} ${preset}`}
            className={
              selected ? 'rating__btn rating__btn--selected' : 'rating__btn'
            }
            onClick={() => {
              // Validate the proposed value; an invalid one keeps the prior
              // value (R5.4). Presets are always valid, but routing through
              // applyRating keeps the single validation path.
              onChange(applyRating(preset, value, range));
            }}
            style={{
              // Inline min sizes are the guaranteed 44px touch-target floor
              // (R5.1); the class layers visual affordance on top.
              minWidth: MIN_TOUCH_TARGET_PX,
              minHeight: MIN_TOUCH_TARGET_PX,
            }}
          >
            {preset}
          </button>
        );
      })}
    </div>
  );
}
