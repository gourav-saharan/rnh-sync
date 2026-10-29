# Decisions

D1. Roles live only in `users/{uid}.roles`; clients never grant roles.
  Self-registration = `['Tester']` only (rules enforce exact list + allowed keys).
  Office roles via `tools/seed-users.mjs --add-role/--remove-role`. (Done Oct 2026.)
  Consequence: laptop self-sign-ups are locked out until an admin grants a role.

D7 (Oct 2026, owner, SUPERSEDES D1). Open access: every account gets all roles
  ['Tester','Report_Viewer','Template_Admin']. Sign-up writes them; resolve on sign-in
  auto-upgrades partial/no-role accounts once (`upgradeToFullAccess` in auth.ts).
  Rules: users/{uid} create with full list (or ['Tester'] for old clients); self-update
  only `roles == fullAccessRoles()`. Risk accepted by owner: anyone with the link gets
  full access. Lock-down options: disable sign-up in Firebase Auth settings, or revert rules.

D2. No Cloud Functions; all access control in security rules (spec R14.1).

D3. Firestore binary blobs replaced Cloud Storage for workbooks and photos
  (comment in `v2data/blobs.ts`: avoid bucket provisioning/CORS). Made before
  this session. Consequence: `storage.rules` no longer protects real data;
  1 MiB document limit applies (knownIssues K1).

D4. UNRESOLVED – where workbooks should live long-term (chunked `blobs` only vs
  back to Cloud Storage). Needs owner decision.

D5. UNRESOLVED – design drift items kept as-is pending owner decision
  (Report_Viewer template writes, Testers read all sessions, office self-add
  Tester, Template_Admin cannot list users). Tracked in taskPlan T6.

D6. Emulator tests use the project id the emulators start with (fallback `rnh-sync`),
  because single-project emulators made Storage→Firestore lookups fail otherwise.
