import { describe, expect, it } from 'vitest';
import { inDateRange } from './Dashboard';

describe('inDateRange', () => {
  it('passes everything when no bounds are set', () => {
    expect(inDateRange('2026-09-30', '', '')).toBe(true);
    expect(inDateRange('30/9/26', '', '')).toBe(true);
  });

  it('is inclusive on both ends', () => {
    expect(inDateRange('2026-09-01', '2026-09-01', '2026-09-30')).toBe(true);
    expect(inDateRange('2026-09-30', '2026-09-01', '2026-09-30')).toBe(true);
    expect(inDateRange('2026-08-31', '2026-09-01', '')).toBe(false);
    expect(inDateRange('2026-10-01', '', '2026-09-30')).toBe(false);
  });

  it('excludes non-ISO dates once a bound is set', () => {
    expect(inDateRange('30/9/26', '2026-09-01', '')).toBe(false);
  });
});
