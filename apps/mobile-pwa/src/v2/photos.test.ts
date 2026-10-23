// Tyre photo queue (R5.8): validation, local persistence, upload retry.
import { describe, expect, it } from 'vitest';
import { MobileStoreV2, MobileV2Database } from './store';
import { addPhoto, PhotoError, uploadPendingPhotos } from './photos';

function store(): MobileStoreV2 {
  return new MobileStoreV2(new MobileV2Database(`photos-${Math.random()}`));
}

const img = (bytes: number, type = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type });

describe('tyre photos', () => {
  it('stores a valid image locally under the session photo path', async () => {
    const s = store();
    const path = await addPhoto(s, 's1', 't1', img(10));
    expect(path).toMatch(/^sessions\/s1\/photos\/t1_ph_[a-z0-9]+\.jpg$/);
    expect(await s.pendingPhotos()).toHaveLength(1);
  });

  it('rejects non-images and files of 5 MB or more', async () => {
    const s = store();
    await expect(addPhoto(s, 's1', 't1', img(10, 'text/plain'))).rejects.toBeInstanceOf(PhotoError);
    await expect(addPhoto(s, 's1', 't1', img(5 * 1024 * 1024))).rejects.toBeInstanceOf(PhotoError);
    expect(await s.pendingPhotos()).toHaveLength(0);
  });

  it('keeps failed uploads queued and marks successful ones uploaded', async () => {
    const s = store();
    await addPhoto(s, 's1', 't1', img(10));
    const r1 = await uploadPendingPhotos(s, async () => {
      throw new Error('offline');
    });
    expect(r1).toEqual({ uploaded: 0, failed: 1 });
    expect(await s.pendingPhotos()).toHaveLength(1);
    const seen: string[] = [];
    const r2 = await uploadPendingPhotos(s, async (p) => {
      seen.push(p);
    });
    expect(r2).toEqual({ uploaded: 1, failed: 0 });
    expect(seen).toHaveLength(1);
    expect(await s.pendingPhotos()).toHaveLength(0);
  });
});
