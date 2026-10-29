import { describe, expect, it } from 'vitest';
import { parentOf, transitionFor } from './mobileNav';

describe('transitionFor (screen animations)', () => {
  it('does not animate the first screen or a same-screen update', () => {
    expect(transitionFor(null, { name: 'home' })).toBe('none');
    expect(transitionFor({ name: 'home' }, { name: 'home' })).toBe('none');
  });

  it('pushes deeper screens and pops shallower ones', () => {
    expect(transitionFor({ name: 'home' }, { name: 'setup', sessionId: 's' })).toBe('forward');
    expect(transitionFor({ name: 'drive', sessionId: 's' }, { name: 'overview', sessionId: 's' })).toBe(
      'forward',
    );
    expect(transitionFor({ name: 'drive', sessionId: 's' }, { name: 'summary', sessionId: 's' })).toBe(
      'back',
    );
  });

  it('fades between tabs at the same level', () => {
    expect(transitionFor({ name: 'home' }, { name: 'settings' })).toBe('fade');
  });
});

describe('parentOf (hardware Back)', () => {
  it('leaves the app only from Home', () => {
    expect(parentOf({ name: 'home' })).toBeNull();
  });

  it('returns to Home from top-level screens', () => {
    expect(parentOf({ name: 'settings' })).toEqual({ name: 'home' });
    expect(parentOf({ name: 'setup', sessionId: 's1' })).toEqual({ name: 'home' });
    expect(parentOf({ name: 'summary', sessionId: 's1' })).toEqual({ name: 'home' });
  });

  it('steps back through a test', () => {
    expect(parentOf({ name: 'overview', sessionId: 's1' })).toEqual({
      name: 'drive',
      sessionId: 's1',
    });
    expect(parentOf({ name: 'drive', sessionId: 's1' })).toEqual({
      name: 'summary',
      sessionId: 's1',
    });
  });
});
