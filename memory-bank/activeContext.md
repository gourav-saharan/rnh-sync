# Active context

Objective: harden data integrity/security found in the Oct 2026 audit.
Completed: T1–T4 (see progress.md Session 2). All verified: tsc exit 0,
34 unit files pass, 3 emulator rules files pass.
Session 3: mobile Back gesture + removed fake status bar (see progress.md).
Mobile UX items 1-5 DONE (transitions, update toast, install card, pull-to-sync,
font runtime cache). Remaining: real-device check (owner).
T7 DONE: audit triaged (K11), nothing reachable in shipped bundles. Optional T9: firebase 12.
Old note: T7 dependency upgrades (`npm audit --omit=dev`, check fix versions,
upgrade firebase/exceljs/uuid, rerun all tests). Optional: emulator integration
test for `sessions.ts` purge/updateFields.
Session 4: T5 DONE (workbooks in chunked blobs, up to 10 MB).
Session 4b: full-repo lint now 0 errors (fixed `as any` in templates.test.ts);
K12 DONE (v2 header comments in firestore.rules / storage.rules).
Session 4c: new `packages/shared/src/v2data/emulator.integration.test.ts` + script
`npm run test:integration:emulated` (real modular SDK vs emulator + rules): ~9.5 MB
workbook create/publish/reload byte-exact, published chunk rewrite denied, atomic
edit+history, purge (30+ days) removes history/photos/chunks, refused inside window.
3/3 pass. Skipped in plain `npx vitest run` (36 files pass, 1 skipped).
Next: owner actions only (commit/push, deploy rules+hosting, seed office roles,
real-device + live 5–10 MB check). Optional T9 firebase 12, T6 design drift.
Owner decisions pending: D5 (design drift, T6), deploy (T8), firebase 12 (T9), commit/push.
Constraints: no deploy; no new dependencies; keep existing conventions.
Blockers: T5/T6/T8 need owner decisions.
