import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the browser-only Firebase Analytics SDK so tests are deterministic and
// Node-safe (no real analytics, no network, no browser APIs required).
const isSupportedMock = vi.fn(() => Promise.resolve(false));
const getAnalyticsMock = vi.fn();

vi.mock('firebase/analytics', () => ({
  isSupported: () => isSupportedMock(),
  getAnalytics: (app: unknown) => getAnalyticsMock(app),
}));

// Mock the shared app so we never touch a real Firebase app instance.
const fakeApp = { name: 'test-app' };
vi.mock('./app', () => ({
  getFirebaseServices: () => ({ app: fakeApp }),
}));

// Mock the config loader so each test controls whether a measurementId exists.
const loadFirebaseConfigMock = vi.fn();
vi.mock('./config', () => ({
  loadFirebaseConfig: () => loadFirebaseConfigMock(),
}));

import { initAnalytics } from './analytics';

const withMeasurementId = {
  apiKey: 'k',
  authDomain: 'd',
  projectId: 'p',
  storageBucket: 's',
  messagingSenderId: 'm',
  appId: 'a',
  measurementId: 'G-TEST123',
};

const withoutMeasurementId = { ...withMeasurementId, measurementId: undefined };

describe('initAnalytics', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    isSupportedMock.mockReset();
    getAnalyticsMock.mockReset();
    loadFirebaseConfigMock.mockReset();
    // Simulate a browser runtime by default so we can exercise the guards.
    (globalThis as { window?: unknown }).window = {} as unknown;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('returns null when there is no browser window (Node/SSR/test)', async () => {
    delete (globalThis as { window?: unknown }).window;
    loadFirebaseConfigMock.mockReturnValue(withMeasurementId);
    isSupportedMock.mockResolvedValue(true);

    await expect(initAnalytics()).resolves.toBeNull();
    expect(getAnalyticsMock).not.toHaveBeenCalled();
  });

  it('returns null when no measurementId is configured', async () => {
    loadFirebaseConfigMock.mockReturnValue(withoutMeasurementId);
    isSupportedMock.mockResolvedValue(true);

    await expect(initAnalytics()).resolves.toBeNull();
    expect(getAnalyticsMock).not.toHaveBeenCalled();
  });

  it('returns null when Analytics is unsupported in this browser', async () => {
    loadFirebaseConfigMock.mockReturnValue(withMeasurementId);
    isSupportedMock.mockResolvedValue(false);

    await expect(initAnalytics()).resolves.toBeNull();
    expect(getAnalyticsMock).not.toHaveBeenCalled();
  });

  it('returns a truthy Analytics instance when supported and configured', async () => {
    const analytics = { app: fakeApp };
    loadFirebaseConfigMock.mockReturnValue(withMeasurementId);
    isSupportedMock.mockResolvedValue(true);
    getAnalyticsMock.mockReturnValue(analytics);

    await expect(initAnalytics()).resolves.toBe(analytics);
    expect(getAnalyticsMock).toHaveBeenCalledWith(fakeApp);
  });

  it('never throws and returns null when config loading fails', async () => {
    loadFirebaseConfigMock.mockImplementation(() => {
      throw new Error('missing config');
    });

    await expect(initAnalytics()).resolves.toBeNull();
    expect(getAnalyticsMock).not.toHaveBeenCalled();
  });
});
