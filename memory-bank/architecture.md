# Architecture (verified against source, Oct 2026)

## Stack
- TypeScript monorepo, npm workspaces. React + Vite apps. Vitest (+ Testing Library).
- Firebase JS SDK (`firebase` 11.x), Firestore, Firebase Auth (email/password),
  Firebase Hosting. Storage rules exist but the app no longer uses Cloud Storage.
- Phone local store: IndexedDB via `apps/mobile-pwa/src/v2/store.ts`.
- Excel read/write: `exceljs` (in shared `v2/grid.ts`, `v2/fill.ts`).
- Exact versions: see `package.json` files (all `^` ranges, not pinned).

## Layout
```
apps/mobile-pwa/src/v2/   Phone PWA (Tester): MobileAppV2, AuthGateV2, Home,
                          SetupWizard, DriveMode, RatingPad, syncEngine, store,
                          photos, pullAssigned, context (services)
apps/laptop-web/src/v2/   Office app: LaptopAppV2 (shell+tabs), AuthGateL,
                          Dashboard, SessionPage, AssignPanel, HistoryPanel,
                          ReportDialog, TemplateList, TemplateStudio,
                          useTemplateDraft, PublishPanel, TrashList,
                          AnalysisPage, TyrePhotos, officeRole.ts
packages/shared/src/v2/   Pure domain logic: model, grid, detect, expand,
                          rating, session, merge, fill, analysis, a1, remoteEdit
packages/shared/src/v2data/ Firebase access: auth, users, sessions, templates, blobs
packages/shared/src/firebase/ app init/config/collections
tests/security-rules/     Emulator tests: securityRules (v1), securityRulesV2,
                          securityRulesMatrix (role×path×op), emulatorEnv
tools/                    seed-users.mjs, migrate-v1-to-v2.mjs (Admin SDK)
archive/                  old v1 code (not built)
.kiro/specs/...           requirements/design/tasks (spec)
```
v1 code paths still exist in places (`fieldMappings`, legacy `role` field).

## Firestore data model
- `users/{uid}`: `uid, email, displayName, roles[], createdAt` (legacy `role` honoured by rules).
- `customerTemplates/{tid}`: names, `draft` {structure, schema, mappings, `workbookBytes`},
  `latestVersion`, archived flag.
  - `versions/{n}`: immutable snapshot incl. `workbookBytes` (Bytes).
  - `blobs/{draft|v{n}}` + `chunks/{i}`: chunked fallback storage (`v2data/blobs.ts`, 500 KB chunks).
  - `fieldMappings/*`: v1 legacy.
- `testSessions/{sid}`: `schemaVersion: 2, createdBy, assignedTo[], cells, status,
  lastReport, progress, deletedAt, deletedBy, updatedAt, updatedBy, fieldTimestamps…`
  - `history/{id}`: append-only `{path, before, after, by, byName, at}`.
  - `photos/{photoId}` + `chunks/{i}`: tyre photos (phone path `sessions/{sid}/photos/{file}` is
    mapped to `testSessions/{sid}/photos/{file}` by `parsePhotoPath`).

## Auth / authorization
- `v2data/auth.ts` `resolveUserV2()` reads roles only from `users/{uid}`; never writes roles.
  Offline: cached profile for same uid. `signUp()` always writes `roles: ['Tester']`.
- Laptop gate requires Report_Viewer or Template_Admin (`officeRole.ts`).
- Phone gate requires a role; office accounts can self-add Tester.
- Real enforcement: `firestore.rules` (helpers `hasRole`, `isTester`, `isReportViewer`,
  `isTemplateAdmin` incl. legacy viewer, `testerOwns`, `trashExpired`).

## Sync (phone)
`syncEngine.ts`: push new sessions fully, else only dirty paths; `deletedOnServer`
handling (keep/discard); `pullIdle` pulls laptop edits; uploads pending photos
via `savePhotoBlob`.

## Commands
- `npm run build` (tsc --build), `npm test` (vitest workspace, 32 test files),
  `npm run lint`, `npm run build:apps`.
- `npm run test:rules:emulated` (needs Java + firebase-tools; Firestore+Storage emulators).
- Deploy (LIVE, ask first): `npm run deploy:rules`, `deploy:hosting`, `deploy:all`.
- Roles: `npm run seed:users -- --email a@x.com --add-role Report_Viewer [--dry-run]`.
