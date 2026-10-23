// AuthGateV2: office-only accounts get a "Turn on testing" path instead of a
// dead end, and a profile read failure offers Try again (not "no access").
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AuthServiceV2, AuthStateV2 } from '@rnh/shared/v2data';
import { withTester } from '@rnh/shared/v2data';
import { AuthGateV2 } from './AuthGateV2';

function fakeAuth(state: AuthStateV2, over: Partial<AuthServiceV2> = {}): AuthServiceV2 {
  return {
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    subscribe: (cb) => {
      cb(state);
      return () => {};
    },
    refresh: vi.fn(),
    enableTester: vi.fn(async () => {}),
    ...over,
  };
}

const office: AuthStateV2 = {
  state: 'authorized',
  user: {
    uid: 'u1',
    email: 'office@example.com',
    displayName: 'Office',
    roles: ['Report_Viewer', 'Template_Admin'],
  },
};

describe('AuthGateV2', () => {
  it('offers to turn on testing for an office-only account', async () => {
    const auth = fakeAuth(office);
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    expect(
      screen.getByRole('heading', { name: 'Use this account for testing?' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('capture')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on testing' }));
    expect(auth.enableTester).toHaveBeenCalledTimes(1);
  });

  it('shows the error from enableTester', async () => {
    const auth = fakeAuth(office, {
      enableTester: vi.fn(async () => {
        throw new Error('The server refused the change.');
      }),
    });
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on testing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server refused the change.');
  });

  it('lets a Tester straight through', () => {
    const auth = fakeAuth({
      state: 'authorized',
      user: { ...office.user, roles: ['Tester'] },
    } as AuthStateV2);
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    expect(screen.getByText('capture')).toBeInTheDocument();
  });

  it('a profile read failure offers Try again', () => {
    const auth = fakeAuth({ state: 'error', uid: 'u1', email: 'x@example.com' });
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('withTester', () => {
  it('adds Tester once', () => {
    expect(withTester(['Report_Viewer'])).toEqual(['Report_Viewer', 'Tester']);
    expect(withTester(['Tester', 'Report_Viewer'])).toBeNull();
  });
});
