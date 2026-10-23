// App-level React error boundary for the Laptop_Web_App.
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
        <main className="l-auth" role="alert">
          <div className="l-auth__card">
            <h1>Something went wrong</h1>
            <p className="l-muted">
              The app hit an unexpected error and could not continue. The details below can help
              diagnose the problem.
            </p>
            <pre
              className="l-alert l-alert--error"
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '12px',
                margin: '8px 0',
              }}
            >
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
            <button
              type="button"
              className="l-btn l-btn--primary"
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
