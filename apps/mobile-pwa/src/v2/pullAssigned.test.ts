import { describe, expect, it } from 'vitest';
import { emptySchema, type TemplateVersion, type TestSessionV2 } from '@rnh/shared/v2';
import type { SessionStoreV2, TemplateStoreV2 } from '@rnh/shared/v2data';
import { MobileStoreV2, MobileV2Database } from './store';
import { pullAssigned } from './syncEngine';

const version: TemplateVersion = {
  templateId: 'tpl',
  customerName: 'C',
  templateName: 'T',
  version: 1,
  storagePath: 'x',
  structure: null,
  schema: {
    ...emptySchema(),
    parameters: [{ paramId: 'p1', categoryId: 'c', name: 'P', shortName: '', order: 0 }],
  },
  mappings: [],
  publishedBy: 'u',
  publishedAt: 0,
} as unknown as TemplateVersion;

function remoteSession(id: string, extra: Partial<TestSessionV2> = {}): TestSessionV2 {
  return {
    sessionId: id,
    schemaVersion: 2,
    templateId: 'tpl',
    templateVersion: 1,
    createdBy: 'owner',
    assignedTo: ['me'],
    tyreSets: {},
    cells: {},
    header: {},
    deletedAt: null,
    updatedAt: 5,
    ...extra,
  } as unknown as TestSessionV2;
}

describe('pullAssigned', () => {
  it('adds new assigned tests with their template, skips trashed and existing ones', async () => {
    const local = new MobileStoreV2(new MobileV2Database(`pa-${Math.random()}`));
    await local.saveSession({ ...remoteSession('existing'), dirtyPaths: ['x'] } as never);
    const remote = {
      listAssigned: async () => [
        remoteSession('new'),
        remoteSession('gone', { deletedAt: 1 }),
        remoteSession('existing'),
      ],
    } as unknown as SessionStoreV2;
    const templates = { getVersion: async () => version } as unknown as TemplateStoreV2;

    const added = await pullAssigned({ local, remote, templates, userId: 'me' });

    expect(added).toBe(1);
    expect((await local.getSession('new'))?.cursor.screen).toBe('setup');
    expect(await local.getSession('gone')).toBeUndefined();
    expect((await local.getSession('existing'))?.dirtyPaths).toEqual(['x']);
    expect(await local.getVersion('tpl', 1)).toBeTruthy();
  });

  it('does nothing without a user id', async () => {
    const local = new MobileStoreV2(new MobileV2Database(`pa-${Math.random()}`));
    const added = await pullAssigned({
      local,
      remote: {} as SessionStoreV2,
      templates: {} as TemplateStoreV2,
    });
    expect(added).toBe(0);
  });
});
