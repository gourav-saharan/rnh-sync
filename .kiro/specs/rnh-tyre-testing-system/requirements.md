# Requirements Document (v2)

> v2 replaces `archive/requirements.v1.md`. v1 modelled one rating per parameter per session and only Ride/Handling. Analysis of the real customer workbooks (M&M U171 `R&H` sheet, `R&H_MSIL Format.xlsx`, `Hyundai Format R&H.xlsx`) showed that every report is a **comparison matrix**: parameters down the rows, tyre sets across the columns, and a rating + comment per (parameter, tyre set). v2 is built around that matrix.

## Introduction

The R&H Tyre Testing System supports subjective Ride & Handling (R&H) tyre evaluation. Testers drive a vehicle on a set of tyres (a Reference plus one or more Candidates), subjectively rate each R&H parameter, and write a short comment. Today results are memorised and typed up after the test, so ratings, comments, and tyre details get lost.

The system has two coordinated front ends on one Firebase backend:

- **Mobile_PWA**: an installable, offline-first web app used in the vehicle and at the track. It must feel like a native app and let the tester record a rating in one tap and a comment by voice or quick-pick, with no typing needed.
- **Laptop_Web_App**: used at the office to manage customer templates, review synchronized test data, and download a finished report in the customer's exact Excel format.

There is **no fixed report template**. Each customer (for example MSIL/Maruti, M&M, Renault, TATA, Hyundai) has its own multi-sheet workbook. The system lets a user upload that workbook, describe its parameter list and header fields, and map them to the capture app by selecting table regions, not one cell at a time. The generated report must be the customer's original workbook with only the captured values written in: sheets, merges, styles, and the customer's own formulas (averages, cross-sheet links) stay untouched and recalculate on open.

### Observed template characteristics (drive the requirements)

| Characteristic | M&M U171 `R&H` | MSIL | Hyundai |
|---|---|---|---|
| Sheets | 1 | `Tabelle`, `dryhandling1`, `dryhandling2` | `Tabelle`, `dryhandling1`, `dryhandling2`, `Description` |
| Categories | Ride, Handling, Steering, Noise & Vibration | Ride, Handling, Steering | Ride, Handling, Steering, NVH |
| Parameters | 19 | 14 | 19 (with weights 0.1–0.4) |
| Tyre slots | Reference + MU1–MU7 (8) | 4 per sheet, 8 sets over 2 sheets | 4 per sheet |
| Per-slot cells | Rating + comment, side by side | Rating + comment | Rating + comment |
| Formulas | none | `AVERAGE` per category, total average, links to `Tabelle` | same as MSIL |
| Header data | purpose, vehicle, date, weather, tested by, load, IP Fr/Rr | report nr, date, vehicle, tyre size, sets table (group, make, pattern, SR/LR, week code), track, pressure FA/RA (kPa), rim, equipment, done by | same as MSIL plus air/road temp per set |
| Observed ratings | 5.75–7.25 | 5–6.25 | 5–7 |

## Glossary

- **System**: the Mobile_PWA, the Laptop_Web_App, and the Firebase_Backend together.
- **Mobile_PWA / Laptop_Web_App / Firebase_Backend**: as in the Introduction.
- **Customer_Template**: an uploaded customer `.xlsx` workbook plus its Template_Schema and Mappings. Versioned.
- **Template_Version**: an immutable snapshot of a Customer_Template (workbook bytes, schema, mappings). Test_Sessions pin one version.
- **Template_Schema**: the customer's ordered list of Categories, R&H_Parameters, Header_Fields, rating scale, and tyre slot count.
- **Category**: a group of R&H_Parameters, e.g. Ride, Handling, Steering, Noise & Vibration. Names and order come from the template.
- **R&H_Parameter**: a rated item, e.g. "Smooth Road", "Yaw control", "Squeal noise". Optionally carries a weight and a description.
- **Header_Field**: a single-value report field such as Report Nr., test date, vehicle, weather, tested by, inflation pressure.
- **Tyre_Set**: one set of tyres under evaluation, with its details (label, role, make, pattern, size, SR/LR, week code, DOT, compound, notes).
- **Tyre_Slot**: a column position in a template's rating matrix (slot 1 = first tyre column). Tyre_Sets are assigned to slots.
- **Reference_Set**: the Tyre_Set that candidates are compared against (the "Ref"/"Control"/"CEAT" column).
- **Rating_Matrix**: the grid of Rating_Cells for one Test_Session: R&H_Parameters × Tyre_Sets.
- **Rating_Cell**: the rating and comment for one (R&H_Parameter, Tyre_Set). A rating is either a number on the Rating_Scale or **Unrated**.
- **Rating_Scale**: min, max, and step for ratings (default 1–10, step 0.25) plus the point descriptions (e.g. 7 = satisfactory).
- **Unrated**: a Rating_Cell with no rating yet. Distinct from any numeric value; written as an empty cell.
- **Block_Mapping**: a mapping from a rectangular template region to the Rating_Matrix (parameter rows × tyre slot columns, with rating and comment column offsets).
- **Cell_Mapping**: a mapping from one template cell to one Header_Field or per-Tyre_Set detail.
- **Test_Session**: one evaluation event: header data, Tyre_Sets, Rating_Matrix, overall comments, pinned Template_Version.
- **Template_Manager**: the Laptop_Web_App component that uploads, versions, and defines Customer_Templates.
- **Mapping_Editor**: the Laptop_Web_App component that creates Block_Mappings and Cell_Mappings on a sheet grid.
- **Report_Generator**: the component that fills a Template_Version's workbook with Test_Session data.
- **Sync_Engine**: the component that synchronizes local Mobile_PWA data with the Firebase_Backend.
- **Drive_Mode**: the Mobile_PWA capture screen built for in-vehicle use.
- **Quick_Comment**: a predefined comment phrase (e.g. "ok", "similar to ref", "slightly more") selectable in one tap.
- **Roles**: **Tester** (captures sessions), **Report_Viewer** (reviews, generates, exports), **Template_Admin** (creates and edits Customer_Templates). One user may hold several roles.

## Requirements

### Requirement 1: Authentication and Roles

**User Story:** As an engineer, I want to sign in once and have the roles I need, so that the same person can drive the test and write the report.

#### Acceptance Criteria

1. WHEN a user submits valid credentials, THE System SHALL authenticate the user through the Firebase_Backend and grant access according to the user's roles.
2. IF a user submits invalid credentials, THEN THE System SHALL deny access and display an authentication error message.
3. THE System SHALL allow a user to hold one or more of the roles Tester, Report_Viewer, and Template_Admin.
4. WHERE a user holds the Tester role, THE System SHALL grant access to Test_Session creation and capture on the Mobile_PWA.
5. WHERE a user holds the Report_Viewer role, THE System SHALL grant access to Test_Session review, report generation, and export on the Laptop_Web_App.
6. WHERE a user holds the Template_Admin role, THE System SHALL grant access to Customer_Template creation, editing, and archiving.
7. WHILE a user session is unauthenticated, THE System SHALL restrict access to sign-in functions only.
8. WHEN an authenticated user selects sign-out on the Mobile_PWA while unsynced Test_Session data exists, THE Mobile_PWA SHALL warn the user and require confirmation before signing out.
9. WHILE the Mobile_PWA has no network connectivity, THE Mobile_PWA SHALL keep a previously authenticated user signed in and allow capture.

### Requirement 2: Customer Template Upload and Versioning

**User Story:** As a Template_Admin, I want to upload a customer's Excel workbook and keep versions of it, so that reports always match the format the customer expects, even after the format changes.

#### Acceptance Criteria

1. WHEN a Template_Admin uploads a `.xlsx` file and enters a customer name and template name, THE Template_Manager SHALL store the original file bytes unchanged in the Firebase_Backend and create a draft Customer_Template.
2. IF an uploaded file is not a readable `.xlsx` workbook, is password-protected, or exceeds 10 MB, THEN THE Template_Manager SHALL reject the upload and state the reason.
3. WHEN a workbook is uploaded, THE Template_Manager SHALL display every sheet in its original order with its name, used range, merged ranges, and a rendered grid preview.
4. WHEN a Template_Admin publishes a Customer_Template, THE Template_Manager SHALL create a new immutable Template_Version and make it available to Testers.
5. WHEN a Template_Admin replaces the workbook or edits the schema or mappings of a published Customer_Template, THE Template_Manager SHALL save the change as a new draft without altering existing Template_Versions.
6. THE Template_Manager SHALL list Customer_Templates with customer name, template name, latest published version number, publish date, and number of Test_Sessions using it.
7. WHEN a Template_Admin archives a Customer_Template, THE Template_Manager SHALL hide it from new Test_Session creation while keeping all its Template_Versions available for report generation of existing Test_Sessions.
8. THE Template_Manager SHALL allow a Template_Admin to duplicate an existing Customer_Template as the starting point for a new customer.

### Requirement 3: Template Schema Definition

**User Story:** As a Template_Admin, I want the system to read the parameter list from the customer's sheet and let me correct it, so that the capture app shows exactly the customer's parameters in the customer's order.

#### Acceptance Criteria

1. WHEN a Template_Admin selects the parameter-name column range on a sheet, THE Template_Manager SHALL propose R&H_Parameters from the non-empty cells in that range and propose Categories from the adjacent category-label cells, including merged category labels.
2. THE Template_Manager SHALL skip proposed rows whose cell contains a formula or whose text matches "Average" or "Total Average" (case-insensitive) and list them as excluded rows the Template_Admin can re-include.
3. THE Template_Manager SHALL allow a Template_Admin to rename, reorder, add, remove, and re-categorise Categories and R&H_Parameters before publishing.
4. THE Template_Manager SHALL allow a Template_Admin to set, per R&H_Parameter, an optional short display name for the Mobile_PWA, an optional description, and an optional weight.
5. THE Template_Manager SHALL allow a Template_Admin to set the Rating_Scale per Customer_Template (min, max, step of 0.25 or 0.5, and optional point descriptions) with a default of 1–10, step 0.25.
6. THE Template_Manager SHALL allow a Template_Admin to set the Quick_Comment list per Customer_Template, starting from a default list.
7. THE Template_Manager SHALL allow a Template_Admin to define Header_Fields with a label, type (text, number, date, choice, pressure), unit, required flag, and default value.
8. IF a Template_Admin attempts to publish a Customer_Template with no R&H_Parameters or with duplicate parameter names in one Category, THEN THE Template_Manager SHALL block publishing and identify each problem.

### Requirement 4: Region-Based Field Mapping

**User Story:** As a Template_Admin, I want to map the whole rating table by selecting regions, so that mapping a 19-parameter × 8-tyre sheet takes minutes, not hundreds of clicks.

#### Acceptance Criteria

1. WHEN a Template_Admin selects a rectangular region on a sheet and declares it a rating block, THE Mapping_Editor SHALL create a Block_Mapping defined by the sheet name, the ordered parameter rows, the first tyre-slot column, the column stride between slots, the rating column offset, and the comment column offset.
2. THE Mapping_Editor SHALL bind each row of a Block_Mapping to one R&H_Parameter of the Template_Schema, proposing the binding by matching row text to parameter names and allowing the Template_Admin to correct it.
3. THE Mapping_Editor SHALL support multiple Block_Mappings per Customer_Template, each covering a range of Tyre_Slots, so that slots can continue across sheets (e.g. slots 1–4 on `dryhandling1`, slots 5–8 on `dryhandling2`).
4. THE Mapping_Editor SHALL support Cell_Mappings from one cell to one Header_Field, and per-slot Cell_Mappings from one cell per Tyre_Slot to one Tyre_Set detail (label, make, pattern, SR/LR, week code, DOT, compound, air temperature, road temperature, overall comment).
5. WHEN a mapping is created or changed, THE Mapping_Editor SHALL highlight every target cell on the sheet grid, colour-coded by kind (rating, comment, header, tyre detail).
6. IF a mapping targets a cell that contains a formula, THEN THE Mapping_Editor SHALL block the mapping and show the formula text.
7. IF two mappings target the same (sheet, cell), THEN THE Mapping_Editor SHALL block saving and identify both mappings.
8. IF a mapping targets a non-master cell of a merged range, THEN THE Mapping_Editor SHALL redirect it to the merged range's master cell and inform the Template_Admin.
9. WHEN a Template_Admin selects "Test fill", THE Mapping_Editor SHALL generate a sample report filled with labelled placeholder values (e.g. `R:Smooth Road/S1`) and offer it for download.
10. THE Mapping_Editor SHALL show a coverage summary: for each R&H_Parameter and Tyre_Slot whether its rating and comment cells are mapped, and each Header_Field's mapping status.

### Requirement 5: Test Session Setup

**User Story:** As a Tester, I want to set up a test in under a minute before I start driving, so that all tyre and vehicle details are recorded while I have them in front of me.

#### Acceptance Criteria

1. WHEN a Tester creates a Test_Session, THE Mobile_PWA SHALL require selecting a published Customer_Template and SHALL pin the session to its latest Template_Version.
2. THE Mobile_PWA SHALL present setup as short steps (template, header fields, tyre sets, review) with progress shown and back/next navigation.
3. THE Mobile_PWA SHALL render each Header_Field with an input suited to its type (numeric keypad for numbers and pressures, date picker for dates, chips for choices).
4. THE Mobile_PWA SHALL prefill Header_Fields from the Tester's previous Test_Session on the same Customer_Template and from defaults (test date = today, tested by = signed-in user's display name).
5. THE Mobile_PWA SHALL allow adding Tyre_Sets up to the template's Tyre_Slot count, each with a label (e.g. "Ref", "MU1", "Set A"), with exactly one marked as Reference_Set.
6. THE Mobile_PWA SHALL suggest previously entered tyre make, pattern, and size values, and allow copying details from the previous Tyre_Set.
7. THE Mobile_PWA SHALL allow reordering Tyre_Sets, which sets their Tyre_Slot assignment in the report.
8. WHERE the device has a camera, THE Mobile_PWA SHALL allow attaching a photo to a Tyre_Set (e.g. sidewall/DOT).
9. THE Mobile_PWA SHALL allow starting Drive_Mode with required Header_Fields missing and SHALL list those fields on the session summary until completed.

### Requirement 6: Drive_Mode Rating Capture

**User Story:** As a Tester in a moving vehicle, I want to record a rating in one tap and a comment without typing, so that I capture accurate results with minimal distraction.

#### Acceptance Criteria

1. THE Mobile_PWA SHALL present Drive_Mode as one R&H_Parameter per screen for the active Tyre_Set, showing the Category, the parameter's short display name, the Tyre_Set label, and position (e.g. "7 / 19").
2. THE Mobile_PWA SHALL display a rating pad of at most 9 large preset buttons centred on an anchor value (default: the Reference_Set's rating for that parameter, else the scale midpoint), plus −step and +step buttons to shift the window across the full Rating_Scale.
3. THE Mobile_PWA SHALL render each rating button with a touch target of at least 64 × 64 CSS pixels and each other Drive_Mode control with at least 48 × 48 CSS pixels.
4. WHEN a Tester taps a rating button, THE Mobile_PWA SHALL record the rating, give haptic feedback where supported, and persist it locally before showing the saved state.
5. WHEN a Tester taps a rating button, THE Mobile_PWA SHALL advance to the next R&H_Parameter after a configurable delay (default 600 ms, can be disabled), during which a second tap on a different value replaces the rating.
6. THE Mobile_PWA SHALL let the Tester add a comment by tapping one or more Quick_Comments, by voice dictation where available, or by typing, and SHALL keep existing comment text when appending.
7. THE Mobile_PWA SHALL let the Tester clear a rating back to Unrated.
8. THE Mobile_PWA SHALL show, for the current parameter, the ratings already recorded for the other Tyre_Sets.
9. THE Mobile_PWA SHALL let the Tester switch capture order between "by tyre" (all parameters for one Tyre_Set, then the next) and "by parameter" (one parameter across all Tyre_Sets).
10. THE Mobile_PWA SHALL let the Tester jump to any parameter or Tyre_Set from an overview grid that marks each Rating_Cell as rated, unrated, or commented.
11. THE Mobile_PWA SHALL keep the screen awake during Drive_Mode where the Screen Wake Lock API is supported.
12. THE Mobile_PWA SHALL provide a high-contrast theme readable in direct sunlight and a dark theme for low light, switchable in one tap.
13. WHEN a Tester undoes the last action, THE Mobile_PWA SHALL restore the previous rating and comment of the affected Rating_Cell.

### Requirement 7: Rating Validity and Averages

**User Story:** As a Tester and Report_Viewer, I want ratings to be valid and blank cells to stay blank, so that averages in the report are correct.

#### Acceptance Criteria

1. THE System SHALL accept a rating only if it lies within the Rating_Scale min and max and is a multiple of the scale step from min.
2. THE System SHALL represent a Rating_Cell without a rating as Unrated and SHALL never substitute a numeric default.
3. THE System SHALL compute each Category average per Tyre_Set as the arithmetic mean of that Tyre_Set's rated parameters in the Category, excluding Unrated cells, and SHALL report the average as undefined when no parameter is rated.
4. WHERE R&H_Parameters carry weights, THE System SHALL also compute a weighted Category average using only rated parameters, with weights renormalised over them.
5. THE System SHALL display each Tyre_Set's difference from the Reference_Set per parameter and per Category average in the Mobile_PWA summary and the Laptop_Web_App review.
6. THE System SHALL NOT write computed averages into cells where the Customer_Template has its own formulas.

### Requirement 8: Offline-First Reliability

**User Story:** As a Tester, I want confidence that nothing I record is ever lost, so that I no longer need to memorise results.

#### Acceptance Criteria

1. WHEN a Tester records any value, THE Mobile_PWA SHALL persist it to local device storage within 500 ms and before showing a saved state.
2. IF the Mobile_PWA closes unexpectedly, THEN THE Mobile_PWA SHALL restore all persisted data and reopen the in-progress Test_Session at the last active parameter and Tyre_Set.
3. WHILE the device has no network connectivity, THE Mobile_PWA SHALL allow the Tester to launch the app, create Test_Sessions on cached Template_Versions, and capture all data.
4. THE Mobile_PWA SHALL cache every published Template_Version the Tester has access to for offline use.
5. THE Mobile_PWA SHALL request persistent storage from the browser where supported and SHALL warn the Tester when it is not granted.
6. THE Mobile_PWA SHALL show per Test_Session a sync state of "saved on phone", "syncing", "synced", or "sync error".
7. WHEN the Mobile_PWA is installed, THE Mobile_PWA SHALL launch in standalone mode without browser chrome and SHALL offer installation from a supported browser.

### Requirement 9: Synchronization Between Mobile and Laptop

**User Story:** As a Tester, I want my captured data to appear on the laptop automatically, so that the report is ready when I return to the office.

#### Acceptance Criteria

1. WHILE the Mobile_PWA has network connectivity, THE Sync_Engine SHALL push each locally saved change to the Firebase_Backend within 10 seconds.
2. IF a push fails, THEN THE Sync_Engine SHALL keep the local data and retry with backoff until it succeeds, without blocking capture.
3. WHEN a Test_Session changes in the Firebase_Backend, THE Laptop_Web_App SHALL display the change without a manual reload.
4. WHEN the same Test_Session is edited on two devices, THE Sync_Engine SHALL merge per Rating_Cell and per Header_Field, keeping the value with the latest server-received timestamp for ratings and fields, and SHALL keep both texts for conflicting comments.
5. THE Sync_Engine SHALL store the Rating_Matrix so that a single Rating_Cell change does not overwrite other Rating_Cells.

### Requirement 10: Laptop Review and Correction

**User Story:** As a Report_Viewer, I want to review and correct a test at my desk, so that the report is accurate before it goes to the customer.

#### Acceptance Criteria

1. THE Laptop_Web_App SHALL list Test_Sessions with customer, template, test date, vehicle, tester, Tyre_Set count, completeness percentage, sync state, and status (in progress, ready, reported), filterable by each column and searchable by text.
2. WHEN a Report_Viewer opens a Test_Session, THE Laptop_Web_App SHALL display the Rating_Matrix as a table with R&H_Parameters as rows grouped by Category and Tyre_Sets as columns, showing rating, comment, Category averages, and difference from the Reference_Set.
3. THE Laptop_Web_App SHALL allow a Report_Viewer to edit any rating, comment, Header_Field, and Tyre_Set detail in place with keyboard navigation (arrow keys, Tab, Enter), applying the same validation as the Mobile_PWA.
4. THE Laptop_Web_App SHALL record, for each edit, the user and time, and SHALL show the change history per Rating_Cell.
5. THE Laptop_Web_App SHALL highlight Unrated Rating_Cells, missing required Header_Fields, and Tyre_Sets without a Tyre_Slot mapping.
6. WHEN a Report_Viewer marks a Test_Session as ready, THE System SHALL show a warning for Unrated Rating_Cells and missing required Header_Fields and require confirmation.

### Requirement 11: Report Generation in the Customer Format

**User Story:** As a Report_Viewer, I want the downloaded report to be the customer's own workbook with our results in it, so that it can be sent without manual editing.

#### Acceptance Criteria

1. WHEN a Report_Viewer generates a report, THE Report_Generator SHALL load the original workbook bytes of the Test_Session's pinned Template_Version and write each mapped value into its mapped cell.
2. THE Report_Generator SHALL write numeric ratings as numbers, Unrated cells as empty cells, dates as Excel dates, and text as text.
3. THE Report_Generator SHALL preserve all sheets, sheet order and names, merged ranges, cell styles, column widths, row heights, print settings, and every unmapped cell's content.
4. THE Report_Generator SHALL preserve every template formula and SHALL set the workbook to recalculate on open, so that customer `AVERAGE` and cross-sheet formulas show the new values.
5. WHEN a Test_Session has more Tyre_Sets than mapped Tyre_Slots, THE Report_Generator SHALL block generation and list the unmapped Tyre_Sets.
6. WHEN a Test_Session has fewer Tyre_Sets than Tyre_Slots, THE Report_Generator SHALL leave unused slot cells with their original template content.
7. THE Report_Generator SHALL list each missing required value before generation and allow generation to continue with those cells left blank.
8. THE Report_Generator SHALL produce a workbook that opens in Microsoft Excel without repair prompts.

### Requirement 12: Report Preview and Download

**User Story:** As a Report_Viewer, I want to see the report before downloading it, so that I can catch mistakes early.

#### Acceptance Criteria

1. WHEN a report is generated, THE Laptop_Web_App SHALL display a preview of each sheet rendered as a grid close to the Excel layout, with written cells highlighted.
2. WHEN a Report_Viewer selects download, THE Laptop_Web_App SHALL provide the report as a `.xlsx` file.
3. IF report generation fails, THEN THE Laptop_Web_App SHALL show an explicit error and SHALL NOT offer a partial file.
4. THE Laptop_Web_App SHALL name the file by a per-template pattern, default `{customer}_{vehicle}_{tyreSize}_{testDate} - R&H.xlsx`, with characters invalid in file names replaced.
5. WHEN a report is downloaded, THE System SHALL record the generation time, user, and Template_Version on the Test_Session and set its status to reported.

### Requirement 13: Data Retention, Deletion, and Audit

**User Story:** As a Report_Viewer, I want test data kept safely and removed only on purpose, so that past reports can always be regenerated.

#### Acceptance Criteria

1. THE System SHALL retain each synchronized Test_Session and its pinned Template_Version until a Report_Viewer deletes the Test_Session.
2. WHEN a Report_Viewer deletes a Test_Session, THE System SHALL require typed confirmation, move it to a trash retained for 30 days, and allow restoring it within that period.
3. WHEN a Test_Session is deleted, THE System SHALL remove its local copies from every Mobile_PWA device on next sync, except for unsynced local edits, which the Mobile_PWA SHALL keep and flag to the Tester.
4. THE System SHALL allow a Report_Viewer to export any Test_Session as JSON for backup.
5. THE System SHALL record the creator, creation time, last editor, and last edit time on every Test_Session and Customer_Template.

### Requirement 14: Security and Access Enforcement

**User Story:** As the team lead, I want access rules enforced by the backend, so that test data and customer templates are protected even if a client is modified.

#### Acceptance Criteria

1. THE Firebase_Backend SHALL enforce all role checks in Firestore and Storage security rules, independent of the client UI.
2. THE Firebase_Backend SHALL allow a Tester to create Test_Sessions and to edit only Test_Sessions the Tester created or is assigned to.
3. THE Firebase_Backend SHALL allow only Template_Admins to create, edit, publish, and archive Customer_Templates, and SHALL make published Template_Versions read-only for everyone.
4. THE Firebase_Backend SHALL prevent any user from changing their own roles.
5. THE Firebase_Backend SHALL deny all access to unauthenticated requests.

### Requirement 15: Usability and Performance

**User Story:** As a Tester and Report_Viewer, I want the apps to be fast and clear, so that they help rather than slow down professional testing.

#### Acceptance Criteria

1. THE Mobile_PWA SHALL respond to a rating tap with visible feedback within 100 ms on a mid-range Android phone.
2. THE Mobile_PWA SHALL open the in-progress Test_Session within 2 seconds of launch, online or offline.
3. THE Mobile_PWA SHALL support portrait and landscape orientation and screen widths from 360 CSS px, with Drive_Mode usable one-handed in portrait.
4. THE System SHALL meet WCAG 2.1 AA colour contrast for text and controls in all themes and SHALL NOT rely on colour alone to show state.
5. THE Laptop_Web_App SHALL generate a report for a 3-sheet template with 8 Tyre_Sets and 20 parameters within 5 seconds.
6. THE System SHALL show every error as a plain-language message that states what happened and what the user can do.

