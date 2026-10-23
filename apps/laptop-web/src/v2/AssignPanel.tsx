// Assign testers (R14.2): a Report_Viewer picks which Testers may also edit
// this test on their phone. The test appears on their phone at the next sync.
// The owner (creator) always keeps access and is not listed as removable.

import { useEffect, useState } from 'react';
import { hasRole, type AppUser, type TestSessionV2 } from '@rnh/shared/v2';
import { listTeamV2 } from '@rnh/shared/v2data';
import { plainError } from './context';

export type TeamLoader = () => Promise<AppUser[]>;

export interface AssignPanelProps {
  session: TestSessionV2;
  onSave: (assignedTo: string[]) => Promise<void>;
  loadTeam?: TeamLoader;
}

export function AssignPanel({
  session,
  onSave,
  loadTeam = () => listTeamV2(),
}: AssignPanelProps): JSX.Element {
  const [team, setTeam] = useState<AppUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = session.assignedTo ?? [];

  useEffect(() => {
    let active = true;
    loadTeam()
      .then((t) => active && setTeam(t.filter((u) => hasRole(u, 'Tester'))))
      .catch((e) => active && setError(`The team list could not be loaded: ${plainError(e)}`));
    return () => {
      active = false;
    };
    // Load once per panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (uid: string) => {
    const next = current.includes(uid) ? current.filter((x) => x !== uid) : [...current, uid];
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const others = (team ?? []).filter((u) => u.uid !== session.createdBy);

  return (
    <details className="l-card" aria-label="Assigned testers">
      <summary className="l-card__summary">
        Assigned testers {current.length > 0 ? `(${current.length})` : ''}
      </summary>
      <p className="l-muted l-small">
        Owner: {session.createdByName}. Assigned testers can also edit this test on their phone; it
        appears there at their next sync.
      </p>
      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {team === null && !error ? <p className="l-muted">Loading team…</p> : null}
      {team !== null && others.length === 0 ? (
        <p className="l-muted">No other users with the Tester role yet.</p>
      ) : null}
      <ul className="l-list l-list--plain">
        {others.map((u) => (
          <li key={u.uid}>
            <label className="l-check">
              <input
                type="checkbox"
                checked={current.includes(u.uid)}
                disabled={busy}
                onChange={() => void toggle(u.uid)}
              />{' '}
              {u.displayName} <span className="l-muted l-small">{u.email}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
