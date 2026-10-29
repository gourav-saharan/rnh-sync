import { describe, expect, it } from 'vitest';
import { Bytes } from 'firebase/firestore';
import { stripUndefined } from './templates';

describe('stripUndefined', () => {
  it('strips undefined from plain objects and nested objects', () => {
    const input = {
      a: 1,
      b: undefined,
      c: {
        d: 'hello',
        e: undefined,
      },
    };
    expect(stripUndefined(input)).toEqual({
      a: 1,
      c: {
        d: 'hello',
      },
    });
  });

  it('preserves Uint8Array instances intact', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const res = stripUndefined(bytes);
    expect(res).toBeInstanceOf(Uint8Array);
    expect(Array.from(res)).toEqual([1, 2, 3, 4, 5]);
  });

  it('preserves Bytes instances and does not convert them to empty objects', () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const firestoreBytes = Bytes.fromUint8Array(bytes);
    const res = stripUndefined(firestoreBytes);
    expect(typeof (res as Bytes).toUint8Array).toBe('function');
    expect(Array.from((res as Bytes).toUint8Array())).toEqual([10, 20, 30, 40]);
  });

  it('preserves Bytes inside document data structures', () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const firestoreBytes = Bytes.fromUint8Array(bytes);
    const docData = {
      templateId: 'tpl_123',
      draft: {
        workbookBytes: firestoreBytes,
        notes: undefined,
      },
    };
    const stripped = stripUndefined(docData);
    expect(stripped.draft.notes).toBeUndefined();
    expect(typeof (stripped.draft.workbookBytes as Bytes).toUint8Array).toBe('function');
    expect(Array.from((stripped.draft.workbookBytes as Bytes).toUint8Array())).toEqual([7, 8, 9]);
  });
});
