// Task 9.7 / Property 20: role x path x operation matrix (R14.1-R14.5).
// Run with `npm run test:rules:emulated`.
//
// Every row is run for every actor. An actor listed in `allow` must succeed;
// every other actor must be denied. The rows describe the CURRENT
// firestore.rules / storage.rules. Where they are looser than design.md
// "Security Rules (v2)", the row says so in a `// design:` comment.

import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
// rules-unit-testing uses the compat SDK, which only accepts its own Blob type
// for bytes fields (a plain Uint8Array is rejected client-side).
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { clearStorageDeep, createTestEnv } from './emulatorEnv';

let env: RulesTestEnvironment;

type Actor = 'unauth' | 'none' | 'tester' | 'viewer' | 'admin';
const ACTORS: Actor[] = ['unauth', 'none', 'tester', 'viewer', 'admin'];

/** uid per actor; `none` is signed in but has no users/{uid} doc. */
const UID: Record<Actor, string> = {
  unauth: 'm-nobody',
  none: 'm-none',
  tester: 'm-tester',
  viewer: 'm-viewer',
  admin: 'm-admin',
};
const OTHER = 'm-other';
const DAY = 24 * 60 * 60 * 1000;

type Db = ReturnType<ReturnType<RulesTestEnvironment['unauthenticatedContext']>['firestore']>;
type St = ReturnType<ReturnType<RulesTestEnvironment['unauthenticatedContext']>['storage']>;

interface Row<C> {
  name: string;
  allow: Actor[];
  run: (ctx: C, uid: string) => Promise<unknown>;
}

const ctxFor = (a: Actor) =>
  a === 'unauth' ? env.unauthenticatedContext() : env.authenticatedContext(UID[a]);

const putAs = (ref: ReturnType<St['ref']>, contentType: string) =>
  Promise.resolve(ref.put(new Uint8Array([1, 2, 3]), { contentType }));

function session(owner: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 's',
    schemaVersion: 2,
    createdBy: owner,
    assignedTo: [],
    cells: {},
    deletedAt: null,
    deletedBy: null,
    updatedAt: 0,
    ...extra,
  };
}

/** Photo meta as written by blobs.ts writeFirestoreBlob. */
function photoMeta(by: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    blobId: 'p',
    size: 1000,
    chunkCount: 1,
    contentType: 'image/jpeg',
    updatedAt: 1,
    updatedBy: by,
    ...extra,
  };
}

async function seed(): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const roles: [string, string[]][] = [
      [UID.tester, ['Tester']],
      [UID.viewer, ['Report_Viewer']],
      [UID.admin, ['Template_Admin']],
      [OTHER, ['Tester']],
    ];
    for (const [uid, r] of roles) {
      await db.doc(`users/${uid}`).set({ uid, email: `${uid}@example.com`, displayName: uid, roles: r, createdAt: 0 });
    }
    await db.doc('customerTemplates/t1').set({ templateId: 't1', latestVersion: 1, draft: {} });
    await db.doc('customerTemplates/t1/versions/1').set({ templateId: 't1', version: 1 });
    await db.doc('testSessions/s-own').set(session(UID.tester));
    await db.doc('testSessions/s-other').set(session(OTHER));
    await db.doc('testSessions/s-old').set(session(UID.tester, { deletedAt: Date.now() - 31 * DAY }));
    await db.doc('testSessions/s-fresh').set(session(UID.tester, { deletedAt: Date.now() - 2 * DAY }));
    await db.doc('testSessions/s-own/history/h0').set({ path: 'status', by: UID.viewer, at: 0 });
    await db.doc('testSessions/s-old/history/h0').set({ path: 'status', by: UID.viewer, at: 0 });
    await db.doc('testSessions/s-own/photos/p0').set(photoMeta(UID.tester));
    await db.doc('customerTemplates/t1/blobs/v1').set({ blobId: 'v1', size: 1, chunkCount: 1 });
    await ctx.storage().ref('templates/t1/v1.xlsx').put(new Uint8Array([1]), {
      contentType: 'application/octet-stream',
    });
    await ctx.storage().ref('sessions/s-own/photos/p0.jpg').put(new Uint8Array([1]), {
      contentType: 'image/jpeg',
    });
  });
}

beforeAll(async () => {
  env = await createTestEnv();
});

beforeEach(async () => {
  await env.clearFirestore();
  await clearStorageDeep(env);
  await seed();
});

afterAll(async () => {
  await env?.cleanup();
});

function runMatrix<C>(rows: Row<C>[], ctx: (a: Actor) => C): void {
  for (const row of rows) {
    describe(row.name, () => {
      for (const actor of ACTORS) {
        const allowed = row.allow.includes(actor);
        it(`${allowed ? 'allows' : 'denies'} ${actor}`, async () => {
          const p = row.run(ctx(actor), UID[actor]);
          await (allowed ? assertSucceeds(p) : assertFails(p));
        });
      }
    });
  }
}

const profile = (uid: string, roles: string[]) => ({
  uid,
  email: `${uid}@example.com`,
  displayName: uid,
  roles,
  createdAt: 1,
});

// --- users/{uid} (R14.4, R1.3) ---------------------------------------------
const userRows: Row<Db>[] = [
  { name: 'users: read own profile', allow: ['none', 'tester', 'viewer', 'admin'],
    run: (db, uid) => db.doc(`users/${uid}`).get() },
  // design: "own doc; Template_Admin all". Rules let Report_Viewer list the
  // team (assignment panel) and do not give Template_Admin extra reads.
  { name: "users: read someone else's profile", allow: ['viewer'],
    run: (db) => db.doc(`users/${OTHER}`).get() },
  // Existing profiles turn this into an update, which is refused.
  { name: 'users: self-register as Tester', allow: ['none'],
    run: (db, uid) => db.doc(`users/${uid}`).set(profile(uid, ['Tester'])) },
  { name: 'users: self-register as Template_Admin', allow: [],
    run: (db, uid) => db.doc(`users/${uid}`).set(profile(uid, ['Template_Admin'])) },
  { name: 'users: create a profile for another uid', allow: [],
    run: (db) => db.doc('users/m-forged').set(profile('m-forged', ['Tester'])) },
  // Owner decision D7 (open access): sign-up and self-upgrade to every role.
  { name: 'users: self-register with full access', allow: ['none'],
    run: (db, uid) =>
      db.doc(`users/${uid}`).set(profile(uid, ['Tester', 'Report_Viewer', 'Template_Admin'])) },
  { name: 'users: set own roles to a partial list', allow: [],
    run: (db, uid) =>
      db.doc(`users/${uid}`).set({ roles: ['Report_Viewer', 'Tester'] }, { merge: true }) },
  { name: "users: change someone else's roles", allow: [],
    run: (db) =>
      db
        .doc(`users/${OTHER}`)
        .set({ roles: ['Tester', 'Report_Viewer', 'Template_Admin'] }, { merge: true }) },
  { name: 'users: grant self every role', allow: ['tester', 'viewer', 'admin'],
    run: (db, uid) =>
      db
        .doc(`users/${uid}`)
        .set({ roles: ['Tester', 'Report_Viewer', 'Template_Admin'] }, { merge: true }) },
  { name: 'users: delete own profile', allow: [],
    run: (db, uid) => db.doc(`users/${uid}`).delete() },
];

// --- customerTemplates + versions (R2.4, R14.3) ------------------------------
const templateRows: Row<Db>[] = [
  { name: 'templates: read', allow: ['tester', 'viewer', 'admin'],
    run: (db) => db.doc('customerTemplates/t1').get() },
  // design: Template_Admin only. Rules still let Report_Viewer write (v1 carry-over).
  { name: 'templates: create', allow: ['viewer', 'admin'],
    run: (db) => db.doc('customerTemplates/t2').set({ templateId: 't2', draft: {} }) },
  { name: 'templates: update (archive)', allow: ['viewer', 'admin'],
    run: (db) => db.doc('customerTemplates/t1').update({ archived: true }) },
  { name: 'templates: delete', allow: ['admin'],
    run: (db) => db.doc('customerTemplates/t1').delete() },
  { name: 'versions: read', allow: ['tester', 'viewer', 'admin'],
    run: (db) => db.doc('customerTemplates/t1/versions/1').get() },
  // design also wants n == latestVersion + 1; rules check only templateId.
  { name: 'versions: publish a new version', allow: ['admin'],
    run: (db) => db.doc('customerTemplates/t1/versions/2').set({ templateId: 't1', version: 2 }) },
  { name: 'versions: update a published version', allow: [],
    run: (db) => db.doc('customerTemplates/t1/versions/1').update({ version: 9 }) },
  { name: 'versions: delete a published version', allow: [],
    run: (db) => db.doc('customerTemplates/t1/versions/1').delete() },
  // --- Firestore workbook blobs ---------------------------------------------
  { name: 'blobs: read', allow: ['tester', 'viewer', 'admin'],
    run: (db) => db.doc('customerTemplates/t1/blobs/v1').get() },
  // design: Template_Admin only. Report_Viewer kept (v1 carry-over, D5).
  { name: 'blobs: write the draft', allow: ['viewer', 'admin'],
    run: (db) => db.doc('customerTemplates/t1/blobs/draft').set({ blobId: 'draft', size: 1 }) },
  { name: 'blobs: create a new version blob', allow: ['admin'],
    run: (db) => db.doc('customerTemplates/t1/blobs/v2').set({ blobId: 'v2', size: 1 }) },
  { name: 'blobs: overwrite a published version blob', allow: [],
    run: (db) => db.doc('customerTemplates/t1/blobs/v1').set({ blobId: 'v1', size: 9 }) },
  { name: 'blobs: delete a published version blob', allow: [],
    run: (db) => db.doc('customerTemplates/t1/blobs/v1').delete() },
  // Chunks are written before the meta doc; allowed until the meta exists.
  { name: 'blobs: write a chunk of an unpublished version blob', allow: ['admin'],
    run: (db) => db.doc('customerTemplates/t1/blobs/v2/chunks/0').set({ index: 0 }) },
  { name: 'blobs: rewrite a chunk of a published version blob', allow: [],
    run: (db) => db.doc('customerTemplates/t1/blobs/v1/chunks/0').set({ index: 0 }) },
];

// --- testSessions + history (R14.2, R13.2, R10.4) ----------------------------
const sessionRows: Row<Db>[] = [
  // design: Tester reads own or assigned only. Rules let any role read any
  // session (needed for list queries without an ownership filter).
  { name: "sessions: read another tester's session", allow: ['tester', 'viewer', 'admin'],
    run: (db) => db.doc('testSessions/s-other').get() },
  { name: 'sessions: create own', allow: ['tester'],
    run: (db, uid) => db.doc('testSessions/s-new').set(session(uid)) },
  { name: 'sessions: create on behalf of someone else', allow: [],
    run: (db) => db.doc('testSessions/s-forged').set(session(OTHER)) },
  { name: "sessions: edit the tester's own session", allow: ['tester', 'viewer'],
    run: (db) => db.doc('testSessions/s-own').update({ 'cells.p__t': { rating: 6 } }) },
  { name: "sessions: edit another tester's session", allow: ['viewer'],
    run: (db) => db.doc('testSessions/s-other').update({ 'cells.p__t': { rating: 6 } }) },
  { name: 'sessions: change the owner', allow: [],
    run: (db) => db.doc('testSessions/s-own').update({ createdBy: OTHER }) },
  { name: 'sessions: change who it is assigned to', allow: ['viewer'],
    run: (db) => db.doc('testSessions/s-own').update({ assignedTo: [OTHER] }) },
  { name: 'sessions: create without schemaVersion 2 (v1 shape)', allow: [],
    run: (db, uid) => db.doc('testSessions/s-v1').set({ ...session(uid), schemaVersion: 1 }) },
  { name: 'sessions: move own session to trash', allow: ['viewer'],
    run: (db, uid) =>
      db.doc('testSessions/s-own').update({ deletedAt: Date.now(), deletedBy: uid }) },
  // Phone "keep my edits" after a laptop trash (R13.3).
  { name: 'sessions: restore own session from trash', allow: ['tester', 'viewer'],
    run: (db, uid) =>
      db.doc('testSessions/s-fresh').update({ deletedAt: null, deletedBy: null, updatedBy: uid }) },
  { name: 'sessions: record a report (lastReport)', allow: ['viewer'],
    run: (db, uid) =>
      db.doc('testSessions/s-own').update({ lastReport: { at: 1, by: uid, templateVersion: 1 } }) },
  { name: 'sessions: delete a live session', allow: [],
    run: (db) => db.doc('testSessions/s-own').delete() },
  { name: 'sessions: delete inside the 30-day trash window', allow: [],
    run: (db) => db.doc('testSessions/s-fresh').delete() },
  { name: 'sessions: delete after 30 days in trash', allow: ['viewer'],
    run: (db) => db.doc('testSessions/s-old').delete() },
  { name: 'history: read', allow: ['tester', 'viewer', 'admin'],
    run: (db) => db.doc('testSessions/s-own/history/h0').get() },
  { name: 'history: append an entry signed by the writer', allow: ['tester', 'viewer'],
    run: (db, uid) =>
      db.doc('testSessions/s-own/history/h-new').set({ path: 'status', by: uid, at: 1 }) },
  { name: "history: append on another tester's session", allow: ['viewer'],
    run: (db, uid) =>
      db.doc('testSessions/s-other/history/h-x').set({ path: 'status', by: uid, at: 1 }) },
  { name: 'history: append an entry signed by someone else', allow: [],
    run: (db) =>
      db.doc('testSessions/s-own/history/h-forged').set({ path: 'status', by: OTHER, at: 1 }) },
  { name: 'history: edit an entry', allow: [],
    run: (db) => db.doc('testSessions/s-own/history/h0').update({ path: 'x' }) },
  { name: 'history: delete an entry', allow: [],
    run: (db) => db.doc('testSessions/s-own/history/h0').delete() },
  // Purge removes history before the session (sessions.ts purge).
  { name: 'history: delete while purging a session 30+ days in trash', allow: ['viewer'],
    run: (db) => db.doc('testSessions/s-old/history/h0').delete() },
  // --- Firestore photo blobs (the paths the apps actually use) -------------
  { name: 'photos: read', allow: ['tester', 'viewer', 'admin'],
    run: (db) => db.doc('testSessions/s-own/photos/p0').get() },
  { name: 'photos: upload to own session', allow: ['tester', 'viewer'],
    run: (db, uid) => db.doc('testSessions/s-own/photos/p1').set(photoMeta(uid)) },
  { name: "photos: upload to another tester's session", allow: ['viewer'],
    run: (db, uid) => db.doc('testSessions/s-other/photos/p1').set(photoMeta(uid)) },
  { name: 'photos: upload to a session that does not exist', allow: ['viewer'],
    run: (db, uid) => db.doc('testSessions/s-none/photos/p1').set(photoMeta(uid)) },
  { name: 'photos: upload a non-image', allow: [],
    run: (db, uid) =>
      db.doc('testSessions/s-own/photos/p2').set(photoMeta(uid, { contentType: 'text/plain' })) },
  { name: 'photos: upload 5 MB or more', allow: [],
    run: (db, uid) =>
      db.doc('testSessions/s-own/photos/p3').set(photoMeta(uid, { size: 5 * 1024 * 1024 })) },
  { name: 'photos: upload signed by someone else', allow: [],
    run: (db) => db.doc('testSessions/s-own/photos/p4').set(photoMeta(OTHER)) },
  { name: 'photos: write a chunk on own session', allow: ['tester', 'viewer'],
    run: (db) =>
      db
        .doc('testSessions/s-own/photos/p0/chunks/0')
        .set({ index: 0, data: firebase.firestore.Blob.fromUint8Array(new Uint8Array([1, 2])) }) },
  { name: 'photos: write a non-bytes chunk', allow: [],
    run: (db) => db.doc('testSessions/s-own/photos/p0/chunks/1').set({ index: 1, data: 'x' }) },
  { name: 'photos: delete', allow: ['viewer'],
    run: (db) => db.doc('testSessions/s-own/photos/p0').delete() },
  { name: 'unknown collection: read', allow: [],
    run: (db) => db.doc('somethingElse/x').get() },
];

// --- Storage (R2.4, R5.8, R14.3) ---------------------------------------------
const storageRows: Row<St>[] = [
  // design: any role reads templates/**. Rules leave Testers out (phones never
  // download workbooks).
  { name: 'storage: read a published workbook', allow: ['viewer', 'admin'],
    run: (st) => st.ref('templates/t1/v1.xlsx').getDownloadURL() },
  // design: Template_Admin only. Rules still let Report_Viewer write (v1 carry-over).
  { name: 'storage: upload a draft workbook', allow: ['viewer', 'admin'],
    run: (st) => putAs(st.ref('templates/t1/draft.xlsx'), 'application/octet-stream') },
  { name: 'storage: publish a new workbook version', allow: ['viewer', 'admin'],
    run: (st) => putAs(st.ref('templates/t1/v2.xlsx'), 'application/octet-stream') },
  { name: 'storage: overwrite a published workbook', allow: [],
    run: (st) => putAs(st.ref('templates/t1/v1.xlsx'), 'application/octet-stream') },
  { name: 'storage: read a tyre photo', allow: ['tester', 'viewer'],
    run: (st) => st.ref('sessions/s-own/photos/p0.jpg').getDownloadURL() },
  { name: 'storage: upload a tyre photo', allow: ['tester'],
    run: (st) => putAs(st.ref('sessions/s-own/photos/p1.jpg'), 'image/jpeg') },
  { name: 'storage: upload a non-image as a photo', allow: [],
    run: (st) => putAs(st.ref('sessions/s-own/photos/p1.txt'), 'text/plain') },
  { name: 'storage: write outside known paths', allow: [],
    run: (st) => putAs(st.ref('elsewhere/x.bin'), 'application/octet-stream') },
];

describe('P20 matrix: Firestore users', () => runMatrix(userRows, (a) => ctxFor(a).firestore()));
describe('P20 matrix: Firestore templates', () =>
  runMatrix(templateRows, (a) => ctxFor(a).firestore()));
describe('P20 matrix: Firestore sessions', () =>
  runMatrix(sessionRows, (a) => ctxFor(a).firestore()));
describe('P20 matrix: Storage', () => runMatrix(storageRows, (a) => ctxFor(a).storage()));
