// Sign-in / register screen for the Mobile_PWA.
//
// The only screen reachable while unauthenticated (R1.6). Submits credentials
// to the Auth_Service; on invalid credentials it stays on this screen and
// shows the descriptive authentication error (R1.2). On success the auth-change
// listener in AuthGate swaps in the protected content (R1.1).
//
// It also offers a self-service Register mode: a new account created here is
// assigned the Tester role (the Mobile_PWA is the Tester's capture surface).

import { useState, type FormEvent } from 'react';
import { AuthenticationError, MissingRoleError, type AuthService } from '@rnh/shared';

interface SignInProps {
  authService: AuthService;
}

/** The role a self-registered account is granted on the Mobile_PWA. */
const APP_ROLE = 'Tester' as const;

type Mode = 'signin' | 'register';

export function SignIn({ authService }: SignInProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === 'register';

  function switchMode(next: Mode): void {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirm('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (isRegister && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        if (typeof authService.signUp !== 'function') {
          throw new Error('Registration is not available.');
        }
        await authService.signUp(email, password, APP_ROLE);
      } else {
        await authService.signIn(email, password);
      }
      // On success, AuthGate's auth listener renders the protected content.
    } catch (cause) {
      // Deny access and display the descriptive authentication error (R1.2).
      if (cause instanceof AuthenticationError || cause instanceof MissingRoleError) {
        setError(cause.message);
      } else {
        setError(
          isRegister
            ? 'Could not create the account. Please try again.'
            : 'Sign-in failed. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">{isRegister ? 'Create account' : 'Sign in'}</h1>
        <p className="auth-card__subtitle">
          R&amp;H Tyre Testing — Tester capture
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            Email
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              value={password}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {isRegister ? (
            <label className="field">
              Confirm password
              <input
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="auth-error">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn btn--primary btn--full"
            disabled={submitting}
          >
            {submitting
              ? isRegister
                ? 'Creating account…'
                : 'Signing in…'
              : isRegister
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>
        <button
          type="button"
          className="btn btn--secondary btn--full"
          style={{ marginTop: 'var(--space-3)' }}
          onClick={() => switchMode(isRegister ? 'signin' : 'register')}
        >
          {isRegister ? 'Have an account? Sign in' : 'Create account'}
        </button>
      </div>
    </main>
  );
}
