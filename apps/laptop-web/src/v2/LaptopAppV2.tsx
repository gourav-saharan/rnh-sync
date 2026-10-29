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
import { sectionOf, visibleSections, type LaptopSection } from './officeRole';

type Route = LaptopRoute;

function Shell(): JSX.Element {
  const { user, auth } = useLaptop();
  // Tabs follow the user's roles (R1.5, R1.6); the first allowed one is home.
  const allowed = useMemo(() => visibleSections(user), [user]);
  const home = useMemo<Route>(() => ({ name: allowed[0] ?? 'tests' }), [allowed]);
  const [hashRoute, go] = useHashRoute(home);
  // A pasted or bookmarked link to a section this user cannot use opens home.
  const route: Route = allowed.includes(sectionOf(hashRoute.name)) ? hashRoute : home;

  const LABELS: Record<LaptopSection, string> = {
    tests: 'Tests',
    analysis: 'Analysis',
    templates: 'Templates',
    trash: 'Trash',
  };
  const tabs = allowed.map((id) => ({ id, label: LABELS[id], show: true }));
  const section = sectionOf(route.name);

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
