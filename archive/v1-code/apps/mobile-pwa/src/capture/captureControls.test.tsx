// Additional UI/unit coverage for the Mobile_PWA capture controls (task 12.4).
//
// These example-based tests use @testing-library/react with a real Dexie store
// backed by fake-indexeddb (registered in src/test/setup.ts). They complement
// RatingControl.test.tsx and CaptureForm.test.tsx by filling the gaps called
// out for task 12.4:
//
//   - single-tap rating entry across categories and re-tapping (R5.2)
//   - autosave-on-change lands within the 2s requirement, using fake timers
//     to assert the timing bound (R5.3)
//   - multi-Tyre_Set management: add several sets, edit each independently,
//     remove one, and verify autosave persists the full, correct set (R6.1)
//   - template-driven vs default R&H_Parameter sets: exactly the default set of
//     six parameters when no mappings define them (R6.7), and exactly the
//     template-defined set (across ride + handling) otherwise (R6.6)

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DEFAULT_RH_PARAMETERS, type FieldMapping } from '@rnh/shared';
import { AUTOSAVE_DELAY_MS, CaptureForm } from './CaptureForm';
import { LocalSessionDatabase, LocalSessionStore } from '../local';

let store: LocalSessionStore;
let db: LocalSessionDatabase;
let dbCounter = 0;

const SESSION_ID = 'session-under-test';
const fixedNow = () => 1_000;
const fixedId = () => SESSION_ID;

beforeEach(async () => {
  // Fresh, isolated database per test so autosaves don't bleed across tests.
  db = new LocalSessionDatabase(`test-capture-controls-${dbCounter++}`);
  store = new LocalSessionStore(db);
  await store.clear();
});

afterEach(() => {
  db.close();
});

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

/** A helper to build an rhRating Field_Mapping that defines a parameter. */
function rhMapping(
  overrides: Partial<FieldMapping> & { rhParameterName: string },
): FieldMapping {
  return {
    mappingId: `m-${overrides.rhParameterName}`,
    templateId: 't1',
    sheetName: 'R&H',
    cellAddress: 'C7',
    inputFieldKey: `rhRating.ride.${overrides.rhParameterName}`,
    fieldType: 'rhRating',
    required: true,
    ...overrides,
  };
}

describe('capture controls — single-tap rating entry (R5.2)', () => {
  it('records a ride and a handling rating, each in a single tap', async () => {
    const user = userEvent.setup();
    renderForm();

    // "Smooth Road" is a default Ride parameter; "Rear Tracking" is Handling.
    await user.click(screen.getByRole('button', { name: 'Rate Smooth Road 7.5' }));
    await user.click(
      screen.getByRole('button', { name: 'Rate Rear Tracking 4.25' }),
    );

    await waitFor(async () => {
      const saved = await store.load(SESSION_ID);
      expect(
        saved?.ride.parameters.find((p) => p.name === 'Smooth Road')?.rating,
      ).toBe(7.5);
      expect(
        saved?.handling.parameters.find((p) => p.name === 'Rear Tracking')
          ?.rating,
      ).toBe(4.25);
    });
  });

  it('overwrites a prior rating when the tester taps a different preset', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Rate Damping 3' }));
    await user.click(screen.getByRole('button', { name: 'Rate Damping 5.25' }));

    await waitFor(async () => {
      const saved = await store.load(SESSION_ID);
      expect(
        saved?.ride.parameters.find((p) => p.name === 'Damping')?.rating,
      ).toBe(5.25);
    });
  });
});

describe('capture controls — autosave-on-change timing (R5.3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not persist before the autosave delay, and persists within 2s', async () => {
    // Use fake timers with fireEvent (userEvent + fake timers is brittle) so we
    // can assert the debounce boundary precisely. The write must not happen
    // before AUTOSAVE_DELAY_MS elapses, and must happen at/after it — and the
    // debounce window is itself within the 2s requirement (R5.3).
    expect(AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(2000);
    // Fake only the debounce timer APIs; leave the IndexedDB (fake-indexeddb)
    // internal scheduling on real timers so store reads still resolve.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderForm();

    fireEvent.change(screen.getByRole('textbox', { name: 'Vehicle ID' }), {
      target: { value: 'CAR-42' },
    });

    // Just before the debounce elapses, nothing is written yet.
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    });
    expect(await store.load(SESSION_ID)).toBeUndefined();

    // Crossing the debounce boundary schedules the write.
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // The write is now in flight against IndexedDB (real scheduling). Restore
    // real timers and poll until it has persisted.
    vi.useRealTimers();
    await waitFor(async () => {
      const saved = await store.load(SESSION_ID);
      expect(saved?.vehicle.vehicleId).toBe('CAR-42');
    });
  });
});

describe('capture controls — multi-Tyre_Set management (R6.1)', () => {
  it('adds several sets, edits each independently, and autosaves the full set', async () => {
    const user = userEvent.setup();
    renderForm();

    // Start with one set; add two more for three total.
    await user.click(screen.getByRole('button', { name: 'Add tyre set' }));
    await user.click(screen.getByRole('button', { name: 'Add tyre set' }));

    expect(screen.getAllByRole('group', { name: /Tyre set \d+/ })).toHaveLength(
      3,
    );

    // Edit the make of each set independently.
    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 1 make' }),
      'Bridgestone',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 2 make' }),
      'Michelin',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 3 make' }),
      'Goodyear',
    );
    // Give one set a distinct pattern to prove per-set fields are independent.
    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 2 pattern' }),
      'Primacy',
    );

    await waitFor(async () => {
      const saved = await store.load(SESSION_ID);
      expect(saved?.tyreSets).toHaveLength(3);
      expect(saved?.tyreSets.map((ts) => ts.make)).toEqual([
        'Bridgestone',
        'Michelin',
        'Goodyear',
      ]);
      expect(saved?.tyreSets[1]?.pattern).toBe('Primacy');
      // Untouched patterns stay blank — edits don't leak across sets.
      expect(saved?.tyreSets[0]?.pattern).toBe('');
      expect(saved?.tyreSets[2]?.pattern).toBe('');
    });
  });

  it('removes a set and autosaves the reduced, correctly-ordered set', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add tyre set' }));
    await user.click(screen.getByRole('button', { name: 'Add tyre set' }));

    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 1 make' }),
      'Bridgestone',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 2 make' }),
      'Michelin',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Tyre set 3 make' }),
      'Goodyear',
    );

    // Remove the middle set (index 2 in the UI labelling).
    await user.click(
      screen.getByRole('button', { name: 'Remove tyre set 2' }),
    );

    expect(screen.getAllByRole('group', { name: /Tyre set \d+/ })).toHaveLength(
      2,
    );

    await waitFor(async () => {
      const saved = await store.load(SESSION_ID);
      expect(saved?.tyreSets).toHaveLength(2);
      // The remaining sets keep their values in order (first + last).
      expect(saved?.tyreSets.map((ts) => ts.make)).toEqual([
        'Bridgestone',
        'Goodyear',
      ]);
    });
  });

  it('does not offer a remove control when only one set remains', () => {
    renderForm();
    expect(screen.getAllByRole('group', { name: /Tyre set \d+/ })).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole('button', { name: /Remove tyre set/ }),
    ).toBeNull();
  });
});

describe('capture controls — template-driven vs default parameter sets (R6.6, R6.7)', () => {
  it('presents exactly the default six-parameter set when no mappings define parameters (R6.7)', () => {
    renderForm([]);

    // Every default parameter is rendered as a rating group.
    for (const param of DEFAULT_RH_PARAMETERS) {
      expect(
        screen.getByRole('group', { name: `${param.name} rating` }),
      ).toBeInTheDocument();
    }
    // And no extras: exactly the six default rating groups are present.
    expect(screen.getAllByRole('group', { name: /rating$/ })).toHaveLength(
      DEFAULT_RH_PARAMETERS.length,
    );
  });

  it('presents exactly the template-defined parameters across both categories (R6.6)', () => {
    const mappings: FieldMapping[] = [
      rhMapping({
        rhParameterName: 'Custom Ride Feel',
        inputFieldKey: 'rhRating.ride.customRide',
        cellAddress: 'C7',
      }),
      rhMapping({
        rhParameterName: 'Custom Handling Feel',
        inputFieldKey: 'rhRating.handling.customHandling',
        cellAddress: 'C8',
      }),
    ];
    renderForm(mappings);

    // Exactly the two template-defined parameters — one per category.
    const groups = screen.getAllByRole('group', { name: /rating$/ });
    expect(groups).toHaveLength(2);
    expect(
      screen.getByRole('group', { name: 'Custom Ride Feel rating' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Custom Handling Feel rating' }),
    ).toBeInTheDocument();

    // The ride parameter lands under Ride, the handling one under Handling.
    const ride = screen.getByRole('region', { name: 'Ride' });
    const handling = screen.getByRole('region', { name: 'Handling' });
    expect(
      within(ride).getByRole('group', { name: 'Custom Ride Feel rating' }),
    ).toBeInTheDocument();
    expect(
      within(handling).getByRole('group', {
        name: 'Custom Handling Feel rating',
      }),
    ).toBeInTheDocument();

    // None of the default parameters are presented alongside the template set.
    for (const param of DEFAULT_RH_PARAMETERS) {
      expect(
        screen.queryByRole('group', { name: `${param.name} rating` }),
      ).toBeNull();
    }
  });
});
