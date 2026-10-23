// Auth_Service public surface. Wraps Firebase Auth and resolves the single
// per-user role (Requirement 1).
export {
  createAuthService,
  createUserRoleDoc,
  describeSignUpError,
  canAccess,
  isRole,
  resolveRole,
  AuthenticationError,
  MissingRoleError,
  type AuthService,
  type AuthStatus,
  type Unsubscribe,
  type Capability,
} from './authService';
