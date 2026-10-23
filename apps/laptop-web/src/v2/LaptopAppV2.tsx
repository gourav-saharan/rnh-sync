// Laptop_Web_App v2 shell: header with identity + sign-out, section tabs
// (Tests / Templates / Trash) shown by role, and simple in-app routing.

import { useMemo } from 'react';
import { useHashRoute, type LaptopRoute } from './hashRoute';
import type { AuthServiceV2 } from '@rnh/shared/v2data';
import { AuthGateL } from './AuthGateL';
import { LaptopProvider, useLaptop } from './context';
import { Dashboard } from './Dashboard';
import { SessionPage } from './SessionPage';
import { TemplateList } from './TemplateList';
import { TemplateStudio } from './TemplateStudio';
import { TrashList } from './TrashList';
import { AnalysisPage } from './AnalysisPage';

type Route = LaptopRoute;

function Shell(): JSX.Element {
  const { user, auth } = useLaptop();
  const home = useMemo<Route>(() => ({ name: 'tests' }), []);
  const [hashRoute, go] = useHashRoute(home);
  const route = hashRoute;

  const tabs: { id: Route['name']; label: string; show: boolean }[] = [
    { id: 'tests', label: 'Tests', show: true },
    { id: 'analysis', label: 'Analysis', show: true },
    { id: 'templates', label: 'Templates', show: true },
    { id: 'trash', label: 'Trash', show: true },
  ];
  const section =
    route.name === 'session' ? 'tests' : route.name === 'template' ? 'templates' : route.name;

  return (
    <>
      <header className="l-header">
        <div className="l-header__inner">
          <span className="l-header__title">R&H Tyre Testing</span>
          <nav className="l-header__nav" aria-label="Sections">
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`l-header__tab${section === t.id ? ' l-header__tab--active' : ''}`}
                  aria-current={section === t.id ? 'page' : undefined}
                  onClick={() => go({ name: t.id } as Route)}
                >
                  {t.label}
                </button>
              ))}
          </nav>
          <span className="l-header__user">
            {user.displayName} · {user.roles.join(', ').replace(/_/g, ' ')}
          </span>
          <button
            type="button"
            className="l-btn l-btn--ghost l-btn--on-dark"
            onClick={() => void auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="l-body">
        {route.name === 'tests' ? (
          <Dashboard onOpen={(id) => go({ name: 'session', sessionId: id })} />
        ) : null}
        {route.name === 'session' ? (
          <SessionPage sessionId={route.sessionId} onBack={() => go({ name: 'tests' })} />
        ) : null}
        {route.name === 'templates' ? (
          <TemplateList onOpen={(id) => go({ name: 'template', templateId: id })} />
        ) : null}
        {route.name === 'template' ? (
          <TemplateStudio templateId={route.templateId} onBack={() => go({ name: 'templates' })} />
        ) : null}
        {route.name === 'analysis' ? <AnalysisPage /> : null}
        {route.name === 'trash' ? (
          <main className="l-page">
            <TrashList />
          </main>
        ) : null}
      </div>
    </>
  );
}

export function LaptopAppV2({ authService }: { authService?: AuthServiceV2 }): JSX.Element {
  return (
    <AuthGateL authService={authService}>
      {(user, auth) => (
        <LaptopProvider user={user} auth={auth}>
          <Shell />
        </LaptopProvider>
      )}
    </AuthGateL>
  );
}
