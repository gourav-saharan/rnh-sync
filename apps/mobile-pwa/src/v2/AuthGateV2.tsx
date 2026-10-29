// Mobile_PWA v2 auth gate + sign-in (R1). Only users holding the Tester role
// reach capture. Every account gets full access automatically (D7).

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { hasRole, type AppUser } from '@rnh/shared/v2';
import { createAuthServiceV2, type AuthServiceV2, type AuthStateV2 } from '@rnh/shared/v2data';

const MIN_PASSWORD = 6;

export interface AuthGateV2Props {
  authService?: AuthServiceV2;
  children: (user: AppUser, auth: AuthServiceV2) => ReactNode;
}

export function AuthGateV2({ authService, children }: AuthGateV2Props): JSX.Element {
  const [auth] = useState<AuthServiceV2>(() => authService ?? createAuthServiceV2());
  const [state, setState] = useState<AuthStateV2>({ state: 'loading' });
  useEffect(() => auth.subscribe(setState), [auth]);

  if (state.state === 'loading') return <p className="app-loading">Loading…</p>;
  if (state.state === 'unauthenticated') return <SignInV2 auth={auth} />;
  if (state.state === 'error') return <ProfileError auth={auth} email={state.email} />;
  if (state.state === 'no-role' || !hasRole(state.user, 'Tester')) {
    const who = state.state === 'no-role' ? state.email : state.user.email;
    const roles = state.state === 'authorized' ? state.user.roles : [];
    return <EnableTester auth={auth} email={who} roles={roles} />;
  }
  return <>{children(state.user, auth)}</>;
}

/** The profile could not be read (no connection, or rules not deployed). */
function ProfileError({ auth, email }: { auth: AuthServiceV2; email: string }): JSX.Element {
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">Could not load your account</h1>
        <p className="auth-note">
          Signed in as {email}, but your profile could not be read. Check the phone has internet and
          try again.
        </p>
        <div className="auth-form">
          <button
            type="button"
            className="btn btn--primary btn--full"
            onClick={() => auth.refresh()}
          >
            Try again
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--full"
            onClick={() => void auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Fallback when the automatic upgrade to full access (D7) did not succeed,
 * for example offline. Offers a one-tap retry instead of a dead end.
 */
function EnableTester({
  auth,
  email,
  roles,
}: {
  auth: AuthServiceV2;
  email: string;
  roles: string[];
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.enableFullAccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">Finish setting up your account</h1>
        <p className="auth-note">
          {email}{' '}
          {roles.length > 0
            ? `currently has: ${roles.join(', ').replace(/_/g, ' ')}.`
            : 'has no profile yet.'}{' '}
          We could not finish setting it up automatically, usually because there was no
          connection. Tap the button to try again.
        </p>
        {error ? (
          <p role="alert" className="auth-error">
            {error}
          </p>
        ) : null}
        <div className="auth-form">
          <button
            type="button"
            className="btn btn--primary btn--full"
            disabled={busy}
            onClick={() => void enable()}
          >
            {busy ? 'Please wait…' : 'Set up my account'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--full"
            onClick={() => void auth.signOut()}
          >
            Sign in with another account
          </button>
        </div>
      </div>
    </main>
  );
}

function SignInV2({ auth }: { auth: AuthServiceV2 }): JSX.Element {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Same rule and wording as Firebase's weak-password error, checked
    // before any network call so the Tester gets instant feedback.
    if (register && password.length < MIN_PASSWORD) {
      setError(`Password is too weak. Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (register && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (register) await auth.signUp(email, password, name);
      else await auth.signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">{register ? 'Create account' : 'Sign in'}</h1>
        <p className="auth-card__subtitle">R&H Tyre Testing · Tester</p>
        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          {register ? (
            <label className="field">
              <span className="field__label">Your name (shown as “Tested by”)</span>
              <input
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          ) : null}
          <label className="field">
            <span className="field__label">Email</span>
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              autoComplete={register ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={register ? 'auth-pw-hint' : undefined}
              required
            />
          </label>
          {register ? (
            <p id="auth-pw-hint" className="auth-hint">
              At least {MIN_PASSWORD} characters.
            </p>
          ) : null}
          {register ? (
            <label className="field">
              <span className="field__label">Confirm password</span>
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
          ) : null}
          <label className="auth-check">
            <input
              type="checkbox"
              checked={showPw}
              onChange={(e) => setShowPw(e.target.checked)}
            />
            <span>Show password</span>
          </label>
          {error ? (
            <p role="alert" className="auth-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary btn--full" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <button
          type="button"
          className="btn btn--ghost btn--full"
          onClick={() => {
            setRegister((r) => !r);
            setError(null);
            // Never carry a typed password across modes.
            setPassword('');
            setConfirm('');
          }}
        >
          {register ? 'Have an account? Sign in' : 'New here? Create account'}
        </button>
      </div>
    </main>
  );
}
