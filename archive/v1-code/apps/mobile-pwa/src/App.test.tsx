import { describe, expect, it } from 'vitest';
import { ROLES } from '@rnh/shared';

describe('mobile-pwa consumes shared package', () => {
  it('reads the shared roles constant', () => {
    expect(ROLES).toContain('Tester');
    expect(ROLES).toContain('Report_Viewer');
  });
});
