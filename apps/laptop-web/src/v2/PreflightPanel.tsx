// Report pre-flight (R11.5, R11.7): blockers stop generation, warnings are
// listed and the Report_Viewer may continue with those cells left blank.

import type { Preflight } from '@rnh/shared/v2';

export function PreflightPanel({ preflight }: { preflight: Preflight }): JSX.Element {
  const { blockers, warnings } = preflight;
  return (
    <section className="l-preflight" aria-label="Report checks">
      {blockers.length === 0 && warnings.length === 0 ? (
        <p className="l-alert l-alert--ok">
          All checks passed. {preflight.writes.length} cells will be written.
        </p>
      ) : null}
      {blockers.length > 0 ? (
        <div className="l-alert l-alert--danger" role="alert">
          <strong>Cannot generate yet</strong>
          <ul>
            {blockers.map((b, i) => (
              <li key={i}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="l-alert l-alert--warn">
          <strong>Check before sending</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
