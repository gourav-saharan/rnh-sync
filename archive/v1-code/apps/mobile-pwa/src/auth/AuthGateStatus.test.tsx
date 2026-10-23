// Tests for the Mobile_PWA AuthGate using the richer onAuthStatusChange
// contract: a Firebase-authenticated user with no valid role must see an
// actionable "No role assigned yet" screen (with Sign out), not a silent
// bounce back to sign-in (R1.3).

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuthService, AuthStatus, AuthUser } from '@rnh/shared';
import { AuthGate } from './AuthGate';

class StatusAuthService implements AuthService {
  constructor(private status: AuthStatus) {}

  async signIn(): Promise<AuthUser> {
    throw new Error('not used');
  }
  async signUp(): Promise<AuthUser> {
    throw new Error('not used');
  }
  async signOut(): Promise<void> {
    this.status = { state: 'unauthenticated' };
  }
  currentUser(): AuthUser | null {
    return this.status.state === 'authorized' ? this.status.user : null;
  }
  onAuthChange(cb: (u: AuthUser | null) => void): () => void {
    cb(this.currentUser());
    return () => {};
  }
  onAuthStatusChange(cb: (s: AuthStatus) => void): () => void {
    cb(this.status);
    return () => {};
  }
}

describe('Mobile_PWA AuthGate no-role handling (R1.3)', () => {
  it('shows an actionable no-role screen instead of bouncing to sign-in', () => {
    const service = new StatusAuthService({
      state: 'no-role',
      uid: 'uid-xyz',
      email: 'norole@example.com',
    });

    render(
      <AuthGate authService={service}>
        <div>Capture surface</div>
      </AuthGate>,
    );

    expect(
      screen.getByRole('heading', { name: /no role assigned/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/uid-xyz/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByText('Capture surface')).not.toBeInTheDocument();
  });
});
