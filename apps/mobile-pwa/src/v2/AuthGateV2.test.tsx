// AuthGateV2: accounts that are not fully set up yet (automatic upgrade failed)
// get a one-tap "Set up my account" instead of a dead end, and a profile read
// failure offers Try again (not "no access").
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AuthServiceV2, AuthStateV2 } from '@rnh/shared/v2data';
import { hasFullAccess } from '@rnh/shared/v2data';
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
    enableFullAccess: vi.fn(async () => {}),
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
  it('offers one-tap set-up when an account is not fully set up', async () => {
    const auth = fakeAuth(office);
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    expect(
      screen.getByRole('heading', { name: 'Finish setting up your account' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('capture')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up my account' }));
    expect(auth.enableFullAccess).toHaveBeenCalledTimes(1);
  });

  it('shows the error from enableFullAccess', async () => {
    const auth = fakeAuth(office, {
      enableFullAccess: vi.fn(async () => {
        throw new Error('The server refused the change.');
      }),
    });
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    fireEvent.click(screen.getByRole('button', { name: 'Set up my account' }));
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

  it('a no-role account does not reach capture', () => {
    const auth = fakeAuth({ state: 'no-role', uid: 'u1', email: 'x@example.com' });
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    expect(screen.queryByText('capture')).not.toBeInTheDocument();
  });

  it('a profile read failure offers Try again', () => {
    const auth = fakeAuth({ state: 'error', uid: 'u1', email: 'x@example.com' });
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('SignInV2 UX', () => {
  const openRegister = () => {
    const auth = fakeAuth({ state: 'unauthenticated' });
    render(<AuthGateV2 authService={auth}>{() => <p>capture</p>}</AuthGateV2>);
    fireEvent.click(screen.getByRole('button', { name: 'New here? Create account' }));
    return auth;
  };

  it('rejects a short password before calling the server', () => {
    const auth = openRegister();
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'N' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'n@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 6 characters');
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('registers with no roles argument (service always uses Tester)', async () => {
    const auth = openRegister();
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'N' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'n@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await vi.waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith('n@example.com', 'secret1', 'N'),
    );
  });

  it('show password toggles the input type', () => {
    openRegister();
    const pw = screen.getByLabelText('Password');
    fireEvent.click(screen.getByLabelText('Show password'));
    expect(pw).toHaveAttribute('type', 'text');
  });
});

describe('hasFullAccess', () => {
  it('is true only when every role is held', () => {
    expect(hasFullAccess(['Tester', 'Report_Viewer', 'Template_Admin'])).toBe(true);
    expect(hasFullAccess(['Template_Admin', 'Tester', 'Report_Viewer'])).toBe(true);
    expect(hasFullAccess(['Tester', 'Report_Viewer'])).toBe(false);
    expect(hasFullAccess([])).toBe(false);
  });
});
