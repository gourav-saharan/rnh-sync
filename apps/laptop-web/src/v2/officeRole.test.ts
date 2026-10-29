// Laptop sections shown per role (R1.5, R1.6).
import { describe, expect, it } from 'vitest';
import { hasOfficeRole, sectionOf, visibleSections } from './officeRole';

describe('visibleSections', () => {
  it('Report_Viewer gets Tests, Analysis, Templates and Trash', () => {
    expect(visibleSections({ roles: ['Report_Viewer'] })).toEqual([
      'tests',
      'analysis',
      'templates',
      'trash',
    ]);
  });

  it('Template_Admin only gets Templates (its home)', () => {
    expect(visibleSections({ roles: ['Template_Admin'] })).toEqual(['templates']);
  });

  it('both office roles get every section once', () => {
    expect(visibleSections({ roles: ['Template_Admin', 'Report_Viewer'] })).toEqual([
      'tests',
      'analysis',
      'templates',
      'trash',
    ]);
  });

  it('Tester-only and no-role accounts get nothing', () => {
    expect(visibleSections({ roles: ['Tester'] })).toEqual([]);
    expect(visibleSections({ roles: [] })).toEqual([]);
    expect(hasOfficeRole({ roles: ['Tester'] })).toBe(false);
  });
});

describe('sectionOf', () => {
  it('maps detail routes to their parent section', () => {
    expect(sectionOf('session')).toBe('tests');
    expect(sectionOf('template')).toBe('templates');
    expect(sectionOf('trash')).toBe('trash');
  });
});
