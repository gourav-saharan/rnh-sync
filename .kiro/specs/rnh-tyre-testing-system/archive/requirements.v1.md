# Requirements Document

## Introduction

The R&H Tyre Testing System supports subjective ride & handling (R&H) tyre evaluation. Today, testers drive vehicles and subjectively rate how a tyre feels for ride and handling, then must memorize the results and write reports after the test. This causes forgotten details (both ratings and tyre details) and is error-prone.

The system consists of two coordinated experiences backed by Firebase:

- A **Mobile PWA** (installable, offline-capable web app that behaves like a native app) used during and after driving to capture test input in real time with minimal taps.
- A **Laptop Web App** used at the office to generate finished reports in the required customer-specific Excel format, ready to view and export.

The core value: a tester enters input on the Mobile PWA while or after driving, the data syncs to Firebase, and by the time the tester returns to the office and opens the Laptop Web App, the report is already prepared in the required customer Excel format.

There is **no fixed report template**. Different customers (for example Maruti/MSIL, Renault, TATA, Hyundai) use different Excel templates, and templates may contain multiple sheets (for example MU1-MU7, dryhandling1, dryhandling2, Description). The system must let users upload an Excel template per customer, create new templates inside the application, and map each template's input fields to the Mobile PWA input fields. Generated report output must faithfully match the customer's Excel template, including multi-sheet structure.

## Glossary

- **System**: The complete R&H Tyre Testing System, including the Mobile PWA, the Laptop Web App, and the Firebase backend.
- **Mobile_PWA**: The installable, offline-capable web application used on a mobile device to capture test input during and after driving.
- **Laptop_Web_App**: The web application used on a laptop at the office to review test data, generate reports, and export them.
- **Firebase_Backend**: The Firebase services used for authentication, data storage, file storage, and real-time synchronization.
- **Auth_Service**: The Firebase-based authentication component that manages sign-in and roles.
- **Template_Manager**: The component that stores, uploads, and manages customer Excel templates.
- **Mapping_Editor**: The component that maps customer template cells and columns to Mobile_PWA input fields.
- **Report_Generator**: The component that produces a completed Excel report from Test_Session data using a Customer_Template.
- **Sync_Engine**: The component that synchronizes locally captured data to the Firebase_Backend and back.
- **Customer_Template**: An uploaded Excel workbook (one or more sheets) that defines a customer's required report format (for example Maruti/MSIL, Renault, TATA, Hyundai).
- **Field_Mapping**: The stored association between a Customer_Template cell or column and a Mobile_PWA input field.
- **Test_Session**: A single R&H evaluation capturing tyre details, vehicle, test conditions, R&H subjective ratings, and notes.
- **R&H_Parameter**: A subjective evaluation item that receives a rating (for example Smooth Road, Speed Breaker, Rough Road, Damping, Rear Tracking, Roll Level & Damping).
- **Rating**: A numeric subjective score assigned to an R&H_Parameter (for example 5.5, 6, 6.25).
- **Tyre_Set**: A group of tyre details evaluated within a Test_Session (for example Tyre Make, Pattern, SR/LR, Week code, DOT).
- **Tester**: A user role that captures Test_Session data on the Mobile_PWA.
- **Report_Viewer**: A user role that reviews and exports generated reports on the Laptop_Web_App.
- **Offline_Mode**: The state in which the Mobile_PWA operates without network connectivity and stores data locally.

## Requirements

### Requirement 1: Authentication and Roles

**User Story:** As a tester, I want to sign in securely and have a defined role, so that only authorized people can capture test data and view reports.

#### Acceptance Criteria

1. WHEN a user submits valid credentials, THE Auth_Service SHALL authenticate the user through the Firebase_Backend and grant access.
2. IF a user submits invalid credentials, THEN THE Auth_Service SHALL deny access and display an authentication error message.
3. THE Auth_Service SHALL assign each authenticated user exactly one role of Tester or Report_Viewer.
4. WHERE a user holds the Tester role, THE System SHALL grant access to Test_Session capture on the Mobile_PWA.
5. WHERE a user holds the Report_Viewer role, THE System SHALL grant access to report generation and export on the Laptop_Web_App.
6. WHILE a user session is unauthenticated, THE System SHALL restrict access to sign-in functions only.
7. WHEN an authenticated user selects sign-out, THE Auth_Service SHALL end the session and return the user to the sign-in screen.

### Requirement 2: Customer Excel Template Upload

**User Story:** As a Report_Viewer, I want to upload a customer's Excel report template, so that reports are produced in that customer's required format.

#### Acceptance Criteria

1. WHEN a user uploads an Excel file (.xlsx) as a Customer_Template, THE Template_Manager SHALL store the file in the Firebase_Backend and associate it with a named customer.
2. WHEN a Customer_Template contains multiple sheets, THE Template_Manager SHALL preserve all sheets and their sheet names.
3. IF an uploaded file is not a valid .xlsx workbook, THEN THE Template_Manager SHALL reject the upload and display a descriptive error message.
4. THE Template_Manager SHALL list all stored Customer_Templates with their customer name and upload date.
5. WHEN a user selects a stored Customer_Template, THE Template_Manager SHALL display each sheet name and its cell dimensions.
6. WHEN a user deletes a Customer_Template, THE Template_Manager SHALL remove the template from the Firebase_Backend after the user confirms the deletion.

### Requirement 3: In-App Template Creation and Field Mapping

**User Story:** As a Report_Viewer, I want to create a new template in the application by uploading an Excel file and mapping its input fields to the Mobile_PWA fields, so that any customer format can be supported without code changes.

#### Acceptance Criteria

1. WHEN a user starts creation of a new Customer_Template, THE Mapping_Editor SHALL accept an uploaded Excel file and present its sheets, cells, and columns for mapping.
2. WHEN a user selects a template cell or column and a Mobile_PWA input field, THE Mapping_Editor SHALL create a Field_Mapping between them.
3. THE Mapping_Editor SHALL support Field_Mappings that target cells located on any sheet of a multi-sheet Customer_Template.
4. WHEN a user saves a set of Field_Mappings, THE Mapping_Editor SHALL store the Field_Mappings in the Firebase_Backend associated with the Customer_Template.
5. IF a user maps two distinct Mobile_PWA input fields to the same template cell, THEN THE Mapping_Editor SHALL display a conflict warning, withhold only the conflicting Field_Mapping, and save the remaining non-conflicting Field_Mappings.
6. WHEN a user opens an existing Customer_Template for editing, THE Mapping_Editor SHALL display the previously saved Field_Mappings.
7. WHERE a template cell has no Field_Mapping, THE Report_Generator SHALL leave that cell's original template content unchanged in the generated report.

### Requirement 4: Mobile PWA Installation and Offline Capability

**User Story:** As a tester, I want to install the app on my phone and use it without a network connection, so that I can capture input while driving in areas with poor connectivity.

#### Acceptance Criteria

1. WHEN a user opens the Mobile_PWA in a supported browser, THE Mobile_PWA SHALL offer installation to the device home screen.
2. WHEN the Mobile_PWA is installed, THE Mobile_PWA SHALL launch in a standalone, full-screen mode without browser navigation chrome.
3. WHILE the device has no network connectivity, THE Mobile_PWA SHALL allow the Tester to open the app and capture Test_Session data.
4. WHILE in Offline_Mode, THE Mobile_PWA SHALL store all captured Test_Session data in local device storage.
5. WHEN network connectivity is restored, THE Sync_Engine SHALL synchronize locally stored Test_Session data to the Firebase_Backend.

### Requirement 5: Smooth Driving-Time Input Capture

**User Story:** As a tester, I want to enter ratings and notes with minimal effort during driving, so that I capture accurate results without being distracted.

#### Acceptance Criteria

1. THE Mobile_PWA SHALL display each R&H_Parameter with a touch target of at least 44 by 44 CSS pixels.
2. WHEN a Tester assigns a Rating to an R&H_Parameter, THE Mobile_PWA SHALL record the Rating in a single tap on a preset value.
3. WHEN a Tester changes any Test_Session value, THE Mobile_PWA SHALL autosave the change to local device storage within 2 seconds.
4. THE Mobile_PWA SHALL accept Rating values in increments of 0.25 within a configured numeric range for each R&H_Parameter.
5. WHERE voice or dictated text entry is available on the device, THE Mobile_PWA SHALL allow the Tester to enter note text by dictation.
6. WHEN a Tester reopens the Mobile_PWA after closing it, THE Mobile_PWA SHALL restore the most recent in-progress Test_Session with all previously entered values.

### Requirement 6: Test Session Data Model

**User Story:** As a tester, I want to capture all relevant test details in one session, so that the report contains complete tyre, vehicle, condition, and rating information.

#### Acceptance Criteria

1. THE Mobile_PWA SHALL capture Tyre_Set details including Tyre Make, Pattern, SR or LR, Week code, and DOT for each Tyre_Set in a Test_Session.
2. THE Mobile_PWA SHALL capture vehicle details including test vehicle identifier, tyre size, rim size, front axle pressure, and rear axle pressure.
3. THE Mobile_PWA SHALL capture test condition details including test track, driver name, load of car, air temperature, road temperature, and test date.
4. THE Mobile_PWA SHALL capture a Rating and an associated note for each R&H_Parameter under the Ride and Handling categories.
5. THE Mobile_PWA SHALL derive a category average Rating from the individual R&H_Parameter Ratings within each category.
6. WHERE a Customer_Template defines R&H_Parameters through Field_Mappings, THE Mobile_PWA SHALL present exactly those R&H_Parameters for the selected Customer_Template.
7. WHERE a Customer_Template does not define R&H_Parameters through Field_Mappings, THE Mobile_PWA SHALL present a default set of R&H_Parameters.

### Requirement 7: Real-Time Sync from Mobile to Laptop

**User Story:** As a tester, I want my captured data to appear on the laptop automatically, so that the report is ready when I return to the office.

#### Acceptance Criteria

1. WHILE the Mobile_PWA has network connectivity, THE Sync_Engine SHALL synchronize each saved Test_Session change to the Firebase_Backend within 10 seconds.
2. WHEN a Test_Session is synchronized to the Firebase_Backend, THE Laptop_Web_App SHALL display the updated Test_Session without requiring a manual page reload.
3. IF a synchronization attempt fails, THEN THE Sync_Engine SHALL retain the local data and retry synchronization when connectivity is available.
4. WHEN the same Test_Session is edited on two devices, THE Sync_Engine SHALL resolve the conflict by keeping the change with the latest Firebase_Backend server-received timestamp per field and preserving both note texts.

### Requirement 8: Report Generation Matching the Customer Template

**User Story:** As a Report_Viewer, I want to generate a report that faithfully matches the customer's Excel template, so that the output is delivered in exactly the required format.

#### Acceptance Criteria

1. WHEN a Report_Viewer generates a report for a Test_Session, THE Report_Generator SHALL produce an Excel workbook based on the associated Customer_Template.
2. THE Report_Generator SHALL write each Test_Session value into the template cell defined by its Field_Mapping.
3. THE Report_Generator SHALL preserve the Customer_Template's sheets, sheet names, sheet order, merged cells, and cell formatting in the generated report.
4. WHEN a Customer_Template contains multiple sheets, THE Report_Generator SHALL populate mapped cells across all sheets of the generated report.
5. IF a Test_Session is missing a value for a mapped required field, THEN THE Report_Generator SHALL list each missing field and produce the report with those cells left blank.
6. WHEN a report is generated, THE Report_Generator SHALL produce an output workbook that opens without repair prompts in Microsoft Excel.

### Requirement 9: Report Export and Download

**User Story:** As a Report_Viewer, I want to download the generated report, so that I can share it with the customer.

#### Acceptance Criteria

1. WHEN a Report_Viewer selects download for a generated report, THE Laptop_Web_App SHALL provide the report as an .xlsx file.
2. IF .xlsx file generation fails after download is selected, THEN THE Laptop_Web_App SHALL display an explicit error message and block the download.
3. THE Laptop_Web_App SHALL name the downloaded file using the customer name and the Test_Session test date.
4. WHEN a generated report is available, THE Laptop_Web_App SHALL display a preview of the report contents before download.

### Requirement 10: Reliability and Data Retention

**User Story:** As a tester, I want confidence that captured data is never lost, so that I no longer have to memorize or reconstruct results.

#### Acceptance Criteria

1. WHEN a Tester enters a Test_Session value, THE Mobile_PWA SHALL persist the value to local device storage before displaying a saved confirmation.
2. IF the Mobile_PWA closes unexpectedly, THEN THE Mobile_PWA SHALL retain all locally persisted Test_Session data for restoration on next launch.
3. WHILE Test_Session data exists locally and is not yet confirmed as synchronized, THE Mobile_PWA SHALL display an unsynced indicator for that Test_Session.
4. WHEN Test_Session data is confirmed as stored in the Firebase_Backend, THE Sync_Engine SHALL mark the Test_Session as synchronized.
5. THE System SHALL retain each synchronized Test_Session in the Firebase_Backend until a user with the Report_Viewer role explicitly deletes the Test_Session.
6. WHEN a Report_Viewer deletes a synchronized Test_Session, THE System SHALL remove the Test_Session from the Firebase_Backend and propagate the deletion to remove locally persisted copies on all devices.
