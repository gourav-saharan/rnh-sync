// Save state badge (R8.1, R8.6). Text + icon, never colour alone (R15.4).

import type { SaveState } from './useSession';

export function SaveBadge({
  state,
  error,
}: {
  state: SaveState;
  error?: string | null;
}): JSX.Element {
  if (state === 'error') {
    return (
      <span className="badge badge--error" role="alert" title={error ?? undefined}>
        ✕ Not saved
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="badge badge--busy" aria-live="polite">
        … Saving
      </span>
    );
  }
  return (
    <span className="badge badge--ok" aria-live="polite">
      ✓ Saved on phone
    </span>
  );
}
