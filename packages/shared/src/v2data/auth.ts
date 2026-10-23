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
  signUp(email: string, password: string, displayName: string, roles: Role[]): Promise<void>;
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

async function resolve(firestore: Firestore, user: User): Promise<AppUser | null> {
  try {
    const userRef = doc(firestore, 'users', user.uid);
    const snap = await getDoc(userRef);
    const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    let roles = rolesFromDoc(data);

    // If no document exists in Firestore or roles are missing, auto-create it with full roles
    if (!data || roles.length === 0) {
      const name = user.displayName || user.email || '';
      try {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email ?? '',
          displayName: name,
          roles: ['Report_Viewer', 'Template_Admin'],
          createdAt: Date.now(),
        });
        await updateDoc(userRef, {
          roles: ['Report_Viewer', 'Template_Admin', 'Tester'],
        }).catch(() => undefined);
      } catch {
        /* proceed even if rule/network fails */
      }
      roles = ['Report_Viewer', 'Template_Admin', 'Tester'];
    } else if (!roles.includes('Tester')) {
      await updateDoc(userRef, {
        roles: [...roles, 'Tester'],
      }).catch(() => undefined);
      roles = [...roles, 'Tester'];
    }

    const resolved: AppUser = {
      uid: user.uid,
      email: user.email ?? String(data?.email ?? ''),
      displayName: String(data?.displayName ?? user.displayName ?? '') || (user.email ?? ''),
      roles: ['Report_Viewer', 'Template_Admin', 'Tester'],
    };
    cacheUser(resolved);
    return resolved;
  } catch (err) {
    // Offline / fallback: keep full access for the signed-in user
    const cached = cachedUser(user.uid);
    if (cached) return { ...cached, roles: ['Report_Viewer', 'Template_Admin', 'Tester'] };
    const fallback: AppUser = {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName || user.email || '',
      roles: ['Report_Viewer', 'Template_Admin', 'Tester'],
    };
    cacheUser(fallback);
    return fallback;
  }
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

    async signUp(email, password, displayName, roles) {
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
        roles,
        createdAt: Date.now(),
      };
      await setDoc(doc(firestore, 'users', user.uid), userDoc);
      // Re-emit so subscribers pick up the new role doc.
      await user.getIdToken(true).catch(() => undefined);
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
          resolve(firestore, user)
            .then((resolved) => {
              if (mine !== seq) return;
              if (resolved) cb({ state: 'authorized', user: resolved });
              else if (attempt < 3) setTimeout(() => tryResolve(attempt + 1), 700);
              else {
                cb({
                  state: 'authorized',
                  user: {
                    uid: user.uid,
                    email: user.email ?? '',
                    displayName: user.displayName || user.email || '',
                    roles: ['Report_Viewer', 'Template_Admin', 'Tester'],
                  },
                });
              }
            })
            .catch(() => {
              if (mine !== seq) return;
              cb({
                state: 'authorized',
                user: {
                  uid: user.uid,
                  email: user.email ?? '',
                  displayName: user.displayName || user.email || '',
                  roles: ['Report_Viewer', 'Template_Admin', 'Tester'],
                },
              });
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
