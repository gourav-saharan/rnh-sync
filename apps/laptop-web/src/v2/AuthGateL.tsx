// Laptop_Web_App v2 auth gate (R1). Report_Viewer or Template_Admin may enter;
// the shell hides what the user's roles do not allow. Every account gets full
// access automatically on sign-up / sign-in (owner decision D7).

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AppUser } from '@rnh/shared/v2';
import { createAuthServiceV2, type AuthServiceV2, type AuthStateV2 } from '@rnh/shared/v2data';
import { hasOfficeRole } from './officeRole';

const MIN_PASSWORD = 6;

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
  if (state.state === 'error') {
    return (
      <BlockedL
        auth={auth}
        title="Could not load your account"
        message={`Signed in as ${state.email}, but your profile could not be read. Check your connection and try again.`}
        retry
      />
    );
  }
  if (state.state === 'no-role' || !hasOfficeRole(state.user)) {
    const email = state.state === 'no-role' ? state.email : state.user.email;
    const roles = state.state === 'authorized' ? state.user.roles : [];
    const current =
      roles.length > 0
        ? `It currently has: ${roles.join(', ').replace(/_/g, ' ')}.`
        : 'It has no role yet.';
    return (
      <BlockedL
        auth={auth}
        title="Finish setting up your account"
        message={`${email} is not fully set up yet. ${current} This usually means there was no connection. Select Set up my account to finish.`}
        onFix={() => auth.enableFullAccess()}
        retry
      />
    );
  }
  return <>{children(state.user, auth)}</>;
}

/** Signed in, but the laptop app cannot be used (no office role, or read failed). */
function BlockedL({
  auth,
  title,
  message,
  retry,
  onFix,
}: {
  auth: AuthServiceV2;
  title: string;
  message: string;
  retry?: boolean;
  onFix?: () => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fix = async () => {
    if (!onFix) return;
    setBusy(true);
    setError(null);
    try {
      await onFix();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };
  return (
    <main className="l-auth">
      <div className="l-auth__card" role="region" aria-labelledby="l-auth-blocked-title">
        <h1 id="l-auth-blocked-title">{title}</h1>
        <p className="l-muted" aria-live="polite">
          {message}
        </p>
        {error ? (
          <p className="l-alert l-alert--error" role="alert">
            {error}
          </p>
        ) : null}
        {onFix ? (
          <button
            type="button"
            className="l-btn l-btn--primary"
            disabled={busy}
            onClick={() => void fix()}
          >
            {busy ? 'Please wait…' : 'Set up my account'}
          </button>
        ) : null}
        {retry ? (
          <button type="button" className="l-btn l-btn--primary" onClick={() => auth.refresh()}>
            Try again
          </button>
        ) : null}
        <button type="button" className="l-btn l-btn--link" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}

function SignInL({ auth }: { auth: AuthServiceV2 }): JSX.Element {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const switchMode = () => {
    setMode(mode === 'in' ? 'up' : 'in');
    setError(null);
    // Never carry a typed password across modes.
    setPassword('');
    setConfirm('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Same rule and wording as Firebase's weak-password error, checked first.
    if (mode === 'up' && password.length < MIN_PASSWORD) {
      setError(`Password is too weak. Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (mode === 'up' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'in') await auth.signIn(email, password);
      else await auth.signUp(email, password, name);
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
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            aria-describedby={mode === 'up' ? 'l-auth-pw-hint' : undefined}
            required
          />
        </label>
        {mode === 'up' ? (
          <p id="l-auth-pw-hint" className="l-auth__hint">
            At least {MIN_PASSWORD} characters.
          </p>
        ) : null}
        {mode === 'up' ? (
          <label className="l-field">
            <span>Confirm password</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        ) : null}
        <label className="l-auth__check">
          <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
          <span>Show password</span>
        </label>
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
          onClick={switchMode}
        >
          {mode === 'in' ? 'Create an account' : 'I already have an account'}
        </button>
      </form>
    </main>
  );
}
