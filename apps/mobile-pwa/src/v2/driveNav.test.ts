// Drive_Mode order: by tyre / by parameter, next unrated, tyre change (R6.9).
import { describe, expect, it } from 'vitest';
import {
  blankTyreSetV2,
  cellKey,
  emptySchema,
  type TemplateSchema,
  type TyreSetV2,
} from '@rnh/shared/v2';
import {
  crossesTyreSet,
  firstUnratedIndex,
  nextIndex,
  positionInSet,
  sequenceOf,
} from './driveNav';

function setup(): { schema: TemplateSchema; tyreSets: Record<string, TyreSetV2>; ids: string[] } {
  const schema: TemplateSchema = {
    ...emptySchema(),
    categories: [{ categoryId: 'c1', name: 'Ride', order: 0 }],
    parameters: [
      { paramId: 'p1', categoryId: 'c1', name: 'A', order: 0 },
      { paramId: 'p2', categoryId: 'c1', name: 'B', order: 1 },
    ],
  };
  const a = blankTyreSetV2(1, true, 'Ref');
  const b = blankTyreSetV2(2, false, 'MU1');
  return {
    schema,
    tyreSets: { [a.tyreSetId]: a, [b.tyreSetId]: b },
    ids: [a.tyreSetId, b.tyreSetId],
  };
}

describe('driveNav', () => {
  it('orders by tyre and by parameter', () => {
    const { schema, tyreSets, ids } = setup();
    const byTyre = sequenceOf({ tyreSets }, schema, 'byTyre');
    expect(byTyre.map((s) => `${s.paramId}/${s.tyreSetId}`)).toEqual([
      `p1/${ids[0]}`,
      `p2/${ids[0]}`,
      `p1/${ids[1]}`,
      `p2/${ids[1]}`,
    ]);
    const byParam = sequenceOf({ tyreSets }, schema, 'byParam');
    expect(byParam.map((s) => `${s.paramId}/${s.tyreSetId}`)).toEqual([
      `p1/${ids[0]}`,
      `p1/${ids[1]}`,
      `p2/${ids[0]}`,
      `p2/${ids[1]}`,
    ]);
    expect(crossesTyreSet(byTyre, 1, 2)).toBe(true);
    expect(positionInSet(byTyre, 3)).toEqual({ n: 2, of: 2 });
  });

  it('finds the next unrated cell and ends after the last step', () => {
    const { schema, tyreSets, ids } = setup();
    const seq = sequenceOf({ tyreSets }, schema, 'byTyre');
    const cells = {
      [cellKey('p1', ids[0])]: { rating: 6, comment: '', updatedAt: 0, updatedBy: '' },
      [cellKey('p2', ids[0])]: { rating: 6, comment: '', updatedAt: 0, updatedBy: '' },
    };
    expect(firstUnratedIndex(seq, { cells })).toBe(2);
    expect(nextIndex(seq, 0, { cells }, true)).toBe(2);
    expect(nextIndex(seq, 3, { cells }, false)).toBeNull();
  });
});
