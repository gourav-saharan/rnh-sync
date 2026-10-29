# Project brief: R&H Tyre Testing System ("RNH sync")

Source of intended behaviour: `.kiro/specs/rnh-tyre-testing-system/requirements.md`
(R1–R14), `design.md`, `tasks.md`. Read those for exact acceptance criteria;
this file is a summary, not a replacement.

## Purpose
Replace paper/Excel "R&H" (ride & handling) tyre-test sheets. Testers rate tyre
sets on a phone during drives (offline-first), office staff review/correct the
results on a laptop and generate the customer's own Excel report format
(e.g. `Hyundai Format R&H.xlsx`, `R&H_MSIL Format.xlsx` in the repo root are
real customer formats used as samples).

## User roles (R1, stored in `users/{uid}.roles: Role[]`)
- `Tester` – captures tests on the phone PWA (own + assigned sessions).
- `Report_Viewer` – laptop: reviews/edits sessions, assigns testers, trash/restore/purge, reports.
- `Template_Admin` – laptop: uploads customer workbooks, maps cells, publishes immutable versions.
- One user may hold several roles. Self-registration grants only `['Tester']`;
  office roles are granted with `tools/seed-users.mjs` (Admin SDK).

## Primary workflows
1. Template_Admin uploads a customer `.xlsx` → Template Studio detects grids,
   defines schema + mappings → publishes version `n` (immutable, R2.4).
2. Tester (phone) picks a published template → setup wizard (tyre sets, photos)
   → Drive Mode rating pad → saved to IndexedDB first, synced to Firestore
   when online (dirty field paths only, R9.5).
3. Report_Viewer (laptop) sees live sessions, edits fields (each edit appends a
   history entry, R10.4), assigns testers, generates the Excel report
   by filling the template version's workbook (R12).
4. Trash: sessions are soft-deleted (`deletedAt`), purgeable after 30 days (R13).

## Non-functional / constraints
- No Cloud Functions; all enforcement in Firestore/Storage security rules (R14.1).
- Phone must work offline (R8); laptop is online.
- Workbooks up to 10 MB (R2.2) – currently NOT achievable, see knownIssues K1.
- Firebase project id: `rnh-sync` (`.firebaserc`).

## Unknown / needs clarification
- Whether Report_Viewer should keep template write access (design says no).
- Whether office accounts may self-add Tester ("Turn on testing" button).
- Workbook storage target (chunked Firestore blobs vs Cloud Storage) – see decisions D4.
