// Component tests for the Laptop_Web_App route guard (Requirement 1).
//
// These are example-based tests using @testing-library/react. They drive the
// AuthGate with an injected in-memory Auth_Service so no Firebase is required:
//
//   - Unauthenticated users see only the sign-in screen (R1.6).
//   - A Report_Viewer reaches the protected report content (R1.5).
//   - A Tester is authenticated but blocked from report features (R1.4 boundary).
//   - Sign-out returns the user to the sign-in screen (R1.7).

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthService, AuthUser } from '@rnh/shared';
import { AuthGate } from './AuthGate';

/**
 * A minimal in-memory Auth_Service test double implementing the surface the
 * AuthGate consumes: currentUser(), onAuthChange(), and signOut(). It lets a
 * test set the signed-in user and notify subscribers, mirroring how the real
 * service pushes auth-state changes.
 */
class FakeAuthService implements AuthService {
  private user: AuthUser | null;
  private listeners = new Set<(u: AuthUser | null) => void>();

  constructor(initial: AuthUser | null = null) {
    this.user = initial;
  }

  async signIn(): Promise<AuthUser> {
    throw new Error('not used in guard tests');
  }

  async signOut(): Promise<void> {
    this.setUser(null);
  }

  currentUser(): AuthUser | null {
    return this.user;
  }

  onAuthChange(cb: (u: AuthUser | null) => void): () => void {
    this.listeners.add(cb);
    cb(this.user);
    return () => this.listeners.delete(cb);
  }

  /** Test helper: change the signed-in user and notify subscribers. */
  setUser(next: AuthUser | null): void {
    this.user = next;
    for (const cb of this.listeners) cb(next);
  }
}

const tester: AuthUser = { uid: 't1', email: 'tester@example.com', role: 'Tester' };
const viewer: AuthUser = {
  uid: 'v1',
  email: 'viewer@example.com',
  role: 'Report_Viewer',
};

function renderGate(service: AuthService) {
  return render(
    <AuthGate authService={service}>
      <div>Report surface</div>
    </AuthGate>,
  );
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

describe('Laptop_Web_App AuthGate', () => {
  it('shows only the sign-in screen while unauthenticated (R1.6)', () => {
    renderGate(new FakeAuthService(null));

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText('Report surface')).not.toBeInTheDocument();
  });

  it('grants a Report_Viewer access to the report surface (R1.5)', () => {
    renderGate(new FakeAuthService(viewer));

    expect(screen.getByText('Report surface')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('blocks a Tester from the report surface (R1.5 boundary)', () => {
    renderGate(new FakeAuthService(tester));

    expect(screen.queryByText('Report surface')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /access restricted/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('returns to the sign-in screen after sign-out (R1.7)', async () => {
    const service = new FakeAuthService(viewer);
    renderGate(service);

    expect(screen.getByText('Report surface')).toBeInTheDocument();

    await act(async () => {
      await service.signOut();
    });

    expect(screen.queryByText('Report surface')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('re-renders the report surface when a Report_Viewer signs in after being unauthenticated (R1.5)', () => {
    const service = new FakeAuthService(null);
    renderGate(service);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();

    act(() => {
      service.setUser(viewer);
    });

    expect(screen.getByText('Report surface')).toBeInTheDocument();
  });

  it('lets a blocked Tester sign out back to the sign-in screen (R1.7)', async () => {
    renderGate(new FakeAuthService(tester));

    const signOutButton = screen.getByRole('button', { name: /sign out/i });
    await user.click(signOutButton);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });
});
