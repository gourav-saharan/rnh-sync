// Saved Analysis views: named AnalysisOptions kept in this browser's
// localStorage (per user). No server storage needed, no Cloud Functions.

import { DEFAULT_ANALYSIS, type AnalysisOptions } from '@rnh/shared/v2';

export interface SavedView {
  name: string;
  opts: AnalysisOptions;
}

const key = (uid: string) => `rnh.v2.analysisViews.${uid}`;
const lastKey = (uid: string) => `rnh.v2.analysisLast.${uid}`;

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or disabled: views are a convenience only */
  }
}

export function loadViews(uid: string): SavedView[] {
  const list = read<SavedView[]>(key(uid), []);
  return Array.isArray(list) ? list.filter((v) => v && typeof v.name === 'string' && v.opts) : [];
}

export function saveView(uid: string, name: string, opts: AnalysisOptions): SavedView[] {
  const trimmed = name.trim();
  const next = [...loadViews(uid).filter((v) => v.name !== trimmed), { name: trimmed, opts }].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  write(key(uid), next);
  return next;
}

export function deleteView(uid: string, name: string): SavedView[] {
  const next = loadViews(uid).filter((v) => v.name !== name);
  write(key(uid), next);
  return next;
}

/** Last options used, so the page reopens as the user left it. */
export function loadLast(uid: string): AnalysisOptions {
  const o = read<AnalysisOptions | null>(lastKey(uid), null);
  return o
    ? { ...DEFAULT_ANALYSIS, ...o, filter: { ...DEFAULT_ANALYSIS.filter, ...o.filter } }
    : DEFAULT_ANALYSIS;
}

export function saveLast(uid: string, opts: AnalysisOptions): void {
  write(lastKey(uid), opts);
}
