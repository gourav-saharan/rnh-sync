# Task plan (priority order)

| ID | Task | Status | Acceptance criteria |
|---|---|---|---|
| T0 | Role model hardening (task 9.1/9.6/9.7): self-reg Tester only, seed-users role flags, matrix tests | DONE | build+unit+255 emulator tests pass (Oct 2026) |
| T1 | Fail loudly on missing workbook (K4) | DONE | `loadDraftBytes`/`loadVersionBytes` throw clear error when no bytes; `publish` refuses empty draft; unit tests cover it |
| T2 | Rules hardening (K2, K3, K8, K9, K10) | DONE (350 emulator tests pass) | photo/history writes tied to session owner/assignee or Report_Viewer; image contentType + size limit on photo meta; `blobs/v{n}` create-only; no direct delete without `deletedAt`; v2 create checks schemaVersion; matrix rows added; emulator tests pass |
| T3 | Atomic edit+history batch (K6), purge removes history/photos (K7) | DONE (rules + client code verified against emulator) | `writeBatch` used; unit test with fake/emulator |
| T4 | Laptop tabs by role (K5) | DONE | Tests/Trash/Analysis need Report_Viewer, Templates needs Template_Admin; component test |
| T5 | Workbook storage architecture (K1) | DONE (D4 = chunked Firestore blobs; ~9.5 MB verified against emulator via `npm run test:integration:emulated`) | 10 MB workbook saves/publishes |
| T6 | Design-drift decisions (D5) | BLOCKED (owner) | rules + matrix rows updated per decision |
| T7 | Dependency audit (K11) | DONE (justified, not exploitable in shipped apps; see K11) | `npm audit --omit=dev` clean or justified; tests pass |
| T9 | Upgrade firebase 11 -> 12 (clears grpc advisories) | TODO (owner approval: major upgrade) | all unit + emulator tests + both builds pass |
| T8 | Deploy rules | BLOCKED (owner runs `npm run deploy:rules`) | live rules match repo |

Dependencies: T2 before T8. T5 may change T2 blob rules.
