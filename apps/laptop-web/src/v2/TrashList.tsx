// Trash (R13.2): deleted tests stay 30 days and can be restored. Permanent
// delete is allowed only after 30 days (also enforced by the security rules),
// with a typed confirmation. No Cloud Functions: purge is a user action.

import { useMemo, useState } from 'react';
import { trashDaysLeft } from '@rnh/shared/v2data';
import { formatDate, plainError, useLaptop, useLiveSessions } from './context';
import { ConfirmDialog } from './ConfirmDialog';

export function TrashList(): JSX.Element {
  const { sessions, user } = useLaptop();
  const live = useLiveSessions();
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<{ id: string; label: string } | null>(null);
  const trashed = useMemo(() => live.data.filter((s) => s.deletedAt), [live.data]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(plainError(e));
    }
  };

  return (
    <section className="l-card" aria-label="Trash">
      <h2 className="l-card__title">Trash</h2>
      <p className="l-muted l-small">
        Deleted tests are kept for 30 days. Restore them any time before then.
      </p>
      {purging ? (
        <ConfirmDialog
          title="Delete this test permanently?"
          confirmLabel="Delete forever"
          danger
          requireText="DELETE"
          onCancel={() => setPurging(null)}
          onConfirm={() => {
            const id = purging.id;
            setPurging(null);
            void run(() => sessions.purge(id));
          }}
        >
          <p>{purging.label}. This cannot be undone. Export it as JSON first if you may need it.</p>
        </ConfirmDialog>
      ) : null}
      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {live.error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {live.error}
        </p>
      ) : null}
      {live.loading ? (
        <p className="l-loading">Loading trash…</p>
      ) : trashed.length === 0 ? (
        <p className="l-empty">Trash is empty.</p>
      ) : (
        <div className="l-table-wrap">
          <table className="l-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Template</th>
                <th scope="col">Tester</th>
                <th scope="col">Deleted</th>
                <th scope="col">Days left</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trashed.map((s) => {
                const left = trashDaysLeft(s.deletedAt);
                return (
                  <tr key={s.sessionId}>
                    <td>{s.customerName}</td>
                    <td>{s.templateName}</td>
                    <td>{s.createdByName}</td>
                    <td>{formatDate(s.deletedAt)}</td>
                    <td>{left}</td>
                    <td className="l-actions">
                      <button
                        type="button"
                        className="l-btn l-btn--secondary l-btn--small"
                        onClick={() => void run(() => sessions.restore(s.sessionId, user.uid))}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="l-btn l-btn--ghost-danger l-btn--small"
                        disabled={left > 0}
                        title={left > 0 ? `Can be deleted permanently in ${left} days` : undefined}
                        onClick={() =>
                          setPurging({
                            id: s.sessionId,
                            label: `${s.customerName} · ${s.templateName}`,
                          })
                        }
                      >
                        Delete forever
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
