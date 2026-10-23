// Unit / integration tests for the Auth_Service (Requirement 1).
//
// These are example-based tests (not property tests). They exercise the
// createAuthService wrapper against a mocked Firebase Auth + Firestore SDK so
// the behaviour is deterministic and no emulator JAR download is required:
//
//   - Invalid credentials surface a descriptive authentication error (R1.2).
//   - A valid sign-in resolves the user's single role from users/{uid} into an
//     AuthUser and grants access (R1.1, R1.3).
//   - signOut ends the session so currentUser() returns null (R1.7).
//   - A signed-in Firebase user with no valid role is denied (R1.3).
//
// The Firebase SDK modules are mocked at the module boundary: createAuthService
// accepts injected `auth` and `firestore` instances, and the mocked SDK
// functions (signInWithEmailAndPassword, getDoc, ...) decide the outcome.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Firebase Auth SDK mock ------------------------------------------------
const mockSignInWithEmailAndPassword = vi.fn();
const mockCreateUserWithEmailAndPassword = vi.fn();
const mockFirebaseSignOut = vi.fn();
const mockOnAuthStateChanged = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) =>
    mockSignInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    mockCreateUserWithEmailAndPassword(...args),
  signOut: (...args: unknown[]) => mockFirebaseSignOut(...args),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}));

// --- Firebase Firestore SDK mock -------------------------------------------
const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  // `doc` just needs to return an identifiable ref; getDoc/setDoc are controlled.
  doc: (_firestore: unknown, path: string) => ({ path }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}));

// Import after the mocks are registered.
import {
  AuthenticationError,
  MissingRoleError,
  createAuthService,
} from './authService';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

/** Placeholder instances — behaviour is decided by the mocked SDK functions. */
const fakeAuth = {} as Auth;
const fakeFirestore = {} as Firestore;

/** Builds a fake Firestore snapshot matching the shape resolveAuthUser reads. */
function userSnapshot(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => data,
  };
}

/** Builds a fake Firebase Auth user credential. */
function credentialFor(uid: string, email: string | null) {
  return { user: { uid, email } };
}

beforeEach(() => {
  mockSignInWithEmailAndPassword.mockReset();
  mockCreateUserWithEmailAndPassword.mockReset();
  mockFirebaseSignOut.mockReset();
  mockOnAuthStateChanged.mockReset();
  mockGetDoc.mockReset();
  mockSetDoc.mockReset();
  mockSetDoc.mockResolvedValue(undefined);
  // Default: the auth listener registered in createAuthService is a no-op that
  // returns an unsubscribe function and never fires.
  mockOnAuthStateChanged.mockReturnValue(() => {});
});

describe('Auth_Service sign-in (R1.1, R1.2, R1.3)', () => {
  it('resolves the single role from users/{uid} into an AuthUser on valid credentials (R1.1, R1.3)', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(
      credentialFor('uid-123', 'tester@example.com'),
    );
    mockGetDoc.mockResolvedValue(
      userSnapshot({ role: 'Tester', email: 'tester@example.com' }),
    );

    const service = createAuthService(fakeAuth, fakeFirestore);
    const user = await service.signIn('tester@example.com', 'correct-password');

    expect(user).toEqual({
      uid: 'uid-123',
      email: 'tester@example.com',
      role: 'Tester',
    });
    // Access is granted: the current user is now cached (R1.1).
    expect(service.currentUser()).toEqual(user);
  });

  it('maps the Report_Viewer role from the user document (R1.3)', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(
      credentialFor('uid-viewer', 'viewer@example.com'),
    );
    mockGetDoc.mockResolvedValue(userSnapshot({ role: 'Report_Viewer' }));

    const service = createAuthService(fakeAuth, fakeFirestore);
    const user = await service.signIn('viewer@example.com', 'pw');

    expect(user.role).toBe('Report_Viewer');
  });

  it('surfaces a descriptive AuthenticationError on invalid credentials (R1.2)', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue({
      code: 'auth/invalid-credential',
    });

    const service = createAuthService(fakeAuth, fakeFirestore);

    await expect(service.signIn('user@example.com', 'wrong')).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    // The message is user-facing and descriptive, not a raw error code.
    await expect(
      service.signIn('user@example.com', 'wrong'),
    ).rejects.toThrowError(/incorrect email or password/i);
    // Access is denied: no user is cached (R1.2).
    expect(service.currentUser()).toBeNull();
    // Role resolution is never attempted when authentication fails.
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it('does not leak whether the email exists (wrong-password maps to the same message) (R1.2)', async () => {
    const service = createAuthService(fakeAuth, fakeFirestore);

    mockSignInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    const notFound = await service.signIn('nobody@example.com', 'pw').catch((e) => e);

    mockSignInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/wrong-password' });
    const wrongPw = await service.signIn('real@example.com', 'pw').catch((e) => e);

    expect(notFound).toBeInstanceOf(AuthenticationError);
    expect(wrongPw).toBeInstanceOf(AuthenticationError);
    expect((notFound as Error).message).toBe((wrongPw as Error).message);
  });

  it('denies access when the authenticated user has no valid role (R1.3)', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(
      credentialFor('uid-noRole', 'norole@example.com'),
    );
    // Document exists but carries no recognised role.
    mockGetDoc.mockResolvedValue(userSnapshot({ email: 'norole@example.com' }));

    const service = createAuthService(fakeAuth, fakeFirestore);

    await expect(service.signIn('norole@example.com', 'pw')).rejects.toBeInstanceOf(
      MissingRoleError,
    );
  });

  it('denies access when the users/{uid} document is missing (R1.3)', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(
      credentialFor('uid-missing', 'ghost@example.com'),
    );
    mockGetDoc.mockResolvedValue(userSnapshot(null));

    const service = createAuthService(fakeAuth, fakeFirestore);

    await expect(service.signIn('ghost@example.com', 'pw')).rejects.toBeInstanceOf(
      MissingRoleError,
    );
  });
});

describe('Auth_Service sign-out (R1.7)', () => {
  it('ends the session so currentUser() returns null after sign-out', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(
      credentialFor('uid-123', 'tester@example.com'),
    );
    mockGetDoc.mockResolvedValue(userSnapshot({ role: 'Tester' }));
    mockFirebaseSignOut.mockResolvedValue(undefined);

    const service = createAuthService(fakeAuth, fakeFirestore);
    await service.signIn('tester@example.com', 'pw');
    expect(service.currentUser()).not.toBeNull();

    await service.signOut();

    // The Firebase session is ended and the cached user is cleared (R1.7).
    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
    expect(service.currentUser()).toBeNull();
  });
});

describe('Auth_Service onAuthChange (R1.6)', () => {
  it('emits the resolved user when the underlying auth state signals a signed-in user', async () => {
    // Capture the callback registered by onAuthChange so we can drive it.
    let listener: ((user: unknown) => void) | undefined;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      listener = cb as (user: unknown) => void;
      return () => {};
    });
    mockGetDoc.mockResolvedValue(userSnapshot({ role: 'Tester' }));

    const service = createAuthService(fakeAuth, fakeFirestore);
    const received: (unknown | null)[] = [];
    service.onAuthChange((u) => received.push(u));

    // Simulate Firebase reporting a signed-in user.
    listener?.({ uid: 'uid-1', email: 'tester@example.com' });
    // Allow the async role resolution to settle.
    await vi.waitFor(() => {
      expect(received.length).toBeGreaterThan(0);
    });

    expect(received.at(-1)).toEqual({
      uid: 'uid-1',
      email: 'tester@example.com',
      role: 'Tester',
    });
  });

  it('emits null when the underlying auth state signals a signed-out user (R1.6)', () => {
    let listener: ((user: unknown) => void) | undefined;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      listener = cb as (user: unknown) => void;
      return () => {};
    });

    const service = createAuthService(fakeAuth, fakeFirestore);
    const received: (unknown | null)[] = [];
    service.onAuthChange((u) => received.push(u));

    listener?.(null);

    expect(received.at(-1)).toBeNull();
    expect(service.currentUser()).toBeNull();
  });
});

describe('Auth_Service sign-up (self-registration, R1.1, R1.3)', () => {
  it('creates the Firebase account, writes the role doc, and resolves the AuthUser', async () => {
    mockCreateUserWithEmailAndPassword.mockResolvedValue(
      credentialFor('uid-new', 'new@example.com'),
    );

    const service = createAuthService(fakeAuth, fakeFirestore);
    const user = await service.signUp!('new@example.com', 'sup3rsecret', 'Report_Viewer');

    expect(user).toEqual({
      uid: 'uid-new',
      email: 'new@example.com',
      role: 'Report_Viewer',
    });
    // The role document was written to users/{uid} with the chosen role.
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockSetDoc.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('users/uid-new');
    expect(data).toMatchObject({
      uid: 'uid-new',
      email: 'new@example.com',
      role: 'Report_Viewer',
    });
    expect(typeof data.createdAt).toBe('number');
    // The new user is cached for a synchronous currentUser() read (R1.1).
    expect(service.currentUser()).toEqual(user);
  });

  it('assigns the Tester role when the Mobile_PWA registers a Tester', async () => {
    mockCreateUserWithEmailAndPassword.mockResolvedValue(
      credentialFor('uid-tester', 'tester@example.com'),
    );

    const service = createAuthService(fakeAuth, fakeFirestore);
    const user = await service.signUp!('tester@example.com', 'pw123456', 'Tester');

    expect(user.role).toBe('Tester');
  });

  it('maps email-already-in-use to a friendly AuthenticationError and does not write a role doc', async () => {
    mockCreateUserWithEmailAndPassword.mockRejectedValue({
      code: 'auth/email-already-in-use',
    });

    const service = createAuthService(fakeAuth, fakeFirestore);

    const err = await service.signUp!('taken@example.com', 'pw123456', 'Tester').catch((e) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as Error).message).toMatch(/already exists/i);
    // Account creation failed, so no role document is written.
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(service.currentUser()).toBeNull();
  });

  it('maps weak-password to a friendly AuthenticationError', async () => {
    mockCreateUserWithEmailAndPassword.mockRejectedValue({ code: 'auth/weak-password' });

    const service = createAuthService(fakeAuth, fakeFirestore);
    const err = await service.signUp!('u@example.com', '123', 'Tester').catch((e) => e);

    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as Error).message).toMatch(/too weak/i);
  });
});

describe('Auth_Service onAuthStatusChange (R1.3, R1.6)', () => {
  it('emits authorized with the resolved user when a signed-in user has a valid role', async () => {
    let listener: ((user: unknown) => void) | undefined;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      listener = cb as (user: unknown) => void;
      return () => {};
    });
    mockGetDoc.mockResolvedValue(userSnapshot({ role: 'Tester' }));

    const service = createAuthService(fakeAuth, fakeFirestore);
    const received: unknown[] = [];
    service.onAuthStatusChange?.((s) => received.push(s));

    listener?.({ uid: 'uid-1', email: 'tester@example.com' });
    await vi.waitFor(() => {
      expect(received.length).toBeGreaterThan(0);
    });

    expect(received.at(-1)).toEqual({
      state: 'authorized',
      user: { uid: 'uid-1', email: 'tester@example.com', role: 'Tester' },
    });
  });

  it('emits no-role (not unauthenticated) when the signed-in user has no valid role (R1.3)', async () => {
    let listener: ((user: unknown) => void) | undefined;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      listener = cb as (user: unknown) => void;
      return () => {};
    });
    // Document is missing -> resolveAuthUser throws MissingRoleError.
    mockGetDoc.mockResolvedValue(userSnapshot(null));

    const service = createAuthService(fakeAuth, fakeFirestore);
    const received: unknown[] = [];
    service.onAuthStatusChange?.((s) => received.push(s));

    listener?.({ uid: 'uid-norole', email: 'norole@example.com' });
    await vi.waitFor(() => {
      expect(received.length).toBeGreaterThan(0);
    });

    expect(received.at(-1)).toEqual({
      state: 'no-role',
      uid: 'uid-norole',
      email: 'norole@example.com',
    });
  });

  it('emits unauthenticated when there is no signed-in user (R1.6)', () => {
    let listener: ((user: unknown) => void) | undefined;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      listener = cb as (user: unknown) => void;
      return () => {};
    });

    const service = createAuthService(fakeAuth, fakeFirestore);
    const received: unknown[] = [];
    service.onAuthStatusChange?.((s) => received.push(s));

    listener?.(null);

    expect(received.at(-1)).toEqual({ state: 'unauthenticated' });
  });
});

