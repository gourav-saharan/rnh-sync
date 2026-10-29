// Security Rules tests — Firestore + Cloud Storage — against the Emulator Suite.
//
// Feature: rnh-tyre-testing-system, Property 2: Role-based access control
// Validates: Requirements 1.4, 1.5, 1.6
//
// These tests assert the Property 2 access matrix directly against the
// repo-root `firestore.rules` and `storage.rules`, evaluated by the Firebase
// emulators. The matrix (design.md > Testing Strategy > Security Rules Tests
// and firestore.rules header):
//
//                       | testSessions            | customerTemplates       | fieldMappings          | template blobs (Storage)
//   --------------------+-------------------------+-------------------------+------------------------+-------------------------
//   Unauthenticated     | deny all                | deny all                | deny all               | deny all
//   Tester              | create/read/update OWN, | deny read + write       | deny read + write      | deny read + write
//                       | no delete, no foreign   |                         |                        |
//   Report_Viewer       | read + delete           | read + write (manage)   | read + write (manage)  | read + write
//
// PREREQUISITE: the Firebase emulators must be running:
//   npm run emulators        # Firestore :8080, Storage :9199, Auth :9099
//   npm run test:rules       # in another terminal
//
// If the emulator is unreachable, `createTestEnv()` throws an actionable error
// and the whole suite fails (rather than silently passing).

import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ROLE,
  clearStorageDeep,
  createTestEnv,
  mappingData,
  seedSession,
  seedTemplate,
  seedUser,
  sessionData,
  templateData,
} from './emulatorEnv';

let env: RulesTestEnvironment;

// Stable actor uids reused across tests. Their `users/{uid}` docs are seeded
// once in beforeAll; document data is cleared between tests.
const TESTER_A = 'tester-a';
const TESTER_B = 'tester-b';
const VIEWER = 'viewer-1';

beforeAll(async () => {
  env = await createTestEnv();
  await seedUser(env, TESTER_A, ROLE.tester);
  await seedUser(env, TESTER_B, ROLE.tester);
  await seedUser(env, VIEWER, ROLE.reportViewer);
});

afterEach(async () => {
  // Clear document data between tests, but re-seed the user role docs so the
  // rules can still resolve roles in the next test.
  await env.clearFirestore();
  await clearStorageDeep(env);
  await seedUser(env, TESTER_A, ROLE.tester);
  await seedUser(env, TESTER_B, ROLE.tester);
  await seedUser(env, VIEWER, ROLE.reportViewer);
});

afterAll(async () => {
  await env?.cleanup();
});

// --- Actor context helpers -------------------------------------------------

const unauthDb = () => env.unauthenticatedContext().firestore();
const testerADb = () => env.authenticatedContext(TESTER_A).firestore();
const _testerBDb = () => env.authenticatedContext(TESTER_B).firestore();
const viewerDb = () => env.authenticatedContext(VIEWER).firestore();

const unauthStorage = () => env.unauthenticatedContext().storage();
const testerStorage = () => env.authenticatedContext(TESTER_A).storage();
const viewerStorage = () => env.authenticatedContext(VIEWER).storage();

// The Storage emulator's `ref.put()` returns an `UploadTask`, which is
// thenable but not typed as a `Promise`. Wrap it so it satisfies the
// `assertFails`/`assertSucceeds` Promise signatures while preserving the
// underlying success/failure semantics.
const putBytes = (ref: ReturnType<ReturnType<typeof viewerStorage>['ref']>): Promise<unknown> =>
  Promise.resolve(ref.put(new Uint8Array([1, 2, 3])));

// ===========================================================================
// Unauthenticated: denied everywhere (Requirement 1.6)
// ===========================================================================

describe('Unauthenticated access is denied everywhere (R1.6)', () => {
  it('cannot read or create a testSession', async () => {
    await seedSession(env, 's1', TESTER_A);
    const db = unauthDb();
    await assertFails(db.doc('testSessions/s1').get());
    await assertFails(db.doc('testSessions/s2').set(sessionData('anyone')));
  });

  it('cannot read, write, or delete a customerTemplate', async () => {
    await seedTemplate(env, 't1', 'm1');
    const db = unauthDb();
    await assertFails(db.doc('customerTemplates/t1').get());
    await assertFails(db.doc('customerTemplates/t2').set(templateData()));
    await assertFails(db.doc('customerTemplates/t1').delete());
  });

  it('cannot read or write a fieldMapping', async () => {
    await seedTemplate(env, 't1', 'm1');
    const db = unauthDb();
    await assertFails(db.doc('customerTemplates/t1/fieldMappings/m1').get());
    await assertFails(db.doc('customerTemplates/t1/fieldMappings/m2').set(mappingData('t1')));
  });

  it('cannot read or write a template blob in Storage', async () => {
    const ref = unauthStorage().ref('templates/t1/original.xlsx');
    await assertFails(ref.getDownloadURL());
    await assertFails(putBytes(ref));
  });
});

// ===========================================================================
// Tester: owns their testSessions; no template/mapping access (R1.4)
// ===========================================================================

describe('Tester access (R1.4)', () => {
  it('can create a testSession owned by themselves', async () => {
    await assertSucceeds(testerADb().doc('testSessions/mine').set(sessionData(TESTER_A)));
  });

  it('cannot create a testSession owned by someone else', async () => {
    await assertFails(testerADb().doc('testSessions/foreign').set(sessionData(TESTER_B)));
  });

  it('can read and update their own testSession', async () => {
    await seedSession(env, 'own', TESTER_A);
    await assertSucceeds(testerADb().doc('testSessions/own').get());
    await assertSucceeds(
      testerADb()
        .doc('testSessions/own')
        .set({ ...sessionData(TESTER_A), driverNote: 'updated' }, { merge: true }),
    );
  });

  it('cannot update a testSession owned by another tester', async () => {
    await seedSession(env, 'others', TESTER_B);
    await assertFails(
      testerADb()
        .doc('testSessions/others')
        .set({ ...sessionData(TESTER_B), tampered: true }, { merge: true }),
    );
  });

  it('cannot reassign ownership of their own session to another user', async () => {
    await seedSession(env, 'own2', TESTER_A);
    await assertFails(
      testerADb()
        .doc('testSessions/own2')
        .set({ ...sessionData(TESTER_A), createdBy: TESTER_B }, { merge: true }),
    );
  });

  it('cannot delete a testSession (delete is Report_Viewer-only)', async () => {
    await seedSession(env, 'own3', TESTER_A);
    await assertFails(testerADb().doc('testSessions/own3').delete());
  });

  // v2: Testers READ templates (phones cache published versions offline,
  // R8.4) but can never write them (R14.3).
  it('can read but not write customerTemplates', async () => {
    await seedTemplate(env, 't1', 'm1');
    await assertSucceeds(testerADb().doc('customerTemplates/t1').get());
    await assertFails(testerADb().doc('customerTemplates/t2').set(templateData()));
    await assertFails(testerADb().doc('customerTemplates/t1').delete());
  });

  it('can read but not write fieldMappings', async () => {
    await seedTemplate(env, 't1', 'm1');
    await assertSucceeds(testerADb().doc('customerTemplates/t1/fieldMappings/m1').get());
    await assertFails(
      testerADb().doc('customerTemplates/t1/fieldMappings/m2').set(mappingData('t1')),
    );
  });

  it('cannot read or write template blobs in Storage', async () => {
    const ref = testerStorage().ref('templates/t1/original.xlsx');
    await assertFails(ref.getDownloadURL());
    await assertFails(putBytes(ref));
  });
});

// ===========================================================================
// Report_Viewer: reads/deletes sessions; manages templates + mappings (R1.5)
// ===========================================================================

describe('Report_Viewer access (R1.5, and R10.5/R10.6 deletion)', () => {
  it('can read any testSession', async () => {
    await seedSession(env, 's1', TESTER_A);
    await assertSucceeds(viewerDb().doc('testSessions/s1').get());
  });

  it('cannot delete a live testSession directly (trash first, R13.2)', async () => {
    await seedSession(env, 's1', TESTER_A);
    await assertFails(viewerDb().doc('testSessions/s1').delete());
  });

  it('cannot create a testSession (capture is a Tester capability)', async () => {
    await assertFails(viewerDb().doc('testSessions/new').set(sessionData(VIEWER)));
  });

  it('can create, read, and delete customerTemplates', async () => {
    await assertSucceeds(viewerDb().doc('customerTemplates/tNew').set(templateData()));
    await assertSucceeds(viewerDb().doc('customerTemplates/tNew').get());
    await assertSucceeds(viewerDb().doc('customerTemplates/tNew').delete());
  });

  it('can create, read, and delete fieldMappings', async () => {
    await seedTemplate(env, 't1', 'm1');
    await assertSucceeds(viewerDb().doc('customerTemplates/t1/fieldMappings/m1').get());
    await assertSucceeds(
      viewerDb().doc('customerTemplates/t1/fieldMappings/mNew').set(mappingData('t1')),
    );
    await assertSucceeds(viewerDb().doc('customerTemplates/t1/fieldMappings/m1').delete());
  });

  it('can read and write template blobs in Storage', async () => {
    const ref = viewerStorage().ref('templates/t1/original.xlsx');
    await assertSucceeds(putBytes(ref));
    await assertSucceeds(ref.getDownloadURL());
  });
});

// ===========================================================================
// Cross-check: the users/{uid} role document itself (supports R1.4-1.6)
// ===========================================================================

describe('users/{uid} role document access', () => {
  // A fresh uid with no pre-seeded users doc, so create-own-role-doc tests
  // exercise the create path rather than colliding with an existing document.
  const NEW_USER = 'new-user-1';
  const newUserDb = () => env.authenticatedContext(NEW_USER).firestore();

  it('a signed-in user can read only their own profile', async () => {
    await assertSucceeds(testerADb().doc(`users/${TESTER_A}`).get());
    await assertFails(testerADb().doc(`users/${TESTER_B}`).get());
  });

  it('a signed-in user can create their own role document as Tester (self-registration)', async () => {
    await assertSucceeds(
      newUserDb()
        .doc(`users/${NEW_USER}`)
        .set({
          uid: NEW_USER,
          email: `${NEW_USER}@example.com`,
          displayName: NEW_USER,
          roles: [ROLE.tester],
          createdAt: Date.now(),
        }),
    );
  });

  it('cannot self-register with the legacy single `role` field (v2 rules)', async () => {
    // v1 clients wrote `role`; hasRole() still honours it for migrated
    // accounts, so a client-written `role` would be an escalation path.
    await assertFails(
      newUserDb()
        .doc(`users/${NEW_USER}`)
        .set({
          uid: NEW_USER,
          email: `${NEW_USER}@example.com`,
          role: ROLE.reportViewer,
          createdAt: Date.now(),
        }),
    );
  });

  it('cannot create their own role document with an invalid role', async () => {
    await assertFails(
      newUserDb()
        .doc(`users/${NEW_USER}`)
        .set({
          uid: NEW_USER,
          email: `${NEW_USER}@example.com`,
          role: 'Superuser',
          createdAt: Date.now(),
        }),
    );
  });

  it('cannot create a role document for another user', async () => {
    await assertFails(
      newUserDb()
        .doc(`users/${TESTER_B}-forged`)
        .set({
          uid: `${TESTER_B}-forged`,
          email: 'forged@example.com',
          role: ROLE.tester,
          createdAt: Date.now(),
        }),
    );
  });

  it('cannot update an existing role document (roles are not self-changed)', async () => {
    // TESTER_A's users doc is seeded in beforeAll/afterEach, so this is an update.
    await assertFails(
      testerADb().doc(`users/${TESTER_A}`).set({ role: ROLE.reportViewer }, { merge: true }),
    );
    await assertFails(
      viewerDb().doc(`users/${VIEWER}`).set({ role: ROLE.tester }, { merge: true }),
    );
  });

  it('cannot delete their own role document', async () => {
    await assertFails(testerADb().doc(`users/${TESTER_A}`).delete());
  });

  it('unauthenticated users cannot read any profile', async () => {
    await assertFails(unauthDb().doc(`users/${TESTER_A}`).get());
  });
});

// A guard so the suite fails loudly if the environment never initialized.
it('the emulator test environment initialized', () => {
  expect(env).toBeDefined();
});
