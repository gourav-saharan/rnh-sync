// resolveUserV2: roles come only from users/{uid} (R1.3, R14.4). A signed-in
// user is never granted roles the stored document does not hold.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const getDocMock = vi.fn();
vi.mock('firebase/firestore', async (orig) => {
  const actual = await orig<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
    getDoc: (...args: unknown[]) => getDocMock(...args),
  };
});

import { resolveUserV2, rolesFromDoc, SELF_REGISTER_ROLES } from './auth';

const fs = {} as Firestore;
const fbUser = { uid: 'u1', email: 'u1@example.com', displayName: 'U One' };

function snap(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data ?? undefined };
}

/** Minimal in-memory localStorage for the offline cache. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  getDocMock.mockReset();
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveUserV2', () => {
  it('returns exactly the roles stored on the user doc', async () => {
    getDocMock.mockResolvedValue(snap({ roles: ['Tester'], displayName: 'Stored' }));
    const s = await resolveUserV2(fs, fbUser);
    expect(s).toEqual({
      state: 'authorized',
      user: { uid: 'u1', email: 'u1@example.com', displayName: 'Stored', roles: ['Tester'] },
    });
  });

  it('a missing user doc is no-role, not full access', async () => {
    getDocMock.mockResolvedValue(snap(null));
    expect(await resolveUserV2(fs, fbUser)).toEqual({
      state: 'no-role',
      uid: 'u1',
      email: 'u1@example.com',
    });
  });

  it('an empty or unknown roles list is no-role', async () => {
    getDocMock.mockResolvedValue(snap({ roles: [] }));
    expect((await resolveUserV2(fs, fbUser)).state).toBe('no-role');
    getDocMock.mockResolvedValue(snap({ roles: ['Superuser'] }));
    expect((await resolveUserV2(fs, fbUser)).state).toBe('no-role');
  });

  it('never writes to Firestore while resolving', async () => {
    const firestore = await import('firebase/firestore');
    const setSpy = vi.spyOn(firestore, 'setDoc');
    const updSpy = vi.spyOn(firestore, 'updateDoc');
    getDocMock.mockResolvedValue(snap(null));
    await resolveUserV2(fs, fbUser);
    getDocMock.mockResolvedValue(snap({ roles: ['Report_Viewer'] }));
    await resolveUserV2(fs, fbUser);
    expect(setSpy).not.toHaveBeenCalled();
    expect(updSpy).not.toHaveBeenCalled();
  });

  it('offline: reuses the cached roles for the same uid (R1.9)', async () => {
    getDocMock.mockResolvedValue(snap({ roles: ['Tester'] }));
    await resolveUserV2(fs, fbUser);
    getDocMock.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
    const s = await resolveUserV2(fs, fbUser);
    expect(s.state).toBe('authorized');
    if (s.state === 'authorized') expect(s.user.roles).toEqual(['Tester']);
  });

  it('offline without a cache (or for another uid) is error, not access', async () => {
    getDocMock.mockResolvedValue(snap({ roles: ['Report_Viewer'] }));
    await resolveUserV2(fs, { ...fbUser, uid: 'someone-else' });
    getDocMock.mockRejectedValue(new Error('offline'));
    expect(await resolveUserV2(fs, fbUser)).toEqual({
      state: 'error',
      uid: 'u1',
      email: 'u1@example.com',
    });
  });

  it('a no-role result clears a stale cached profile', async () => {
    getDocMock.mockResolvedValue(snap({ roles: ['Report_Viewer'] }));
    await resolveUserV2(fs, fbUser);
    getDocMock.mockResolvedValue(snap({ roles: [] }));
    await resolveUserV2(fs, fbUser);
    getDocMock.mockRejectedValue(new Error('offline'));
    expect((await resolveUserV2(fs, fbUser)).state).toBe('error');
  });
});

describe('rolesFromDoc', () => {
  it('reads v2 roles and the legacy single role', () => {
    expect(rolesFromDoc({ roles: ['Tester', 'Nope'] })).toEqual(['Tester']);
    expect(rolesFromDoc({ role: 'Tester' })).toEqual(['Tester']);
    expect(rolesFromDoc(null)).toEqual([]);
  });
});

describe('SELF_REGISTER_ROLES', () => {
  it('is Tester only (matches firestore.rules)', () => {
    expect(SELF_REGISTER_ROLES).toEqual(['Tester']);
  });
});
