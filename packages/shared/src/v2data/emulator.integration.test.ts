// Emulator integration tests: run the REAL data-layer code (templates.ts,
// sessions.ts, blobs.ts) with the modular Firebase SDK against the Firestore
// emulator and the repo's firestore.rules. Covers what mocked unit tests
// cannot: a ~10 MB workbook through create/publish/load (K1, R2.2), atomic
// edit + history (K6, R10.4) and purge removing history and photos (K7, R13.2).
//
// Skipped unless the emulator is running. Run with:
//   npm run test:integration:emulated

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTemplateStoreV2, templatePathsV2 } from './templates';
import { createSessionStoreV2 } from './sessions';
import { writeFirestoreBlob } from './blobs';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'rnh-sync';
const [HOST, PORT] = (EMU ?? '127.0.0.1:8080').split(':');
const DAY = 24 * 60 * 60 * 1000;
const ADMIN = 'it-admin';
const VIEWER = 'it-viewer';
const TESTER = 'it-tester';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

let env: RulesTestEnvironment;
const apps: FirebaseApp[] = [];

/** A modular Firestore client signed in as `uid` (emulator mock token). */
function dbAs(uid: string): Firestore {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-key' }, `it-${uid}-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, HOST, Number(PORT), { mockUserToken: { sub: uid } });
  return db;
}

/** Deterministic bytes that differ per position, so chunk-order bugs show up. */
function bytesOf(size: number, salt = 0): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + (i >> 9) + salt) & 0xff;
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

const session = (owner: string, extra: Record<string, unknown> = {}) => ({
  sessionId: 's',
  schemaVersion: 2,
  createdBy: owner,
  assignedTo: [],
  cells: {},
  header: {},
  deletedAt: null,
  deletedBy: null,
  updatedAt: 0,
  ...extra,
});

describe.skipIf(!EMU)('v2 data layer against the Firestore emulator', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(repoRoot, 'firestore.rules'), 'utf8'),
        host: HOST,
        port: Number(PORT),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    const roles: [string, string[]][] = [
      [ADMIN, ['Template_Admin']],
      [VIEWER, ['Report_Viewer']],
      [TESTER, ['Tester']],
    ];
    for (const [uid, r] of roles) {
      await seed(`users/${uid}`, { uid, email: `${uid}@example.com`, displayName: uid, roles: r, createdAt: 0 });
    }
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => deleteApp(a)));
    await env?.cleanup();
  });

  it('saves, publishes and reloads a ~9.5 MB workbook byte-for-byte (K1, R2.2)', async () => {
    const db = dbAs(ADMIN);
    const store = createTemplateStoreV2({ firestore: db });
    const big = bytesOf(9.5 * 1024 * 1024);

    const t = await store.createTemplate({
      customerName: 'MSIL',
      templateName: 'R&H big',
      userId: ADMIN,
      bytes: big,
      structure: { sheets: [] },
    });
    const tplDoc = (await getDoc(doc(db, templatePathsV2.template(t.templateId)))).data();
    expect(tplDoc?.draft?.workbookBytes).toBeUndefined();
    expect(sameBytes(await store.loadDraftBytes(t.templateId), big)).toBe(true);

    const v = await store.publish(t.templateId, ADMIN);
    expect(v.version).toBe(1);
    expect(sameBytes(await store.loadVersionBytes(t.templateId, 1), big)).toBe(true);

    // The published blob is final: rewriting a chunk is refused by the rules.
    await expect(
      setDoc(doc(db, `${templatePathsV2.versionBlob(t.templateId, 1)}/chunks/0`), { index: 0 }),
    ).rejects.toThrow(/permission/i);

    // Replacing the draft afterwards leaves version 1 untouched.
    const next = bytesOf(2 * 1024 * 1024, 7);
    await store.replaceDraftWorkbook(t.templateId, next, { sheets: [] }, ADMIN);
    expect(sameBytes(await store.loadDraftBytes(t.templateId), next)).toBe(true);
    expect(sameBytes(await store.loadVersionBytes(t.templateId, 1), big)).toBe(true);
  }, 180_000);

  it('saves a laptop edit and its history together, or neither (K6, R10.4)', async () => {
    const db = dbAs(VIEWER);
    const sessions = createSessionStoreV2({ firestore: db, now: () => 1234 });
    await seed('testSessions/s1', session(TESTER));

    await sessions.updateFields(
      's1',
      [
        { path: 'header.h_vehicle', before: null, after: 'Swift' },
        { path: 'progress', before: null, after: { rated: 1, total: 4 } },
      ],
      { uid: VIEWER, name: 'Viewer' },
    );
    const s = (await getDoc(doc(db, 'testSessions/s1'))).data();
    expect(s?.header?.h_vehicle).toBe('Swift');
    const hist = await sessions.listHistory('s1');
    expect(hist.map((h) => h.path)).toEqual(['header.h_vehicle']);

    // Session missing: the update fails, so no orphan history is written.
    await expect(
      sessions.updateFields('gone', [{ path: 'header.h_x', before: null, after: 1 }], {
        uid: VIEWER,
        name: 'Viewer',
      }),
    ).rejects.toThrow();
    // withSecurityRulesDisabled resolves to void, so read into an outer variable.
    let orphanCount = -1;
    await env.withSecurityRulesDisabled(async (ctx) => {
      orphanCount = (await ctx.firestore().collection('testSessions/gone/history').get()).size;
    });
    expect(orphanCount).toBe(0);
  }, 60_000);

  it('purge removes history and photos, only after 30 days in the trash (K7, R13.2)', async () => {
    const tester = dbAs(TESTER);
    const viewer = dbAs(VIEWER);
    const sessions = createSessionStoreV2({ firestore: viewer });

    for (const [sid, age] of [
      ['s-old', 31],
      ['s-fresh', 2],
    ] as const) {
      await seed(`testSessions/${sid}`, session(TESTER, { deletedAt: Date.now() - age * DAY }));
      await seed(`testSessions/${sid}/history/h0`, { path: 'status', by: VIEWER, at: 0 });
      // Real phone upload path: owner Tester writes a 2-chunk photo.
      await writeFirestoreBlob(tester, `testSessions/${sid}/photos`, 'p1.jpg', bytesOf(700 * 1024), {
        contentType: 'image/jpeg',
        userId: TESTER,
      });
    }

    await sessions.purge('s-old');
    let left: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore();
      left = {
        session: (await f.doc('testSessions/s-old').get()).exists,
        history: (await f.collection('testSessions/s-old/history').get()).size,
        photos: (await f.collection('testSessions/s-old/photos').get()).size,
        chunks: (await f.collection('testSessions/s-old/photos/p1.jpg/chunks').get()).size,
      };
    });
    expect(left).toEqual({ session: false, history: 0, photos: 0, chunks: 0 });

    // Inside the 30-day window the purge is refused and nothing is deleted.
    await expect(sessions.purge('s-fresh')).rejects.toThrow(/permission/i);
    expect((await getDocs(collection(viewer, 'testSessions/s-fresh/history'))).size).toBe(1);
    expect((await getDoc(doc(viewer, 'testSessions/s-fresh'))).exists()).toBe(true);
  }, 60_000);
});
