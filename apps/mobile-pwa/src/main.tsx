import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { initAnalytics } from '@rnh/shared';
import { MobileAppV2 } from './v2/MobileAppV2';
import { ErrorBoundary } from './ErrorBoundary';
import { listenForInstall, setUpdateReady } from './v2/pwaUpdate';
import './v2/v2.css';

// Optional, browser-only Firebase Analytics. Fire-and-forget: it resolves to
// null (never throws) when Analytics is unsupported or no measurementId is set.
void initAnalytics();

// Capture Android's install prompt early; it can fire before React renders.
listenForInstall();

// Register the Workbox-generated Service Worker so the app shell is precached
// and the capture UI opens offline (Requirement 4.3). A new build waits until
// the Tester taps "Reload" on the update toast, so it never swaps mid-rating.
// The virtual module is a no-op without Service Worker support.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    setUpdateReady(() => updateSW(true));
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <MobileAppV2 />
    </ErrorBoundary>
  </StrictMode>,
);
