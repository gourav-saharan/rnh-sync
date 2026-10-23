// Tyre photos (R5.8). Offline-first: the photo is written to IndexedDB and its
// Storage path is added to the Tyre_Set straight away; the Sync_Engine uploads
// the blob later when there is signal. Storage rules accept images < 5 MB.

import { newId } from '@rnh/shared/v2';
import type { MobileStoreV2, PhotoRow } from './store';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export class PhotoError extends Error {}

export function photoPath(sessionId: string, file: string): string {
  return `sessions/${sessionId}/photos/${file}`;
}

function extensionOf(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/heic' || type === 'image/heif') return 'heic';
  return 'jpg';
}

/** Validate and store a photo locally; returns its Storage path. */
export async function addPhoto(
  local: MobileStoreV2,
  sessionId: string,
  tyreSetId: string,
  file: Blob,
  now: number = Date.now(),
): Promise<string> {
  const type = file.type || 'image/jpeg';
  if (!type.startsWith('image/')) throw new PhotoError('Only images can be attached.');
  if (file.size === 0) throw new PhotoError('The photo is empty.');
  if (file.size >= MAX_PHOTO_BYTES) {
    throw new PhotoError(
      'The photo is larger than 5 MB. Use a lower camera resolution and try again.',
    );
  }
  const path = photoPath(sessionId, `${tyreSetId}_${newId('ph')}.${extensionOf(type)}`);
  const row: PhotoRow = {
    path,
    sessionId,
    tyreSetId,
    blob: file,
    contentType: type,
    uploaded: 0,
    createdAt: now,
  };
  await local.savePhoto(row);
  return path;
}

export type UploadFn = (path: string, blob: Blob, contentType: string) => Promise<void>;

/** Upload every waiting photo. Failures stay queued for the next pass. */
export async function uploadPendingPhotos(
  local: MobileStoreV2,
  upload: UploadFn,
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  for (const p of await local.pendingPhotos()) {
    try {
      await upload(p.path, p.blob, p.contentType);
      await local.markPhotoUploaded(p.path);
      uploaded += 1;
    } catch {
      failed += 1;
    }
  }
  return { uploaded, failed };
}
