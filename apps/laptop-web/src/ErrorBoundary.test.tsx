// Tests for the Laptop_Web_App error boundary.
//
// A throwing child must be caught and replaced with an actionable fallback
// (message + Reload) rather than propagating and blank-screening the app.

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('kaboom from a child');
}

describe('Laptop_Web_App ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error to console.error; silence it for clean output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>Healthy content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Healthy content')).toBeInTheDocument();
  });

  it('renders an actionable fallback (not a blank screen) when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    // The error message is surfaced for diagnosis.
    expect(screen.getByText(/kaboom from a child/i)).toBeInTheDocument();
    // A recovery affordance is offered.
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });
});
