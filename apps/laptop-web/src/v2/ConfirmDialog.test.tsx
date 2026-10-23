// ConfirmDialog: typed confirmation, input value, Escape to cancel.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('keeps confirm disabled until the required word is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete?"
        confirmLabel="Delete"
        requireText="DELETE"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(onConfirm).toHaveBeenCalledWith('delete');
  });

  it('passes the input value and cancels on Escape', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Copy"
        confirmLabel="Create copy"
        inputLabel="Name"
        inputDefault="MSIL (copy)"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Copy' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create copy' }));
    expect(onConfirm).toHaveBeenCalledWith('MSIL (copy)');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});
