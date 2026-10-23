// Route guard for the Laptop_Web_App.
//
// Implements the app-side of Requirement 1 access control (design.md,
// Auth_Service + Error Handling):
//   - While unauthenticated, only sign-in is reachable (R1.6).
//   - Report generation and export are granted to the Report_Viewer role (R1.5).
//   - Sign-out ends the session and returns to the sign-in screen (R1.7).
//
// The Laptop_Web_App is the Report_Viewer's report surface, so its protected
// content is gated on the 'report' capability. A Tester who signs in here is
// authenticated but not permitted to generate reports, and sees an explanatory
// screen.

import { cloneElement, isValidElement, useEffect, useState, type ReactNode } from 'react';
import {
  canAccess,
  createAuthService,
  type AuthService,
  type AuthStatus,
  type Capability,
} from '@rnh/shared';
import { SignIn } from './SignIn';

interface AuthGateProps {
  /** The capability the wrapped content requires. Defaults to 'report'. */
  capability?: Capability;
  /** Protected content, rendered only when access is granted. */
  children: ReactNode;
  /**
   * Auth_Service to use. Defaults to the shared, environment-initialized
   * instance; tests inject an emulator-backed instance.
   */
  authService?: AuthService;
}

/**
 * Gates its children on authentication + role. Unauthenticated users see the
 * sign-in screen (R1.6); authenticated users without the required capability
 * see a "no access" screen; authorized users see the protected content.
 */
export function AuthGate({
  capability = 'report',
  children,
  authService,
}: AuthGateProps): JSX.Element {
  // Lazily create one Auth_Service for the lifetime of the gate.
  const [service] = useState<AuthService>(() => authService ?? createAuthService());
  const [status, setStatus] = useState<AuthStatus>(() => {
    const current = service.currentUser();
    return current
      ? { state: 'authorized', user: current }
      : { state: 'unauthenticated' };
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Prefer the richer status subscription so a signed-in user with no valid
    // role gets an actionable screen instead of a silent bounce (R1.3). Fall
    // back to onAuthChange for services (e.g. test doubles) that predate it.
    if (typeof service.onAuthStatusChange === 'function') {
      const unsubscribe = service.onAuthStatusChange((next) => {
        setStatus(next);
        setReady(true);
      });
      return unsubscribe;
    }
    const unsubscribe = service.onAuthChange((next) => {
      setStatus(next ? { state: 'authorized', user: next } : { state: 'unauthenticated' });
      setReady(true);
    });
    return unsubscribe;
  }, [service]);

  if (!ready) {
    return <p className="loading-indicator">Loading…</p>;
  }

  // Unauthenticated: only sign-in is reachable (R1.6).
  if (status.state === 'unauthenticated') {
    return <SignIn authService={service} />;
  }

  // Authenticated with Firebase but no valid role assigned — show an actionable
  // screen (contact an administrator / sign out) rather than bouncing to
  // sign-in (R1.3).
  if (status.state === 'no-role') {
    return (
      <main className="screen">
        <h1>No role assigned yet</h1>
        <p>
          Your account ({status.email || status.uid}) has been created but does not
          have a role assigned yet. Report generation on the Laptop Web App requires
          the Report_Viewer role.
        </p>
        <p>Contact an administrator to have a role assigned, then sign in again.</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
          Account ID: {status.uid}
        </p>
        <button
          type="button"
          onClick={() => {
            void service.signOut();
          }}
        >
          Sign out
        </button>
      </main>
    );
  }

  const user = status.user;

  // Authenticated but not permitted for this capability (e.g. Tester on the
  // Report_Viewer report surface) — deny access, offer sign-out (R1.5).
  if (!canAccess(user, capability)) {
    return (
      <main className="screen">
        <h1>Access restricted</h1>
        <p>
          Your role ({user.role}) does not have access to report generation and export
          on the Laptop Web App.
        </p>
        <button
          type="button"
          onClick={() => {
            void service.signOut();
          }}
        >
          Sign out
        </button>
      </main>
    );
  }

  // Surface the authenticated user + Auth_Service to component children so the
  // primary UI can show the signed-in identity and an in-app sign-out (R1.7).
  // Only inject into component elements (function/class); intrinsic DOM
  // elements (e.g. a plain <div> used in tests) are rendered untouched so no
  // unknown-attribute warnings are produced.
  if (isValidElement(children) && typeof children.type !== 'string') {
    return cloneElement(children as React.ReactElement, {
      authUser: user,
      authService: service,
    });
  }

  return <>{children}</>;
}
