import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LocalTestSession } from '@rnh/shared';
import { LocalSessionDatabase, LocalSessionStore } from './localSessionStore';

let dbCounter = 0;
let db: LocalSessionDatabase;
let store: LocalSessionStore;

/** Build a valid LocalTestSession with sensible defaults, overridable per test. */
function makeSession(overrides: Partial<LocalTestSession> = {}): LocalTestSession {
  const base: LocalTestSession = {
    sessionId: 'session-1',
    templateId: null,
    createdBy: 'tester-uid',
    tyreSets: [
      {
        groupName: 'Set A',
        make: 'BrandX',
        pattern: 'P1',
        srlr: 'SR',
        weekCode: '2401',
        dot: 'DOT123',
      },
    ],
    vehicle: {
      vehicleId: 'V-1',
      tyreSize: '235/60R18',
      rimSize: '18',
      frontAxlePressure: 32,
      rearAxlePressure: 30,
    },
    conditions: {
      testTrack: 'Track 1',
      driverName: 'Driver A',
      loadOfCar: 'GVW',
      airTempC: 25,
      roadTempC: 30,
      testDate: '2026-09-15',
    },
    ride: {
      parameters: [{ name: 'Smooth Road', rating: 6.5, note: 'ok' }],
      averageRating: 6.5,
    },
    handling: {
      parameters: [{ name: 'Rear Tracking', rating: 7, note: '' }],
      averageRating: 7,
    },
    syncState: 'unsynced',
    fieldTimestamps: {},
    updatedAt: 1000,
    dirty: true,
    pendingSince: 1000,
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  db = new LocalSessionDatabase(`test-db-${dbCounter++}`);
  store = new LocalSessionStore(db);
});

afterEach(async () => {
  await db.delete();
});

describe('LocalSessionStore save/load round-trip', () => {
  it('persists a session and reloads an identical value', async () => {
    const session = makeSession();
    await store.save(session);

    const loaded = await store.load(session.sessionId);
    expect(loaded).toEqual(session);
  });

  it('save resolves only after the write is committed (save-before-confirm)', async () => {
    const session = makeSession();
    // Awaiting save must mean the value is already durable and readable.
    await store.save(session);
    const immediately = await store.load(session.sessionId);
    expect(immediately).toEqual(session);
  });

  it('overwrites an existing session with the same id', async () => {
    await store.save(makeSession({ updatedAt: 1000 }));
    await store.save(makeSession({ updatedAt: 2000, dirty: false }));

    const loaded = await store.load('session-1');
    expect(loaded?.updatedAt).toBe(2000);
    expect(loaded?.dirty).toBe(false);
  });

  it('returns undefined when a session is not present', async () => {
    expect(await store.load('missing')).toBeUndefined();
  });
});

describe('LocalSessionStore.loadMostRecentInProgress', () => {
  it('returns undefined when nothing is stored', async () => {
    expect(await store.loadMostRecentInProgress()).toBeUndefined();
  });

  it('restores the in-progress session with the highest updatedAt', async () => {
    await store.save(
      makeSession({ sessionId: 'a', updatedAt: 100, dirty: true }),
    );
    await store.save(
      makeSession({ sessionId: 'b', updatedAt: 300, dirty: true }),
    );
    await store.save(
      makeSession({ sessionId: 'c', updatedAt: 200, dirty: true }),
    );

    const restored = await store.loadMostRecentInProgress();
    expect(restored?.sessionId).toBe('b');
  });

  it('treats unsynced sessions as in-progress even when not dirty', async () => {
    await store.save(
      makeSession({ sessionId: 'a', updatedAt: 500, dirty: false, syncState: 'unsynced' }),
    );

    const restored = await store.loadMostRecentInProgress();
    expect(restored?.sessionId).toBe('a');
  });

  it('ignores fully synchronized, non-dirty sessions', async () => {
    await store.save(
      makeSession({ sessionId: 'synced', updatedAt: 999, dirty: false, syncState: 'synced' }),
    );

    expect(await store.loadMostRecentInProgress()).toBeUndefined();
  });
});

describe('LocalSessionStore removal', () => {
  it('removes a single session', async () => {
    await store.save(makeSession({ sessionId: 'x' }));
    await store.remove('x');
    expect(await store.load('x')).toBeUndefined();
  });

  it('clears all sessions', async () => {
    await store.save(makeSession({ sessionId: 'x' }));
    await store.save(makeSession({ sessionId: 'y' }));
    await store.clear();
    expect(await store.loadAll()).toHaveLength(0);
  });
});
