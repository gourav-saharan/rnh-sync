// R13.3: Keep & send / Discard for a test trashed on the laptop while the
// phone still had unsynced edits.
import { describe, expect, it, vi } from 'vitest';
import type { LocalTestSessionV2, TestSessionV2 } from '@rnh/shared/v2';
import type { SessionStoreV2 } from '@rnh/shared/v2data';
import { MobileStoreV2, MobileV2Database } from './store';
import { resolveDeletedOnServer } from './syncEngine';

function flagged(id: string): LocalTestSessionV2 {
  return {
    sessionId: id,
    schemaVersion: 2,
    templateId: 'tpl',
    templateVersion: 1,
    createdBy: 'me',
    assignedTo: [],
    tyreSets: {},
    cells: {},
    header: {},
    deletedAt: null,
    deletedBy: null,
    updatedAt: 5,
    dirtyPaths: ['cells.p1__t1'],
    isNew: false,
    syncState: 'error',
    lastError: 'This test was deleted on the laptop.',
    deletedOnServer: true,
    cursor: { paramId: 'p1', tyreSetId: 't1', order: 'byTyre', screen: 'drive' },
  } as unknown as LocalTestSessionV2;
}

function store(): MobileStoreV2 {
  return new MobileStoreV2(new MobileV2Database(`rd-${Math.random()}`));
}

describe('resolveDeletedOnServer (R13.3)', () => {
  it('discard removes the phone copy and never touches the server', async () => {
    const local = store();
    await local.saveSession(flagged('s1'));
    const remote = { get: vi.fn(), restore: vi.fn() } as unknown as SessionStoreV2;

    await resolveDeletedOnServer({ local, remote }, 's1', 'discard', 'me');

    expect(await local.getSession('s1')).toBeUndefined();
    expect(remote.get).not.toHaveBeenCalled();
    expect(remote.restore).not.toHaveBeenCalled();
  });

  it('keep restores a trashed server copy and queues the local edits', async () => {
    const local = store();
    await local.saveSession(flagged('s1'));
    const remote = {
      get: vi.fn(async () => ({ sessionId: 's1', deletedAt: 123 }) as unknown as TestSessionV2),
      restore: vi.fn(async () => undefined),
    } as unknown as SessionStoreV2;

    await resolveDeletedOnServer({ local, remote }, 's1', 'keep', 'me');

    expect(remote.restore).toHaveBeenCalledWith('s1', 'me');
    const s = await local.getSession('s1');
    expect(s?.deletedOnServer).toBe(false);
    expect(s?.syncState).toBe('saved_local');
    expect(s?.isNew).toBe(false);
    expect(s?.dirtyPaths).toEqual(['cells.p1__t1']);
  });

  it('keep re-creates the test when it was purged on the server', async () => {
    const local = store();
    await local.saveSession(flagged('s1'));
    const remote = {
      get: vi.fn(async () => null),
      restore: vi.fn(),
    } as unknown as SessionStoreV2;

    await resolveDeletedOnServer({ local, remote }, 's1', 'keep', 'me');

    expect(remote.restore).not.toHaveBeenCalled();
    expect((await local.getSession('s1'))?.isNew).toBe(true);
  });
});
