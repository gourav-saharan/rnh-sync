// Auth_Service — wraps Firebase Auth and resolves the single per-user role.
//
// This module implements the Auth_Service described in design.md
// (Components and Interfaces -> Auth_Service):
//
//   interface AuthService {
//     signIn(email, password): Promise<AuthUser>;   // R1.1, R1.2
//     signOut(): Promise<void>;                      // R1.7
//     currentUser(): AuthUser | null;                // R1.6
//     onAuthChange(cb): Unsubscribe;
//   }
//
// Responsibilities:
//   - Authenticate against the Firebase_Backend on valid credentials (R1.1).
//   - Deny access and surface a descriptive authentication error on invalid
//     credentials (R1.2, Error Handling — Auth).
//   - Resolve the single role from the user's `users/{uid}` document and expose
//     it on AuthUser; each authenticated user has exactly one role (R1.3).
//   - Expose the current user and subscribe to auth changes so UIs can gate
//     access; while unauthenticated only sign-in is reachable (R1.6).
//   - End the session on sign-out (R1.7).
//
// The role gates the UI (Tester -> capture on Mobile_PWA (R1.4);
// Report_Viewer -> report generation/export on Laptop_Web_App (R1.5)) and is
// mirrored by the Firestore Security Rules.

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { firestorePaths } from '../firebase/collections';
import { getFirebaseServices } from '../firebase/app';
import { ROLES, type AuthUser, type Role, type UserDoc } from '../index';

/** Unsubscribe handle returned by {@link AuthService.onAuthChange}. */
export type Unsubscribe = () => void;

/**
 * The auth status surfaced by {@link AuthService.onAuthStatusChange}. Unlike
 * the legacy {@link AuthService.onAuthChange} (which collapses "no valid role"
 * into `null`), this discriminated union distinguishes a Firebase-authenticated
 * user who has no assigned role from one who is not signed in at all — so the
 * app can show an actionable "no role yet" screen instead of silently bouncing
 * the user back to sign-in (R1.3, R1.6).
 */
export type AuthStatus =
  | { state: 'unauthenticated' }
  | { state: 'no-role'; uid: string; email: string }
  | { state: 'authorized'; user: AuthUser };

/** The Auth_Service surface consumed by both apps (design.md). */
export interface AuthService {
  /** Authenticate with email/password, resolving the user + role (R1.1, R1.2). */
  signIn(email: string, password: string): Promise<AuthUser>;
  /**
   * Create a new Firebase Auth account, assign it the given role by writing its
   * `users/{uid}` document, and resolve the {@link AuthUser}. Each app passes
   * its own role (Mobile_PWA -> Tester, Laptop_Web_App -> Report_Viewer).
   *
   * Optional so existing in-memory test doubles typed as {@link AuthService}
   * remain valid; the register UI feature-detects it before calling.
   */
  signUp?(email: string, password: string, role: Role): Promise<AuthUser>;
  /** End the session and return to a signed-out state (R1.7). */
  signOut(): Promise<void>;
  /** The currently authenticated user, or null while unauthenticated (R1.6). */
  currentUser(): AuthUser | null;
  /** Subscribe to auth-state changes; fires with the resolved user or null. */
  onAuthChange(cb: (user: AuthUser | null) => void): Unsubscribe;
  /**
   * Subscribe to richer auth-status changes; distinguishes 'unauthenticated',
   * 'no-role' (authenticated but no valid role), and 'authorized' (R1.3, R1.6).
   * Optional so existing in-memory test doubles typed as {@link AuthService}
   * remain valid; consumers should feature-detect before calling.
   */
  onAuthStatusChange?(cb: (status: AuthStatus) => void): Unsubscribe;
}

/**
 * Error thrown when authentication fails. Carries a descriptive, user-facing
 * message suitable for display on the sign-in screen (R1.2).
 */
export class AuthenticationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AuthenticationError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Error thrown when an authenticated user has no valid `users/{uid}` document
 * or the stored role is not one of the known {@link ROLES}. A user must have
 * exactly one valid role (R1.3); without one, access is denied.
 */
export class MissingRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingRoleError';
  }
}

/** Type guard: is `value` one of the known roles (R1.3)? */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Pure role-resolution core, factored out of {@link resolveAuthUser} so it can
 * be exercised without Firebase.
 *
 * Given arbitrary user-document data, this produces the single {@link Role}
 * that a resolved {@link AuthUser} would carry, or throws {@link MissingRoleError}
 * when the data has no valid role (absent, wrong type, or an unknown string).
 * A resolved user therefore always has exactly one role from {@link ROLES} —
 * never zero and never more than one (R1.3).
 */
export function resolveRole(data: Partial<UserDoc> | null | undefined): Role {
  if (data == null || !isRole(data.role)) {
    throw new MissingRoleError(
      'This account does not have a valid role assigned. ' +
        'Contact an administrator to be granted a Tester or Report_Viewer role.',
    );
  }
  return data.role;
}

/**
 * Maps Firebase Auth error codes to descriptive, user-facing messages (R1.2).
 * Every invalid-credential path resolves to a single "invalid credentials"
 * message so we never leak whether an email exists.
 */
function describeAuthError(cause: unknown): string {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password. Please check your credentials and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact an administrator.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the authentication service. Check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

/**
 * Maps Firebase Auth error codes raised during account creation to descriptive,
 * user-facing messages shown on the register screen. Unlike sign-in (which
 * intentionally hides whether an email exists), registration must tell the user
 * their email is already in use so they can sign in instead.
 */
export function describeSignUpError(cause: unknown): string {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account already exists for this email. Try signing in instead.';
    case 'auth/invalid-email':
      return 'That email address is not valid. Please check it and try again.';
    case 'auth/weak-password':
      return 'That password is too weak. Use at least 6 characters.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-up is not enabled. Contact an administrator.';
    case 'auth/network-request-failed':
      return 'Could not reach the authentication service. Check your connection and try again.';
    default:
      return 'Could not create the account. Please try again.';
  }
}

/**
 * Writes the `users/{uid}` document that assigns a single {@link Role} to a
 * newly created account, mirroring the {@link UserDoc} shape (R1.3). Used by
 * {@link AuthService.signUp}; the Firestore Security Rules permit a signed-in
 * user to create their own role document exactly once with a valid role.
 */
export async function createUserRoleDoc(
  firestore: Firestore,
  uid: string,
  email: string,
  role: Role,
): Promise<void> {
  const userDoc: UserDoc = { uid, email, role, createdAt: Date.now() };
  await setDoc(doc(firestore, firestorePaths.user(uid)), userDoc);
}

/**
 * Reads the user's `users/{uid}` document and returns the resolved
 * {@link AuthUser} with its single role (R1.3). Throws {@link MissingRoleError}
 * when the document is absent or its role is invalid, so callers can deny
 * access rather than proceed roleless.
 */
async function resolveAuthUser(firestore: Firestore, user: User): Promise<AuthUser> {
  const snapshot = await getDoc(doc(firestore, firestorePaths.user(user.uid)));

  if (!snapshot.exists()) {
    throw new MissingRoleError(
      `No role is assigned to this account (missing users/${user.uid} document). ` +
        'Contact an administrator to be granted a Tester or Report_Viewer role.',
    );
  }

  const data = snapshot.data() as Partial<UserDoc>;
  const role = resolveRole(data);

  return {
    uid: user.uid,
    email: user.email ?? data.email ?? '',
    role,
  };
}

/**
 * Creates an {@link AuthService} bound to the given Firebase Auth and Firestore
 * instances. Defaults to the shared, environment-initialized services so both
 * apps can simply call {@link createAuthService} with no arguments; tests can
 * inject emulator-backed instances.
 */
export function createAuthService(
  authInstance?: Auth,
  firestoreInstance?: Firestore,
): AuthService {
  const services = authInstance && firestoreInstance ? null : getFirebaseServices();
  const auth = authInstance ?? services!.auth;
  const firestore = firestoreInstance ?? services!.firestore;

  // Cache of the most recently resolved user so `currentUser()` is synchronous
  // (design.md: currentUser(): AuthUser | null). Kept fresh by the auth
  // listener registered below.
  let cached: AuthUser | null = null;

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      cached = null;
      return;
    }
    resolveAuthUser(firestore, user)
      .then((resolved) => {
        cached = resolved;
      })
      .catch(() => {
        // A signed-in Firebase user with no valid role is treated as
        // unauthenticated for access purposes (R1.3, R1.6).
        cached = null;
      });
  });

  return {
    async signIn(email: string, password: string): Promise<AuthUser> {
      let credential;
      try {
        credential = await signInWithEmailAndPassword(auth, email, password);
      } catch (cause) {
        // Deny access and surface a descriptive authentication error (R1.2).
        throw new AuthenticationError(describeAuthError(cause), { cause });
      }

      const resolved = await resolveAuthUser(firestore, credential.user);
      cached = resolved;
      return resolved;
    },

    async signUp(email: string, password: string, role: Role): Promise<AuthUser> {
      let credential;
      try {
        credential = await createUserWithEmailAndPassword(auth, email, password);
      } catch (cause) {
        throw new AuthenticationError(describeSignUpError(cause), { cause });
      }

      const { uid } = credential.user;
      const resolvedEmail = credential.user.email ?? email;
      // Assign the role by creating the user's role document, then resolve the
      // AuthUser (R1.3). The auth listener will subsequently emit 'authorized'.
      await createUserRoleDoc(firestore, uid, resolvedEmail, role);

      const resolved: AuthUser = { uid, email: resolvedEmail, role };
      cached = resolved;
      return resolved;
    },

    async signOut(): Promise<void> {
      await firebaseSignOut(auth);
      cached = null;
    },

    currentUser(): AuthUser | null {
      return cached;
    },

    onAuthChange(cb: (user: AuthUser | null) => void): Unsubscribe {
      return onAuthStateChanged(auth, (user) => {
        if (!user) {
          cached = null;
          cb(null);
          return;
        }
        resolveAuthUser(firestore, user)
          .then((resolved) => {
            cached = resolved;
            cb(resolved);
          })
          .catch(() => {
            cached = null;
            cb(null);
          });
      });
    },

    onAuthStatusChange(cb: (status: AuthStatus) => void): Unsubscribe {
      return onAuthStateChanged(auth, (user) => {
        if (!user) {
          cached = null;
          cb({ state: 'unauthenticated' });
          return;
        }
        resolveAuthUser(firestore, user)
          .then((resolved) => {
            cached = resolved;
            cb({ state: 'authorized', user: resolved });
          })
          .catch((error) => {
            // Distinguish "authenticated but no valid role" from
            // "unauthenticated" so the app can show an actionable screen
            // instead of silently bouncing to sign-in (R1.3, R1.6).
            cached = null;
            if (error instanceof MissingRoleError) {
              cb({ state: 'no-role', uid: user.uid, email: user.email ?? '' });
            } else {
              cb({ state: 'unauthenticated' });
            }
          });
      });
    },
  };
}

/**
 * Determines whether a user (possibly null) may access a given capability,
 * implementing the role-based access rule (R1.4, R1.5, R1.6):
 *   - unauthenticated -> only 'sign-in'
 *   - Tester          -> 'capture'
 *   - Report_Viewer   -> 'report'
 *
 * This pure helper is shared by both apps' route guards and is the unit the
 * role-based access-control property (Property 2) exercises.
 */
export type Capability = 'sign-in' | 'capture' | 'report';

export function canAccess(user: AuthUser | null, capability: Capability): boolean {
  if (capability === 'sign-in') {
    // Sign-in is always reachable; while unauthenticated it is the only
    // reachable capability (R1.6).
    return true;
  }
  if (user === null) {
    // Unauthenticated: nothing but sign-in (R1.6).
    return false;
  }
  if (capability === 'capture') {
    // Test_Session capture is granted to Testers (R1.4).
    return user.role === 'Tester';
  }
  // Report generation/export is granted to Report_Viewers (R1.5).
  return user.role === 'Report_Viewer';
}
