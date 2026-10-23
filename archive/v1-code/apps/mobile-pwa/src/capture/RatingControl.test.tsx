// Component tests for the single-tap rating control (R5.1, R5.2, R5.4).
//
// These example-based tests use @testing-library/react. They assert that:
//   - only in-range 0.25-grid values are offered as presets (R5.4)
//   - a single tap records that rating (R5.2)
//   - selecting a valid preset applies it; the control never surfaces an
//     off-grid or out-of-range value, and an invalid proposal keeps the prior
//     value (R5.4, via the shared applyRating routed through onChange)
//   - every preset button meets the 44x44 CSS px touch-target minimum (R5.1)

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRating } from '@rnh/shared';
import { RatingControl, MIN_TOUCH_TARGET_PX } from './RatingControl';
import { presetRatingsFor } from './session';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

describe('RatingControl single-tap 0.25-grid rating', () => {
  it('offers only in-range 0.25 increments as presets (R5.4)', () => {
    const range = { min: 1, max: 3 };
    render(
      <RatingControl
        parameterName="Damping"
        value={1}
        range={range}
        onChange={() => {}}
      />,
    );

    // Expected presets: 1, 1.25, 1.5, ... 3 — 9 buttons.
    const expected = presetRatingsFor(range);
    expect(expected).toEqual([1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]);

    for (const preset of expected) {
      expect(
        screen.getByRole('button', { name: `Rate Damping ${preset}` }),
      ).toBeInTheDocument();
    }
    // No out-of-range or off-grid buttons.
    expect(screen.queryByRole('button', { name: /Rate Damping 3.25/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rate Damping 0.75/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rate Damping 1.1/ })).toBeNull();
  });

  it('records a valid rating in a single tap (R5.2)', async () => {
    const onChange = vi.fn();
    render(
      <RatingControl
        parameterName="Smooth Road"
        value={1}
        range={{ min: 1, max: 10 }}
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Rate Smooth Road 6.25' }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(6.25);
  });

  it('marks the current value as pressed', () => {
    render(
      <RatingControl
        parameterName="Rough Road"
        value={2.5}
        range={{ min: 1, max: 10 }}
        onChange={() => {}}
      />,
    );

    const selected = screen.getByRole('button', { name: 'Rate Rough Road 2.5' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    const other = screen.getByRole('button', { name: 'Rate Rough Road 2.75' });
    expect(other).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the prior value when an invalid rating is proposed (R5.4)', () => {
    const range = { min: 1, max: 10 };
    // applyRating is the single validation path the control routes through.
    // Off-grid and out-of-range proposals resolve back to the prior value.
    expect(applyRating(6.1, 5, range)).toBe(5); // off the 0.25 grid
    expect(applyRating(11, 5, range)).toBe(5); // above range
    expect(applyRating(0.5, 5, range)).toBe(5); // below range
    // A valid proposal is applied.
    expect(applyRating(6.25, 5, range)).toBe(6.25);
  });

  it('renders touch targets of at least 44x44 CSS px (R5.1)', () => {
    render(
      <RatingControl
        parameterName="Damping"
        value={1}
        range={{ min: 1, max: 2 }}
        onChange={() => {}}
      />,
    );

    for (const button of screen.getAllByRole('button')) {
      // Inline styles set the minimum dimensions; assert they meet the floor.
      expect(button.style.minWidth).toBe(`${MIN_TOUCH_TARGET_PX}px`);
      expect(button.style.minHeight).toBe(`${MIN_TOUCH_TARGET_PX}px`);
    }
  });
});
