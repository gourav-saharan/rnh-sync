// Firebase environment-based configuration for the R&H Tyre Testing System.
//
// Configuration is read from environment variables so the same code runs
// against a developer's Firebase project, the Emulator Suite, and production
// without code changes. Both Vite apps expose variables prefixed with `VITE_`
// on `import.meta.env`; Node contexts (tests, scripts) expose them on
// `process.env`. `readEnv` reads from whichever source is available.

/**
 * The shape of a Firebase Web SDK configuration object. Mirrors the object
 * Firebase hands out in the console under Project settings -> Your apps.
 */
export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  /**
   * Optional Google Analytics measurement ID (e.g. "G-XXXXXXXXXX"). Only used
   * to enable browser-only Firebase Analytics. Absent when Analytics is not
   * configured; never part of the required-variable validation.
   */
  measurementId?: string;
}

/**
 * Emulator host/port settings used when {@link shouldUseEmulators} is true.
 * Defaults match the ports declared in the root `firebase.json`.
 */
export interface EmulatorConfig {
  authUrl: string;
  firestoreHost: string;
  firestorePort: number;
  storageHost: string;
  storagePort: number;
}

/** Default emulator wiring, aligned with `firebase.json` at the repo root. */
export const DEFAULT_EMULATOR_CONFIG: EmulatorConfig = {
  authUrl: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
  storageHost: '127.0.0.1',
  storagePort: 9199,
};

type EnvRecord = Record<string, string | undefined>;

// The shared package emits its own types and does not depend on Vite's client
// type definitions. Declare `import.meta.env` as an optional record here so the
// literal `import.meta.env` member expression compiles under this package's
// tsconfig while remaining statically visible to Vite for env injection. The
// property is optional so Node/CommonJS contexts (where it is absent) type-check.
declare global {
  interface ImportMeta {
    readonly env?: EnvRecord;
  }
}

/**
 * Collects environment variables from every source available in the current
 * runtime. Vite replaces `import.meta.env` at build time; Node exposes
 * `process.env`. Missing sources are simply skipped.
 */
function collectEnv(): EnvRecord {
  const merged: EnvRecord = {};

  // Node / test / tooling context.
  if (typeof process !== 'undefined' && process.env) {
    Object.assign(merged, process.env);
  }

  // Vite / browser context: reference `import.meta.env` DIRECTLY so Vite's
  // dev-time and build-time env injection populates the VITE_* vars. Casting
  // `import.meta` to `any` (or optional-chaining it) hides the literal
  // `import.meta.env` member expression that Vite statically substitutes,
  // which is exactly what breaks dev-time injection for this shared module.
  // We cast only the RESULT type, keeping the `import.meta.env` token intact.
  try {
    const viteEnv: EnvRecord | undefined = import.meta.env;
    if (viteEnv) {
      Object.assign(merged, viteEnv);
    }
  } catch {
    // `import.meta.env` unavailable in this context (e.g. CommonJS Node); ignore.
  }

  return merged;
}

function readEnv(env: EnvRecord, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Builds a {@link FirebaseEnvConfig} from environment variables.
 *
 * @throws if any required variable is missing. Callers that want a softer
 *   failure (for example, emulator-only smoke runs) can catch this.
 */
export function loadFirebaseConfig(env: EnvRecord = collectEnv()): FirebaseEnvConfig {
  const config: FirebaseEnvConfig = {
    apiKey: readEnv(env, 'VITE_FIREBASE_API_KEY') ?? '',
    authDomain: readEnv(env, 'VITE_FIREBASE_AUTH_DOMAIN') ?? '',
    projectId: readEnv(env, 'VITE_FIREBASE_PROJECT_ID') ?? '',
    storageBucket: readEnv(env, 'VITE_FIREBASE_STORAGE_BUCKET') ?? '',
    messagingSenderId: readEnv(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID') ?? '',
    appId: readEnv(env, 'VITE_FIREBASE_APP_ID') ?? '',
  };

  const missing = (Object.keys(config) as Array<keyof FirebaseEnvConfig>).filter(
    (key) => (config[key] ?? '').length === 0,
  );

  if (missing.length > 0) {
    const envKeys = missing.map((key) => `VITE_FIREBASE_${camelToScreamingSnake(key)}`);
    throw new Error(
      `Missing Firebase configuration environment variables: ${envKeys.join(', ')}. ` +
        'Set them in your .env file or supply an explicit config object.',
    );
  }

  // Optional: attached only when present so it never affects the required-var
  // validation above (and so existing config equality checks stay unchanged).
  const measurementId = readEnv(env, 'VITE_FIREBASE_MEASUREMENT_ID');
  if (measurementId) {
    config.measurementId = measurementId;
  }

  return config;
}

function camelToScreamingSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * True when the app should point the SDK at the local Emulator Suite instead
 * of a live Firebase project. Controlled by `VITE_FIREBASE_USE_EMULATORS`
 * (accepts `true`/`1`), defaulting to off.
 */
export function shouldUseEmulators(env: EnvRecord = collectEnv()): boolean {
  const flag = readEnv(env, 'VITE_FIREBASE_USE_EMULATORS')?.toLowerCase();
  return flag === 'true' || flag === '1';
}

/**
 * Builds an {@link EmulatorConfig} from environment variables, falling back to
 * {@link DEFAULT_EMULATOR_CONFIG} for any value that is not overridden.
 */
export function loadEmulatorConfig(env: EnvRecord = collectEnv()): EmulatorConfig {
  const firestorePort = readEnv(env, 'VITE_FIREBASE_EMULATOR_FIRESTORE_PORT');
  const storagePort = readEnv(env, 'VITE_FIREBASE_EMULATOR_STORAGE_PORT');

  return {
    authUrl: readEnv(env, 'VITE_FIREBASE_EMULATOR_AUTH_URL') ?? DEFAULT_EMULATOR_CONFIG.authUrl,
    firestoreHost:
      readEnv(env, 'VITE_FIREBASE_EMULATOR_FIRESTORE_HOST') ??
      DEFAULT_EMULATOR_CONFIG.firestoreHost,
    firestorePort: firestorePort ? Number(firestorePort) : DEFAULT_EMULATOR_CONFIG.firestorePort,
    storageHost:
      readEnv(env, 'VITE_FIREBASE_EMULATOR_STORAGE_HOST') ?? DEFAULT_EMULATOR_CONFIG.storageHost,
    storagePort: storagePort ? Number(storagePort) : DEFAULT_EMULATOR_CONFIG.storagePort,
  };
}
