#!/usr/bin/env node
// tools/seed-users.mjs
//
// Operator tooling — provision the internal users of the R&H Tyre Testing
// System against the live Firebase project ("rnh-sync").
//
// WHY THIS EXISTS
// ---------------
// The apps use Firebase purely as a backend service (no Cloud Functions).
// The deployed Firestore security rules (firestore.rules) require every
// signed-in user to have a `users/{uid}` document whose `role` is one of
// 'Tester' | 'Report_Viewer', and they explicitly forbid clients from writing
// that document (`allow write: if false`). So both the Firebase Auth account
// AND its role document must be created OUT OF BAND, with the privileged
// Firebase Admin SDK. That is exactly what this standalone script does.
//
// It is NOT part of any workspace build/test. It is a plain Node ESM script an
// operator runs from a workstation that has a service-account key.
//
// WHAT IT DOES (idempotent)
// -------------------------
// For each entry in a users JSON file:
//   1. Ensure the Firebase Auth user exists (look up by email; create if
//      missing). On re-run, an existing user is left as-is unless
//      --reset-passwords is passed (then its password is updated).
//   2. Upsert the Firestore document `users/{uid}` = { uid, email, role,
//      createdAt } to match the UserDoc shape the app and rules expect. Here
//      `createdAt` is milliseconds since the Unix epoch (the shared `Timestamp`
//      type), only set on first creation so re-runs preserve the original.
//
// USAGE
// -----
//   node tools/seed-users.mjs [--file <path>] [--key <serviceAccount.json>] [--reset-passwords] [--dry-run]
//
//   Credentials are resolved in this order:
//     1. --key <path>
//     2. GOOGLE_APPLICATION_CREDENTIALS env var (path to a key file)
//     3. Application Default Credentials (e.g. `gcloud auth application-default login`)
//
//   The users file defaults to tools/users.example.json; copy it to
//   tools/users.json (gitignored) and fill in real values, then pass
//   --file tools/users.json.
//
// SECURITY
// --------
//   No secrets are hardcoded. The service-account key and the real users file
//   (tools/users.json) are gitignored. The script refuses to run without
//   usable credentials and prints actionable guidance.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The roles accepted by the app / security rules (mirrors shared `ROLES`).
const VALID_ROLES = ['Tester', 'Report_Viewer', 'Template_Admin'];

/** v2 `roles: []`, or the legacy single `role` string. */
function rolesOf(entry) {
  if (Array.isArray(entry.roles)) return [...new Set(entry.roles)];
  return typeof entry.role === 'string' ? [entry.role] : [];
}

// ---------------------------------------------------------------------------
// Argument parsing (tiny, dependency-free)
// ---------------------------------------------------------------------------

/**
 * Parse the supported CLI flags out of process.argv.
 * @returns {{ file: string, key: string|null, resetPasswords: boolean, dryRun: boolean }}
 */
function parseArgs(argv) {
  const args = {
    file: resolve(__dirname, 'users.example.json'),
    key: null,
    resetPasswords: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--file':
      case '-f':
        args.file = resolve(process.cwd(), requireValue(argv, ++i, arg));
        break;
      case '--key':
      case '-k':
        args.key = resolve(process.cwd(), requireValue(argv, ++i, arg));
        break;
      case '--reset-passwords':
        args.resetPasswords = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsageAndExit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsageAndExit(1);
    }
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('-')) {
    console.error(`Missing value for ${flag}`);
    printUsageAndExit(1);
  }
  return value;
}

function printUsageAndExit(code) {
  console.log(
    [
      'Usage: node tools/seed-users.mjs [options]',
      '',
      'Options:',
      '  -f, --file <path>       Users JSON file (default: tools/users.example.json)',
      '  -k, --key <path>        Service-account key JSON file',
      '  --reset-passwords       Update the password of existing Auth users',
      '  --dry-run               Validate and report actions without writing',
      '  -h, --help              Show this help',
      '',
      'Credentials are resolved from --key, then GOOGLE_APPLICATION_CREDENTIALS,',
      'then Application Default Credentials.',
    ].join('\n'),
  );
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

/**
 * Initialize the Firebase Admin app using a service-account key or ADC.
 * Fails with an actionable message when no credentials are available.
 */
async function initAdmin(keyPath) {
  // 1) Explicit --key argument.
  if (keyPath) {
    if (!existsSync(keyPath)) {
      failCredentials(`Service-account key not found at: ${keyPath}`);
    }
    const serviceAccount = await readJson(keyPath);
    return initializeApp({ credential: cert(serviceAccount) });
  }

  // 2) GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.
  const envKey = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envKey) {
    if (!existsSync(envKey)) {
      failCredentials(
        `GOOGLE_APPLICATION_CREDENTIALS is set to a path that does not exist: ${envKey}`,
      );
    }
    // applicationDefault() reads GOOGLE_APPLICATION_CREDENTIALS automatically.
    return initializeApp({ credential: applicationDefault() });
  }

  // 3) Application Default Credentials (gcloud login, workload identity, etc.).
  try {
    return initializeApp({ credential: applicationDefault() });
  } catch (cause) {
    failCredentials(
      'No usable credentials found via ADC.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

function failCredentials(...lines) {
  console.error('\nERROR: Could not authenticate to Firebase.\n');
  for (const line of lines) console.error(`  ${line}`);
  console.error(
    [
      '',
      'Provide credentials in one of these ways:',
      '  1. Pass a key file:      node tools/seed-users.mjs --key ./serviceAccount.json',
      '  2. Set an env variable:  set GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json  (Windows)',
      '                           export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json  (macOS/Linux)',
      '  3. Use gcloud ADC:       gcloud auth application-default login',
      '',
      'Get a service-account key from the Firebase console:',
      '  Project settings > Service accounts > Generate new private key',
      '',
      'See docs/SETUP.md for the full walkthrough.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Users file
// ---------------------------------------------------------------------------

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * Load and shallow-validate the users file. Accepts either a top-level array
 * or an object with a `users` array (so the example file can carry a
 * `_comment` field alongside the list).
 * @returns {Array<object>}
 */
async function loadUsers(path) {
  if (!existsSync(path)) {
    console.error(`\nERROR: Users file not found: ${path}`);
    console.error('Copy tools/users.example.json to tools/users.json and fill in real values,');
    console.error('then run: npm run seed:users -- --file tools/users.json\n');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = await readJson(path);
  } catch (cause) {
    console.error(`\nERROR: Could not parse ${path} as JSON.`);
    console.error(`  ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(1);
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.users;
  if (!Array.isArray(list)) {
    console.error(
      `\nERROR: ${path} must be a JSON array of users, or an object with a "users" array.\n`,
    );
    process.exit(1);
  }
  return list;
}

/**
 * Validate a single user entry. Returns an array of human-readable problems
 * (empty when valid).
 */
function validateEntry(entry, index) {
  const problems = [];
  const label = `entry #${index + 1}`;

  if (typeof entry !== 'object' || entry === null) {
    return [`${label}: not an object`];
  }
  if (typeof entry.email !== 'string' || !entry.email.includes('@')) {
    problems.push(`${label}: missing or invalid "email"`);
  }
  if (typeof entry.password !== 'string' || entry.password.length < 6) {
    problems.push(`${label} (${entry.email ?? '?'}): "password" must be at least 6 characters`);
  }
  const roles = rolesOf(entry);
  if (roles.length === 0 || roles.some((r) => !VALID_ROLES.includes(r))) {
    problems.push(
      `${label} (${entry.email ?? '?'}): "roles" must be a non-empty list of ${VALID_ROLES.join(', ')} (got ${JSON.stringify(entry.roles ?? entry.role)})`,
    );
  }
  if (entry.displayName !== undefined && typeof entry.displayName !== 'string') {
    problems.push(`${label} (${entry.email ?? '?'}): "displayName" must be a string when present`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Ensure the Auth user exists; create it if missing. Optionally reset password.
 * @returns {{ uid: string, authAction: 'created'|'exists'|'password-reset' }}
 */
async function ensureAuthUser(auth, entry, { resetPasswords, dryRun }) {
  let userRecord = null;
  try {
    userRecord = await auth.getUserByEmail(entry.email);
  } catch (cause) {
    if (!(cause && cause.code === 'auth/user-not-found')) {
      throw cause; // Unexpected error — bubble up.
    }
  }

  if (!userRecord) {
    if (dryRun) {
      return { uid: '(dry-run)', authAction: 'created' };
    }
    const created = await auth.createUser({
      email: entry.email,
      password: entry.password,
      displayName: entry.displayName,
      emailVerified: false,
      disabled: false,
    });
    return { uid: created.uid, authAction: 'created' };
  }

  // User already exists. Optionally update the password on request.
  if (resetPasswords && !dryRun) {
    await auth.updateUser(userRecord.uid, {
      password: entry.password,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
    });
    return { uid: userRecord.uid, authAction: 'password-reset' };
  }
  return { uid: userRecord.uid, authAction: 'exists' };
}

/**
 * Upsert the users/{uid} role document to match the UserDoc shape
 * ({ uid, email, role, createdAt }). `createdAt` (ms epoch) is only set on
 * first creation so re-runs preserve the original timestamp.
 * @returns {'created'|'updated'}
 */
async function upsertUserDoc(firestore, uid, entry, { dryRun }) {
  const ref = firestore.collection('users').doc(uid);

  if (dryRun) {
    const snap = await ref.get().catch(() => null);
    return snap && snap.exists ? 'updated' : 'created';
  }

  const snap = await ref.get();
  const existed = snap.exists;
  const createdAt = existed && typeof snap.get('createdAt') === 'number'
    ? snap.get('createdAt')
    : Date.now();

  // v2 UserDoc shape (uid, email, displayName, roles[], createdAt). The legacy
  // single `role` field is removed so v1 fallbacks cannot grant extra roles.
  const { FieldValue } = await import('firebase-admin/firestore');
  await ref.set(
    {
      uid,
      email: entry.email,
      displayName: entry.displayName || entry.email,
      roles: rolesOf(entry),
      role: FieldValue.delete(),
      createdAt,
    },
    { merge: true },
  );

  return existed ? 'updated' : 'created';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('R&H Tyre Testing System — user seeding');
  console.log(`  users file : ${args.file}`);
  console.log(`  reset pw   : ${args.resetPasswords ? 'yes' : 'no'}`);
  console.log(`  dry run    : ${args.dryRun ? 'yes' : 'no'}`);
  console.log('');

  const users = await loadUsers(args.file);

  // Validate everything up front; collect invalid entries but keep going with
  // the valid ones (invalid ones are skipped and reported).
  const valid = [];
  const invalid = [];
  users.forEach((entry, index) => {
    const problems = validateEntry(entry, index);
    if (problems.length === 0) {
      valid.push(entry);
    } else {
      invalid.push({ index, problems });
    }
  });

  for (const { problems } of invalid) {
    for (const problem of problems) console.warn(`SKIP  ${problem}`);
  }

  if (valid.length === 0) {
    console.error('\nNo valid user entries to process.');
    process.exit(1);
  }

  const app = await initAdmin(args.key);
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  const tally = { created: 0, updated: 0, passwordReset: 0, failed: invalid.length };

  for (const entry of valid) {
    try {
      const { uid, authAction } = await ensureAuthUser(auth, entry, args);
      const docAction = await upsertUserDoc(firestore, uid, entry, args);

      if (authAction === 'created') tally.created += 1;
      if (authAction === 'password-reset') tally.passwordReset += 1;
      if (authAction === 'exists') tally.updated += 1;

      const parts = [`auth:${authAction}`, `doc:${docAction}`];
      console.log(`OK    ${entry.email.padEnd(32)} roles=${rolesOf(entry).join('+').padEnd(28)} uid=${uid} (${parts.join(', ')})`);
    } catch (cause) {
      tally.failed += 1;
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`FAIL  ${entry.email ?? '?'} — ${message}`);
    }
  }

  console.log('');
  console.log('Summary:');
  console.log(`  created         : ${tally.created}`);
  console.log(`  updated         : ${tally.updated}`);
  if (args.resetPasswords) console.log(`  passwords reset : ${tally.passwordReset}`);
  console.log(`  failed/skipped  : ${tally.failed}`);

  // Non-zero exit if anything failed or was skipped, so CI/operators notice.
  if (tally.failed > 0) {
    process.exit(1);
  }
}

main().catch((cause) => {
  console.error('\nUnexpected error:');
  console.error(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
  process.exit(1);
});
