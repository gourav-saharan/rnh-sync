# Operator Setup Guide — R&H Tyre Testing System

This guide covers running the system against the live Firebase project
(`rnh-sync`) for the ~10 internal users. The apps use Firebase as a backend
service only (Auth, Firestore, Storage) — there are no Cloud Functions.

All commands are run from the repository root unless noted otherwise.

## 1. One-time Firebase console setup

1. Open the [Firebase console](https://console.firebase.google.com/) and select
   the `rnh-sync` project.
2. **Authentication > Sign-in method**: enable the **Email/Password** provider.
   (This system uses email/password sign-in only. Email/Password must be enabled
   for both the in-app sign-in and the in-app Register flow.)
3. **Authentication > Settings > Authorized domains**: add the domain(s) where
   the apps are hosted. `localhost` is already authorized for local dev.
4. The Cloud Storage bucket already exists — no action needed.

## 2. Deploy security rules and indexes to the live project

The deployed Firestore rules are what actually enforce access; the web API key
in the `.env` files is not a secret. `firebase-tools` is already a devDependency,
and the project is pinned in `.firebaserc` (`rnh-sync`).

Use the convenience script:

```
npm run deploy:rules
```

or run the raw command directly:

```
npx firebase deploy --only firestore:rules,firestore:indexes,storage
```

Either way this deploys `firestore.rules`, `firestore.indexes.json`, and
`storage.rules`.

> **Important:** The updated `users/{uid}` rule permits a signed-in user to
> create their OWN role document once — this is REQUIRED for the in-app Register
> flow to work. It must be deployed before Register can write role docs.

## 3. Onboard the ~10 internal users

There are two ways to give a person an account plus a role. Pick per-user; they
can be mixed.

### Option A — Self-service Register (recommended)

Each person opens the app that matches the role they need and clicks
**Create account**:

- **Open access (owner decision):** both apps register every new account with
  all roles: **`["Tester", "Report_Viewer", "Template_Admin"]`**. No admin
  approval is needed. Existing accounts with fewer roles are upgraded
  automatically the next time they sign in.
- **Security note:** anyone who can open the app link can create an account
  and gets full access (read all tests, edit/delete templates, purge trash).
  Keep the app URLs private. To lock it down later, restrict sign-up in the
  Firebase console (Authentication > Settings > User actions) or change the
  `users/{uid}` rules back.
- The seeder (Option B) can still remove roles from a specific account, but
  that account will upgrade itself again on its next sign-in while open
  access is on.

Roles are stored as a list in `users/{uid}.roles`. One person can hold several
roles (e.g. an engineer who drives and writes the report). Multi-role accounts
such as `["Tester", "Report_Viewer", "Template_Admin"]` are created with the
seeder (Option B). Legacy v1 accounts with a single `role` field keep working.

Register creates the Firebase Auth account and writes the `users/{uid}` role
document automatically. This requires **Email/Password enabled** (section 1) and
the **rules deployed** (section 2).

A self-registered account is a Tester. To give a person office roles, an
admin updates their `roles` list via the console / Admin SDK (seeder).

### Option B — Admin seeding (bulk / pre-provisioning / custom roles)

Use `tools/seed-users.mjs` when you want to pre-provision users in bulk, or
assign a role that differs from an app's default. The Admin SDK bypasses the
Firestore rules, so it can both create Auth accounts and write/overwrite role
documents.

1. **Get a service-account key**: Firebase console > **Project settings** >
   **Service accounts** > **Generate new private key**. This downloads a JSON
   key file.
2. **Store the key** somewhere outside version control (or use one of the
   gitignored patterns, e.g. `serviceAccountKey.json` at the repo root). Never
   commit it.
3. **Point the script at the key**, either:
   - set an env var: `set GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`
     (Windows) / `export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`
     (macOS/Linux), or
   - pass `--key ./serviceAccountKey.json` on the command line.
4. **Prepare the users file**: copy the template and fill in real values.
   ```
   copy tools\users.example.json tools\users.json   (Windows)
   cp tools/users.example.json tools/users.json       (macOS/Linux)
   ```
   Edit `tools/users.json` — set each `email`, `password` (min 6 chars), and
   `roles` (any of `Tester`, `Report_Viewer`, `Template_Admin`).
   `tools/users.json` is gitignored.
5. **Run the seeder**:
   ```
   npm run seed:users -- --file tools/users.json
   ```
   It is idempotent — re-running updates each `users/{uid}` role document and
   skips existing Auth accounts without error.

#### Seeder flags

- `--file <path>` — users JSON file (default `tools/users.example.json`).
- `--key <path>` — service-account key file (overrides the env var).
- `--reset-passwords` — update the password of users that already exist.
- `--dry-run` — validate and report actions without writing anything.

#### Changing roles of existing accounts

Grant or revoke roles without a users file (the account must already exist,
e.g. after self-registration as a Tester):

```
npm run seed:users -- --email person@example.com --add-role Report_Viewer --add-role Template_Admin
npm run seed:users -- --email person@example.com --remove-role Template_Admin
```

- `--email <addr>` (repeatable), `--add-role <Role>` and `--remove-role <Role>`
  (both repeatable). Roles: `Tester`, `Report_Viewer`, `Template_Admin`.
- If a role is both added and removed, removal wins.
- The legacy single `role` field is folded into `roles` and then removed.
- Combine with `--dry-run` to print `before -> after` without writing.
- The user sees new roles after selecting **Try again** or signing in again.

Example — reset passwords for the real user list:

```
npm run seed:users -- --file tools/users.json --reset-passwords
```

The script prints a per-user summary (created/updated, uid, role) and a final
tally, and exits non-zero if any entry failed or was skipped.

### Existing account with no role

If someone signed in before the rules were deployed and saw "No role assigned",
their Auth account exists but has no `users/{uid}` document. After deploying the
rules, resolve it one of these ways:

- They **sign out and Register with a new email** — creates a fresh account and
  role doc; or
- An **admin adds their `users/{uid}` doc** via the console or the seeder
  (Option B), reusing their existing email.

Note: Register calls sign-up, which fails with `email-already-in-use` for an
email that already has an Auth account. So an EXISTING Auth account that is
missing a role doc cannot be fixed by re-running Register with the same email —
the role doc must be added by an admin/console. Register only self-heals an
email that has no Auth account yet.

## 4. Run the apps

Env comes from the `.env` files already present in each app.

- Testers (mobile): `npm run dev:mobile`
- Report viewers (laptop): `npm run dev:laptop`

Building for internal hosting:

```
npm run build
```

Then serve each app's built output (`apps/mobile-pwa/dist/` and
`apps/laptop-web/dist/`) from your static host.

## 4b. Day-to-day workflow

1. **Template Admin (laptop → Templates):** upload the customer `.xlsx`, then
   in Template Studio:
   - _Parameters_: select the parameter-name column (e.g. `C8:C26`) and click
     Detect. Average / formula rows are skipped automatically. Adjust names,
     short names, weights, header fields, rating scale and quick comments.
   - _Mapping_: select the rating table (e.g. `E8:T26`) and add it as a block;
     for MSIL-style files add one block per sheet (slots 1–4, then 5–8). Click
     single cells to map header fields and per-tyre details. Formula cells
     cannot be mapped. Use **Test fill** to download a sample with placeholders.
   - _Publish_: creates a locked version the phones download.
2. **Tester (phone):** New test → pick template → test details → tyre sets
   (mark the Reference) → Start driving. One parameter per screen, tap a
   rating, add a quick comment or voice note; it moves on automatically.
   Everything is saved on the phone first and syncs when there is signal.
3. **Report Viewer (laptop → Sessions):** open the test, correct anything in
   the grid (every edit is recorded in History), mark it Ready, then
   **Generate report** → check the preview → Download. The file is the
   customer's own workbook; their formulas recalculate when opened in Excel.

Deleted tests go to **Trash** for 30 days and can be restored. v1 test data
is left untouched in Firestore but is not shown in the v2 screens.

## 4c. One-time v1 → v2 user migration

v1 accounts store a single `role`. They keep working, but converting them to
`roles[]` is cleaner (v1 Report_Viewers become Report_Viewer + Template_Admin,
the same rights they had before):

```bash
npm run migrate:v2                 # dry run: backup + list of changes, writes nothing
npm run migrate:v2 -- --apply      # backup, then convert the user documents
```

Credentials are resolved like the seeder (`--key`, then
`GOOGLE_APPLICATION_CREDENTIALS`, then Application Default Credentials). A JSON
backup of `users`, `customerTemplates` and `testSessions` is written to
`tools/backups/` (or `--out <dir>`) before anything changes. v1 sessions and
templates are only counted, never modified or deleted.

## 5. Local emulator alternative (no live data)

To test without touching live data, set `VITE_FIREBASE_USE_EMULATORS=true` in
the app `.env` files and start the emulators:

```
npm run emulators
```

Register works fully against the emulator (both Auth and Firestore rules are
emulated), so you can exercise the whole sign-up + role-doc flow locally without
touching live data. You can also seed test users against the emulator by
pointing the Admin SDK at it (set `FIRESTORE_EMULATOR_HOST` /
`FIREBASE_AUTH_EMULATOR_HOST`) before running `npm run seed:users`.

## 6. Security notes

- The web API key in the `.env` files is **not** a secret. Real access is
  enforced by the deployed Firestore/Storage rules.
- Keep the **service-account key** and **`tools/users.json`** out of version
  control. Both are covered by `.gitignore` (`*serviceAccount*.json`,
  `serviceAccountKey.json`, `tools/users.json`, etc.).
- There are **no Cloud Functions**. All access control is in `firestore.rules`
  and `storage.rules`; admin-only work runs locally via `tools/`.
- Self-registration is open to anyone who can reach the app URL, but it only
  ever grants `Tester`. For tighter control, seed all users and disable new
  sign-ups in Firebase console > Authentication > Settings.
- Clients MAY create their own `users/{uid}` role document exactly once via the
  Register flow, with exactly `roles: ["Tester"]` and no legacy `role` field.
  The only later self-service change is an office account adding `Tester` to
  itself; they cannot delete the doc or add any other role. Changing an existing role
  therefore requires the console or the Admin SDK (seeder), which bypass the
  rules.
