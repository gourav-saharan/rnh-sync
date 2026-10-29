// K4 / R12.3: a missing workbook must raise a clear error, never an empty file.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const getDocMock = vi.fn();
const readBlobMock = vi.fn();

vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig<typeof import('firebase/firestore')>()),
  doc: vi.fn((_fs: unknown, path: string) => ({ path })),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  setDoc: (...a: unknown[]) => setDocMock(...a),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  runTransaction: async (_fs: unknown, fn: (tx: unknown) => Promise<void>) =>
    fn({
      get: async () => ({ data: () => ({ latestVersion: 0 }) }),
      set: txSet,
      update: txUpdate,
    }),
}));
const writeBlobMock = vi.fn();
const setDocMock = vi.fn();
const updateDocMock = vi.fn();
const txSet = vi.fn();
const txUpdate = vi.fn();

vi.mock('./blobs', () => ({
  readFirestoreBlob: (...a: unknown[]) => readBlobMock(...a),
  writeFirestoreBlob: (...a: unknown[]) => writeBlobMock(...a),
}));

const { createTemplateStoreV2, storedWorkbookBytes, WorkbookMissingError } = await import(
  './templates'
);

const snap = (data: unknown) => ({ exists: () => data !== null, data: () => data });
const store = () => createTemplateStoreV2({ firestore: {} as Firestore });

beforeEach(() => {
  for (const m of [getDocMock, readBlobMock, writeBlobMock, setDocMock, updateDocMock, txSet, txUpdate]) {
    m.mockReset();
  }
});

// K1 / R2.2: workbooks go to the chunked blob, never inline in a 1 MiB doc.
describe('workbook storage (up to 10 MB)', () => {
  const big = new Uint8Array(3 * 1024 * 1024).fill(9);

  it('createTemplate writes the draft blob and keeps bytes out of the doc', async () => {
    const t = await store().createTemplate({
      customerName: ' MSIL ',
      templateName: 'R&H',
      userId: 'u1',
      bytes: big,
      structure: { sheets: [] },
    });
    expect(writeBlobMock).toHaveBeenCalledWith(
      expect.anything(),
      `customerTemplates/${t.templateId}/blobs`,
      'draft',
      big,
      expect.objectContaining({ userId: 'u1' }),
    );
    const written = setDocMock.mock.calls[0][1] as { draft: Record<string, unknown> };
    expect(written.draft.workbookBytes).toBeUndefined();
    expect(written.draft.storagePath).toBe(`customerTemplates/${t.templateId}/blobs/draft`);
  });

  it('replaceDraftWorkbook writes the blob before updating the doc', async () => {
    await store().replaceDraftWorkbook('t1', big, { sheets: [] }, 'u1');
    expect(writeBlobMock.mock.calls[0][2]).toBe('draft');
    expect(writeBlobMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateDocMock.mock.invocationCallOrder[0],
    );
  });

  it('publish copies the draft into blobs/v{n} and keeps bytes out of the version doc', async () => {
    getDocMock.mockResolvedValue(
      snap({ templateId: 't1', latestVersion: 0, draft: { structure: { sheets: [] } } }),
    );
    readBlobMock.mockImplementation(async (_fs: unknown, _p: string, id: string) => {
      if (id === 'draft') return big;
      throw new Error(`Blob not found at x/${id}`);
    });
    const v = await store().publish('t1', 'u1');
    expect(v.version).toBe(1);
    expect(writeBlobMock.mock.calls[0][2]).toBe('v1');
    const versionDoc = txSet.mock.calls[0][1] as Record<string, unknown>;
    expect(versionDoc.workbookBytes).toBeUndefined();
    expect(versionDoc.storagePath).toBe('customerTemplates/t1/blobs/v1');
  });

  it('publish reuses an identical v{n} blob left by a failed attempt', async () => {
    getDocMock.mockResolvedValue(
      snap({ templateId: 't1', latestVersion: 0, draft: { structure: { sheets: [] } } }),
    );
    readBlobMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    await store().publish('t1', 'u1');
    expect(writeBlobMock).not.toHaveBeenCalled();
    expect(txSet).toHaveBeenCalledTimes(1);
  });

  it('publish refuses when v{n} already holds different bytes', async () => {
    getDocMock.mockResolvedValue(
      snap({ templateId: 't1', latestVersion: 0, draft: { structure: { sheets: [] } } }),
    );
    readBlobMock.mockImplementation(async (_fs: unknown, _p: string, id: string) =>
      id === 'draft' ? new Uint8Array([1]) : new Uint8Array([2]),
    );
    await expect(store().publish('t1', 'u1')).rejects.toThrow(/Someone else published/);
    expect(txSet).not.toHaveBeenCalled();
  });
});

describe('storedWorkbookBytes', () => {
  it('returns non-empty inline bytes and null otherwise', () => {
    expect(storedWorkbookBytes(new Uint8Array([1]))).toEqual(new Uint8Array([1]));
    expect(storedWorkbookBytes({ toUint8Array: () => new Uint8Array([2]) })).toEqual(
      new Uint8Array([2]),
    );
    expect(storedWorkbookBytes(new Uint8Array(0))).toBeNull();
    expect(storedWorkbookBytes(undefined)).toBeNull();
  });
});

describe('loadDraftBytes', () => {
  it('returns inline draft bytes without reading the blob', async () => {
    getDocMock.mockResolvedValue(snap({ draft: { workbookBytes: new Uint8Array([7]) } }));
    await expect(store().loadDraftBytes('t1')).resolves.toEqual(new Uint8Array([7]));
    expect(readBlobMock).not.toHaveBeenCalled();
  });

  it('falls back to the chunked blob', async () => {
    getDocMock.mockResolvedValue(snap({ draft: {} }));
    readBlobMock.mockResolvedValue(new Uint8Array([3, 4]));
    await expect(store().loadDraftBytes('t1')).resolves.toEqual(new Uint8Array([3, 4]));
  });

  it('throws WorkbookMissingError when no blob exists', async () => {
    getDocMock.mockResolvedValue(snap({ draft: {} }));
    readBlobMock.mockRejectedValue(new Error('Blob not found at x/draft'));
    await expect(store().loadDraftBytes('t1')).rejects.toBeInstanceOf(WorkbookMissingError);
  });

  it('throws WorkbookMissingError for an empty blob', async () => {
    getDocMock.mockResolvedValue(snap({ draft: {} }));
    readBlobMock.mockResolvedValue(new Uint8Array(0));
    await expect(store().loadDraftBytes('t1')).rejects.toBeInstanceOf(WorkbookMissingError);
  });

  it('passes other errors through unchanged', async () => {
    getDocMock.mockResolvedValue(snap({ draft: {} }));
    readBlobMock.mockRejectedValue(new Error('permission-denied'));
    await expect(store().loadDraftBytes('t1')).rejects.toThrow('permission-denied');
  });
});

describe('loadVersionBytes', () => {
  it('throws WorkbookMissingError naming the version', async () => {
    getDocMock.mockResolvedValue(snap({ templateId: 't1', version: 2 }));
    readBlobMock.mockRejectedValue(new Error('Blob not found at x/v2'));
    await expect(store().loadVersionBytes('t1', 2)).rejects.toThrow(/version 2 is missing/);
  });

  it('throws when the version document does not exist', async () => {
    getDocMock.mockResolvedValue(snap(null));
    await expect(store().loadVersionBytes('t1', 9)).rejects.toThrow('Version not found.');
  });
});

describe('publish', () => {
  it('refuses to publish when the draft workbook is missing', async () => {
    getDocMock.mockResolvedValue(
      snap({ templateId: 't1', latestVersion: 0, draft: { structure: { sheets: [] } } }),
    );
    readBlobMock.mockRejectedValue(new Error('Blob not found at x/draft'));
    await expect(store().publish('t1', 'u1')).rejects.toBeInstanceOf(WorkbookMissingError);
  });
});
