import { describe, expect, it } from 'vitest';
import {
  remoteChanges,
  toRemoteSession,
  createSessionV2,
  setRatingV2,
  setCommentV2,
  cellKey,
  emptySchema,
} from './index';
import type { TemplateVersion } from './model';

const schema = {
  ...emptySchema(),
  categories: [{ categoryId: 'c', name: 'Ride', order: 0 }],
  parameters: [{ paramId: 'p1', categoryId: 'c', name: 'Smooth road', order: 0 }],
};
const version = {
  templateId: 't',
  customerName: 'C',
  templateName: 'T',
  version: 1,
  storagePath: '',
  structure: { sheets: [] },
  schema,
  mappings: [],
  publishedBy: 'u',
  publishedAt: 0,
} as TemplateVersion;
const user = { uid: 'u', email: 'a@b.c', displayName: 'A', roles: ['Tester' as const] };

describe('remoteChanges', () => {
  const remote = toRemoteSession(createSessionV2({ version, user, now: 1 }));
  const ts = Object.keys(remote.tyreSets)[0];
  const ctx = { userId: 'rv', version, now: 5 };

  it('returns only the changed cell and progress, with before values', () => {
    const changes = remoteChanges(remote, (s) => setRatingV2(s, 'p1', ts, 6.5, ctx));
    const paths = changes.map((c) => c.path).sort();
    expect(paths).toEqual([`cells.${cellKey('p1', ts)}`, 'progress']);
    const cell = changes.find((c) => c.path.startsWith('cells.'))!;
    expect(cell.before).toBeNull();
    expect((cell.after as { rating: number }).rating).toBe(6.5);
  });

  it('returns nothing for a no-op edit', () => {
    expect(remoteChanges(remote, (s) => setCommentV2(s, 'p1', ts, '', ctx))).toEqual([]);
  });
});
