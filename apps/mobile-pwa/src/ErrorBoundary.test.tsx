// Tests for the Mobile_PWA error boundary.
//
// A throwing child must be caught and replaced with an actionable fallback
// (message + Reload) rather than propagating and blank-screening the app.

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('kaboom from a child');
}

describe('Mobile_PWA ErrorBoundary', () => {
  beforeEach(() => {
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
    expect(screen.getByText(/kaboom from a child/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });
});
