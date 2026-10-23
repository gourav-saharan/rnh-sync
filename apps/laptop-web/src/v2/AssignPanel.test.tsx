import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppUser, TestSessionV2 } from '@rnh/shared/v2';
import { AssignPanel } from './AssignPanel';

const team: AppUser[] = [
  { uid: 'owner', email: 'o@x.com', displayName: 'Owner', roles: ['Tester'] },
  { uid: 't2', email: 't2@x.com', displayName: 'Tester Two', roles: ['Tester'] },
  { uid: 'v1', email: 'v@x.com', displayName: 'Viewer', roles: ['Report_Viewer'] },
];

const session = {
  createdBy: 'owner',
  createdByName: 'Owner',
  assignedTo: [],
} as unknown as TestSessionV2;

describe('AssignPanel', () => {
  it('lists only other Testers and saves the new assignment', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AssignPanel session={session} onSave={onSave} loadTeam={async () => team} />);
    const box = await screen.findByRole('checkbox', { name: /Tester Two/ });
    expect(screen.queryByRole('checkbox', { name: /Viewer/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^Owner/ })).toBeNull();
    await userEvent.click(box);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(['t2']));
  });

  it('shows a plain error when the team cannot be loaded', async () => {
    render(
      <AssignPanel
        session={session}
        onSave={vi.fn()}
        loadTeam={async () => Promise.reject(new Error('permission-denied'))}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('team list could not be loaded');
  });
});
