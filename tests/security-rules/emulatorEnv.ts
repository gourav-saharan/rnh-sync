// Shared test-environment wiring for the Security Rules test suite.
//
// Builds a single `RulesTestEnvironment` bound to the Firestore and Storage
// emulators, loading the repo-root `firestore.rules` and `storage.rules`. All
// role/collection helpers used by the tests are colocated here so the test
// file stays focused on the access matrix (Property 2) rather than plumbing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root is two levels up from `tests/security-rules`. */
const repoRoot = resolve(here, '..', '..');

/** The Firebase project id used by the emulator (matches `.firebaserc`). */
export const PROJECT_ID = 'rnh-tyre-testing-system';

/**
 * Emulator ports: `firebase emulators:exec` exports the real host:port in
 * FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST, so the suite also
 * works when another config moves the ports. Falls back to `firebase.json`.
 */
function portFrom(envVar: string | undefined, fallback: number): number {
  const port = Number(envVar?.split(':').pop());
  return Number.isInteger(port) && port > 0 ? port : fallback;
}
export const FIRESTORE_PORT = portFrom(process.env.FIRESTORE_EMULATOR_HOST, 8080);
export const STORAGE_PORT = portFrom(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199);
export const EMULATOR_HOST = '127.0.0.1';

/** Roles as stored in `users/{uid}.role` (design.md > Data Models). */
export const ROLE = {
  tester: 'Tester',
  reportViewer: 'Report_Viewer',
} as const;

/**
 * Creates the shared test environment. Fails fast with an actionable message
 * when the Firestore emulator is not reachable so a missing emulator never
 * looks like a passing suite.
 */
export async function createTestEnv(): Promise<RulesTestEnvironment> {
  try {
    return await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(repoRoot, 'firestore.rules'), 'utf8'),
        host: EMULATOR_HOST,
        port: FIRESTORE_PORT,
      },
      storage: {
        rules: readFileSync(resolve(repoRoot, 'storage.rules'), 'utf8'),
        host: EMULATOR_HOST,
        port: STORAGE_PORT,
      },
    });
  } catch (err) {
    throw new Error(
      'Could not initialize the Firebase rules test environment. ' +
        'Start the emulators first with `npm run emulators` (Firestore ' +
        `port ${FIRESTORE_PORT}, Storage port ${STORAGE_PORT}), then re-run ` +
        '`npm run test:rules`. Original error: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/**
 * Seeds a `users/{uid}` document with the given role, bypassing rules. The
 * rules read this document to resolve the caller's role, so every
 * authenticated actor needs one before role-gated access can be evaluated.
 */
export async function seedUser(
  env: RulesTestEnvironment,
  uid: string,
  role: string,
  email = `${uid}@example.com`,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`users/${uid}`).set({
      uid,
      email,
      role,
      createdAt: Date.now(),
    });
  });
}

/**
 * Seeds a Test_Session owned by `ownerUid`, bypassing rules. Used to set up
 * read/update/delete scenarios that need a pre-existing document.
 */
export async function seedSession(
  env: RulesTestEnvironment,
  sessionId: string,
  ownerUid: string,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`testSessions/${sessionId}`).set(sessionData(ownerUid));
  });
}

/** Seeds a customerTemplate and one fieldMapping, bypassing rules. */
export async function seedTemplate(
  env: RulesTestEnvironment,
  templateId: string,
  mappingId: string,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`customerTemplates/${templateId}`).set(templateData());
    await db
      .doc(`customerTemplates/${templateId}/fieldMappings/${mappingId}`)
      .set(mappingData(templateId));
  });
}

/** A minimal, rules-valid Test_Session document body owned by `ownerUid`. */
export function sessionData(ownerUid: string): Record<string, unknown> {
  return {
    sessionId: 's-doc',
    templateId: null,
    createdBy: ownerUid,
    tyreSets: [],
    vehicle: {},
    conditions: {},
    ride: { parameters: [], averageRating: 0 },
    handling: { parameters: [], averageRating: 0 },
    syncState: 'synced',
    fieldTimestamps: {},
    updatedAt: Date.now(),
  };
}

/** A minimal customerTemplate document body. */
export function templateData(): Record<string, unknown> {
  return {
    templateId: 't-doc',
    customerName: 'MSIL',
    storagePath: 'templates/t-doc/original.xlsx',
    uploadDate: Date.now(),
    structure: { sheets: [] },
    createdBy: 'seed',
  };
}

/** A minimal fieldMapping document body. */
export function mappingData(templateId: string): Record<string, unknown> {
  return {
    mappingId: 'm-doc',
    templateId,
    sheetName: 'Sheet1',
    cellAddress: 'A1',
    inputFieldKey: 'vehicle.vehicleId',
    fieldType: 'vehicle',
    required: false,
  };
}
