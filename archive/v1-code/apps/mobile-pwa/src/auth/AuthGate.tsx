// Route guard for the Mobile_PWA.
//
// Implements the app-side of Requirement 1 access control (design.md,
// Auth_Service + Error Handling):
//   - While unauthenticated, only sign-in is reachable (R1.6).
//   - Test_Session capture is granted to the Tester role (R1.4).
//   - Sign-out ends the session and returns to the sign-in screen (R1.7).
//
// The Mobile_PWA is the Tester's capture surface, so its protected content is
// gated on the 'capture' capability. A Report_Viewer who signs in here is
// authenticated but not permitted to capture, and sees an explanatory screen.

import { useEffect, useState, type ReactNode } from 'react';
import {
  canAccess,
  createAuthService,
  type AuthService,
  type AuthStatus,
  type AuthUser,
  type Capability,
} from '@rnh/shared';
import { SignIn } from './SignIn';

interface AuthGateProps {
  /** The capability the wrapped content requires. Defaults to 'capture'. */
  capability?: Capability;
  /**
   * Protected content, rendered only when access is granted. May be a plain
   * node, or a render function that receives the authenticated user so the
   * capture surface can key its session on the Tester's uid.
   */
  children: ReactNode | ((user: AuthUser) => ReactNode);
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
  capability = 'capture',
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
    return <p className="app-loading">Loading…</p>;
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
      <main className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-card__title">No role assigned yet</h1>
          <p className="auth-note">
            Your account ({status.email || status.uid}) has been created but does not
            have a role assigned yet. Test_Session capture on the Mobile PWA requires
            the Tester role.
          </p>
          <p className="auth-note">
            Contact an administrator to have a role assigned, then sign in again.
          </p>
          <p className="auth-note" style={{ fontSize: '0.8125rem' }}>
            Account ID: {status.uid}
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--full"
            onClick={() => {
              void service.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  const user = status.user;

  // Authenticated but not permitted for this capability (e.g. Report_Viewer on
  // the Tester capture surface) — deny access, offer sign-out (R1.4).
  if (!canAccess(user, capability)) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-card__title">Access restricted</h1>
          <p className="auth-note">
            Your role ({user.role}) does not have access to Test_Session capture on the
            Mobile PWA.
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--full"
            onClick={() => {
              void service.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return <>{typeof children === 'function' ? children(user) : children}</>;
}
