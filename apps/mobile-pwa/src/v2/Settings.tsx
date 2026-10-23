// Mobile_PWA settings: theme (R6.12), Drive_Mode auto-advance + haptics
// (R6.5, R6.4), storage persistence status (R8.5), sign-out with unsynced
// warning (R1.8), and manual sync.

import { useEffect, useState } from 'react';
import {
  loadPrefs,
  savePrefs,
  useServices,
  useSyncStatus,
  useTheme,
  type DrivePrefs,
} from './context';

export interface SettingsProps {
  onBack: () => void;
}

const DELAYS = [0, 400, 600, 1000, 1500];

export function Settings({ onBack }: SettingsProps): JSX.Element {
  const { user, auth, local, sync } = useServices();
  const status = useSyncStatus();
  const [theme, setTheme] = useTheme();
  const [prefs, setPrefs] = useState<DrivePrefs>(() => loadPrefs());
  const [persist, setPersist] = useState<boolean | null | undefined>(undefined);
  const [confirmOut, setConfirmOut] = useState(false);

  useEffect(() => {
    void local.getMeta<boolean | null>('persistGranted').then(setPersist);
  }, [local]);

  const update = (p: Partial<DrivePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    savePrefs(next);
  };

  const signOut = () => {
    if (status.pendingCount > 0 && !confirmOut) {
      setConfirmOut(true);
      return;
    }
    void auth.signOut();
  };

  return (
    <main className="screen">
      <header className="topbar">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ‹ Back
        </button>
        <h1 className="topbar__title">Settings</h1>
      </header>

      <section className="card">
        <h2 className="card__title">Signed in</h2>
        <p>
          {user.displayName} · {user.email}
        </p>
        <p className="list__sub">Roles: {user.roles.join(', ').replace(/_/g, ' ')}</p>
      </section>

      <section className="card">
        <h2 className="card__title">Display</h2>
        <div className="seg" role="group" aria-label="Theme">
          <button
            type="button"
            className="seg__btn"
            aria-pressed={theme === 'sun'}
            onClick={() => setTheme('sun')}
          >
            ☀ Sunlight
          </button>
          <button
            type="button"
            className="seg__btn"
            aria-pressed={theme === 'night'}
            onClick={() => setTheme('night')}
          >
            ☾ Night
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Drive Mode</h2>
        <p className="field__label">Go to next parameter after a rating</p>
        <div className="seg" role="group" aria-label="Auto-advance delay">
          {DELAYS.map((d) => (
            <button
              key={d}
              type="button"
              className="seg__btn"
              aria-pressed={prefs.autoAdvanceMs === d}
              onClick={() => update({ autoAdvanceMs: d })}
            >
              {d === 0 ? 'Off' : `${d / 1000}s`}
            </button>
          ))}
        </div>
        <label className="toggle">
          <span>Vibrate on tap</span>
          <input
            type="checkbox"
            checked={prefs.haptics}
            onChange={(e) => update({ haptics: e.target.checked })}
          />
        </label>
      </section>

      <section className="card">
        <h2 className="card__title">Data on this phone</h2>
        {persist === false ? (
          <p className="note note--warn">
            The browser has not granted persistent storage. Data could be cleared if the phone runs
            low on space. Install the app to the home screen and sync often.
          </p>
        ) : persist === true ? (
          <p className="note">Storage is persistent.</p>
        ) : null}
        <p>
          {status.pendingCount === 0
            ? 'Everything is synced.'
            : `${status.pendingCount} test(s) waiting to sync.`}
          {status.lastSyncedAt
            ? ` Last sync ${new Date(status.lastSyncedAt).toLocaleTimeString()}.`
            : ''}
        </p>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!status.online}
          onClick={() => void sync.syncNow()}
        >
          Sync now
        </button>
      </section>

      <section className="card">
        <h2 className="card__title">About</h2>
        <p>R&H Tyre Testing Mobile PWA · v2.0</p>
        <p className="list__sub">
          Offline-first testing system for automotive ride and handling evaluations. Designed for
          high-contrast visibility and fast in-car data collection.
        </p>
      </section>

      {confirmOut ? (
        <p className="note note--warn" role="alert">
          {status.pendingCount} test(s) are not synced yet. They stay on this phone, but signing out
          now means they will not reach the laptop until you sign in again. Tap “Sign out” again to
          confirm.
        </p>
      ) : null}
      <button type="button" className="btn btn--danger btn--full" onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}
