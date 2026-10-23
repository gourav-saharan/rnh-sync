// Analysis data hook: every live (non-trashed) test plus the pinned
// Template_Version of each, loaded once per (template, version) pair.

import { useEffect, useMemo, useState } from 'react';
import type { AnalysisInput, TemplateVersion } from '@rnh/shared/v2';
import { plainError, useLaptop, useLiveSessions } from './context';

export interface AnalysisData {
  inputs: AnalysisInput[];
  loading: boolean;
  error: string | null;
  /** Tests whose template version could not be loaded (skipped). */
  skipped: number;
}

export function useAnalysisData(): AnalysisData {
  const { templates } = useLaptop();
  const live = useLiveSessions();
  const [versions, setVersions] = useState<Record<string, TemplateVersion | null>>({});
  const [error, setError] = useState<string | null>(null);

  const active = useMemo(() => live.data.filter((s) => !s.deletedAt), [live.data]);
  const needed = useMemo(
    () => [...new Set(active.map((s) => `${s.templateId}#${s.templateVersion}`))],
    [active],
  );

  useEffect(() => {
    const missing = needed.filter((k) => !(k in versions));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (k) => {
        const [tid, n] = k.split('#');
        try {
          return [k, await templates.getVersion(tid, Number(n))] as const;
        } catch {
          return [k, null] as const;
        }
      }),
    )
      .then((pairs) => {
        if (!cancelled) setVersions((v) => ({ ...v, ...Object.fromEntries(pairs) }));
      })
      .catch((e) => !cancelled && setError(plainError(e)));
    return () => {
      cancelled = true;
    };
  }, [needed, versions, templates]);

  const inputs = useMemo(() => {
    const out: AnalysisInput[] = [];
    for (const s of active) {
      const v = versions[`${s.templateId}#${s.templateVersion}`];
      if (v) out.push({ session: s, version: v });
    }
    return out;
  }, [active, versions]);

  const loadedAll = needed.every((k) => k in versions);
  const skipped = loadedAll ? active.length - inputs.length : 0;

  return {
    inputs,
    loading: live.loading || !loadedAll,
    error: error ?? live.error,
    skipped,
  };
}
