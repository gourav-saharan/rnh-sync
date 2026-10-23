import { describe, expect, it } from 'vitest';
import { parsePhotoPath, FIRESTORE_BLOB_CHUNK_SIZE } from './blobs';

describe('parsePhotoPath', () => {
  it('normalizes legacy sessions path to testSessions subcollection', () => {
    const res = parsePhotoPath('sessions/sess_123/photos/t1_ph_abc.jpg');
    expect(res.collectionPath).toBe('testSessions/sess_123/photos');
    expect(res.photoId).toBe('t1_ph_abc.jpg');
  });

  it('preserves testSessions path', () => {
    const res = parsePhotoPath('testSessions/s_999/photos/slot2_ph_xyz.png');
    expect(res.collectionPath).toBe('testSessions/s_999/photos');
    expect(res.photoId).toBe('slot2_ph_xyz.png');
  });

  it('handles custom fallback paths', () => {
    const res = parsePhotoPath('custom/blobs/photo1.webp');
    expect(res.collectionPath).toBe('custom/blobs');
    expect(res.photoId).toBe('photo1.webp');
  });
});

describe('FIRESTORE_BLOB_CHUNK_SIZE', () => {
  it('is configured safely under Firestore 1 MB document limit', () => {
    expect(FIRESTORE_BLOB_CHUNK_SIZE).toBe(512000);
    expect(FIRESTORE_BLOB_CHUNK_SIZE).toBeLessThan(1048576);
  });
});
