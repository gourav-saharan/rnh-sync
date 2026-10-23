// Component tests for the session review/list panel (R7.2, R10.5).
//
// Uses @testing-library/react with a fake report-viewer store (no Firebase).
// Asserts:
//   - synced sessions render live from the subscription (R7.2),
//   - selecting a session shows its details,
//   - deletion is confirmation-gated: deleteTestSession runs only after the
//     user confirms, and then with { confirmed: true } (R10.5).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TestSession } from '@rnh/shared';
import type { ReportViewerStore } from '../data-access';
import { SessionListPanel } from './SessionListPanel';

const session = {
  sessionId: 's1',
  templateId: 't1',
  conditions: { testDate: '2026-09-15', driverName: 'Ada', testTrack: 'MU1' },
  vehicle: { vehicleId: 'CAR-1' },
  tyreSets: [{ groupName: 'Set A' }],
  ride: { parameters: [], averageRating: 5 },
  handling: { parameters: [], averageRating: 6 },
  syncState: 'synced',
} as unknown as TestSession;

function makeStore(deleteFn = vi.fn(async () => {})): ReportViewerStore {
  return {
    subscribeTestSessions(onData) {
      onData([session]);
      return () => {};
    },
    subscribeCustomerTemplates() {
      return () => {};
    },
    subscribeFieldMappings() {
      return () => {};
    },
    deleteTestSession: deleteFn,
  };
}

describe('SessionListPanel', () => {
  it('lists synced sessions live (R7.2)', () => {
    render(<SessionListPanel reportViewerStore={makeStore()} />);
    expect(screen.getByTestId('session-s1')).toHaveTextContent('s1');
    expect(screen.getByTestId('session-s1')).toHaveTextContent('(synced)');
  });

  it('shows details for a selected session', async () => {
    const user = userEvent.setup();
    render(<SessionListPanel reportViewerStore={makeStore()} />);
    await user.click(screen.getByRole('button', { name: /s1/ }));
    const details = await screen.findByLabelText('Session details');
    expect(details).toHaveTextContent('Ada');
    expect(details).toHaveTextContent('CAR-1');
  });

  it('deletes a session only after explicit confirmation (R10.5)', async () => {
    const user = userEvent.setup();
    const deleteFn = vi.fn(async () => {});
    render(<SessionListPanel reportViewerStore={makeStore(deleteFn)} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteFn).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => {
      expect(deleteFn).toHaveBeenCalledWith('s1', { confirmed: true });
    });
  });
});
