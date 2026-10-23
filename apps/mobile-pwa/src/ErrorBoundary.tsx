// App-level React error boundary for the Mobile_PWA.
//
// Without an error boundary, any uncaught error thrown while rendering (for
// example a Firestore read failing, or an unexpected throw during role
// resolution) unmounts the whole React tree and leaves a blank white screen —
// exactly the failure the browser console flagged. This boundary catches such
// errors and renders an actionable fallback (message + stack + Reload) so the
// app never blank-screens.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface details for debugging; the fallback UI shows the message + stack.
    // eslint-disable-next-line no-console
    console.error('Unhandled error caught by ErrorBoundary:', error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <main className="auth-screen">
          <div className="auth-card" role="alert">
            <h1 className="auth-card__title">Something went wrong</h1>
            <p className="auth-note">
              The app hit an unexpected error and could not continue. The details below can help
              diagnose the problem.
            </p>
            <pre className="auth-error" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
            <button
              type="button"
              className="btn btn--primary btn--full"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
