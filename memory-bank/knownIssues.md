# Known issues (from Oct 2026 audit; verify against code before fixing)

K1 (high) Workbook size capped ~1 MiB. Draft and version docs embed `workbookBytes`
  in one Firestore doc (`v2data/templates.ts` ~L168, ~L282) but `MAX_TEMPLATE_BYTES`
  is 10 MB (`v2/grid.ts`). Template list snapshots download all bytes. Needs D4.
FIXED in repo (not deployed): K1 (Session 4), K2, K3, K4, K5, K6, K7, K8, K9, K10 (see progress.md).
K1 note: templates created before Session 4 still hold inline `workbookBytes` (< 1 MiB);
  loaders read those first. Re-uploading the workbook moves it to the blob and deletes the field.

K2 (high) Photo writes: `testSessions/{sid}/photos/**` and `sessions/{sid}/photos/**`
  allow any Tester/Report_Viewer to write/delete any session's photos (`firestore.rules`).
K3 (high) `customerTemplates/{tid}/blobs/**` incl. `v{n}` writable/deletable by
  Report_Viewer and Template_Admin → published bytes mutable via fallback path.
K4 (high) `loadDraftBytes` / `loadVersionBytes` swallow errors into `new Uint8Array(0)`
  → publish can create 0-byte version; reports get empty file.
K5 (med) Laptop tabs all `show: true` regardless of role (`LaptopAppV2.tsx`).
K6 (med) `updateFields` writes session + history as separate calls (not atomic).
K7 (med) `purge` deletes only the session doc; history and photo chunks orphaned.
K8 (med) Any Tester/Report_Viewer may append history on any session.
K9 (med) Session without `deletedAt` field deletable immediately (v1 shortcut).
K10 (med) Create doesn't check `schemaVersion == 2`; Tester updates may change
  `deletedAt`, `status`, `lastReport`.
K11 (low, triaged Oct 2026) `npm audit --omit=dev`: 4 high, 2 moderate.
  - high: all trace to `@grpc/grpc-js@1.9.16` (fix >=1.13.6), pinned `~1.9.0` by
    `@firebase/firestore@4.8.0` (firebase 11.10.0). grpc is the Node transport only; the
    browser build uses webchannel. Verified: 0 grpc-js hits in `apps/*/dist/**/*.js`.
    Advisories are server-side (getAuthContext, server error messages). Not reachable in
    the shipped apps. npm's suggested "fix" (firebase 9.14.0) is a downgrade; ignore.
    Real fix = firebase 12.x (latest 12.19.0, major) – separate task with full regression.
  - moderate: `uuid@8.3.2` via `exceljs@4.4.0` (latest; no newer exceljs). Advisory is
    buffer bounds in v3/v5/v6 with `buf`; exceljs only calls `v4()` without buf, and the
    browser build uses exceljs's prebuilt `dist/exceljs.min.js`. Not reachable.
  - Deps still use `^` ranges (lockfile pins actual versions).
K12 (low) Header comments in `firestore.rules` / `storage.rules` describe v1 model.
K13 (low) `tasks.md` checkboxes all `[ ]` though Status says 1–21 done.
K14 (low) Design drift (see decisions D5) – annotated `// design:` in
  `tests/security-rules/securityRulesMatrix.test.ts`.

## Environment notes
- Emulator rules tests need Java; `clearStorage()` in rules-unit-testing 3.0.4 is
  shallow → use `clearStorageDeep()` from `tests/security-rules/emulatorEnv.ts`.
- Some PowerShell commands lose output via shell integration; redirect to `.tmp_*`
  files and read them, then delete.
- Rules tests use the compat SDK: bytes fields must be `firebase.firestore.Blob`, not Uint8Array.
- Pre-existing lint errors: `packages/shared/src/v2data/templates.test.ts` (4x no-explicit-any).
- Rules changes are NOT live until `npm run deploy:rules` (owner must run/approve).
