# Implementation Plan: R&H Tyre Testing System

## Overview

This plan builds the R&H Tyre Testing System incrementally in React + TypeScript with a Firebase backend, following the design's layered architecture. Foundational pieces come first (monorepo/project setup, shared TypeScript models, Firebase project + emulator config, security rules), then the data/persistence layer (IndexedDB local store, Firestore data access), then the template/mapping engine and the fidelity-by-preservation report generation pipeline (the core value plus the linchpin fidelity properties 6, 13, 14, 16), then the Mobile PWA capture UI and the offline/sync engine, and finally the Laptop review/report UI and Excel export. Each task builds on the previous ones and wires new code into the running app so there is no orphaned code.

Testing uses the design's dual approach: property-based tests with fast-check (minimum 100 iterations, one PBT per correctness property, each tagged `Feature: rnh-tyre-testing-system, Property {number}: {property_text}`) for pure input-varying logic, plus example/integration/smoke/security-rules tests against the Firebase Emulator Suite for external services and UI.

## Tasks

- [x] 1. Set up project structure, tooling, and shared models
  - [x] 1.1 Initialize monorepo and app scaffolding
    - Create a workspace with a `shared` package and two React + TypeScript apps (`mobile-pwa`, `laptop-web`) using Vite
    - Configure TypeScript project references so both apps consume the `shared` package
    - Add ESLint/Prettier and a root `test` script wired to Vitest
    - Install and configure fast-check as the property-testing library (do not implement PBT from scratch)
    - _Requirements: 4.1, 4.2_

  - [x] 1.2 Define shared TypeScript domain models and constants
    - Create shared types: `Role`, `AuthUser`, `UserDoc`, `CustomerTemplate`, `TemplateStructure`, `FieldMapping`, `TestSession`, `TyreSet`, `VehicleDetails`, `TestConditions`, `RHCategory`, `RHParameterEntry`
    - Define the default R&H_Parameter set and rating grid constants (0.25 increment, per-parameter range config)
    - Define the `(templateId, sheetName, cellAddress)` uniqueness key helper and the `inputFieldKey` conventions
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 5.4, 3.2, 3.3_

- [x] 2. Configure Firebase backend, emulator, and security rules
  - [x] 2.1 Set up Firebase project config and Emulator Suite
    - Add Firebase SDK initialization (Auth, Firestore, Cloud Storage) with environment-based config
    - Add `firebase.json` and emulator config for Auth, Firestore, and Storage; add npm scripts to start the emulators
    - Define the Firestore collection layout (`users`, `customerTemplates`, `customerTemplates/{id}/fieldMappings`, `testSessions`) and Cloud Storage path convention (`templates/{templateId}/original.xlsx`)
    - _Requirements: 1.1, 2.1, 7.1_

  - [x] 2.2 Author Firestore and Storage security rules for role-based access
    - Write rules: Testers write their own Test_Sessions but not templates; Report_Viewers read sessions and manage templates/mappings; unauthenticated access denied
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 2.3 Write security-rules tests against the emulator
    - Assert Property 2 access matrix (Tester, Report_Viewer, unauthenticated) for sessions, templates, and mappings
    - **Property 2: Role-based access control**
    - **Validates: Requirements 1.4, 1.5, 1.6**

- [x] 3. Implement Auth_Service and role handling
  - [x] 3.1 Implement Auth_Service wrapper and role resolution
    - Implement `signIn`, `signOut`, `currentUser`, `onAuthChange` over Firebase Auth
    - Resolve the single role from `users/{uid}` and expose it on `AuthUser`; surface descriptive error on invalid credentials
    - Add route guards in both apps: unauthenticated users reach only sign-in; role gates Tester capture vs Report_Viewer report features
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 3.2 Write property test for exactly-one-role
    - **Property 1: Exactly one role**
    - **Validates: Requirements 1.3**

  - [x] 3.3 Write property test for role-based access control
    - **Property 2: Role-based access control**
    - **Validates: Requirements 1.4, 1.5, 1.6**

  - [x] 3.4 Write unit and integration tests for auth flows
    - Unit test the sign-out flow returning to sign-in (1.7)
    - Emulator integration test for valid sign-in granting access (1.1) and invalid credentials denial (1.2)
    - _Requirements: 1.1, 1.2, 1.7_

- [x] 4. Checkpoint - foundation and auth
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the local (IndexedDB) persistence layer on Mobile_PWA
  - [x] 5.1 Implement the `localSessions` IndexedDB store
    - Create a Dexie-based wrapper for the `localSessions` object store keyed by `sessionId`, holding the `TestSession` shape plus `dirty` and `pendingSince`
    - Implement save-before-confirm (persist to IndexedDB before returning a saved confirmation) and load/restore of the most recent in-progress session
    - _Requirements: 4.4, 5.6, 10.1, 10.2_

  - [x] 5.2 Write property test for local persistence round-trip
    - **Property 8: Local Test_Session persistence round-trip**
    - **Validates: Requirements 4.4, 5.6, 6.1, 6.2, 6.3, 6.4, 10.2**

- [x] 6. Implement rating validation and category averaging (pure logic)
  - [x] 6.1 Implement rating validation and category-average derivation
    - Implement a validator accepting a rating iff in the parameter's configured range and a multiple of 0.25, rejecting invalid values while keeping the prior valid value
    - Implement category average as the arithmetic mean of a non-empty set of parameter ratings
    - _Requirements: 5.4, 6.5_

  - [x] 6.2 Write property test for rating validation
    - **Property 7: Rating validation**
    - **Validates: Requirements 5.4**

  - [x] 6.3 Write property test for category average derivation
    - **Property 9: Category average derivation**
    - **Validates: Requirements 6.5**

- [x] 7. Implement the template/mapping engine (ingest side)
  - [x] 7.1 Implement template structure extraction with ExcelJS
    - Parse an uploaded workbook and extract `TemplateStructure` (ordered sheet names, per-sheet row/column dimensions, merged ranges)
    - Validate the file is a real `.xlsx` and reject invalid files with a descriptive error
    - _Requirements: 2.2, 2.3, 2.5, 8.3_

  - [x] 7.2 Write property test for template structure extraction fidelity
    - **Property 3: Template structure extraction fidelity**
    - **Validates: Requirements 2.2, 2.5**

  - [x] 7.3 Implement Field_Mapping creation, conflict detection, and merge-anchor resolution
    - Implement `createMapping` producing accepted mappings and duplicate-target-cell conflicts keyed on `(templateId, sheetName, cellAddress)`
    - Resolve any `cellAddress` inside a merged range to the range's top-left anchor
    - _Requirements: 3.2, 3.3, 3.5_

  - [x] 7.4 Write property test for mapping conflict handling
    - **Property 5: Mapping conflict handling**
    - **Validates: Requirements 3.5**

- [x] 8. Implement Firestore data access for templates and mappings
  - [x] 8.1 Implement Template_Manager persistence (Firestore + Cloud Storage)
    - Implement `upload` (store raw blob in Cloud Storage, store metadata + `TemplateStructure` in Firestore), `list`, `inspect`, and `delete` (confirmation-gated, removes metadata + blob)
    - _Requirements: 2.1, 2.4, 2.5, 2.6_

  - [x] 8.2 Implement Mapping_Editor persistence with conflict-aware save/load
    - Implement `begin`, `loadExisting`, and `save` that persists non-conflicting mappings and withholds only conflicting ones, associated with the Customer_Template
    - _Requirements: 3.1, 3.4, 3.5, 3.6_

  - [x] 8.3 Write property test for mapping save/load round-trip
    - **Property 4: Mapping save/load round-trip**
    - **Validates: Requirements 3.4, 3.6**

  - [x] 8.4 Write unit and integration tests for Template_Manager
    - Unit test template listing projection (2.4) and delete-requires-confirm (2.6)
    - Emulator integration test for upload storing blob + metadata (2.1)
    - _Requirements: 2.1, 2.4, 2.6_

- [x] 9. Checkpoint - persistence and template/mapping engine
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement the Report_Generator pipeline (fidelity-by-preservation)
  - [x] 10.1 Implement workbook load and mapped-cell writing across sheets
    - Load the original workbook with ExcelJS (styles/merges intact), resolve each mapping's worksheet by `sheetName` and `cellAddress` (via merge anchor), and write only mapped Test_Session values
    - Skip mappings whose named sheet is absent and record a generation warning
    - _Requirements: 8.1, 8.2, 8.4, 3.3_

  - [x] 10.2 Write property test for mapped cells written across all sheets
    - **Property 13: Mapped cells are written across all sheets**
    - **Validates: Requirements 3.3, 8.2, 8.4**

  - [x] 10.3 Write property test for unmapped cell preservation
    - **Property 6: Unmapped cells are preserved**
    - **Validates: Requirements 3.7**

  - [x] 10.4 Write property test for output structural fidelity
    - **Property 14: Output structural fidelity**
    - **Validates: Requirements 8.3**

  - [x] 10.5 Implement missing-required-field reporting and workbook serialization
    - Collect each `required` mapping with no value into `missingRequiredFields`, leave those cells blank, and serialize to an `.xlsx` Blob
    - _Requirements: 8.5, 8.6, 9.1_

  - [x] 10.6 Write property test for missing required fields reporting
    - **Property 15: Missing required fields are reported and left blank**
    - **Validates: Requirements 8.5**

  - [x] 10.7 Write property test for generated workbook re-parse validity
    - **Property 16: Generated workbook re-parses validly**
    - **Validates: Requirements 8.6**

  - [x] 10.8 Implement suggested filename and report preview
    - Build the deterministic `{customerName}_{testDate}.xlsx` filename and render a preview of populated sheets
    - _Requirements: 9.3, 9.4_

  - [x] 10.9 Write property test for download filename format
    - **Property 17: Download filename format**
    - **Validates: Requirements 9.3**

- [x] 11. Checkpoint - report generation pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement the Mobile_PWA capture UI and R&H_Parameter selection
  - [x] 12.1 Build the Test_Session capture UI with single-tap ratings and autosave
    - Build forms for Tyre_Set, vehicle, conditions, and per-parameter rating/note capture wired to the IndexedDB store
    - Single-tap preset rating controls with ≥44×44 CSS px touch targets, autosave within 2s, unsynced indicator, and optional dictation where supported
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3, 6.4, 10.1, 10.3_

  - [x] 12.2 Implement R&H_Parameter set selection from template mappings
    - Present exactly the parameters defined by the selected template's Field_Mappings when present, else the default set
    - _Requirements: 6.6, 6.7_

  - [x] 12.3 Write property test for R&H_Parameter set selection
    - **Property 10: R&H_Parameter set selection**
    - **Validates: Requirements 6.6, 6.7**

  - [x] 12.4 Write UI and unit tests for capture controls
    - Touch-target measurement ≥44×44 CSS px (5.1), single-tap rating capture (5.2), autosave-within-2s with fake timers (5.3), dictation with mocked Speech API (5.5)
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 13. Implement PWA installability and offline shell
  - [x] 13.1 Add Web App Manifest and Workbox service worker
    - Provide installability to home screen, standalone/full-screen launch, and app-shell precache enabling offline open-and-capture
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 13.2 Write smoke tests for PWA configuration
    - Assert manifest presence / install offer (4.1) and standalone display mode (4.2)
    - _Requirements: 4.1, 4.2_

- [x] 14. Implement the Sync_Engine and conflict resolution
  - [x] 14.1 Implement local-first sync with retry and status tracking
    - Implement `enqueue` (local write first), `syncNow`, connectivity-restore retry, and `status` transitions marking sessions `synced` only after backend confirmation
    - _Requirements: 4.5, 7.1, 7.3, 10.3, 10.4_

  - [x] 14.2 Implement per-field, latest-server-timestamp conflict merge with note preservation
    - Merge two versions per field by latest `fieldTimestamps`, preserving both note texts as distinct entries
    - _Requirements: 7.4_

  - [x] 14.3 Write property test for failed sync retains and retries
    - **Property 11: Failed sync retains and retries**
    - **Validates: Requirements 7.3**

  - [x] 14.4 Write property test for per-field conflict merge
    - **Property 12: Per-field conflict merge**
    - **Validates: Requirements 7.4**

  - [x] 14.5 Write property test for sync-status invariant
    - **Property 18: Sync-status invariant**
    - **Validates: Requirements 10.3, 10.4**

- [x] 15. Implement retention, deletion, and Laptop real-time listeners
  - [x] 15.1 Implement Laptop_Web_App Firestore listeners and Report_Viewer deletion
    - Subscribe to `testSessions` so synchronized sessions appear without reload; implement Report_Viewer-triggered deletion that removes the session from Firestore and propagates removal of local copies
    - _Requirements: 7.2, 10.5, 10.6_

  - [x] 15.2 Write integration tests for sync and deletion flows
    - Emulator tests: offline open-and-capture (4.3), offline-then-restore sync (4.5), 10s propagation (7.1), laptop live update via listener (7.2), delete propagation to local copies (10.6)
    - _Requirements: 4.3, 4.5, 7.1, 7.2, 10.6_

- [x] 16. Wire the Laptop_Web_App review, generation, and export UI
  - [x] 16.1 Build the review + Template_Manager + Mapping_Editor + Report UI
    - Wire Template_Manager (upload/list/inspect/delete) and Mapping_Editor (grid cell selection, conflict warnings) into the laptop UI
    - Wire the Report_Generator to preview and to a download that provides the `.xlsx` file and blocks download with an explicit error on serialization failure
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 3.1, 3.2, 3.5, 3.6, 9.1, 9.2, 9.4_

  - [x] 16.2 Write unit tests for export and preview UI
    - Download blob type (9.1), generation-failure error + blocked download (9.2), preview rendering (9.4)
    - _Requirements: 9.1, 9.2, 9.4_

- [x] 17. Final checkpoint - full system integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but they cover the correctness properties (especially the template-fidelity linchpin properties 6, 13, 14, 16) and the example/integration/smoke/security-rules tests from the design.
- Each task references specific requirement clauses and, where applicable, the exact design property for traceability.
- Property-based tests use fast-check with a minimum of 100 iterations, one PBT per property, each tagged `Feature: rnh-tyre-testing-system, Property {number}: {property_text}`.
- Checkpoints ensure incremental validation at natural layer boundaries (foundation/auth, persistence/engine, report generation, and full integration).
- The Report_Generator interface is isolated so the Excel engine could be swapped (e.g. to SheetJS Pro) without touching capture, sync, or mapping code.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["2.3", "3.1", "5.2", "6.2", "6.3", "7.2", "7.3"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4", "7.4", "8.1", "8.2"] },
    { "id": 5, "tasks": ["8.3", "8.4", "10.1", "12.2", "13.1"] },
    { "id": 6, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.8", "12.1", "13.2"] },
    { "id": 7, "tasks": ["10.6", "10.7", "10.9", "12.3", "12.4", "14.1", "14.2"] },
    { "id": 8, "tasks": ["14.3", "14.4", "14.5", "15.1"] },
    { "id": 9, "tasks": ["15.2", "16.1"] },
    { "id": 10, "tasks": ["16.2"] }
  ]
}
```
