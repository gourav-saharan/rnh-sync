// v1 -> v2 migration (task 20). Local Admin SDK script; no Cloud Functions.
//
// What it does:
//   1. Backs up every users / customerTemplates / testSessions document (plus
//      v1 fieldMappings) to a local JSON file BEFORE anything is changed.
//   2. Converts v1 user docs (single `role`) to v2 `roles: []`:
//        Tester        -> ['Tester']
//        Report_Viewer -> ['Report_Viewer', 'Template_Admin']  (v1 viewers
//                         managed templates, so they keep that ability)
//      and removes the legacy `role` field.
//
// What it does NOT do: v1 test sessions and v1 templates are left untouched.
// v1 stored one rating per parameter for the whole session and v1 templates
// have no parameter schema, so there is no faithful automatic conversion to
// the v2 rating matrix. They stay in Firestore (and in the backup) and are
// simply not shown in the v2 screens. Re-create templates in Template Studio.
//
// Usage:
//   node tools/migrate-v1-to-v2.mjs [--key <serviceAccount.json>]   # dry run
//   node tools/migrate-v1-to-v2.mjs --apply [--key <serviceAccount.json>]
//
// Credentials: --key, then GOOGLE_APPLICATION_CREDENTIALS, then Application
// Default Credentials (same as tools/seed-users.mjs).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const V1_TO_V2_ROLES = {
  Tester: ['Tester'],
  Report_Viewer: ['Report_Viewer', 'Template_Admin'],
};

function parseArgs(argv) {
  // Default next to this script (tools/backups/), independent of the cwd.
  const args = {
    apply: false,
    key: null,
    out: resolve(dirname(fileURLToPath(import.meta.url)), 'backups'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--key') args.key = resolve(process.cwd(), argv[++i] ?? '');
    else if (a === '--out') args.out = resolve(process.cwd(), argv[++i] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log('node tools/migrate-v1-to-v2.mjs [--apply] [--key <serviceAccount.json>] [--out <backupDir>]');
      process.exit(0);
    } else {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

async function initApp(keyPath) {
  if (keyPath) {
    if (!existsSync(keyPath)) throw new Error(`Service-account key not found: ${keyPath}`);
    return initializeApp({ credential: cert(JSON.parse(await readFile(keyPath, 'utf8'))) });
  }
  return initializeApp({ credential: applicationDefault() });
}

async function dumpCollection(db, name) {
  const snap = await db.collection(name).get();
  const docs = [];
  for (const d of snap.docs) {
    const entry = { id: d.id, data: d.data() };
    if (name === 'customerTemplates') {
      const maps = await d.ref.collection('fieldMappings').get();
      if (!maps.empty) entry.fieldMappings = maps.docs.map((m) => ({ id: m.id, data: m.data() }));
    }
    docs.push(entry);
  }
  return docs;
}

/** v2 roles for a user doc, or null when it needs no change. */
export function plannedRoles(data) {
  if (Array.isArray(data.roles)) return null;
  return V1_TO_V2_ROLES[data.role] ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initApp(args.key);
  const db = getFirestore();

  // 1. Backup first, always (dry run included).
  const backup = { takenAt: new Date().toISOString() };
  for (const name of ['users', 'customerTemplates', 'testSessions']) {
    backup[name] = await dumpCollection(db, name);
  }
  await mkdir(args.out, { recursive: true });
  const file = resolve(args.out, `firestore-backup-${Date.now()}.json`);
  await writeFile(file, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`Backup written: ${file}`);

  // 2. Plan user role changes.
  const plan = [];
  for (const u of backup.users) {
    const roles = plannedRoles(u.data);
    if (roles) plan.push({ id: u.id, email: u.data.email ?? '', from: u.data.role, to: roles });
  }
  const v1Sessions = backup.testSessions.filter((s) => s.data.schemaVersion !== 2).length;
  const v1Templates = backup.customerTemplates.filter((t) => !t.data.draft).length;

  console.log(`\nUsers to convert: ${plan.length}`);
  for (const p of plan) console.log(`  ${p.email.padEnd(32)} ${p.from} -> [${p.to.join(', ')}]`);
  console.log(`\nLeft unchanged (not shown in v2 screens): ${v1Sessions} v1 sessions, ${v1Templates} v1 templates.`);

  if (!args.apply) {
    console.log('\nDry run only. Re-run with --apply to write the user changes.');
    return;
  }

  // 3. Apply in batches of 400.
  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 400)) {
      batch.update(db.collection('users').doc(p.id), { roles: p.to, role: FieldValue.delete() });
    }
    await batch.commit();
  }
  console.log(`\nApplied: ${plan.length} user documents converted.`);
}

main().catch((e) => {
  console.error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('Nothing after the failing step was written. The backup file (if created) is safe to keep.');
  process.exit(1);
});
