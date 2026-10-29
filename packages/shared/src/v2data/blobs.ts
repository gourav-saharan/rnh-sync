// Firestore Binary Blob Storage (replacement for Firebase Cloud Storage).
//
// Eliminates external GCS bucket provisioning, permissions, and CORS preflight
// issues on localhost and production. Files are stored as native Firestore
// binary chunks (`Bytes.fromUint8Array`), chunked at 500 KB to safely respect
// Firestore's 1 MiB per-document limit.
//
// Supports files of arbitrary size (workbooks up to 10+ MB, photos, etc.)
// with atomic batch writes, concurrent chunk reads, and offline cache support.

import { doc, getDoc, writeBatch, Bytes, type Firestore } from 'firebase/firestore';

/** 500 KB per chunk — well under Firestore's 1,048,576 bytes per doc limit. */
export const FIRESTORE_BLOB_CHUNK_SIZE = 500 * 1024;

export interface FirestoreBlobMeta {
  blobId: string;
  size: number;
  chunkCount: number;
  contentType: string;
  updatedAt: number;
  updatedBy: string;
}

export interface FirestoreBlobChunk {
  index: number;
  data: Bytes;
}

/**
 * Splits a `Uint8Array` into 500 KB binary chunks and writes them along with
 * a metadata document to Firestore.
 */
export async function writeFirestoreBlob(
  fs: Firestore,
  collectionPath: string,
  blobId: string,
  bytes: Uint8Array,
  options: { contentType?: string; userId?: string; now?: number } = {},
): Promise<void> {
  const totalSize = bytes.byteLength;
  const chunkCount = Math.max(1, Math.ceil(totalSize / FIRESTORE_BLOB_CHUNK_SIZE));
  const metaRef = doc(fs, `${collectionPath}/${blobId}`);
  const at = options.now ?? Date.now();

  const meta: FirestoreBlobMeta = {
    blobId,
    size: totalSize,
    chunkCount,
    contentType: options.contentType ?? 'application/octet-stream',
    updatedAt: at,
    updatedBy: options.userId ?? '',
  };

  // Firestore caps a commit request at 10 MiB, so a 10 MB workbook cannot go
  // in one batch. Chunks go in batches of BLOB_CHUNKS_PER_BATCH (~4 MB each).
  // The meta document is written LAST: readers only see a blob once every
  // chunk is stored, and rules treat a version blob as final once its meta
  // exists (a failed publish can be retried until then).
  let batch = writeBatch(fs);
  let inBatch = 0;

  for (let i = 0; i < chunkCount; i++) {
    const start = i * FIRESTORE_BLOB_CHUNK_SIZE;
    const end = Math.min(start + FIRESTORE_BLOB_CHUNK_SIZE, totalSize);
    const chunkRef = doc(fs, `${collectionPath}/${blobId}/chunks/${i}`);
    batch.set(chunkRef, {
      index: i,
      data: Bytes.fromUint8Array(bytes.slice(start, end)),
    });
    inBatch += 1;
    if (inBatch >= BLOB_CHUNKS_PER_BATCH) {
      await batch.commit();
      batch = writeBatch(fs);
      inBatch = 0;
    }
  }

  batch.set(metaRef, meta);
  await batch.commit();
}

/** Chunks per commit: 8 x 500 KB = 4 MB, well under the 10 MiB request cap. */
export const BLOB_CHUNKS_PER_BATCH = 8;

/**
 * Reads a chunked binary blob from Firestore, reassembles all chunks in order,
 * and returns the unified `Uint8Array`.
 */
export async function readFirestoreBlob(
  fs: Firestore,
  collectionPath: string,
  blobId: string,
): Promise<Uint8Array> {
  const metaRef = doc(fs, `${collectionPath}/${blobId}`);
  const metaSnap = await getDoc(metaRef);

  if (!metaSnap.exists()) {
    throw new Error(`Blob not found at ${collectionPath}/${blobId}`);
  }

  const meta = metaSnap.data() as Partial<FirestoreBlobMeta> & { data?: Bytes };
  const totalSize = meta.size ?? 0;
  const chunkCount = meta.chunkCount ?? 0;

  // Single-doc fallback or optimization if stored inline:
  if (meta.data && typeof meta.data.toUint8Array === 'function') {
    return meta.data.toUint8Array();
  }

  if (totalSize === 0 || chunkCount === 0) {
    return new Uint8Array(0);
  }

  // Concurrently fetch all chunks
  const chunkReads = Array.from({ length: chunkCount }, (_, i) =>
    getDoc(doc(fs, `${collectionPath}/${blobId}/chunks/${i}`)),
  );
  const snaps = await Promise.all(chunkReads);

  const out = new Uint8Array(totalSize);
  let offset = 0;

  for (let i = 0; i < chunkCount; i++) {
    const snap = snaps[i];
    if (!snap.exists()) {
      throw new Error(`Missing chunk ${i} for blob ${collectionPath}/${blobId}`);
    }
    const chunkData = (snap.data().data as Bytes).toUint8Array();
    out.set(chunkData, offset);
    offset += chunkData.byteLength;
  }

  return out;
}

/**
 * Copies a binary blob from one path to another without round-tripping through
 * external Cloud Storage.
 */
export async function copyFirestoreBlob(
  fs: Firestore,
  fromCollection: string,
  fromBlobId: string,
  toCollection: string,
  toBlobId: string,
  options: { userId?: string; now?: number; contentType?: string } = {},
): Promise<void> {
  const bytes = await readFirestoreBlob(fs, fromCollection, fromBlobId);
  await writeFirestoreBlob(fs, toCollection, toBlobId, bytes, options);
}

/**
 * Normalizes photo paths like "sessions/{sid}/photos/{file}" or
 * "testSessions/{sid}/photos/{file}" into Firestore document paths.
 */
export function parsePhotoPath(path: string): { collectionPath: string; photoId: string } {
  const parts = path.split('/');
  if (parts.length >= 4) {
    const root = parts[0] === 'sessions' ? 'testSessions' : parts[0];
    const sessionId = parts[1];
    const sub = parts[2]; // 'photos'
    const photoId = parts.slice(3).join('_');
    return {
      collectionPath: `${root}/${sessionId}/${sub}`,
      photoId,
    };
  }
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash !== -1) {
    return {
      collectionPath: path.slice(0, lastSlash),
      photoId: path.slice(lastSlash + 1),
    };
  }
  return { collectionPath: 'photos', photoId: path };
}

/**
 * Saves a photo file directly into Firestore as a chunked binary blob.
 */
export async function savePhotoBlob(
  fs: Firestore,
  path: string,
  blob: Blob,
  contentType: string,
  userId?: string,
): Promise<void> {
  const { collectionPath, photoId } = parsePhotoPath(path);
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  await writeFirestoreBlob(fs, collectionPath, photoId, bytes, {
    contentType: contentType || blob.type || 'image/jpeg',
    userId,
  });
}

/**
 * Loads a photo from Firestore binary chunks and returns its raw bytes and MIME type.
 */
export async function loadPhotoBlob(
  fs: Firestore,
  path: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { collectionPath, photoId } = parsePhotoPath(path);
  const metaRef = doc(fs, `${collectionPath}/${photoId}`);
  const metaSnap = await getDoc(metaRef);
  let contentType = 'image/jpeg';
  if (metaSnap.exists()) {
    const meta = metaSnap.data();
    if (meta.contentType) contentType = meta.contentType;
  }
  const bytes = await readFirestoreBlob(fs, collectionPath, photoId);
  return { bytes, contentType };
}

/**
 * Deletes a blob and all of its chunks from Firestore.
 */
export async function deleteFirestoreBlob(
  fs: Firestore,
  collectionPath: string,
  blobId: string,
): Promise<void> {
  const metaRef = doc(fs, `${collectionPath}/${blobId}`);
  const metaSnap = await getDoc(metaRef);
  if (!metaSnap.exists()) return;

  const meta = metaSnap.data() as Partial<FirestoreBlobMeta>;
  const chunkCount = meta.chunkCount ?? 0;

  const batch = writeBatch(fs);
  batch.delete(metaRef);

  for (let i = 0; i < chunkCount; i++) {
    batch.delete(doc(fs, `${collectionPath}/${blobId}/chunks/${i}`));
  }

  await batch.commit();
}
