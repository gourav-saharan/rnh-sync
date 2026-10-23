// Firebase SDK initialization for Auth, Firestore, and Cloud Storage.
//
// A single initialized app instance is shared by both front-ends via the
// `@rnh/shared` package. The instance is created lazily so importing this
// module never triggers network setup or config validation until an app
// actually asks for a service. When emulators are enabled, each service is
// connected to its local emulator exactly once.

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import {
  loadEmulatorConfig,
  loadFirebaseConfig,
  shouldUseEmulators,
  type EmulatorConfig,
  type FirebaseEnvConfig,
} from './config';

/** The set of initialized Firebase services shared across the app. */
export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  /** Optional legacy storage reference; the app uses Firestore blobs. */
  storage?: FirebaseStorage;
}

/** Options for {@link initializeFirebase}, primarily for tests. */
export interface InitFirebaseOptions {
  /** Explicit config. When omitted, config is read from the environment. */
  config?: FirebaseEnvConfig;
  /** Force emulator use on/off. When omitted, derived from the environment. */
  useEmulators?: boolean;
  /** Emulator wiring override. When omitted, read from the environment. */
  emulatorConfig?: EmulatorConfig;
}

let services: FirebaseServices | null = null;
let emulatorsConnected = false;

/**
 * Initializes (or returns the already-initialized) Firebase services.
 *
 * Safe to call from multiple entry points: the underlying `FirebaseApp` is
 * created once and reused, and emulator connections are made at most once.
 */
export function initializeFirebase(options: InitFirebaseOptions = {}): FirebaseServices {
  if (services) {
    return services;
  }

  const config = options.config ?? loadFirebaseConfig();

  const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  let storage: FirebaseStorage | undefined;
  try {
    storage = getStorage(app);
  } catch {
    /* Storage not used */
  }

  const useEmulators = options.useEmulators ?? shouldUseEmulators();
  if (useEmulators && !emulatorsConnected) {
    const emu = options.emulatorConfig ?? loadEmulatorConfig();
    connectAuthEmulator(auth, emu.authUrl, { disableWarnings: true });
    connectFirestoreEmulator(firestore, emu.firestoreHost, emu.firestorePort);
    if (storage) {
      try {
        connectStorageEmulator(storage, emu.storageHost, emu.storagePort);
      } catch {
        /* ignore */
      }
    }
    emulatorsConnected = true;
  }

  services = { app, auth, firestore, storage };
  return services;
}

/**
 * Returns the initialized services, initializing them on first access with
 * environment-derived config. Convenience for callers that do not need to
 * customize initialization.
 */
export function getFirebaseServices(): FirebaseServices {
  return services ?? initializeFirebase();
}

/**
 * Resets the cached services. Intended for tests so each test can initialize
 * with its own config/emulator settings.
 */
export function resetFirebaseForTests(): void {
  services = null;
  emulatorsConnected = false;
}
