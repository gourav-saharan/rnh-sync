// Mobile_PWA v2 app shell: auth -> services -> screen routing. The last
// screen of the open test is persisted in its cursor, so a crash or reload
// reopens exactly where the Tester was (R8.2).

import { useEffect, useRef, useState } from 'react';
import { parentOf, transitionFor, type MobileRoute, type ScreenMotion } from './mobileNav';
import { UpdateToast } from './PwaPrompts';
import type { LocalTestSessionV2 } from '@rnh/shared/v2';
import type { AuthServiceV2 } from '@rnh/shared/v2data';
import { AuthGateV2 } from './AuthGateV2';
import { ServicesProvider, useServices, useTheme } from './context';
import { Home } from './Home';
import { SetupWizard } from './SetupWizard';
import { DriveMode } from './DriveMode';
import { Overview } from './Overview';
import { Summary } from './Summary';
import { Settings } from './Settings';

type Route = MobileRoute;

const OPEN_KEY = 'openSessionId';

function Router(): JSX.Element {
  const { local } = useServices();
  useTheme();
  const [route, setRoute] = useState<Route | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);

  // Resume the last open test at its last screen (R8.2).
  useEffect(() => {
    void (async () => {
      const id = await local.getMeta<string>(OPEN_KEY).catch(() => undefined);
      const s = id ? await local.getSession(id) : undefined;
      if (s && !s.deletedAt) setRoute({ name: s.cursor.screen, sessionId: s.sessionId });
      else setRoute({ name: 'home' });
    })();
  }, [local]);

  // Push / pop / fade animation for the next screen (native feel).
  const [motion, setMotion] = useState<ScreenMotion>('none');

  const go = (r: Route) => {
    setMotion(transitionFor(latest.current.route, r));
    setRoute(r);
    void local.setMeta(OPEN_KEY, 'sessionId' in r ? r.sessionId : null);
    window.scrollTo?.(0, 0);
  };

  // Hardware / gesture Back (Android, installed PWA). While Back has somewhere
  // to go inside the app, keep one guard entry in the browser history; Back
  // pops it and we navigate in-app instead of leaving. On Home with nothing
  // open, there is no guard, so Back leaves the app as on a native app.
  const latest = useRef({ route, pickingTemplate });
  latest.current = { route, pickingTemplate };
  const canGoBack = !!route && (pickingTemplate || parentOf(route) !== null);

  useEffect(() => {
    if (canGoBack && !(window.history.state as { rnhGuard?: boolean } | null)?.rnhGuard) {
      window.history.pushState({ rnhGuard: true }, '');
    }
  }, [canGoBack, route]);

  useEffect(() => {
    const onPop = () => {
      const { route: r, pickingTemplate: picking } = latest.current;
      if (picking) {
        setPickingTemplate(false);
        return;
      }
      const parent = r ? parentOf(r) : null;
      if (parent) go(parent);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // go only depends on `local`, which is stable per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  if (!route) return <p className="app-loading">Loading…</p>;
  const home = () => go({ name: 'home' });

  const isRootRoute = route.name === 'home' || route.name === 'settings';

  return (
    <div className="native-app-container">
      <div className="native-app-body">
        <div
          key={'sessionId' in route ? `${route.name}:${route.sessionId}` : route.name}
          className={`screen-motion screen-motion--${motion}`}
        >
        {(() => {
          switch (route.name) {
            case 'home':
              return (
                <Home
                  pickingExternal={pickingTemplate}
                  onSetPickingExternal={setPickingTemplate}
                  onOpen={(s: LocalTestSessionV2) =>
                    go({
                      name: s.cursor.screen === 'setup' ? 'setup' : s.cursor.screen,
                      sessionId: s.sessionId,
                    })
                  }
                  onSettings={() => go({ name: 'settings' })}
                />
              );
            case 'settings':
              return <Settings onBack={home} />;
            case 'setup':
              return (
                <SetupWizard
                  sessionId={route.sessionId}
                  onExit={home}
                  onDrive={() => go({ name: 'drive', sessionId: route.sessionId })}
                />
              );
            case 'drive':
              return (
                <DriveMode
                  sessionId={route.sessionId}
                  onExit={() => go({ name: 'summary', sessionId: route.sessionId })}
                  onSummary={() => go({ name: 'summary', sessionId: route.sessionId })}
                  onOverview={() => go({ name: 'overview', sessionId: route.sessionId })}
                />
              );
            case 'overview':
              return (
                <Overview
                  sessionId={route.sessionId}
                  onBack={() => go({ name: 'drive', sessionId: route.sessionId })}
                  onJump={() => go({ name: 'drive', sessionId: route.sessionId })}
                />
              );
            case 'summary':
              return (
                <Summary
                  sessionId={route.sessionId}
                  onBack={home}
                  onDrive={() => go({ name: 'drive', sessionId: route.sessionId })}
                  onSetup={() => go({ name: 'setup', sessionId: route.sessionId })}
                />
              );
          }
        })()}
        </div>
      </div>

      <UpdateToast />

      {/* Persistent Native Bottom Navigation Bar for Root Screens */}
      {isRootRoute ? (
        <div className="native-bottom-nav-wrap">
          <nav className="native-bottom-nav" aria-label="Bottom Navigation">
            <button
              type="button"
              className={`nav-tab${route.name === 'home' && !pickingTemplate ? ' nav-tab--active' : ''}`}
              onClick={() => {
                setPickingTemplate(false);
                home();
              }}
              aria-label="Tests tab"
            >
              <span className="nav-tab__icon-wrap" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  <line x1="9" y1="12" x2="15" y2="12" />
                  <line x1="9" y1="16" x2="15" y2="16" />
                </svg>
              </span>
              <span className="nav-tab__label">Tests</span>
              {route.name === 'home' && !pickingTemplate ? (
                <span className="nav-tab__indicator" aria-hidden="true" />
              ) : null}
            </button>

            <button
              type="button"
              className={`nav-tab-fab${pickingTemplate ? ' nav-tab-fab--active' : ''}`}
              onClick={() => {
                if (route.name !== 'home') home();
                setPickingTemplate(!pickingTemplate);
              }}
              aria-label="New test action"
              title="Create new test"
            >
              <span className="nav-tab-fab__icon" aria-hidden="true">
                +
              </span>
            </button>

            <button
              type="button"
              className={`nav-tab${route.name === 'settings' ? ' nav-tab--active' : ''}`}
              onClick={() => {
                setPickingTemplate(false);
                go({ name: 'settings' });
              }}
              aria-label="Settings tab"
            >
              <span className="nav-tab__icon-wrap" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
              <span className="nav-tab__label">Settings</span>
              {route.name === 'settings' ? (
                <span className="nav-tab__indicator" aria-hidden="true" />
              ) : null}
            </button>
          </nav>
          {/* Keeps the nav clear of the phone's own home indicator. */}
          <div className="android-gesture-bar" aria-hidden="true" />
        </div>
      ) : null}
</div>
  );
}

export function MobileAppV2({ authService }: { authService?: AuthServiceV2 }): JSX.Element {
  return (
    <AuthGateV2 authService={authService}>
      {(user, auth) => (
        <ServicesProvider user={user} auth={auth}>
          <Router />
        </ServicesProvider>
      )}
    </AuthGateV2>
  );
}
