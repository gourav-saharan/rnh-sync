import { describe, expect, it } from 'vitest';
import {
  inputFieldKey,
  type LocalTestSession,
  type RHCategory,
  type TestSession,
  type Timestamp,
} from '../index';
import { mergeNote, mergeSession } from './mergeSession';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function ride(smoothRating: number, smoothNote: string): RHCategory {
  return {
    parameters: [{ name: 'Smooth Road', rating: smoothRating, note: smoothNote }],
    averageRating: smoothRating,
  };
}

function handling(rating: number, note: string): RHCategory {
  return {
    parameters: [{ name: 'Rear Tracking', rating, note }],
    averageRating: rating,
  };
}

/** Builds a base TestSession; callers override the fields under test. */
function baseSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    sessionId: 'session-1',
    templateId: null,
    createdBy: 'tester-1',
    tyreSets: [
      { groupName: 'Set A', make: 'MakeA', pattern: 'P1', srlr: 'SR', weekCode: '01', dot: 'D1' },
    ],
    vehicle: {
      vehicleId: 'V1',
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
    ride: ride(5, ''),
    handling: handling(6, ''),
    syncState: 'unsynced',
    fieldTimestamps: {},
    updatedAt: 0,
    ...overrides,
  };
}

function local(session: TestSession, overrides: Partial<LocalTestSession> = {}): LocalTestSession {
  return { ...session, dirty: true, pendingSince: session.updatedAt, ...overrides };
}

const ts = (n: number): Timestamp => n;

// ---------------------------------------------------------------------------
// New-document passthrough
// ---------------------------------------------------------------------------

describe('mergeSession — new-document passthrough', () => {
  it('returns the local session (minus bookkeeping) when remote is undefined', () => {
    const localSession = local(baseSession({ updatedAt: 100 }), {
      dirty: true,
      pendingSince: 100,
    });

    const merged = mergeSession(localSession, undefined);

    // Local-only bookkeeping fields are stripped.
    expect('dirty' in merged).toBe(false);
    expect('pendingSince' in merged).toBe(false);
    // Everything else is the local session verbatim.
    expect(merged).toEqual(baseSession({ updatedAt: 100 }));
  });
});

// ---------------------------------------------------------------------------
// Per-field latest-timestamp resolution (R7.4)
// ---------------------------------------------------------------------------

describe('mergeSession — per-field latest-timestamp resolution', () => {
  it('keeps the local value for a field whose local timestamp is later', () => {
    const remote = baseSession({
      vehicle: { ...baseSession().vehicle, frontAxlePressure: 30 },
      fieldTimestamps: { vehicle: ts(100) },
      updatedAt: 100,
    });
    const localSession = local(
      baseSession({
        vehicle: { ...baseSession().vehicle, frontAxlePressure: 36 },
        fieldTimestamps: { vehicle: ts(200) },
        updatedAt: 200,
      }),
    );

    const merged = mergeSession(localSession, remote);

    expect(merged.vehicle.frontAxlePressure).toBe(36);
  });

  it('keeps the remote value for a field whose remote timestamp is later', () => {
    const remote = baseSession({
      conditions: { ...baseSession().conditions, driverName: 'Newer Driver' },
      fieldTimestamps: { conditions: ts(300) },
      updatedAt: 300,
    });
    const localSession = local(
      baseSession({
        conditions: { ...baseSession().conditions, driverName: 'Older Driver' },
        fieldTimestamps: { conditions: ts(100) },
        updatedAt: 100,
      }),
    );

    const merged = mergeSession(localSession, remote);

    expect(merged.conditions.driverName).toBe('Newer Driver');
  });

  it('resolves each field independently by its own timestamp', () => {
    // Local vehicle is newer; remote conditions are newer.
    const remote = baseSession({
      vehicle: { ...baseSession().vehicle, frontAxlePressure: 30 },
      conditions: { ...baseSession().conditions, driverName: 'Remote Driver' },
      fieldTimestamps: { vehicle: ts(100), conditions: ts(500) },
      updatedAt: 500,
    });
    const localSession = local(
      baseSession({
        vehicle: { ...baseSession().vehicle, frontAxlePressure: 40 },
        conditions: { ...baseSession().conditions, driverName: 'Local Driver' },
        fieldTimestamps: { vehicle: ts(400), conditions: ts(200) },
        updatedAt: 400,
      }),
    );

    const merged = mergeSession(localSession, remote);

    expect(merged.vehicle.frontAxlePressure).toBe(40); // local newer
    expect(merged.conditions.driverName).toBe('Remote Driver'); // remote newer
  });

  it('resolves an R&H rating by its per-parameter timestamp', () => {
    const key = inputFieldKey.rhRating('ride', 'Smooth Road');
    const remote = baseSession({
      ride: ride(4, ''),
      fieldTimestamps: { [key]: ts(100) },
    });
    const localSession = local(
      baseSession({
        ride: ride(7.5, ''),
        fieldTimestamps: { [key]: ts(200) },
      }),
    );

    const merged = mergeSession(localSession, remote);

    expect(merged.ride.parameters[0].rating).toBe(7.5);
  });

  it('prefers remote on a timestamp tie (idempotent no-op merge)', () => {
    const remote = baseSession({
      vehicle: { ...baseSession().vehicle, frontAxlePressure: 30 },
      fieldTimestamps: { vehicle: ts(100) },
    });
    const localSession = local(
      baseSession({
        vehicle: { ...baseSession().vehicle, frontAxlePressure: 40 },
        fieldTimestamps: { vehicle: ts(100) },
      }),
    );

    const merged = mergeSession(localSession, remote);

    expect(merged.vehicle.frontAxlePressure).toBe(30); // remote wins on tie
  });

  it('takes the later of the two timestamps into the merged map', () => {
    const remote = baseSession({ fieldTimestamps: { vehicle: ts(100), conditions: ts(500) } });
    const localSession = local(
      baseSession({ fieldTimestamps: { vehicle: ts(400), conditions: ts(200) } }),
    );

    const merged = mergeSession(localSession, remote);

    expect(merged.fieldTimestamps.vehicle).toBe(400);
    expect(merged.fieldTimestamps.conditions).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Notes preserved on conflict (R6.4, Property 12)
// ---------------------------------------------------------------------------

describe('mergeSession — notes preserved on conflict', () => {
  it('preserves BOTH distinct note texts even when the rating winner is one side', () => {
    const key = inputFieldKey.rhRating('ride', 'Smooth Road');
    // Local rating wins (newer), but the remote note must NOT be discarded.
    const remote = baseSession({
      ride: ride(4, 'remote bumpy patch note'),
      fieldTimestamps: { [key]: ts(100) },
    });
    const localSession = local(
      baseSession({
        ride: ride(7.5, 'local smooth note'),
        fieldTimestamps: { [key]: ts(200) },
      }),
    );

    const merged = mergeSession(localSession, remote);

    expect(merged.ride.parameters[0].rating).toBe(7.5); // latest timestamp
    expect(merged.ride.parameters[0].note).toContain('remote bumpy patch note');
    expect(merged.ride.parameters[0].note).toContain('local smooth note');
  });

  it('keeps the non-empty note when only one side has one', () => {
    const remote = baseSession({ ride: ride(5, 'only remote note') });
    const localSession = local(baseSession({ ride: ride(5, '') }));

    const merged = mergeSession(localSession, remote);

    expect(merged.ride.parameters[0].note).toBe('only remote note');
  });

  it('collapses identical notes to a single entry', () => {
    const remote = baseSession({ ride: ride(5, 'same note') });
    const localSession = local(baseSession({ ride: ride(5, 'same note') }));

    const merged = mergeSession(localSession, remote);

    expect(merged.ride.parameters[0].note).toBe('same note');
  });

  it('unions parameters present on only one side', () => {
    const remote = baseSession({
      ride: {
        parameters: [{ name: 'Smooth Road', rating: 5, note: 'r' }],
        averageRating: 5,
      },
    });
    const localSession = local(
      baseSession({
        ride: {
          parameters: [
            { name: 'Smooth Road', rating: 5, note: 'l' },
            { name: 'Rough Road', rating: 6, note: 'local only' },
          ],
          averageRating: 5.5,
        },
      }),
    );

    const merged = mergeSession(localSession, remote);

    const names = merged.ride.parameters.map((p) => p.name).sort();
    expect(names).toEqual(['Rough Road', 'Smooth Road']);
    const rough = merged.ride.parameters.find((p) => p.name === 'Rough Road');
    expect(rough?.note).toBe('local only');
  });
});

describe('mergeNote', () => {
  it('returns empty when both notes are empty', () => {
    expect(mergeNote('', '')).toBe('');
    expect(mergeNote('   ', '')).toBe('');
  });

  it('keeps the sole non-empty note', () => {
    expect(mergeNote('local', '')).toBe('local');
    expect(mergeNote('', 'remote')).toBe('remote');
  });

  it('collapses identical notes', () => {
    expect(mergeNote('same', 'same')).toBe('same');
  });

  it('preserves both distinct notes, remote first', () => {
    expect(mergeNote('local', 'remote')).toBe('remote\nlocal');
  });
});
