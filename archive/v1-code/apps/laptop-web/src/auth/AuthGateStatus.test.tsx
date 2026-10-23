// Tests for the Laptop_Web_App AuthGate using the richer onAuthStatusChange
// contract: a Firebase-authenticated user with no valid role must see an
// actionable "No role assigned yet" screen (with Sign out), not a silent
// bounce back to sign-in (R1.3).

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuthService, AuthStatus, AuthUser } from '@rnh/shared';
import { AuthGate } from './AuthGate';

/**
 * A test double that implements the optional onAuthStatusChange surface so the
 * AuthGate feature-detects and prefers it. onAuthChange is still present (for
 * interface completeness) but unused by the gate when status is available.
 */
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

describe('Laptop_Web_App AuthGate no-role handling (R1.3)', () => {
  it('shows an actionable no-role screen instead of bouncing to sign-in', () => {
    const service = new StatusAuthService({
      state: 'no-role',
      uid: 'uid-xyz',
      email: 'norole@example.com',
    });

    render(
      <AuthGate authService={service}>
        <div>Report surface</div>
      </AuthGate>,
    );

    expect(
      screen.getByRole('heading', { name: /no role assigned/i }),
    ).toBeInTheDocument();
    // The account identity is shown so the user can relay it to an admin.
    expect(screen.getByText(/uid-xyz/)).toBeInTheDocument();
    // The sign-in screen is NOT shown.
    expect(screen.queryByRole('heading', { name: /^sign in$/i })).not.toBeInTheDocument();
    // A sign-out affordance is offered.
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    // Protected content is withheld.
    expect(screen.queryByText('Report surface')).not.toBeInTheDocument();
  });
});
