// Mobile_PWA v2 service context: one local store, one sync engine and the
// Firebase-backed remote stores for the app's lifetime. Everything is
// injectable so component tests can pass fakes.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getFirebaseServices } from '@rnh/shared';
import type { AppUser } from '@rnh/shared/v2';
import {
  createSessionStoreV2,
  createTemplateStoreV2,
  savePhotoBlob,
  type AuthServiceV2,
  type SessionStoreV2,
  type TemplateStoreV2,
} from '@rnh/shared/v2data';
import { mobileStoreV2, requestPersistentStorage, type MobileStoreV2 } from './store';
import { createSyncEngineV2, type SyncEngineV2, type SyncStatusV2 } from './syncEngine';

export interface MobileServices {
  user: AppUser;
  auth: AuthServiceV2;
  local: MobileStoreV2;
  remote: SessionStoreV2;
  templates: TemplateStoreV2;
  sync: SyncEngineV2;
}

const Ctx = createContext<MobileServices | null>(null);

export function useServices(): MobileServices {
  const v = useContext(Ctx);
  if (!v) throw new Error('MobileServices missing');
  return v;
}

export interface ServicesProviderProps {
  user: AppUser;
  auth: AuthServiceV2;
  local?: MobileStoreV2;
  remote?: SessionStoreV2;
  templates?: TemplateStoreV2;
  sync?: SyncEngineV2;
  children: ReactNode;
}

export function ServicesProvider(props: ServicesProviderProps): JSX.Element {
  const value = useMemo<MobileServices>(() => {
    const local = props.local ?? mobileStoreV2();
    const remote = props.remote ?? createSessionStoreV2();
    const templates = props.templates ?? createTemplateStoreV2();
    const uploadPhoto = async (path: string, blob: Blob, contentType: string) => {
      const { firestore } = getFirebaseServices();
      await savePhotoBlob(firestore, path, blob, contentType, props.user.uid);
    };
    const sync =
      props.sync ??
      createSyncEngineV2({ local, remote, templates, uploadPhoto, userId: props.user.uid });
    return { user: props.user, auth: props.auth, local, remote, templates, sync };
    // Services are created once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.user.uid]);

  useEffect(() => value.sync.start(), [value]);
  useEffect(() => {
    void requestPersistentStorage().then((granted) =>
      value.local.setMeta('persistGranted', granted),
    );
  }, [value]);

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

/** Live sync status for the header chip (R8.6). */
export function useSyncStatus(): SyncStatusV2 {
  const { sync } = useServices();
  const [s, setS] = useState<SyncStatusV2>(() => sync.getStatus());
  useEffect(() => sync.subscribe(setS), [sync]);
  return s;
}

/** Theme (R6.12): 'sun' = high-contrast light, 'night' = dark. */
export type Theme = 'sun' | 'night';
const THEME_KEY = 'rnh.v2.theme';

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'night' ? 'night' : 'sun';
    } catch {
      return 'sun';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, setTheme];
}

/** Drive_Mode preferences (R6.5): auto-advance delay, 0 = off. */
const PREFS_KEY = 'rnh.v2.prefs';
export interface DrivePrefs {
  autoAdvanceMs: number;
  haptics: boolean;
}
export const DEFAULT_PREFS: DrivePrefs = { autoAdvanceMs: 600, haptics: true };

export function loadPrefs(): DrivePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<DrivePrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: DrivePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
