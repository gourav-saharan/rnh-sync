import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute, type LaptopRoute } from './hashRoute';

describe('laptop hash routes', () => {
  it('round-trips every route', () => {
    const routes: LaptopRoute[] = [
      { name: 'tests' },
      { name: 'session', sessionId: 's_abc123' },
      { name: 'analysis' },
      { name: 'templates' },
      { name: 'template', templateId: 'tpl_x9' },
      { name: 'trash' },
    ];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });

  it('rejects unknown or unsafe hashes', () => {
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#/nope')).toBeNull();
    expect(parseRoute('#/tests/a/b/c')).toEqual({ name: 'session', sessionId: 'a' });
    expect(parseRoute('#/tests/<script>')).toBeNull();
    expect(parseRoute('#/trash/extra')).toBeNull();
  });
});
