// PWA lifecycle glue for the installed Mobile_PWA:
//  - "update available": the service worker found a new build. We ask before
//    reloading (registerType 'prompt'), so an update never lands mid-rating.
//  - "install app": Android/Chrome fires `beforeinstallprompt`; iOS has no
//    prompt, so we show Add to Home Screen steps instead.
// Both browser events can fire before React renders, so main.tsx wires them
// up first and components read the state through the hooks below.

import { useEffect, useState } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => {
  for (const l of listeners) l();
};

function useStore<T>(read: () => T): T {
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const l = () => setValue(read());
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
    // `read` is a module-level function; it never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

// --- Update available -------------------------------------------------------

let applyUpdate: (() => Promise<void>) | null = null;

/** Called by registerSW's onNeedRefresh with a function that activates it. */
export function setUpdateReady(apply: () => Promise<void>): void {
  applyUpdate = apply;
  notify();
}

export function useUpdateReady(): boolean {
  return useStore(() => applyUpdate !== null);
}

/** Activate the waiting service worker; the page reloads on the new build. */
export async function applyUpdateNow(): Promise<void> {
  if (applyUpdate) await applyUpdate();
}

// --- Install app ------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
let installed = false;

/** Capture the browser's install prompt so we can show our own button. */
export function listenForInstall(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  target.addEventListener('appinstalled', () => {
    installEvent = null;
    installed = true;
    notify();
  });
}

/** Already running as an installed app (home-screen icon, no browser bar). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const media = window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return media || iosStandalone;
}

export function isIos(ua: string = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  // iPadOS reports a Mac user agent but has touch.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && (touchPoints ?? 0) > 1);
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'unavailable';

export function currentInstallMode(): InstallMode {
  if (installed || isStandalone()) return 'installed';
  if (installEvent) return 'prompt';
  if (isIos()) return 'ios';
  return 'unavailable';
}

export function useInstallMode(): InstallMode {
  return useStore(currentInstallMode);
}

/** Show the browser's install dialog. True when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const ev = installEvent;
  if (!ev) return false;
  await ev.prompt();
  const choice = await ev.userChoice;
  // A prompt can be used only once.
  installEvent = null;
  if (choice.outcome === 'accepted') installed = true;
  notify();
  return choice.outcome === 'accepted';
}

/** Test-only: forget captured events. */
export function resetPwaStateForTests(): void {
  applyUpdate = null;
  installEvent = null;
  installed = false;
  notify();
}
