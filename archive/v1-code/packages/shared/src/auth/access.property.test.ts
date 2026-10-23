// Property-based tests for role-based access control.
//
// Feature: rnh-tyre-testing-system, Property 2: Role-based access control
//
// Property 2 (Role-based access control): For any user (authenticated or not)
// and any protected capability, access is granted if and only if the user's
// role permits it:
//   - Tester          -> Test_Session capture ('capture')
//   - Report_Viewer   -> report generation/export ('report')
//   - unauthenticated -> only sign-in functions ('sign-in')
//
// Validates: Requirements 1.4, 1.5, 1.6

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROLES, type AuthUser, type Role } from '../index';
import { canAccess, type Capability } from './authService';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 500;

/** All protected/known capabilities the access rule must decide. */
const CAPABILITIES: readonly Capability[] = ['sign-in', 'capture', 'report'] as const;

/**
 * Independent oracle for Property 2, expressed directly from the acceptance
 * criteria rather than reusing the implementation's control flow:
 *   - 'sign-in' is always reachable (R1.6: while unauthenticated, only sign-in;
 *     it remains reachable when authenticated).
 *   - unauthenticated (null) users reach nothing but 'sign-in' (R1.6).
 *   - 'capture' is granted exactly to the Tester role (R1.4).
 *   - 'report' is granted exactly to the Report_Viewer role (R1.5).
 *
 * Encoded as an explicit matrix keyed by (role-or-unauthenticated, capability)
 * so it is structurally different from the code under test.
 */
function specGrantsAccess(user: AuthUser | null, capability: Capability): boolean {
  const matrix: Record<'unauthenticated' | Role, Record<Capability, boolean>> = {
    unauthenticated: { 'sign-in': true, capture: false, report: false },
    Tester: { 'sign-in': true, capture: true, report: false },
    Report_Viewer: { 'sign-in': true, capture: false, report: true },
  };
  const key = user === null ? 'unauthenticated' : user.role;
  return matrix[key][capability];
}

/**
 * Arbitrary authenticated user: a valid role plus arbitrary uid/email. The
 * uid/email content must not influence the access decision, so they are
 * generated freely (including empty strings and unicode).
 */
const authUserArb: fc.Arbitrary<AuthUser> = fc.record({
  uid: fc.string(),
  email: fc.oneof(fc.string(), fc.emailAddress()),
  role: fc.constantFrom<Role>(...ROLES),
});

/**
 * Arbitrary user slot covering the full input space: unauthenticated (null)
 * and both authenticated roles. `null` is weighted so unauthenticated cases
 * are exercised frequently alongside each role.
 */
const userArb: fc.Arbitrary<AuthUser | null> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<AuthUser | null>(null) },
  { weight: 3, arbitrary: authUserArb },
);

const capabilityArb: fc.Arbitrary<Capability> = fc.constantFrom(...CAPABILITIES);

describe('Property 2: Role-based access control', () => {
  it('grants access iff the user role permits the capability (full matrix)', () => {
    fc.assert(
      fc.property(userArb, capabilityArb, (user, capability) => {
        expect(canAccess(user, capability)).toBe(specGrantsAccess(user, capability));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('always allows sign-in for any user, authenticated or not (R1.6)', () => {
    fc.assert(
      fc.property(userArb, (user) => {
        expect(canAccess(user, 'sign-in')).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('restricts unauthenticated users to sign-in only (R1.6)', () => {
    fc.assert(
      fc.property(capabilityArb, (capability) => {
        expect(canAccess(null, capability)).toBe(capability === 'sign-in');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('grants capture to Testers only and report to Report_Viewers only (R1.4, R1.5)', () => {
    fc.assert(
      fc.property(authUserArb, (user) => {
        expect(canAccess(user, 'capture')).toBe(user.role === 'Tester');
        expect(canAccess(user, 'report')).toBe(user.role === 'Report_Viewer');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
