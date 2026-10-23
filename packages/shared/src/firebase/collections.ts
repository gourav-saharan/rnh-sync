// Firestore collection layout and Cloud Storage path conventions.
//
// Centralizing these names means every module (data access, security-rules
// tests, report generation) refers to the same strings, so a rename never
// drifts between callers. Mirrors the "Data Models -> Firestore Collections"
// section of design.md.

/** Top-level Firestore collection names. */
export const COLLECTIONS = {
  /** `users/{uid}` — one document per authenticated user, holds the role. */
  users: 'users',
  /** `customerTemplates/{templateId}` — uploaded Customer_Template metadata. */
  customerTemplates: 'customerTemplates',
  /** `testSessions/{sessionId}` — synchronized Test_Session documents. */
  testSessions: 'testSessions',
} as const;

/** Subcollection names nested under a parent document. */
export const SUBCOLLECTIONS = {
  /**
   * `customerTemplates/{templateId}/fieldMappings/{mappingId}` — the
   * Field_Mappings that bind template cells to Mobile_PWA input fields.
   */
  fieldMappings: 'fieldMappings',
} as const;

/** Firestore path builders. Each returns a slash-delimited document/collection path. */
export const firestorePaths = {
  /** Path to a single user document. */
  user(uid: string): string {
    return `${COLLECTIONS.users}/${uid}`;
  },
  /** Path to the customer templates collection. */
  customerTemplates(): string {
    return COLLECTIONS.customerTemplates;
  },
  /** Path to a single customer template document. */
  customerTemplate(templateId: string): string {
    return `${COLLECTIONS.customerTemplates}/${templateId}`;
  },
  /** Path to a template's fieldMappings subcollection. */
  fieldMappings(templateId: string): string {
    return `${COLLECTIONS.customerTemplates}/${templateId}/${SUBCOLLECTIONS.fieldMappings}`;
  },
  /** Path to a single field mapping document. */
  fieldMapping(templateId: string, mappingId: string): string {
    return `${COLLECTIONS.customerTemplates}/${templateId}/${SUBCOLLECTIONS.fieldMappings}/${mappingId}`;
  },
  /** Path to the test sessions collection. */
  testSessions(): string {
    return COLLECTIONS.testSessions;
  },
  /** Path to a single test session document. */
  testSession(sessionId: string): string {
    return `${COLLECTIONS.testSessions}/${sessionId}`;
  },
} as const;

/**
 * Cloud Storage path convention for the raw uploaded workbook blob.
 * Design.md fixes this at `templates/{templateId}/original.xlsx`.
 */
export function templateStoragePath(templateId: string): string {
  return `templates/${templateId}/original.xlsx`;
}

/** Fixed file name for a stored original template workbook. */
export const TEMPLATE_ORIGINAL_FILENAME = 'original.xlsx';
