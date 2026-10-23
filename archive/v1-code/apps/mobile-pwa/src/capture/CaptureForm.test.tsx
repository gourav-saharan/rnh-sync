// Component tests for the capture form's autosave-on-change behaviour
// (R5.3, R6.1, R6.4, R6.6, R6.7, R10.1, R10.3).
//
// These example-based tests use @testing-library/react with a real Dexie store
// backed by fake-indexeddb (registered in the shared test setup). They assert:
//   - editing any Test_Session value autosaves it to the local store (R5.3)
//   - the persisted value round-trips (R10.1)
//   - a single-tap rating is captured and persisted (R5.2 + R5.3)
//   - the default R&H_Parameter set is presented when no template mappings
//     define parameters (R6.7), and template-defined parameters otherwise (R6.6)
//   - an unsynced indicator is shown while edits are not yet synced (R10.3)

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FieldMapping } from '@rnh/shared';
import { LocalSessionDatabase, LocalSessionStore } from '../local';
import { CaptureForm } from './CaptureForm';

let store: LocalSessionStore;
let db: LocalSessionDatabase;
let user: ReturnType<typeof userEvent.setup>;
let dbCounter = 0;

beforeEach(async () => {
  // Fresh, isolated database per test so autosaves don't bleed across tests.
  db = new LocalSessionDatabase(`test-capture-${dbCounter++}`);
  store = new LocalSessionStore(db);
  await store.clear();
  user = userEvent.setup();
});

afterEach(() => {
  db.close();
});

const fixedNow = () => 1_000;
const fixedId = () => 'session-under-test';

function renderForm(mappings: readonly FieldMapping[] = []) {
  return render(
    <CaptureForm
      store={store}
      createdBy="tester-1"
      templateMappings={mappings}
      now={fixedNow}
      makeSessionId={fixedId}
    />,
  );
}

describe('CaptureForm autosave-on-change', () => {
  it('shows an unsynced indicator for an in-progress session (R10.3)', () => {
    renderForm();
    expect(screen.getByTestId('unsynced-indicator')).toBeInTheDocument();
  });

  it('autosaves a tyre-set edit to the local store (R5.3, R6.1, R10.1)', async () => {
    renderForm();

    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 1 make' }),
      'Bridgestone',
    );

    await waitFor(async () => {
      const saved = await store.load('session-under-test');
      expect(saved?.tyreSets[0]?.make).toBe('Bridgestone');
    });
  });

  it('autosaves a vehicle-detail edit (R5.3, R6.2)', async () => {
    renderForm();

    await user.type(
      screen.getByRole('textbox', { name: 'Vehicle ID' }),
      'CAR-9',
    );

    await waitFor(async () => {
      const saved = await store.load('session-under-test');
      expect(saved?.vehicle.vehicleId).toBe('CAR-9');
    });
  });

  it('captures a single-tap rating and persists it (R5.2, R5.3, R6.5)', async () => {
    renderForm();

    // "Smooth Road" is a default Ride parameter (range 1..10).
    await user.click(
      screen.getByRole('button', { name: 'Rate Smooth Road 6.25' }),
    );

    await waitFor(async () => {
      const saved = await store.load('session-under-test');
      const entry = saved?.ride.parameters.find((p) => p.name === 'Smooth Road');
      expect(entry?.rating).toBe(6.25);
      // Category average is derived from the ratings (R6.5).
      expect(saved?.ride.averageRating).toBeGreaterThan(0);
    });
  });

  it('presents the default R&H_Parameter set when no mappings define parameters (R6.7)', () => {
    renderForm([]);
    expect(
      screen.getByRole('group', { name: 'Smooth Road rating' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Rear Tracking rating' }),
    ).toBeInTheDocument();
  });

  it('presents template-defined R&H_Parameters when mappings define them (R6.6)', () => {
    const mappings: FieldMapping[] = [
      {
        mappingId: 'm1',
        templateId: 't1',
        sheetName: 'R&H',
        cellAddress: 'C7',
        inputFieldKey: 'rhRating.ride.customRide',
        fieldType: 'rhRating',
        rhParameterName: 'Custom Ride Feel',
        required: true,
      },
      {
        mappingId: 'm2',
        templateId: 't1',
        sheetName: 'R&H',
        cellAddress: 'C8',
        inputFieldKey: 'rhRating.handling.customHandling',
        fieldType: 'rhRating',
        rhParameterName: 'Custom Handling Feel',
        required: true,
      },
    ];
    renderForm(mappings);

    expect(
      screen.getByRole('group', { name: 'Custom Ride Feel rating' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Custom Handling Feel rating' }),
    ).toBeInTheDocument();
    // The default parameters are NOT presented (exactly the template set).
    expect(
      screen.queryByRole('group', { name: 'Smooth Road rating' }),
    ).toBeNull();
  });
});
