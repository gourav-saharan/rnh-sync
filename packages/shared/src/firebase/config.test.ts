import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMULATOR_CONFIG,
  loadEmulatorConfig,
  loadFirebaseConfig,
  shouldUseEmulators,
} from './config';

const completeEnv = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'rnh.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'rnh-tyre-testing-system',
  VITE_FIREBASE_STORAGE_BUCKET: 'rnh.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
};

describe('loadFirebaseConfig', () => {
  it('maps all required env variables into a config object', () => {
    const config = loadFirebaseConfig(completeEnv);
    expect(config).toEqual({
      apiKey: 'test-api-key',
      authDomain: 'rnh.firebaseapp.com',
      projectId: 'rnh-tyre-testing-system',
      storageBucket: 'rnh.appspot.com',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef',
    });
  });

  it('throws listing every missing variable', () => {
    expect(() => loadFirebaseConfig({})).toThrowError(/Missing Firebase configuration/);
    try {
      loadFirebaseConfig({});
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('VITE_FIREBASE_API_KEY');
      expect(message).toContain('VITE_FIREBASE_APP_ID');
      expect(message).toContain('VITE_FIREBASE_MESSAGING_SENDER_ID');
    }
  });

  it('treats blank/whitespace values as missing', () => {
    expect(() => loadFirebaseConfig({ ...completeEnv, VITE_FIREBASE_API_KEY: '   ' })).toThrowError(
      /VITE_FIREBASE_API_KEY/,
    );
  });
});

describe('shouldUseEmulators', () => {
  it('is true for "true" and "1"', () => {
    expect(shouldUseEmulators({ VITE_FIREBASE_USE_EMULATORS: 'true' })).toBe(true);
    expect(shouldUseEmulators({ VITE_FIREBASE_USE_EMULATORS: '1' })).toBe(true);
    expect(shouldUseEmulators({ VITE_FIREBASE_USE_EMULATORS: 'TRUE' })).toBe(true);
  });

  it('is false when unset or falsey', () => {
    expect(shouldUseEmulators({})).toBe(false);
    expect(shouldUseEmulators({ VITE_FIREBASE_USE_EMULATORS: 'false' })).toBe(false);
    expect(shouldUseEmulators({ VITE_FIREBASE_USE_EMULATORS: '0' })).toBe(false);
  });
});

describe('loadEmulatorConfig', () => {
  it('falls back to defaults when nothing is overridden', () => {
    expect(loadEmulatorConfig({})).toEqual(DEFAULT_EMULATOR_CONFIG);
  });

  it('applies overrides and coerces ports to numbers', () => {
    const config = loadEmulatorConfig({
      VITE_FIREBASE_EMULATOR_FIRESTORE_PORT: '9090',
      VITE_FIREBASE_EMULATOR_STORAGE_HOST: 'localhost',
    });
    expect(config.firestorePort).toBe(9090);
    expect(config.storageHost).toBe('localhost');
    // Untouched values keep their defaults.
    expect(config.authUrl).toBe(DEFAULT_EMULATOR_CONFIG.authUrl);
    expect(config.storagePort).toBe(DEFAULT_EMULATOR_CONFIG.storagePort);
  });
});
