import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  TEMPLATE_ORIGINAL_FILENAME,
  firestorePaths,
  templateStoragePath,
} from './collections';

describe('Firestore collection layout', () => {
  it('exposes the top-level collection names from design.md', () => {
    expect(COLLECTIONS.users).toBe('users');
    expect(COLLECTIONS.customerTemplates).toBe('customerTemplates');
    expect(COLLECTIONS.testSessions).toBe('testSessions');
    expect(SUBCOLLECTIONS.fieldMappings).toBe('fieldMappings');
  });

  it('builds nested field mapping paths under a template', () => {
    expect(firestorePaths.fieldMappings('t1')).toBe('customerTemplates/t1/fieldMappings');
    expect(firestorePaths.fieldMapping('t1', 'm9')).toBe('customerTemplates/t1/fieldMappings/m9');
  });

  it('builds user, template, and session document paths', () => {
    expect(firestorePaths.user('u1')).toBe('users/u1');
    expect(firestorePaths.customerTemplate('t1')).toBe('customerTemplates/t1');
    expect(firestorePaths.testSession('s1')).toBe('testSessions/s1');
  });
});

describe('Cloud Storage path convention', () => {
  it('places the original workbook at templates/{id}/original.xlsx', () => {
    expect(templateStoragePath('abc123')).toBe('templates/abc123/original.xlsx');
    expect(TEMPLATE_ORIGINAL_FILENAME).toBe('original.xlsx');
  });

  it('always ends with the fixed original filename for any template id', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !s.includes('/')),
        (id) => {
          const path = templateStoragePath(id);
          expect(path.startsWith('templates/')).toBe(true);
          expect(path.endsWith(`/${TEMPLATE_ORIGINAL_FILENAME}`)).toBe(true);
          expect(path).toContain(id);
        },
      ),
      { numRuns: 100 },
    );
  });
});
