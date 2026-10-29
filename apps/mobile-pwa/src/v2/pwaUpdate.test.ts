import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUpdateNow,
  currentInstallMode,
  isIos,
  listenForInstall,
  promptInstall,
  resetPwaStateForTests,
  setUpdateReady,
} from './pwaUpdate';
import { pullOffset, PULL_THRESHOLD } from './pullToRefresh';

afterEach(() => resetPwaStateForTests());

function fakeInstallEvent(outcome: 'accepted' | 'dismissed') {
  // Real beforeinstallprompt events are cancelable; preventDefault needs that.
  const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  ev.prompt = vi.fn(async () => {});
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
}

describe('update available', () => {
  it('runs the activator once a new build is waiting', async () => {
    const apply = vi.fn(async () => {});
    setUpdateReady(apply);
    await applyUpdateNow();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('install prompt', () => {
  it('captures the browser prompt and installs on accept', async () => {
    const target = new EventTarget();
    listenForInstall(target as unknown as Window);
    const ev = fakeInstallEvent('accepted');
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(currentInstallMode()).toBe('prompt');
    await expect(promptInstall()).resolves.toBe(true);
    expect(ev.prompt).toHaveBeenCalled();
    expect(currentInstallMode()).toBe('installed');
  });

  it('drops a used prompt when the user declines', async () => {
    const target = new EventTarget();
    listenForInstall(target as unknown as Window);
    target.dispatchEvent(fakeInstallEvent('dismissed'));
    await expect(promptInstall()).resolves.toBe(false);
    expect(currentInstallMode()).not.toBe('prompt');
  });

  it('detects iPhone and iPad (desktop-class UA with touch)', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 14)', 5)).toBe(false);
  });
});

describe('pull to refresh', () => {
  it('ignores upward drags and damps downward ones up to a cap', () => {
    expect(pullOffset(-20)).toBe(0);
    expect(pullOffset(40)).toBe(20);
    expect(pullOffset(PULL_THRESHOLD * 2)).toBe(PULL_THRESHOLD);
    expect(pullOffset(1000)).toBe(96);
  });
});
