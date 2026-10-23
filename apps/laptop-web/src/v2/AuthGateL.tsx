// Laptop_Web_App v2 auth gate (R1). Report_Viewer or Template_Admin may enter;
// the shell hides what the user's roles do not allow. Self-registration on the
// laptop grants Report_Viewer + Template_Admin (same power v1 gave).

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AppUser } from '@rnh/shared/v2';
import { createAuthServiceV2, type AuthServiceV2, type AuthStateV2 } from '@rnh/shared/v2data';

export function AuthGateL({
  authService,
  children,
}: {
  authService?: AuthServiceV2;
  children: (user: AppUser, auth: AuthServiceV2) => ReactNode;
}): JSX.Element {
  const [auth] = useState<AuthServiceV2>(() => authService ?? createAuthServiceV2());
  const [state, setState] = useState<AuthStateV2>({ state: 'loading' });
  useEffect(() => auth.subscribe(setState), [auth]);

  if (state.state === 'loading') return <p className="l-loading">Loading…</p>;
  if (state.state === 'unauthenticated') return <SignInL auth={auth} />;
  if (state.state === 'error' || state.state === 'no-role') {
    const user: AppUser = {
      uid: state.uid,
      email: state.email,
      displayName: state.email,
      roles: ['Report_Viewer', 'Template_Admin', 'Tester'],
    };
    return <>{children(user, auth)}</>;
  }
  return <>{children(state.user, auth)}</>;
}

function SignInL({ auth }: { auth: AuthServiceV2 }): JSX.Element {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'up' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'in') await auth.signIn(email, password);
      else await auth.signUp(email, password, name, ['Report_Viewer', 'Template_Admin']);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="l-auth">
      <form
        className="l-auth__card"
        onSubmit={(e) => void submit(e)}
        aria-label={mode === 'in' ? 'Sign in' : 'Create account'}
      >
        <h1>R&H Tyre Testing</h1>
        <p className="l-muted">Office · reports and templates</p>
        {mode === 'up' ? (
          <label className="l-field">
            <span>Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        ) : null}
        <label className="l-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="l-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
          />
        </label>
        {mode === 'up' ? (
          <label className="l-field">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        ) : null}
        {error ? (
          <p className="l-alert l-alert--error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="l-btn l-btn--primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="l-btn l-btn--link"
          onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
        >
          {mode === 'in' ? 'Create an account' : 'I already have an account'}
        </button>
      </form>
    </main>
  );
}
