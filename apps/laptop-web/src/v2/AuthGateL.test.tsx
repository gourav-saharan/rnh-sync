// AuthGateL: only Report_Viewer / Template_Admin accounts reach the laptop
// shell. No-role, Tester-only and profile-read failures are blocked (R1.5–R1.7).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AuthServiceV2, AuthStateV2 } from '@rnh/shared/v2data';
import { AuthGateL } from './AuthGateL';
import { hasOfficeRole } from './officeRole';

function fakeAuth(state: AuthStateV2): AuthServiceV2 {
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
  };
}

const user = (roles: ('Tester' | 'Report_Viewer' | 'Template_Admin')[]): AuthStateV2 => ({
  state: 'authorized',
  user: { uid: 'u1', email: 'u1@example.com', displayName: 'U', roles },
});

const renderGate = (auth: AuthServiceV2) =>
  render(<AuthGateL authService={auth}>{(u) => <p>shell {u.roles.join(',')}</p>}</AuthGateL>);

describe('AuthGateL', () => {
  it('lets Report_Viewer and Template_Admin in with their own roles', () => {
    renderGate(fakeAuth(user(['Report_Viewer'])));
    expect(screen.getByText('shell Report_Viewer')).toBeInTheDocument();
  });

  it('a Tester-only account (upgrade not done yet) gets a one-tap set-up', () => {
    const auth = fakeAuth(user(['Tester']));
    renderGate(auth);
    expect(
      screen.getByRole('heading', { name: 'Finish setting up your account' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^shell/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up my account' }));
    expect(auth.enableFullAccess).toHaveBeenCalledTimes(1);
  });

  it('a no-role account does not reach the shell and offers Try again', () => {
    const auth = fakeAuth({ state: 'no-role', uid: 'u1', email: 'u1@example.com' });
    renderGate(auth);
    expect(screen.queryByText(/^shell/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not grant access when the profile cannot be read', () => {
    renderGate(fakeAuth({ state: 'error', uid: 'u1', email: 'u1@example.com' }));
    expect(
      screen.getByRole('heading', { name: 'Could not load your account' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^shell/)).not.toBeInTheDocument();
  });

  it('sign-up passes no roles (the service always grants full access)', async () => {
    const auth = fakeAuth({ state: 'unauthenticated' });
    renderGate(auth);
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'N' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'n@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await vi.waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith('n@example.com', 'secret1', 'N'),
    );
  });
});

describe('SignInL UX', () => {
  const openSignUp = () => {
    const auth = fakeAuth({ state: 'unauthenticated' });
    renderGate(auth);
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    return auth;
  };

  it('rejects a short password before calling the server', () => {
    const auth = openSignUp();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'N' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'n@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 6 characters');
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('show password toggles the input type', () => {
    openSignUp();
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByLabelText('Show password'));
    expect(pw).toHaveAttribute('type', 'text');
  });

  it('switching mode clears the typed password', () => {
    openSignUp();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'I already have an account' }));
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});

describe('hasOfficeRole', () => {
  it('is true only for Report_Viewer or Template_Admin', () => {
    expect(hasOfficeRole({ roles: ['Template_Admin'] })).toBe(true);
    expect(hasOfficeRole({ roles: ['Report_Viewer', 'Tester'] })).toBe(true);
    expect(hasOfficeRole({ roles: ['Tester'] })).toBe(false);
    expect(hasOfficeRole({ roles: [] })).toBe(false);
  });
});
