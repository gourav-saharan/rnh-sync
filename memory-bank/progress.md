# Progress log

Git: single commit `848abdb Initial commit` on `main` (tracks `origin/main`).
All work below is uncommitted in the working tree unless stated.

## 2026-10 Session 1 (verified)
- Role model: `resolveUserV2()` in `packages/shared/src/v2data/auth.ts` reads roles
  only from `users/{uid}`; `signUp()` writes `['Tester']`. `firestore.rules` self-create
  restricted to `roles == ['Tester']` + allowed keys.
- Laptop gate `AuthGateL.tsx` requires office role (`officeRole.ts`); no-access /
  error screens; password length check, show-password, hints (both apps).
- `tools/seed-users.mjs`: `--add-role`, `--remove-role`, `--dry-run`, legacy `role` merge.
- Emulator fixes: project id from emulator (fallback `rnh-sync`), `clearStorageDeep()`.
- New tests: `auth.test.ts`, `AuthGateL.test.tsx`, `securityRulesMatrix.test.ts`,
  extra cases in `AuthGateV2.test.tsx`, rules test updates.
- Docs: `docs/SETUP.md` self-registration + role-change sections.
- Results: `npx tsc --build` exit 0; `npx vitest run` 32 files pass;
  `npm run test:rules:emulated` 255 tests pass; eslint clean on changed files.
- Audit written (see knownIssues.md).
- NOT done: deploy; seed-users not run against real/emulated Auth.

## 2026-10 Session 2
- Created memory bank, `.clinerules/memory-bank.md`, `.clineignore`.
- T1 DONE (K4): `templates.ts` adds `WorkbookMissingError`, `storedWorkbookBytes()`,
  `resolveWorkbookBytes()`; `loadDraftBytes`/`loadVersionBytes` throw on missing/empty
  bytes, other errors pass through. New `templates.bytes.test.ts` (9 tests).
- T2 DONE (K2, K3, K8, K9, K10) in `firestore.rules`:
  - `blobs/draft` editable by Template_Admin/Report_Viewer; `blobs/v{n}` + chunks create-only (Template_Admin).
  - photos/chunks: create/update only via `canWriteSession(sid)` (Report_Viewer, or Tester
    owner/assignee of an existing session); meta must be image/*, 0<size<5 MB, chunkCount 1..11,
    `updatedBy == uid`; chunks must be bytes <= 500 KB; delete Report_Viewer only.
  - history create requires `canWriteSession`.
  - session create requires `schemaVersion == 2`; Testers cannot touch `lastReport` or set
    `deletedAt` non-null (restore to null still allowed for R13.3).
  - delete only when `trashExpired` (v1 no-deletedAt shortcut removed).
  - Tests: matrix rows for blobs/photos/history/trash/restore/lastReport/schemaVersion;
    `sessionData()` gets `schemaVersion: 2`; v1 test "can delete a testSession" flipped to deny.
    Compat SDK needs `firebase.firestore.Blob` for bytes fields in tests.
- Results: `npx tsc --build` exit 0; `npx vitest run` 33 files / 145 tests pass;
  `npm run test:rules:emulated` 3 files / 350 tests pass; eslint clean on changed files
  (pre-existing `no-explicit-any` errors in `templates.test.ts` untouched).
- NOT done: deploy (owner).
- T4 DONE (K5): `officeRole.ts` adds `visibleSections()` / `sectionOf()`; `LaptopAppV2.tsx`
  shows tabs by role and redirects disallowed hash routes to the user's home section.
  Report_Viewer keeps Templates while D5 is open. New `officeRole.test.ts`.
- T3 DONE (K6, K7) in `sessions.ts`: `updateFields` uses one `writeBatch` (session + history);
  `purge` deletes history, photo chunks and photo meta in batches of 450, then the session.
  `firestore.rules`: history delete allowed only for Report_Viewer when the parent session is
  30+ days in the trash. Matrix row added.
- Results: `npx tsc --build` exit 0; `npx vitest run` 34 files pass;
  `npm run test:rules:emulated` 3 files pass (exit 0); eslint clean on changed files.
- Not verified: purge/updateFields against a live or emulated Firestore client (no unit
  test with the modular SDK; rules side covered by the matrix).

## 2026-10 Session 3 (mobile native feel, step 1)
- New `apps/mobile-pwa/src/v2/mobileNav.ts` (`MobileRoute`, `parentOf`) + `mobileNav.test.ts`.
- `MobileAppV2.tsx`: hardware/gesture Back navigates in-app (history guard + popstate);
  closes the new-test sheet first; on Home, Back leaves the app.
- Removed fake status bar (fixed "9:41 / 5G / 100%") and fake gesture pill; spacer now only
  pads `safe-area-inset-bottom` (`v2.css`).
- `vite.config.ts` manifest theme/background colours match `index.html` (no dark splash flash).
- Results: tsc exit 0; mobile vitest 11 files pass; eslint clean on changed files;
  `vite build apps/mobile-pwa` exit 0 (17 precache entries, 907 KiB).
- Not verified on a real device (Android/iOS install, Back gesture, safe areas).

## 2026-10 Session 3 (mobile native feel, step 2)
- `mobileNav.ts`: `screenDepth`, `transitionFor` -> push/pop/fade screen animations in
  `MobileAppV2.tsx` (`.screen-motion--*` in `v2.css`, disabled by prefers-reduced-motion).
- New `pwaUpdate.ts` (update-ready store, install prompt capture, iOS detection) and
  `PwaPrompts.tsx` (`UpdateToast`, `InstallCard`). `main.tsx` uses `registerSW` onNeedRefresh;
  `vite.config.ts` `registerType: 'prompt'` (no silent swap mid-test).
- Google Fonts runtime-cached by Workbox (StaleWhileRevalidate css, CacheFirst woff2, 1 year).
  Note: fonts are cached after first online launch, not bundled.
- New `pullToRefresh.ts`; Home pull-down syncs; InstallCard on Home (dismissible) + Settings.
- Tests: `pwaUpdate.test.ts`, `mobileNav.test.ts` extended.
- Results: tsc exit 0; `npx vitest run` 36 files pass; `vite build` mobile + laptop exit 0;
  eslint 0 errors on `apps/mobile-pwa/src` (8 pre-existing react-refresh warnings).
- Not verified on a real device.

## 2026-10 Session 4 (workbook storage, K1 / D4 = chunked Firestore blobs)
- `blobs.ts` `writeFirestoreBlob`: chunks in batches of 8 (~4 MB, under 10 MiB commit cap),
  meta doc written LAST. New export `BLOB_CHUNKS_PER_BATCH`.
- `templates.ts`: `createTemplate` / `replaceDraftWorkbook` write `blobs/draft` (no inline
  bytes; replace deletes legacy `draft.workbookBytes`). `publish` writes `blobs/v{n}` before
  the version doc, reuses an identical blob left by a failed attempt, refuses different bytes.
- `firestore.rules`: version-blob chunks writable by Template_Admin only until the blob meta exists.
- Tests: 5 new cases in `templates.bytes.test.ts`; 2 matrix rows (chunk before/after meta).
- Results: tsc exit 0; `npx vitest run` 36 files pass; `npm run test:rules:emulated` 3 files pass;
  mobile + laptop `vite build` exit 0; eslint clean on changed files.
- Not verified: real 10 MB upload/publish against emulator or live project.

