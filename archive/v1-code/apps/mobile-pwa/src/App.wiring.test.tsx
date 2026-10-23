// App wiring tests for GAP-1 (template picker feeding the R&H parameter set)
// and GAP-2 (Sync_Service wired to the capture surface).
// Requirements 6.6, 6.7, 7.1, 7.5, 10.3, 10.4.
//
// These example-based tests render the real App with injected fakes for the
// Auth_Service, Sync_Service, Template_Manager and Mapping_Editor store — no
// Firebase. They assert:
//   - the app starts the Sync_Service on mount and stops it on unmount (R7.1),
//   - a capture autosave enqueues the session through the Sync_Service (R10.4),
//   - the app surfaces the observed sync status (R10.3),
//   - selecting a template feeds its mappings so the template's R&H_Parameters
//     render on the capture surface (R6.6), defaulting otherwise (R6.7),
//   - the surface renders and stays usable when the Sync_Service is absent /
//     offline (graceful degradation).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthService,
  AuthUser,
  CustomerTemplateSummary,
  FieldMapping,
  LocalTestSession,
  MappingEditorStore,
  TemplateManager,
} from '@rnh/shared';
import type { SyncService, SyncStatus } from './sync';
import { localSessionStore } from './local';
import { App } from './App';

// --- Fakes -----------------------------------------------------------------

class FakeAuthService implements AuthService {
  private user: AuthUser | null;
  private listeners = new Set<(u: AuthUser | null) => void>();
  constructor(initial: AuthUser | null) {
    this.user = initial;
  }
  async signIn(): Promise<AuthUser> {
    throw new Error('not used');
  }
  async signOut(): Promise<void> {
    this.user = null;
    for (const cb of this.listeners) cb(null);
  }
  currentUser(): AuthUser | null {
    return this.user;
  }
  onAuthChange(cb: (u: AuthUser | null) => void): () => void {
    this.listeners.add(cb);
    cb(this.user);
    return () => this.listeners.delete(cb);
  }
}

const tester: AuthUser = { uid: 't1', email: 'tester@example.com', role: 'Tester' };

/** A deterministic, in-memory Sync_Service double recording enqueue calls. */
function makeFakeSync(): {
  service: SyncService;
  started: boolean;
  stopped: boolean;
  enqueued: LocalTestSession[];
  emit: (patch: Partial<SyncStatus>) => void;
} {
  const state = {
    started: false,
    stopped: false,
    enqueued: [] as LocalTestSession[],
  };
  let status: SyncStatus = {
    pendingCount: 0,
    syncing: false,
    lastSyncedAt: null,
    lastError: null,
  };
  const listeners = new Set<(s: SyncStatus) => void>();
  const emit = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    for (const l of listeners) l(status);
  };
  const service: SyncService = {
    async enqueue(session) {
      state.enqueued.push(session);
    },
    async syncNow() {
      return { synced: true, syncedCount: 0, failedCount: 0, skippedOffline: false };
    },
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    start() {
      state.started = true;
      return () => {
        state.stopped = true;
      };
    },
    stop() {
      state.stopped = true;
    },
  };
  return {
    service,
    get started() {
      return state.started;
    },
    get stopped() {
      return state.stopped;
    },
    enqueued: state.enqueued,
    emit,
  };
}

const templates: CustomerTemplateSummary[] = [
  { templateId: 't1', customerName: 'Maruti', uploadDate: 1_700_000_000_000 },
];

const t1Mappings: FieldMapping[] = [
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
];

function makeManager(overrides: Partial<TemplateManager> = {}): TemplateManager {
  return {
    upload: vi.fn(),
    list: vi.fn(async () => templates),
    inspect: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as TemplateManager;
}

function makeMappingStore(
  overrides: Partial<MappingEditorStore> = {},
): MappingEditorStore {
  return {
    begin: vi.fn(),
    loadExisting: vi.fn(async () => t1Mappings),
    save: vi.fn(),
    ...overrides,
  } as unknown as MappingEditorStore;
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  user = userEvent.setup();
  await localSessionStore.clear();
});

afterEach(async () => {
  await localSessionStore.clear();
});

describe('App capture wiring (GAP-1 + GAP-2)', () => {
  it('starts the Sync_Service on mount and stops it on unmount (R7.1)', async () => {
    const sync = makeFakeSync();
    const { unmount } = render(
      <App
        authService={new FakeAuthService(tester)}
        syncService={sync.service}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    await screen.findByRole('form', { name: 'Test session capture' });
    expect(sync.started).toBe(true);
    expect(sync.stopped).toBe(false);

    unmount();
    expect(sync.stopped).toBe(true);
  });

  it('enqueues the session through the Sync_Service after an autosave (R10.4)', async () => {
    const sync = makeFakeSync();
    render(
      <App
        authService={new FakeAuthService(tester)}
        syncService={sync.service}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    await screen.findByRole('form', { name: 'Test session capture' });
    await user.type(
      screen.getByRole('textbox', { name: 'Vehicle ID' }),
      'CAR-1',
    );

    // Debounced autosaves can fire mid-typing under load; wait for the one
    // that carries the final value rather than the first enqueue.
    await waitFor(
      () => {
        const last = sync.enqueued[sync.enqueued.length - 1];
        expect(last?.vehicle.vehicleId).toBe('CAR-1');
      },
      { timeout: 10_000 },
    );
  });

  it('surfaces the observed sync status (R10.3)', async () => {
    const sync = makeFakeSync();
    render(
      <App
        authService={new FakeAuthService(tester)}
        syncService={sync.service}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    await screen.findByRole('form', { name: 'Test session capture' });
    // Initially nothing pending -> "All synced".
    expect(screen.getByTestId('sync-summary-synced')).toBeInTheDocument();

    // Service reports pending work -> the app reflects it (R10.3).
    sync.emit({ pendingCount: 2 });
    await waitFor(() => {
      expect(screen.getByTestId('sync-summary-unsynced')).toHaveTextContent(
        '2 unsynced',
      );
    });
  });

  it('feeds a selected template\u2019s R&H_Parameters into the capture form (R6.6)', async () => {
    render(
      <App
        authService={new FakeAuthService(tester)}
        syncService={makeFakeSync().service}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    await screen.findByRole('option', { name: 'Maruti' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Customer template' }),
      't1',
    );

    // The template's parameter now renders; the default set does not.
    expect(
      await screen.findByRole('group', { name: 'Custom Ride Feel rating' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Smooth Road rating' }),
    ).toBeNull();
  });

  it('presents the default parameter set with no template selected (R6.7)', async () => {
    render(
      <App
        authService={new FakeAuthService(tester)}
        syncService={makeFakeSync().service}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    // Default option is selected initially -> default parameters render.
    expect(
      await screen.findByRole('group', { name: 'Smooth Road rating' }),
    ).toBeInTheDocument();
  });

  it('renders the capture surface when template listing fails offline (graceful)', async () => {
    const manager = makeManager({
      list: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    render(
      <App
        authService={new FakeAuthService(tester)}
        syncService={makeFakeSync().service}
        templateManager={manager}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    // Capture stays usable and defaults are shown despite the listing failure.
    expect(
      await screen.findByRole('form', { name: 'Test session capture' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('group', { name: 'Smooth Road rating' }),
    ).toBeInTheDocument();
  });
});
