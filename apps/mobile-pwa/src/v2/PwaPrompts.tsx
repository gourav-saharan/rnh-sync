// "New version ready" toast and "Install the app" card (native-app feel).

import { useState } from 'react';
import { applyUpdateNow, promptInstall, useInstallMode, useUpdateReady } from './pwaUpdate';

/** Shown when a new build is waiting. Reloading is safe: data is on the phone. */
export function UpdateToast(): JSX.Element | null {
  const ready = useUpdateReady();
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  return (
    <div className="update-toast" role="status" aria-live="polite">
      <span className="update-toast__text">
        A new version is ready. Your ratings are saved on this phone.
      </span>
      <button
        type="button"
        className="btn btn--primary update-toast__btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void applyUpdateNow().catch(() => setBusy(false));
        }}
      >
        {busy ? 'Updating…' : 'Reload'}
      </button>
    </div>
  );
}

const DISMISS_KEY = 'rnh.installDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Install the app to the home screen. `dismissible` (Home) can be hidden for
 * good; Settings always shows it while the app is not installed.
 */
export function InstallCard({ dismissible = false }: { dismissible?: boolean }): JSX.Element | null {
  const mode = useInstallMode();
  const [dismissed, setDismissed] = useState(() => dismissible && readDismissed());
  const [busy, setBusy] = useState(false);

  if (mode === 'installed' || mode === 'unavailable' || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode: hide for this visit only.
    }
    setDismissed(true);
  };

  return (
    <section className="card install-card" aria-labelledby="install-card-title">
      <div className="install-card__body">
        <h2 id="install-card-title" className="card__title">
          Install the app
        </h2>
        {mode === 'prompt' ? (
          <p className="list__sub">
            Opens full screen from your home screen, works with no signal, and keeps your data
            safer.
          </p>
        ) : (
          <p className="list__sub">
            On iPhone: tap the Share button <span aria-hidden="true">⬆︎</span> in Safari, then{' '}
            <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
      <div className="install-card__actions">
        {mode === 'prompt' ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void promptInstall().finally(() => setBusy(false));
            }}
          >
            Install
          </button>
        ) : null}
        {dismissible ? (
          <button type="button" className="btn btn--ghost" onClick={dismiss}>
            Not now
          </button>
        ) : null}
      </div>
    </section>
  );
}
