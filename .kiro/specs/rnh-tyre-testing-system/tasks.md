# Implementation Plan (v2): R&H Tyre Testing System

> v2 replaces `archive/tasks.v1.md` (all v1 tasks were completed). It implements `requirements.md` v2 and `design.md` v2.
>
> **Constraints:** Firebase Auth + Firestore + Cloud Storage only. **No Cloud Functions.** Admin-only work (roles, migration, permanent purge) runs as local Admin SDK scripts in `tools/`. No git.

## Status (implementation pass)

Implemented and verified (`tsc --build` clean, ESLint 0 errors, 73 unit/component/property tests, 45 emulator rules tests, both production builds):

- Tasks 1–4, 6–7: shared v2 model, rating core, grid reader, schema/block detection, mapping expansion, report fill, merge. Fixture tests on the M&M, MSIL and Hyundai workbooks.
- Task 9: Firestore/Storage rules v2 (multi-role, immutable versions, 30-day trash, append-only history, photos), data access, indexes. No Cloud Functions.
- Tasks 11–14: Mobile_PWA v2 (Dexie store with photo queue, sync engine, setup wizard with tyre photos, Drive_Mode, overview, summary, settings).
- Tasks 16–18: Laptop_Web_App v2 (dashboard, review grid with history, Template Studio, report dialog with preview, trash).
- Task 20: `tools/migrate-v1-to-v2.mjs` (dry run by default, backup first), tested on the emulator.
- Task 21: v1 code moved (not deleted) to `archive/v1-code/`, outside the build; docs updated.

Not done / not verified:

- P5 (block expansion) and P7 (duplicate targets) now have property tests. Some other optional `*` property-test sub-tasks (e.g. P18) are covered by example/fixture tests only.
- Manual device checks: phone install, sunlight readability, voice input, wake lock, and opening generated reports in Microsoft Excel.
- Rules not yet deployed to the live project (`npm run deploy:rules`).

## Overview

Build order: shared v2 model and pure core first (fully property-tested), then template engine (detection, block mapping, expansion), then the v2 report generator verified on the three real customer workbooks. After that, Firebase rules and data access, then the Mobile_PWA (setup wizard, Drive_Mode, sync), then the Laptop_Web_App (Template Studio, review grid, report dialog), then migration and final checks.

v1 code is replaced module by module. Each task ends with `npm run build` and `npm test` green, so no half-migrated state is left behind. v1 modules are deleted only after their v2 replacement is wired in.

Testing: fast-check property tests (≥100 runs, tagged `Feature: rnh-tyre-testing-system, Property {n}: {text}`), fixture tests on the real `.xlsx` files, Testing Library component tests, and emulator tests for rules and sync. Tasks marked `*` are test sub-tasks.

## Tasks

- [ ] 1. Shared v2 domain model
  - [ ] 1.1 Create `packages/shared/src/model/` with the v2 types from design "Data Models": `Role` (3 roles), `UserDoc.roles[]`, `RatingScale`, `CategoryDef`, `ParameterDef`, `HeaderFieldDef`, `TyreDetailKey`, `TemplateSchema`, `BlockMapping`, `HeaderCellMapping`, `SlotCellMapping`, `ResolvedTarget`, `CustomerTemplate`, `TemplateVersion`, `SheetStructure` (+`formulaCells`, `columnWidths`), `TyreSet`, `RatingCell` (`rating: number | null`), `TestSession` (`schemaVersion: 2`), `LocalTestSession`
    - Add `cellKey(paramId, tyreSetId)` and `parseCellKey`, id factories, `DEFAULT_SCALE`, `DEFAULT_QUICK_COMMENTS`, default file-name pattern
    - Export from `@rnh/shared` next to v1 types (v1 kept until task 21)
    - _Requirements: 3.3, 3.5, 3.6, 7.2, 9.5_
  - [ ] 1.2 Update `firebase/collections.ts`: `versions` subcollection, `history` subcollection, storage paths `templates/{tid}/draft.xlsx`, `templates/{tid}/v{n}.xlsx`, `sessions/{sid}/photos/{file}`
    - _Requirements: 2.4, 5.8, 10.4_
  - [ ]* 1.3 Unit tests for key helpers and path builders

- [ ] 2. Pure rating core (`model/rating.ts`)
  - [ ] 2.1 Implement `isValidRating`, `applyRatingV2` (invalid keeps prior), `padValues(anchor, scale, 9)` with shift-at-ends, `anchorFor(session, paramId)` (Ref rating → last entered → midpoint)
    - _Requirements: 6.2, 7.1_
  - [ ] 2.2 Implement `categoryAverage`, `weightedCategoryAverage`, `diffToReference`, `progress`
    - _Requirements: 7.3, 7.4, 7.5, 10.1_
  - [ ]* 2.3 Property test P1 rating validity — _Validates 7.1_
  - [ ]* 2.4 Property test P2 pad shape — _Validates 6.2_
  - [ ]* 2.5 Property test P3 Unrated never numeric (model part) — _Validates 7.2_
  - [ ]* 2.6 Property test P4 averages exclude Unrated — _Validates 7.3, 7.4_

- [ ] 3. Workbook reading and schema detection (`template/`)
  - [ ] 3.1 Implement `readSheetGrid(bytes)` → serialisable `SheetGrid[]` (values, formulas, merges, column widths, row heights) and extend `extractStructure` to fill `formulaCells` and `columnWidths`; reject non-xlsx, password-protected, >10 MB with a reason
    - _Requirements: 2.2, 2.3_
  - [ ] 3.2 Implement `proposeSchema(grid, nameRange, categoryCol?)`: parameters from non-empty cells, categories from adjacent (merged) labels, skip formula / "Average" / "Total Average" rows into `excludedRows`, stable ids, weights read when an adjacent numeric "Weight" column exists
    - _Requirements: 3.1, 3.2, 3.4_
  - [ ] 3.3 Implement `validateSchema` (no parameters, duplicate names per category)
    - _Requirements: 3.8_
  - [ ] 3.4 Copy the three customer workbooks into `packages/shared/test-fixtures/` (`mm-u171.xlsx`, `msil.xlsx`, `hyundai.xlsx`)
  - [ ]* 3.5 Fixture tests: M&M 19 params / 4 categories, MSIL 14 params / 3 categories, Hyundai 19 params with weights; Average rows excluded
  - [ ]* 3.6 Property test P18 schema detection — _Validates 3.1, 3.2_

- [ ] 4. Mapping engine (`template/expand.ts`, `template/proposeBlock.ts`)
  - [ ] 4.1 Implement `expandMappings(version)` → `{ targets, problems }` for block, header and slotDetail mappings, with merge-master redirection, `formulaCell`, `duplicateTarget`, `mergeRedirect`, `sheetMissing`
    - _Requirements: 4.1, 4.3, 4.4, 4.6, 4.7, 4.8_
  - [ ] 4.2 Implement `proposeBlock(grid, region, schema)`: bind rows to params by normalised text match, detect first column, stride and comment offset from the header row / non-empty pattern
    - _Requirements: 4.1, 4.2_
  - [ ] 4.3 Implement `coverage(version)` (per param × slot rating/comment mapped, per header field mapped) and `validateForPublish(draft)` combining schema + mapping problems
    - _Requirements: 3.8, 4.10_
  - [ ]* 4.4 Property test P5 block expansion — _Validates 4.1, 4.3_
  - [ ]* 4.5 Property test P7 duplicate detection — _Validates 4.7, 4.8_
  - [ ]* 4.6 Fixture tests: `proposeBlock` gives stride 2 (M&M, first column E) and 4 (MSIL/Hyundai, first column D/E); MSIL two blocks cover slots 1–4 and 5–8

- [ ] 5. Checkpoint — shared core
  - Run `npm run build` and `npm test`; all v1 and new tests green. Ask the user if questions arise.

- [ ] 6. Report generator v2 (`report/fillWorkbookV2.ts`)
  - [ ] 6.1 Implement `fillWorkbookV2(bytes, version, session)`: expand targets, map slot → Tyre_Set, write ratings as numbers / `null` as empty, comments as text, header by type (date → `Date`, number/pressure → number), skip slots without a Tyre_Set, assert no formula cell is written, set `calcProperties.fullCalcOnLoad = true`
    - _Requirements: 11.1, 11.2, 11.4, 11.6_
  - [ ] 6.2 Implement `preflight(version, session)` → `{ blockers: unmappedTyreSets, warnings: unrated + missingRequired }`
    - _Requirements: 11.5, 11.7, 10.6_
  - [ ] 6.3 Implement `serializeReport` (writeBuffer + re-parse smoke check, explicit error on failure), `testFill(bytes, version)` with labelled placeholders (`R:<shortName>/S<slot>`), and `suggestedFileNameV2(pattern, session, version)` with invalid characters replaced
    - _Requirements: 4.9, 11.8, 12.3, 12.4_
  - [ ] 6.4 Implement `buildPreview(filledWorkbook, targets)` → per-sheet grid model with written cells flagged and formula cells badged
    - _Requirements: 12.1_
  - [ ]* 6.5 Property test P6 formula protection — _Validates 4.6, 11.4_
  - [ ]* 6.6 Property test P8 mapped-cell fidelity (typed values) — _Validates 11.1, 11.2_
  - [ ]* 6.7 Property test P9 unmapped preservation — _Validates 11.3_
  - [ ]* 6.8 Property test P10 structural fidelity (names, order, merges, widths, heights) — _Validates 11.3_
  - [ ]* 6.9 Property test P11 unused slots untouched — _Validates 11.6_
  - [ ]* 6.10 Property test P12 re-parse validity + `fullCalcOnLoad` — _Validates 11.4, 11.8_
  - [ ]* 6.11 Fixture tests: full 8-set fill of M&M, MSIL (across `dryhandling1`/`dryhandling2`) and Hyundai; every rating/comment cell written, every `AVERAGE` and `Tabelle!` formula unchanged; performance under 5 s (R15.5)

- [ ] 7. Merge, cursor and undo core
  - [ ] 7.1 Implement `mergeSessionV2(local, remote)`: per-path newest `fieldTimestamps` wins, local `dirtyPaths` always win, double-edited comments keep both texts (`local ⏐ remote`) and are flagged
    - _Requirements: 9.4, 9.5_
  - [ ] 7.2 Implement pure `cursor` helpers: `orderedPairs(version, session, order)`, `next`, `prev`, `jump`, "tyre done" boundary detection
    - _Requirements: 6.1, 6.9, 6.10_
  - [ ] 7.3 Implement pure undo stack (`push`, `undo`, max 50) over `{ key, before }`
    - _Requirements: 6.13_
  - [ ]* 7.4 Property test P14 per-cell merge (incl. idempotence) — _Validates 9.4, 9.5_
  - [ ]* 7.5 Property test P16 cursor traversal — _Validates 6.9, 6.10_
  - [ ]* 7.6 Property test P17 undo inverse — _Validates 6.13_

- [ ] 8. Checkpoint — report engine
  - Run `npm run build` and `npm test`. Open the three generated fixture reports in Microsoft Excel (manual): no repair prompt, averages recalculate. Ask the user if questions arise.

- [ ] 9. Firebase v2: rules, indexes, data access (no Cloud Functions)
  - [ ] 9.1 Rewrite `firestore.rules` per design "Security Rules (v2)": `hasRole()` over `roles[]`, self-register only as `['Tester']`, immutable `versions/{n}` with `n == latestVersion + 1`, Tester own/assigned sessions (no change to `createdBy`/`assignedTo`/`deletedAt`), Report_Viewer trash via `deletedAt`, permanent delete only after 30 days, `history` append-only
    - _Requirements: 1.3–1.7, 13.2, 14.1–14.5_
  - [ ] 9.2 Rewrite `storage.rules`: templates (Template_Admin write, `v{n}.xlsx` write-once), session photos (`image/*`, < 5 MB)
    - _Requirements: 5.8, 14.3_
  - [ ] 9.3 Update `firestore.indexes.json` with the three `testSessions` composite indexes
    - _Requirements: 10.1_
  - [ ] 9.4 Update `authService` to resolve `roles[]` (read v1 `role` as a one-item array for compatibility) and expose `hasRole`; update `AuthGate` in both apps to check a required role
    - _Requirements: 1.1–1.7_
  - [ ] 9.5 Implement shared data access: `templateStore` (create draft, upload draft blob, save schema/mappings, publish = copy blob to `v{n}.xlsx` + write version doc + bump `latestVersion` in one batch where possible, archive, duplicate, list, watch) and `sessionStore` (watch list, watch one, field-path `updateDoc` + history append, trash/restore/purge, export JSON)
    - _Requirements: 2.1, 2.4–2.8, 9.3, 10.3, 10.4, 13.1, 13.2, 13.4, 13.5_
  - [ ] 9.6 Extend `tools/seed-users.mjs` to write `roles: []` and `displayName`, with `--add-role` / `--remove-role` flags (Admin SDK, local only)
    - _Requirements: 1.3, 14.4_
  - [ ]* 9.7 Emulator tests P20: full role × path × operation matrix from the rules table — _Validates 14.*_


- [ ] 10. Checkpoint — backend
  - Run `npm run build`, `npm test` and `npm run test:rules:emulated`. Deploy rules only after the user confirms (`npm run deploy:rules` changes the live project). Ask the user if questions arise.

- [ ] 11. Mobile_PWA foundation (Dexie v2, sync, shell)
  - [ ] 11.1 Dexie v2 schema (`version(2)`): stores `sessions`, `templateVersions`, `suggestions`, `photos`; upgrade hook converts local v1 sessions with `migrateSessionV1` (task 20.1 provides the function); `navigator.storage.persist()` on first run with a result flag
    - _Requirements: 8.1–8.5_
  - [ ] 11.2 `localStore` API: `saveCell`, `saveHeader`, `saveTyreSet`, `saveCursor` (each adds the path to `dirtyPaths`, sets `saved_local`, resolves only after commit), `loadInProgress`, `list`
    - _Requirements: 8.1, 8.2_
  - [ ] 11.3 `SyncEngine` v2: 1 s debounce, `setDoc` for new sessions, `updateDoc` with dirty field paths + `fieldTimestamps.<path>: serverTimestamp()`, backoff 2 s → 60 s, triggers on `online` / `visibilitychange`, pull + `mergeSessionV2` on open, tombstone handling (keep dirty local copies and flag)
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 13.3_
  - [ ] 11.4 Template cache: on online start fetch all published `TemplateVersion` docs into Dexie; offline list reads the cache
    - _Requirements: 8.3, 8.4_
  - [ ] 11.5 App shell: bottom tabs (Sessions, Drive, Summary, Settings), per-session sync chip (`saved on phone` / `syncing` / `synced` / `sync error`), high-contrast light + dark theme tokens (WCAG AA), install prompt, sign-out confirm when unsynced data exists, stay signed in offline
    - _Requirements: 1.8, 1.9, 6.12, 8.6, 8.7, 15.4_
  - [ ]* 11.6 Property test P13 local round-trip (incl. `cursor`) — _Validates 8.1, 8.2_
  - [ ]* 11.7 Property test P15 sync never loses data (fake Firestore, random failures) — _Validates 9.2_
  - [ ]* 11.8 Unit tests: tombstone keep/discard, sign-out confirm, offline template list

- [ ] 12. Mobile_PWA setup wizard
  - [ ] 12.1 Sessions screen: in-progress first with `rated / total`, recent list, large "New test" button in thumb zone, auto-resume into Drive_Mode when last left there
    - _Requirements: 8.2, 15.2_
  - [ ] 12.2 Step 1 Template: customer tiles (name, template, version), cached versions only when offline; pins `templateVersion`
    - _Requirements: 5.1, 8.3_
  - [ ] 12.3 Step 2 Header: inputs per `HeaderFieldType` (numeric keypad + unit, date picker, chips), prefill from today / display name / last session on the same template, marked "from last test"
    - _Requirements: 5.3, 5.4_
  - [ ] 12.4 Step 3 Tyre sets: reorderable cards with slot number, exactly-one Reference toggle, suggestions for make / pattern / size, "copy from previous", camera photo (compressed, stored in Dexie then uploaded), Add disabled past `slotCount` with the reason
    - _Requirements: 5.5–5.8_
  - [ ] 12.5 Step 4 Review: counts, missing required fields as a warning, capture order choice, "Start driving"
    - _Requirements: 5.2, 5.9, 6.9_
  - [ ]* 12.6 Component tests: step navigation, prefill, single Reference, slot limit, reorder changes slots


- [ ] 13. Mobile_PWA Drive_Mode
  - [ ] 13.1 `RatingPad`: 3×3 grid of `padValues` around `anchorFor`, buttons ≥64×64 px, selected = filled + ✓ (not colour alone), "− lower" / "higher +" shift buttons ≥48 px, Unrated shown as "–"
    - _Requirements: 6.2, 6.3, 6.7, 15.4_
  - [ ] 13.2 Tap flow: optimistic fill <100 ms, 15 ms vibration where supported, `saveCell` then ✓ only after commit, red "not saved" badge + retry on write failure (never advance), 600 ms progress ring then auto-advance, second tap replaces and restarts; auto-advance toggle + delay in Settings
    - _Requirements: 6.4, 6.5, 8.1, 15.1_
  - [ ] 13.3 `DriveScreen` layout per design sketch: header (tyre label, category, `n / total`, sync dot), shortName, other tyres' ratings for this parameter, bottom bar Prev / Grid / Undo / Next in thumb zone; portrait one-handed, landscape supported, widths ≥360 px
    - _Requirements: 6.1, 6.8, 15.3_
  - [ ] 13.4 `CommentBar`: Quick_Comment chips (append with "; "), voice dictation (reuse v1 `dictation.ts`, hidden when unsupported), type sheet, clear rating; overall comment per Tyre_Set on the "tyre done" card
    - _Requirements: 6.6, 6.7, 4.4_
  - [ ] 13.5 Wire `cursor` + undo: order switch "by tyre" / "by parameter", "MU3 done — next: MU4" card, overview grid (params × tyres, rating or "–", comment dot, tap to jump), undo restores rating + comment, cursor persisted for resume
    - _Requirements: 6.9, 6.10, 6.13, 8.2_
  - [ ] 13.6 Screen Wake Lock on entry, re-request on `visibilitychange`, release on exit; one-tap theme toggle in header
    - _Requirements: 6.11, 6.12_
  - [ ]* 13.7 Component tests: pad sizes and selection, auto-advance with fake timers (replace within window, disabled mode), save-before-✓, failed write blocks advance, undo, grid jump, order switch

- [ ] 14. Mobile_PWA summary and wiring
  - [ ] 14.1 `SessionSummary`: per-tyre category averages (and weighted where weights exist), Δ Ref per parameter and category, unrated list, missing required header fields, "Mark ready" with confirmation when anything is missing
    - _Requirements: 5.9, 7.3–7.5, 10.6_
  - [ ] 14.2 Replace v1 `App.tsx` capture surface with the v2 shell + routes (Sessions → Setup → Drive → Summary); remove v1 `CaptureForm`, `RatingControl`, `TemplatePicker` and their tests once v2 equivalents pass
    - _Requirements: all Mobile_PWA_
  - [ ] 14.3 Update PWA manifest (`orientation: any`, theme colours for both themes) and keep Workbox precache; verify offline launch in the smoke test
    - _Requirements: 8.3, 8.7, 15.3_
  - [ ]* 14.4 Integration test (emulator): offline capture of a full 3-set session → reconnect → Firestore doc has every cell; second client edits one cell → per-cell merge on both

- [ ] 15. Checkpoint — mobile
  - Run `npm run build` and `npm test`. Manual (listed for the user): install on Android Chrome and iOS Safari, standalone launch, airplane-mode capture, sunlight readability, one-handed Drive_Mode in a vehicle. Ask the user if questions arise.


- [ ] 16. Laptop_Web_App shell, sessions and review
  - [ ] 16.1 `AppShell`: left nav (Dashboard, Sessions, Templates, Trash) shown per role, header with user + roles + sign-out, hash router; replace v1 tab `ReportWorkspace`
    - _Requirements: 1.4–1.7_
  - [ ] 16.2 `Dashboard`: tests synced today, tests `ready` awaiting report, templates in draft (live `onSnapshot`)
    - _Requirements: 9.3_
  - [ ] 16.3 `SessionTable`: columns customer, template, test date, vehicle, tester, Tyre_Set count, completeness bar, sync state, status; filter per column + text search; live updates
    - _Requirements: 10.1, 9.3_
  - [ ] 16.4 `ReviewGrid`: parameters grouped by category × tyre columns (rating + comment), category average rows (+ weighted), Δ Ref toggle, Unrated hatched with "–", keyboard nav (arrows, Tab, Enter edits, digits type rating, Esc cancels), same validation as mobile, field-path save + history entry, history popover per cell, flagged double-edited comments
    - _Requirements: 7.5, 9.4, 10.2–10.5_
  - [ ] 16.5 `HeaderPanel` + `TyreSetPanel` (edit header fields and tyre details, missing required highlighted, Tyre_Sets beyond mapped slots flagged); "Mark ready" with warnings + confirmation
    - _Requirements: 10.3, 10.5, 10.6_
  - [ ]* 16.6 Component tests: keyboard editing, invalid rating rejected, Unrated display, Δ Ref, history entry written, mark-ready warning

- [ ] 17. Laptop_Web_App Template Studio
  - [ ] 17.1 `SheetGridView`: virtualised Excel-like grid from `SheetGrid` (merges, column widths, row heights), ƒ badge on formula cells, rectangle selection, colour overlays by target kind with a legend (not colour alone)
    - _Requirements: 2.3, 4.5, 4.6, 15.4_
  - [ ] 17.2 Step 1 Upload: drop `.xlsx`, customer + template name, validation errors from 3.1, sheet list in order; saves draft doc + `draft.xlsx`; "Duplicate template" entry point
    - _Requirements: 2.1, 2.2, 2.3, 2.8_
  - [ ] 17.3 Step 2 Schema: select parameter-name range → `proposeSchema` → editable list (rename, reorder, add, remove, re-categorise, shortName, description, weight), excluded rows with "re-include"; Rating_Scale + point labels, Quick_Comments, Header_Fields editor, slot count, file-name pattern
    - _Requirements: 3.1–3.7_
  - [ ] 17.4 Step 3 Mapping: select rating table → `proposeBlock` → block form (sheet, rows↔params binding, first slot, slot count, first column, stride, rating/comment offsets) with live overlay; add second block for continued slots; click-to-bind header cells and per-slot tyre detail cells; formula cells refuse selection with the formula shown; merge redirect note
    - _Requirements: 4.1–4.8_
  - [ ] 17.5 Step 4 Check: coverage matrix (param × slot, header fields), problems list linking to the cell, "Test fill" download
    - _Requirements: 4.7, 4.9, 4.10_
  - [ ] 17.6 Step 5 Publish: `validateForPublish` must be empty; creates version n+1 (blob copy + version doc); template list shows latest version, publish date, session count; archive / unarchive
    - _Requirements: 2.4–2.7, 3.8_
  - [ ]* 17.7 Component tests: formula cell refuses mapping, duplicate target blocks save, block form overlay count = rows × slots × 2, publish blocked with problems, archive hides from mobile list


- [ ] 18. Laptop_Web_App report dialog and trash
  - [ ] 18.1 `ReportDialog`: pre-flight from `preflight()` (unmapped Tyre_Sets block with the list; unrated + missing required as warnings with "Continue"), download pinned `templates/{tid}/v{n}.xlsx`, `fillWorkbookV2`, preview tabs per sheet via `buildPreview` (written cells outlined, ƒ cells note "recalculates in Excel"), Download with `suggestedFileNameV2`; explicit error and no file on failure; on download write `lastReport` and `status = 'reported'`
    - _Requirements: 11.1–11.8, 12.1–12.5_
  - [ ] 18.2 `TrashList`: trashed sessions with days left, Restore, permanent Delete only when older than 30 days (typed confirmation); "Export JSON" on the session page
    - _Requirements: 13.1, 13.2, 13.4_
  - [ ] 18.3 Delete flow from the session page: typed confirmation → sets `deletedAt` / `deletedBy`
    - _Requirements: 13.2_
  - [ ]* 18.4 Component tests: blocker stops generation, warnings allow continue, failed serialize shows error and no download, `lastReport` recorded, restore within 30 days, purge refused before 30 days

- [ ] 19. Checkpoint — laptop
  - Run `npm run build` and `npm test`. Manual: build all three customer templates in Template Studio, capture a test on the phone, generate each report and open it in Microsoft Excel. Ask the user if questions arise.

- [ ] 20. Migration v1 → v2 (local Admin SDK script, no Cloud Functions)
  - [ ] 20.1 Implement pure `migrateSessionV1` in `packages/shared/src/migrate/` (tyre sets → slots, first = Reference; v1 ride/handling → `cells` of the first Tyre_Set; `rating == range.min` with empty note → `null`, listed as ambiguous); used by both the script and the Dexie upgrade (11.1)
    - _Requirements: design "Migration v1 → v2"_
  - [ ] 20.2 `tools/migrate-v1-to-v2.mjs`: `--dry-run` default, `--apply` to write; users `role` → `roles[]`; v1 templates + `fieldMappings` → v2 drafts (blob copied to `draft.xlsx`); sessions backed up to `testSessionsV1Backup/{sid}` before conversion; prints counts and every ambiguous conversion
  - [ ] 20.3 Document the script in `docs/SETUP.md` (key handling, dry run, apply, or clear test-only data instead with confirmation)
  - [ ]* 20.4 Property test P19 migration safety — _Validates migration_

- [ ] 21. Remove v1 code and update docs
  - [ ] 21.1 Delete v1-only modules and their tests (`rh/parameterSet`, v1 `fillWorkbook`/`generateReport`/`resolveFieldValue`, v1 `mergeSession`, v1 `mappingEditor`/`templateManager`, v1 `fieldMappings` paths) once nothing imports them; remove v1 types from `index.ts`
  - [ ] 21.2 Update `docs/SETUP.md`: three roles, `seed-users` role flags, Template Studio walkthrough, deploy rules, no Cloud Functions
  - [ ] 21.3 Run `npm run lint` and `npm run format:check`; fix findings

- [ ] 22. Final checkpoint — full system
  - Run `npm run build`, `npm test`, `npm run test:rules:emulated`, `npm run test:integration`. Confirm with the user before `npm run deploy:rules` (live project). Hand over the manual checklist (install, offline, sunlight, in-vehicle use, Excel open without repair, assistive-technology review for WCAG). Ask the user if questions arise.

## Notes

- `*` tasks are tests. They can be deferred for speed, but P5–P12 (mapping and report fidelity) and P14–P15 (no data loss) protect the core promise and should not be skipped.
- Each task lists requirement clauses for traceability; property tasks name the design property they validate.
- No Cloud Functions anywhere: publish copies the draft blob client-side (download + upload to `v{n}.xlsx`), trash purge is a user action gated by rules, roles and migration run from `tools/` with the Admin SDK.
- Live-project actions (`deploy:rules`, `migrate --apply`, `seed:users`) are always run only after the user confirms.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2", "3.1", "3.4"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "2.6", "3.2", "3.3", "7.1", "7.2", "7.3"] },
    { "id": 3, "tasks": ["3.5", "3.6", "4.1", "4.2", "7.4", "7.5", "7.6"] },
    { "id": 4, "tasks": ["4.3", "4.4", "4.5", "4.6", "20.1"] },
    { "id": 5, "tasks": ["5", "6.1", "6.2", "20.4"] },
    { "id": 6, "tasks": ["6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11"] },
    { "id": 7, "tasks": ["8", "9.1", "9.2", "9.3", "9.4", "9.6"] },
    { "id": 8, "tasks": ["9.5", "9.7"] },
    { "id": 9, "tasks": ["10", "11.1", "11.2", "16.1"] },
    { "id": 10, "tasks": ["11.3", "11.4", "11.5", "11.6", "16.2", "16.3", "17.1"] },
    { "id": 11, "tasks": ["11.7", "11.8", "12.1", "12.2", "16.4", "16.5", "17.2"] },
    { "id": 12, "tasks": ["12.3", "12.4", "12.5", "13.1", "16.6", "17.3"] },
    { "id": 13, "tasks": ["12.6", "13.2", "13.3", "13.4", "17.4"] },
    { "id": 14, "tasks": ["13.5", "13.6", "17.5", "17.6"] },
    { "id": 15, "tasks": ["13.7", "14.1", "17.7", "18.1", "18.2", "18.3"] },
    { "id": 16, "tasks": ["14.2", "14.3", "18.4"] },
    { "id": 17, "tasks": ["14.4", "15", "19", "20.2"] },
    { "id": 18, "tasks": ["20.3", "21.1"] },
    { "id": 19, "tasks": ["21.2", "21.3"] },
    { "id": 20, "tasks": ["22"] }
  ]
}
```

