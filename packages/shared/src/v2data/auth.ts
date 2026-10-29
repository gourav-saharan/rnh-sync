// v2 Auth_Service: Firebase Auth + multi-role users/{uid} (R1.1–R1.3, R1.9).
// No Cloud Functions: role docs are created once by self-registration (rules
// enforce the allowed roles) or by tools/seed-users.mjs.

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { getFirebaseServices } from '../firebase/app';
import { ALL_ROLES, type AppUser, type Role, type UserDoc } from '../v2/model';

export type AuthStateV2 =
  | { state: 'loading' }
  | { state: 'unauthenticated' }
  | { state: 'no-role'; uid: string; email: string }
  /** Signed in, but the role document could not be read (usually no connection). */
  | { state: 'error'; uid: string; email: string }
  | { state: 'authorized'; user: AppUser };

export interface AuthServiceV2 {
  signIn(email: string, password: string): Promise<void>;
  /**
   * Create an account and its `users/{uid}` doc. Self-registration always
   * gets `roles: ['Tester']` (design "Security Rules (v2)"); office roles are
   * granted only by tools/seed-users.mjs.
   */
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(cb: (s: AuthStateV2) => void): () => void;
  /** Re-read the signed-in user's roles and notify subscribers. */
  refresh(): void;
  /**
   * Add the Tester role to the signed-in account (the only self-service role
   * change the rules allow), or create a Tester profile if none exists.
   */
  enableTester(): Promise<void>;
}

/** The only roles a client may give itself at sign-up (enforced in firestore.rules). */
export const SELF_REGISTER_ROLES: readonly Role[] = ['Tester'];

/** Roles list after adding Tester, or null when it is already present. */
export function withTester(roles: readonly Role[]): Role[] | null {
  return roles.includes('Tester') ? null : [...roles, 'Tester'];
}

/** Roles from a user doc: v2 `roles[]`, else legacy single `role`. */
export function rolesFromDoc(data: Record<string, unknown> | null | undefined): Role[] {
  if (!data) return [];
  const out = new Set<Role>();
  if (Array.isArray(data.roles)) {
    for (const r of data.roles)
      if ((ALL_ROLES as readonly unknown[]).includes(r)) out.add(r as Role);
  }
  if ((ALL_ROLES as readonly unknown[]).includes(data.role)) out.add(data.role as Role);
  // v1 Report_Viewers managed templates; keep that ability until migrated.
  if (out.has('Report_Viewer') && !Array.isArray(data.roles)) out.add('Template_Admin');
  return [...out];
}

export function describeAuthErrorV2(cause: unknown): string {
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
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your administrator.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your network and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

const CACHE_KEY = 'rnh.v2.lastUser';

function cacheUser(user: AppUser | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function cachedUser(uid: string): AppUser | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    const u = raw ? (JSON.parse(raw) as AppUser) : null;
    return u && u.uid === uid ? u : null;
  } catch {
    return null;
  }
}

/** Auth states produced for a signed-in Firebase user. */
export type ResolvedAuthStateV2 = Extract<
  AuthStateV2,
  { state: 'authorized' } | { state: 'no-role' } | { state: 'error' }
>;

/**
 * Resolve the signed-in user's roles from `users/{uid}` (R1.1, R1.3).
 *
 * Roles come only from the stored document; the client never grants or
 * writes roles here (R14.4). A missing doc or an empty roles list is
 * `no-role`. When the doc cannot be read (offline, R1.9) the last cached
 * profile for the same uid is reused with its cached roles; without one
 * the result is `error`. The cache only drives the UI: the security rules
 * still check the server-side roles on every request.
 */
export async function resolveUserV2(
  firestore: Firestore,
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
): Promise<ResolvedAuthStateV2> {
  const email = user.email ?? '';
  let data: Record<string, unknown> | null;
  try {
    const snap = await getDoc(doc(firestore, 'users', user.uid));
    data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    const cached = cachedUser(user.uid);
    if (cached) return { state: 'authorized', user: cached };
    return { state: 'error', uid: user.uid, email };
  }

  const roles = rolesFromDoc(data);
  if (roles.length === 0) {
    cacheUser(null);
    return { state: 'no-role', uid: user.uid, email };
  }

  const resolved: AppUser = {
    uid: user.uid,
    email: email || String(data?.email ?? ''),
    displayName:
      String(data?.displayName ?? '') || user.displayName || email || String(data?.email ?? ''),
    roles,
  };
  cacheUser(resolved);
  return { state: 'authorized', user: resolved };
}

export function createAuthServiceV2(
  authInstance?: Auth,
  firestoreInstance?: Firestore,
): AuthServiceV2 {
  const services = authInstance && firestoreInstance ? null : getFirebaseServices();
  const auth = authInstance ?? services!.auth;
  const firestore = firestoreInstance ?? services!.firestore;
  const refreshers = new Set<() => void>();

  return {
    async signIn(email, password) {
      try {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } catch (cause) {
        throw new Error(describeAuthErrorV2(cause));
      }
    },

    async signUp(email, password, displayName) {
      let user: User;
      try {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        user = cred.user;
      } catch (cause) {
        throw new Error(describeAuthErrorV2(cause));
      }
      const name = displayName.trim() || email.trim();
      try {
        await updateProfile(user, { displayName: name });
      } catch {
        /* display name is optional */
      }
      const userDoc: UserDoc = {
        uid: user.uid,
        email: user.email ?? email.trim(),
        displayName: name,
        roles: [...SELF_REGISTER_ROLES],
        createdAt: Date.now(),
      };
      try {
        await setDoc(doc(firestore, 'users', user.uid), userDoc);
      } catch {
        throw new Error(
          'Your account was created, but its profile could not be saved. Sign in again to retry.',
        );
      }
      // onAuthStateChanged fired before the doc existed; re-resolve now.
      for (const r of refreshers) r();
    },

    async signOut() {
      cacheUser(null);
      await fbSignOut(auth);
    },

    subscribe(cb) {
      cb({ state: 'loading' });
      let seq = 0;
      const run = (user: User | null): void => {
        const mine = ++seq;
        if (!user) {
          cb({ state: 'unauthenticated' });
          return;
        }
        const tryResolve = (attempt: number): void => {
          resolveUserV2(firestore, user)
            .then((resolved) => {
              if (mine !== seq) return;
              // Brief retry for transient read failures; never grant roles.
              if (resolved.state === 'error' && attempt < 2) {
                setTimeout(() => tryResolve(attempt + 1), 700);
                return;
              }
              cb(resolved);
            })
            .catch(() => {
              if (mine !== seq) return;
              cb({ state: 'error', uid: user.uid, email: user.email ?? '' });
            });
        };
        tryResolve(0);
      };
      const rerun = () => {
        cb({ state: 'loading' });
        run(auth.currentUser);
      };
      refreshers.add(rerun);
      const unsub = onAuthStateChanged(auth, run);
      return () => {
        refreshers.delete(rerun);
        unsub();
      };
    },

    refresh() {
      for (const r of refreshers) r();
    },

    async enableTester() {
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in first.');
      const ref = doc(firestore, 'users', user.uid);
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          const name = user.displayName || user.email || '';
          const userDoc: UserDoc = {
            uid: user.uid,
            email: user.email ?? '',
            displayName: name,
            roles: ['Tester'],
            createdAt: Date.now(),
          };
          await setDoc(ref, userDoc);
        } else {
          const raw = (snap.data() as Record<string, unknown>).roles;
          if (!Array.isArray(raw)) {
            throw new Error(
              'This account still uses the old role format. Ask your administrator to run the v2 migration.',
            );
          }
          const next = withTester(
            raw.filter((r): r is Role => (ALL_ROLES as readonly unknown[]).includes(r)),
          );
          if (next && next.length === raw.length + 1) await updateDoc(ref, { roles: next });
        }
      } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith('This account')) throw cause;
        const code =
          typeof cause === 'object' && cause && 'code' in cause
            ? String((cause as { code: unknown }).code)
            : '';
        throw new Error(
          code === 'permission-denied'
            ? 'The server refused the change. The latest security rules may not be deployed yet.'
            : 'Could not update the account. Check your connection and try again.',
        );
      }
      this.refresh();
    },
  };
}
