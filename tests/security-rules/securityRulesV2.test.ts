// v2 Security Rules tests (R1.3, R2.4, R13.2, R14.1–R14.5) against the
// Firestore + Storage emulators. Run with `npm run test:rules:emulated`.
//
// Covers what v2 added: multi-role `roles[]`, Template_Admin-only writes,
// immutable published versions, assigned-tester edits, the 30-day trash
// window, append-only history and self-registration with a roles list.

import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { clearStorageDeep, createTestEnv } from './emulatorEnv';

let env: RulesTestEnvironment;

const ADMIN = 'v2-admin';
const VIEWER = 'v2-viewer';
const TESTER = 'v2-tester';
const OTHER = 'v2-other';
const MULTI = 'v2-multi';
const DAY = 24 * 60 * 60 * 1000;

async function seedRoles(uid: string, roles: string[]): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .doc(`users/${uid}`)
      .set({ uid, email: `${uid}@example.com`, displayName: uid, roles, createdAt: 0 });
  });
}

async function seedDoc(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

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

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const st = (uid: string) => env.authenticatedContext(uid).storage();
const putAs = (ref: ReturnType<ReturnType<typeof st>['ref']>, contentType: string) =>
  Promise.resolve(ref.put(new Uint8Array([1, 2, 3]), { contentType }));

beforeAll(async () => {
  env = await createTestEnv();
});

beforeEach(async () => {
  await env.clearFirestore();
  await clearStorageDeep(env);
  await seedRoles(ADMIN, ['Template_Admin']);
  await seedRoles(VIEWER, ['Report_Viewer']);
  await seedRoles(TESTER, ['Tester']);
  await seedRoles(OTHER, ['Tester']);
  await seedRoles(MULTI, ['Tester', 'Report_Viewer', 'Template_Admin']);
});

afterAll(async () => {
  await env?.cleanup();
});

describe('v2 templates and versions (R2.4, R14.3)', () => {
  it('Template_Admin creates and edits templates; Tester cannot', async () => {
    await assertSucceeds(
      db(ADMIN).doc('customerTemplates/t1').set({ templateId: 't1', draft: {} }),
    );
    await assertSucceeds(db(ADMIN).doc('customerTemplates/t1').update({ archived: true }));
    await assertFails(db(TESTER).doc('customerTemplates/t2').set({ templateId: 't2', draft: {} }));
  });

  it('published versions are create-once and immutable for everyone', async () => {
    await seedDoc('customerTemplates/t1', { templateId: 't1', draft: {} });
    await assertFails(
      db(TESTER).doc('customerTemplates/t1/versions/1').set({ templateId: 't1', version: 1 }),
    );
    await assertSucceeds(
      db(ADMIN).doc('customerTemplates/t1/versions/1').set({ templateId: 't1', version: 1 }),
    );
    await assertSucceeds(db(TESTER).doc('customerTemplates/t1/versions/1').get());
    await assertFails(db(ADMIN).doc('customerTemplates/t1/versions/1').update({ version: 2 }));
    await assertFails(db(ADMIN).doc('customerTemplates/t1/versions/1').delete());
  });

  it('a version must belong to its template', async () => {
    await assertFails(
      db(ADMIN).doc('customerTemplates/t1/versions/1').set({ templateId: 'other', version: 1 }),
    );
  });

  it('a user holding several roles gets all of them', async () => {
    await assertSucceeds(
      db(MULTI).doc('customerTemplates/tm').set({ templateId: 'tm', draft: {} }),
    );
    await assertSucceeds(db(MULTI).doc('testSessions/sm').set(session(MULTI)));
  });
});

describe('v2 test sessions (R14.2, R13.2)', () => {
  it('assigned Tester may edit; unrelated Tester may not', async () => {
    await seedDoc('testSessions/s1', session(OTHER, { assignedTo: [TESTER] }));
    await seedDoc('testSessions/s2', session(OTHER));
    await assertSucceeds(
      db(TESTER)
        .doc('testSessions/s1')
        .update({ 'cells.p__t': { rating: 6 } }),
    );
    await assertFails(
      db(TESTER)
        .doc('testSessions/s2')
        .update({ 'cells.p__t': { rating: 6 } }),
    );
  });

  it('only Report_Viewers change assignments; they may list the team', async () => {
    await seedDoc('testSessions/s1', session(TESTER, { assignedTo: [] }));
    await assertFails(
      db(TESTER)
        .doc('testSessions/s1')
        .update({ assignedTo: [OTHER] }),
    );
    await assertSucceeds(
      db(VIEWER)
        .doc('testSessions/s1')
        .update({ assignedTo: [OTHER] }),
    );
    await assertSucceeds(db(VIEWER).collection('users').get());
    await assertFails(db(TESTER).doc(`users/${OTHER}`).get());
    await assertSucceeds(
      db(OTHER).collection('testSessions').where('assignedTo', 'array-contains', OTHER).get(),
    );
  });

  it('nobody can change the owner of a session', async () => {
    await seedDoc('testSessions/s1', session(TESTER));
    await assertFails(db(TESTER).doc('testSessions/s1').update({ createdBy: OTHER }));
    await assertFails(db(VIEWER).doc('testSessions/s1').update({ createdBy: VIEWER }));
  });

  it('Report_Viewer may correct any session and move it to the trash', async () => {
    await seedDoc('testSessions/s1', session(TESTER));
    await assertSucceeds(db(VIEWER).doc('testSessions/s1').update({ 'header.h_x': 'fixed' }));
    await assertSucceeds(
      db(VIEWER).doc('testSessions/s1').update({ deletedAt: Date.now(), deletedBy: VIEWER }),
    );
  });

  it('permanent delete is refused inside the 30-day trash window', async () => {
    await seedDoc('testSessions/fresh', session(TESTER, { deletedAt: Date.now() - 2 * DAY }));
    await seedDoc('testSessions/live', session(TESTER));
    await assertFails(db(VIEWER).doc('testSessions/fresh').delete());
    await assertFails(db(VIEWER).doc('testSessions/live').delete());
  });

  it('permanent delete is allowed after 30 days, only for Report_Viewer', async () => {
    await seedDoc('testSessions/old', session(TESTER, { deletedAt: Date.now() - 31 * DAY }));
    await assertFails(db(TESTER).doc('testSessions/old').delete());
    await assertSucceeds(db(VIEWER).doc('testSessions/old').delete());
  });

  it('edit history is append-only and signed by the writer', async () => {
    await seedDoc('testSessions/s1', session(TESTER));
    const entry = {
      path: 'status',
      before: 'in_progress',
      after: 'ready',
      byName: 'v',
      at: Date.now(),
    };
    await assertSucceeds(
      db(VIEWER)
        .doc('testSessions/s1/history/h1')
        .set({ ...entry, by: VIEWER }),
    );
    await assertFails(
      db(VIEWER)
        .doc('testSessions/s1/history/h2')
        .set({ ...entry, by: TESTER }),
    );
    await assertFails(db(VIEWER).doc('testSessions/s1/history/h1').update({ after: 'x' }));
    await assertFails(db(VIEWER).doc('testSessions/s1/history/h1').delete());
  });
});

describe('v2 self-registration with a roles list (R1.3, R14.4)', () => {
  const NEW = 'v2-new-user';
  const doc = (roles: unknown) => ({
    uid: NEW,
    email: `${NEW}@example.com`,
    displayName: NEW,
    roles,
    createdAt: 0,
  });

  it('accepts self-registration as Tester only', async () => {
    await assertSucceeds(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Tester'])),
    );
  });

  it('rejects self-registration with any office role', async () => {
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Report_Viewer', 'Template_Admin'])),
    );
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Template_Admin'])),
    );
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Report_Viewer'])),
    );
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Tester', 'Report_Viewer'])),
    );
  });

  it('rejects a legacy `role` field or extra fields on self-registration', async () => {
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set({ ...doc(['Tester']), role: 'Report_Viewer' }),
    );
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set({ uid: NEW, email: `${NEW}@example.com`, role: 'Tester', createdAt: 0 }),
    );
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set({ ...doc(['Tester']), isAdmin: true }),
    );
  });

  it('cannot create a profile for another uid', async () => {
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}-forged`)
        .set({ ...doc(['Tester']), uid: `${NEW}-forged` }),
    );
  });

  it('rejects empty or unknown role lists', async () => {
    await assertFails(db(NEW).doc(`users/${NEW}`).set(doc([])));
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Superuser'])),
    );
    await assertFails(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Tester', 'Report_Viewer', 'Template_Admin', 'Superuser'])),
    );
  });

  // Owner decision D7: open access, every account may hold every role.
  it('accepts self-registration with full access (D7)', async () => {
    await assertSucceeds(
      db(NEW)
        .doc(`users/${NEW}`)
        .set(doc(['Tester', 'Report_Viewer', 'Template_Admin'])),
    );
  });

  it('an existing account may upgrade itself to full access (D7)', async () => {
    await assertSucceeds(
      db(TESTER)
        .doc(`users/${TESTER}`)
        .update({ roles: ['Tester', 'Report_Viewer', 'Template_Admin'] }),
    );
  });

  it('a self-update must set exactly the full list and touch nothing else', async () => {
    // Partial lists are refused.
    await assertFails(
      db(TESTER)
        .doc(`users/${TESTER}`)
        .update({ roles: ['Tester', 'Template_Admin'] }),
    );
    await assertFails(
      db(VIEWER)
        .doc(`users/${VIEWER}`)
        .update({ roles: ['Report_Viewer', 'Tester'] }),
    );
    // Unknown roles or other fields are refused.
    await assertFails(
      db(VIEWER)
        .doc(`users/${VIEWER}`)
        .update({ roles: ['Tester', 'Report_Viewer', 'Template_Admin', 'Superuser'] }),
    );
    await assertFails(
      db(VIEWER)
        .doc(`users/${VIEWER}`)
        .update({ roles: ['Tester', 'Report_Viewer', 'Template_Admin'], email: 'x@y.z' }),
    );
    // Never on someone else's profile.
    await assertFails(
      db(ADMIN)
        .doc(`users/${VIEWER}`)
        .update({ roles: ['Tester', 'Report_Viewer', 'Template_Admin'] }),
    );
  });
});

describe('v2 Storage (R2.4, R5.8)', () => {
  it('published workbooks cannot be overwritten; drafts can', async () => {
    await assertSucceeds(putAs(st(ADMIN).ref('templates/t1/v1.xlsx'), 'application/octet-stream'));
    await assertFails(putAs(st(ADMIN).ref('templates/t1/v1.xlsx'), 'application/octet-stream'));
    await assertSucceeds(
      putAs(st(ADMIN).ref('templates/t1/draft.xlsx'), 'application/octet-stream'),
    );
    await assertSucceeds(
      putAs(st(ADMIN).ref('templates/t1/draft.xlsx'), 'application/octet-stream'),
    );
  });

  it('Testers cannot write template workbooks', async () => {
    await assertFails(putAs(st(TESTER).ref('templates/t1/draft.xlsx'), 'application/octet-stream'));
  });

  it('Testers may upload tyre photos (images only)', async () => {
    await assertSucceeds(putAs(st(TESTER).ref('sessions/s1/photos/a.jpg'), 'image/jpeg'));
    await assertFails(putAs(st(TESTER).ref('sessions/s1/photos/a.txt'), 'text/plain'));
    await assertFails(putAs(st(VIEWER).ref('sessions/s1/photos/b.jpg'), 'image/jpeg'));
  });
});
