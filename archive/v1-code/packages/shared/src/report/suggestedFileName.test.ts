import { describe, expect, it } from 'vitest';
import { REPORT_FILE_EXTENSION, suggestedFileName } from './suggestedFileName';

describe('suggestedFileName (R9.3)', () => {
  it('builds <customerName>_<testDate>.xlsx from clean inputs', () => {
    expect(suggestedFileName({ customerName: 'Hyundai', testDate: '2026-09-15' })).toBe(
      'Hyundai_2026-09-15.xlsx',
    );
  });

  it('always ends in .xlsx', () => {
    const name = suggestedFileName({ customerName: 'MSIL', testDate: '2026-01-01' });
    expect(name.endsWith(REPORT_FILE_EXTENSION)).toBe(true);
  });

  it('replaces filesystem-illegal characters with underscores', () => {
    // < > : " / \ | ? * are illegal on Windows.
    const name = suggestedFileName({
      customerName: 'A/C: "Big"\\Co?*',
      testDate: '2026<>09',
    });
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name.endsWith('.xlsx')).toBe(true);
  });

  it('collapses whitespace runs to a single underscore', () => {
    expect(
      suggestedFileName({ customerName: 'Big   Motors  Ltd', testDate: '2026 09 15' }),
    ).toBe('Big_Motors_Ltd_2026_09_15.xlsx');
  });

  it('trims surrounding whitespace and separator noise', () => {
    expect(suggestedFileName({ customerName: '  .Hyundai. ', testDate: ' 2026-09-15 ' })).toBe(
      'Hyundai_2026-09-15.xlsx',
    );
  });

  it('substitutes a fallback when a part sanitizes to nothing', () => {
    expect(suggestedFileName({ customerName: '', testDate: '2026-09-15' })).toBe(
      'report_2026-09-15.xlsx',
    );
    expect(suggestedFileName({ customerName: '***', testDate: '///' })).toBe(
      'report_report.xlsx',
    );
  });

  it('is deterministic for identical inputs', () => {
    const input = { customerName: 'Renault', testDate: '2026-03-04' };
    expect(suggestedFileName(input)).toBe(suggestedFileName(input));
  });
});
