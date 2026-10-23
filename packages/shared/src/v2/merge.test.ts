import { describe, expect, it } from 'vitest';
import { dirtyPayload, mergeRemoteIntoLocal } from './merge';
import { createSessionV2, setCommentV2, setRatingV2, toRemoteSession } from './session';
import { emptySchema, type TemplateVersion } from './model';

const version: TemplateVersion = {
  templateId: 't',
  customerName: 'C',
  templateName: 'T',
  version: 1,
  storagePath: 'x',
  structure: { sheets: [] },
  schema: {
    ...emptySchema(),
    categories: [{ categoryId: 'c', name: 'Ride', order: 0 }],
    parameters: [
      { paramId: 'p1', categoryId: 'c', name: 'A', order: 0 },
      { paramId: 'p2', categoryId: 'c', name: 'B', order: 1 },
    ],
  },
  mappings: [],
  publishedBy: 'u',
  publishedAt: 0,
};
const user = { uid: 'u1', email: 'a@b.c', displayName: 'A', roles: ['Tester' as const] };

describe('mergeRemoteIntoLocal', () => {
  it('keeps local dirty cells and takes remote clean cells', () => {
    const base = { ...createSessionV2({ version, user, now: 1 }), dirtyPaths: [] };
    const tid = Object.keys(base.tyreSets)[0];
    const local = setRatingV2(base, 'p1', tid, 6, { userId: 'u1', version, now: 10 });
    const remote = toRemoteSession(
      setRatingV2(base, 'p2', tid, 7, { userId: 'u2', version, now: 11 }),
    );
    const merged = mergeRemoteIntoLocal(local, remote, 1);
    expect(merged.cells[`p1__${tid}`].rating).toBe(6);
    expect(merged.cells[`p2__${tid}`].rating).toBe(7);
    expect(dirtyPayload(merged)[`cells.p1__${tid}`]).toMatchObject({ rating: 6 });
  });

  it('keeps both comment texts on a conflict', () => {
    const base = { ...createSessionV2({ version, user, now: 1 }), dirtyPaths: [] };
    const tid = Object.keys(base.tyreSets)[0];
    const local = setCommentV2(base, 'p1', tid, 'understeer', { userId: 'u1', version, now: 10 });
    const remote = toRemoteSession(
      setCommentV2(base, 'p1', tid, 'roll more', { userId: 'u2', version, now: 12 }),
    );
    const merged = mergeRemoteIntoLocal(local, remote, 1);
    const c = merged.cells[`p1__${tid}`];
    expect(c.comment).toContain('understeer');
    expect(c.comment).toContain('roll more');
    expect(c.conflict).toBe(true);
  });
});
