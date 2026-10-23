// Component tests for the Mobile_PWA route guard (Requirement 1).
//
// These are example-based tests using @testing-library/react. They drive the
// AuthGate with an injected in-memory Auth_Service so no Firebase is required:
//
//   - Unauthenticated users see only the sign-in screen (R1.6).
//   - A Tester reaches the protected capture content (R1.4).
//   - A Report_Viewer is authenticated but blocked from capture (R1.5 boundary).
//   - Sign-out returns the user to the sign-in screen (R1.7).

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  // Not exercised by these guard tests, but required by the interface.
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
    // The real service invokes the callback with the current state; do the
    // same synchronously so AuthGate transitions out of its loading state.
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
      <div>Capture surface</div>
    </AuthGate>,
  );
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

afterEach(() => {
  // DOM cleanup handled by the shared test setup.
});

describe('Mobile_PWA AuthGate', () => {
  it('shows only the sign-in screen while unauthenticated (R1.6)', () => {
    renderGate(new FakeAuthService(null));

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText('Capture surface')).not.toBeInTheDocument();
  });

  it('grants a Tester access to the capture surface (R1.4)', () => {
    renderGate(new FakeAuthService(tester));

    expect(screen.getByText('Capture surface')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('blocks a Report_Viewer from the capture surface (R1.4 boundary)', () => {
    renderGate(new FakeAuthService(viewer));

    expect(screen.queryByText('Capture surface')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /access restricted/i })).toBeInTheDocument();
    // A sign-out affordance is offered.
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('returns to the sign-in screen after sign-out (R1.7)', async () => {
    const service = new FakeAuthService(tester);
    renderGate(service);

    expect(screen.getByText('Capture surface')).toBeInTheDocument();

    // Signing out clears the session; the guard re-renders the sign-in screen.
    await act(async () => {
      await service.signOut();
    });

    expect(screen.queryByText('Capture surface')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('re-renders the capture surface when a Tester signs in after being unauthenticated (R1.4)', () => {
    const service = new FakeAuthService(null);
    renderGate(service);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();

    act(() => {
      service.setUser(tester);
    });

    expect(screen.getByText('Capture surface')).toBeInTheDocument();
  });

  it('lets a blocked Report_Viewer sign out back to the sign-in screen (R1.7)', async () => {
    renderGate(new FakeAuthService(viewer));

    const signOutButton = screen.getByRole('button', { name: /sign out/i });
    await user.click(signOutButton);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });
});
