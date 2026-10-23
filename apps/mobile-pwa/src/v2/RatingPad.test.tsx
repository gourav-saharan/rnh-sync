// RatingPad: 9 buttons >= 64px, centred on the anchor, selection shown by
// aria-pressed + check mark, shift and clear (R6.2, R6.3, R6.7).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCALE } from '@rnh/shared/v2';
import { PAD_BUTTON_MIN_PX, RatingPad } from './RatingPad';

function rateButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /^Rate / });
}

describe('RatingPad', () => {
  it('shows 9 values centred on the anchor (6 -> 5..7)', () => {
    render(
      <RatingPad
        label="Basic ride"
        value={null}
        anchor={6}
        scale={DEFAULT_SCALE}
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    const buttons = rateButtons();
    expect(buttons).toHaveLength(9);
    expect(buttons[0]).toHaveAccessibleName('Rate Basic ride 5');
    expect(buttons[8]).toHaveAccessibleName('Rate Basic ride 7');
    for (const b of buttons) {
      expect(parseInt(b.style.minWidth, 10)).toBeGreaterThanOrEqual(PAD_BUTTON_MIN_PX);
      expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(PAD_BUTTON_MIN_PX);
    }
    expect(screen.getByText('Not rated')).toBeInTheDocument();
  });

  it('records a rating in one tap and marks the selected value', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <RatingPad
        label="Yaw"
        value={null}
        anchor={6}
        scale={DEFAULT_SCALE}
        onSelect={onSelect}
        onClear={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Rate Yaw 6.5' }));
    expect(onSelect).toHaveBeenCalledWith(6.5);
    rerender(
      <RatingPad
        label="Yaw"
        value={6.5}
        anchor={6}
        scale={DEFAULT_SCALE}
        onSelect={onSelect}
        onClear={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Rate Yaw 6.5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Rate Yaw 6' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shifts the window higher and clears to Unrated', async () => {
    const onClear = vi.fn();
    render(
      <RatingPad
        label="Roll"
        value={6}
        anchor={6}
        scale={DEFAULT_SCALE}
        onSelect={() => {}}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Higher/ }));
    expect(rateButtons()[8]).toHaveAccessibleName('Rate Roll 7.75');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });
});
