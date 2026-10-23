// Property-based tests for single-role resolution.
//
// Feature: rnh-tyre-testing-system, Property 1: Exactly one role
//
// Property 1 (Exactly one role): For any authenticated user produced by role
// assignment, the user's role is exactly one value from {Tester, Report_Viewer}
// — never zero and never more than one. Invalid or missing roles are rejected
// (a user is never resolved without a valid role).
//
// resolveAuthUser needs Firestore, so this exercises the pure role-resolution
// core (resolveRole) that resolveAuthUser delegates to: given arbitrary
// user-document data, it yields exactly one role, or rejects the data.
//
// Validates: Requirements 1.3

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROLES, type UserDoc } from '../index';
import { isRole, resolveRole, MissingRoleError } from './authService';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 500;

/**
 * Independent oracle mirroring the Property 1 specification: a user-doc
 * resolves to a role iff its `role` field is exactly one of the known ROLES.
 */
function specHasValidRole(data: Partial<UserDoc> | null | undefined): boolean {
  return data != null && typeof data.role === 'string' && (ROLES as readonly string[]).includes(data.role);
}

/** Arbitrary that emits a valid role string. */
const validRoleArb: fc.Arbitrary<string> = fc.constantFrom(...ROLES);

/** Arbitrary strings that are NOT valid roles (invalid role assignments). */
const invalidRoleStringArb: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => !(ROLES as readonly string[]).includes(s));

/**
 * Extra, arbitrary fields the document may carry alongside `role`. Role
 * resolution must ignore these entirely.
 */
const extraFieldsArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string().filter((k) => k !== 'role'),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
);

/**
 * A user-doc arbitrary spanning the whole interesting input space:
 *   - valid roles (Tester / Report_Viewer), with arbitrary extra fields;
 *   - invalid role strings;
 *   - a `role` of the wrong type (number, boolean, null, object);
 *   - a missing `role` altogether;
 *   - a completely absent document (null / undefined).
 */
const userDocArb: fc.Arbitrary<Partial<UserDoc> | null | undefined> = fc.oneof(
  // Valid role, possibly with unrelated extra fields.
  fc
    .tuple(validRoleArb, extraFieldsArb)
    .map(([role, extra]) => ({ ...extra, role }) as Partial<UserDoc>),
  // Invalid role string.
  invalidRoleStringArb.map((role) => ({ role }) as unknown as Partial<UserDoc>),
  // Role of the wrong type.
  fc
    .oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.object())
    .map((role) => ({ role }) as unknown as Partial<UserDoc>),
  // Missing role (document present, but no role field).
  extraFieldsArb.map((extra) => extra as Partial<UserDoc>),
  // Absent document.
  fc.constantFrom(null, undefined),
);

describe('Property 1: Exactly one role', () => {
  it('resolves exactly one valid role, or rejects invalid/missing role data', () => {
    fc.assert(
      fc.property(userDocArb, (data) => {
        if (specHasValidRole(data)) {
          const role = resolveRole(data);
          // Exactly one role: it is a known role...
          expect(isRole(role)).toBe(true);
          expect(ROLES).toContain(role);
          // ...and never zero and never more than one — a single scalar value
          // equal to exactly one member of ROLES.
          const matches = ROLES.filter((r) => r === role);
          expect(matches).toHaveLength(1);
        } else {
          // No valid role -> rejected, never a roleless "authenticated" user.
          expect(() => resolveRole(data)).toThrow(MissingRoleError);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('any resolved role passes the isRole guard for exactly one known role', () => {
    fc.assert(
      fc.property(validRoleArb, extraFieldsArb, (role, extra) => {
        const resolved = resolveRole({ ...extra, role } as Partial<UserDoc>);
        expect(isRole(resolved)).toBe(true);
        expect(ROLES.filter((r) => r === resolved)).toHaveLength(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
