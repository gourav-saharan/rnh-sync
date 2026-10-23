import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initAnalytics } from '@rnh/shared';
import { LaptopAppV2 } from './v2/LaptopAppV2';
import { ErrorBoundary } from './ErrorBoundary';
import './v2/laptop-v2.css';

// Optional, browser-only Firebase Analytics. Fire-and-forget: it resolves to
// null (never throws) when Analytics is unsupported or no measurementId is set.
void initAnalytics();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <LaptopAppV2 />
    </ErrorBoundary>
  </StrictMode>,
);
