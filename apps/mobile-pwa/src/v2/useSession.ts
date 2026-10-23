// Mobile_PWA v2 session editor hook.
//
// Loads one LocalTestSessionV2 + its pinned TemplateVersion from IndexedDB and
// exposes `apply(fn)`: the pure edit runs, the result is written to IndexedDB
// and only THEN becomes the visible state (save-before-confirm, R8.1). The
// sync engine is notified after each committed write (R9.1). Writes are
// serialised so rapid taps can never reorder.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditContext, LocalTestSessionV2, TemplateVersion } from '@rnh/shared/v2';
import { useServices } from './context';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface SessionEditor {
  session: LocalTestSessionV2 | null;
  version: TemplateVersion | null;
  loading: boolean;
  notFound: boolean;
  saveState: SaveState;
  saveError: string | null;
  ctx: EditContext | null;
  /** Apply a pure edit; resolves true once persisted locally. */
  apply: (fn: (s: LocalTestSessionV2, ctx: EditContext) => LocalTestSessionV2) => Promise<boolean>;
}

export function useSession(sessionId: string | null): SessionEditor {
  const { local, sync, user } = useServices();
  const [session, setSession] = useState<LocalTestSessionV2 | null>(null);
  const [version, setVersion] = useState<TemplateVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = useRef<LocalTestSessionV2 | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }
    (async () => {
      const s = await local.getSession(sessionId);
      const v = s ? await local.getVersion(s.templateId, s.templateVersion) : undefined;
      if (!active) return;
      current.current = s ?? null;
      setSession(s ?? null);
      setVersion(v ?? null);
      setNotFound(!s || !v);
      setLoading(false);
    })().catch(() => {
      if (active) {
        setNotFound(true);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [local, sessionId]);

  const ctx: EditContext | null = version ? { userId: user.uid, version } : null;

  const apply = useCallback<SessionEditor['apply']>(
    (fn) => {
      const run = chain.current.then(async () => {
        const base = current.current;
        if (!base || !version) return false;
        const next = fn(base, { userId: user.uid, version, now: Date.now() });
        if (next === base) return true;
        setSaveState('saving');
        try {
          await local.saveSession(next);
        } catch (e) {
          // Keep the prior persisted state visible; never pretend it saved (R8.1).
          setSaveState('error');
          setSaveError(e instanceof Error ? e.message : 'Could not save on this phone.');
          return false;
        }
        current.current = next;
        setSession(next);
        setSaveState('saved');
        setSaveError(null);
        sync.notify();
        return true;
      });
      chain.current = run.catch(() => false);
      return run;
    },
    [local, sync, user.uid, version],
  );

  return { session, version, loading, notFound, saveState, saveError, ctx, apply };
}
