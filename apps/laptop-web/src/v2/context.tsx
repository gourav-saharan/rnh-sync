// Laptop_Web_App v2 services: Firebase-backed session + template stores and
// the signed-in user. Injectable for component tests.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppUser, CustomerTemplateV2, TestSessionV2 } from '@rnh/shared/v2';
import {
  createSessionStoreV2,
  createTemplateStoreV2,
  type AuthServiceV2,
  type SessionStoreV2,
  type TemplateStoreV2,
} from '@rnh/shared/v2data';

export interface LaptopServices {
  user: AppUser;
  auth: AuthServiceV2;
  sessions: SessionStoreV2;
  templates: TemplateStoreV2;
}

const Ctx = createContext<LaptopServices | null>(null);

export function useLaptop(): LaptopServices {
  const v = useContext(Ctx);
  if (!v) throw new Error('LaptopServices missing');
  return v;
}

export function LaptopProvider(props: {
  user: AppUser;
  auth: AuthServiceV2;
  sessions?: SessionStoreV2;
  templates?: TemplateStoreV2;
  children: ReactNode;
}): JSX.Element {
  const value = useMemo<LaptopServices>(
    () => ({
      user: props.user,
      auth: props.auth,
      sessions: props.sessions ?? createSessionStoreV2(),
      templates: props.templates ?? createTemplateStoreV2(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.user.uid],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/** Live list of all v2 sessions (R9.3: updates without reload). */
export function useLiveSessions(): Live<TestSessionV2[]> {
  const { sessions } = useLaptop();
  const [state, setState] = useState<Live<TestSessionV2[]>>({
    data: [],
    loading: true,
    error: null,
  });
  useEffect(
    () =>
      sessions.subscribeAll(
        (items) => setState({ data: items, loading: false, error: null }),
        (e) => setState((s) => ({ ...s, loading: false, error: plainError(e) })),
      ),
    [sessions],
  );
  return state;
}

export function useLiveSession(sid: string): Live<TestSessionV2 | null> {
  const { sessions } = useLaptop();
  const [state, setState] = useState<Live<TestSessionV2 | null>>({
    data: null,
    loading: true,
    error: null,
  });
  useEffect(
    () =>
      sessions.subscribeOne(
        sid,
        (s) => setState({ data: s, loading: false, error: null }),
        (e) => setState((s) => ({ ...s, loading: false, error: plainError(e) })),
      ),
    [sessions, sid],
  );
  return state;
}

export function useLiveTemplates(): Live<CustomerTemplateV2[]> {
  const { templates } = useLaptop();
  const [state, setState] = useState<Live<CustomerTemplateV2[]>>({
    data: [],
    loading: true,
    error: null,
  });
  useEffect(
    () =>
      templates.subscribeTemplates(
        (items) => setState({ data: items, loading: false, error: null }),
        (e) => setState((s) => ({ ...s, loading: false, error: plainError(e) })),
      ),
    [templates],
  );
  return state;
}

/** Plain-language error text (R15.6). */
export function plainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/permission|insufficient/i.test(msg))
    return 'You do not have permission for this. Ask an administrator to check your roles.';
  if (/cors|storage\/retry-limit-exceeded|storage\/unknown/i.test(msg))
    return 'Upload failed. Check your connection and try again.';
  if (/offline|network|unavailable/i.test(msg))
    return 'No connection to the server. Check your network and try again.';
  return msg || 'Something went wrong. Please try again.';
}

/** Browser download of bytes as a file. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  // Copy into a plain ArrayBuffer-backed view so it is a valid BlobPart.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '–';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
