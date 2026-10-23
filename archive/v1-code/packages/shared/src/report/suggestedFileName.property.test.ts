// Property-based tests for the suggested download filename (task 10.9).
//
// Feature: rnh-tyre-testing-system, Property 17: Download filename format
//
// Property 17: For any generated report, the suggested download filename is
// derived from the customer name and the Test_Session test date and ends with
// .xlsx.
//
// Validates: Requirements 9.3
//
// Strategy (no mocks): drive the real `suggestedFileName` helper with arbitrary
// customer names and test dates, including empty strings, whitespace-only
// values, and strings peppered with filesystem-illegal characters
// (< > : " / \ | ? *) and control characters. For every input we assert the
// invariants that make the name a safe, derivable download name:
//   1. it always ends with `.xlsx`;
//   2. it never contains a filesystem-illegal character;
//   3. it is shaped `<customerSegment>_<dateSegment>.xlsx`, i.e. derived from
//      both parts joined by an underscore;
//   4. when a source part sanitizes to nothing, the `report` fallback stands in
//      for that segment (so the name is never empty or malformed).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REPORT_FILE_EXTENSION, suggestedFileName } from './suggestedFileName';

/** Number of iterations per property (spec requires at least 100). */
const NUM_RUNS = 100;

/** The fallback segment the implementation substitutes for empty parts. */
const FALLBACK_SEGMENT = 'report';

/** Illegal filename characters (Windows-strictest) plus control chars. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * Mirrors the implementation's per-segment sanitizer so the test can compute
 * the expected segment (and thus verify derivation from both parts) without
 * reaching into the module's private function.
 */
function expectedSegment(part: string): string {
  const cleaned = part
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  return cleaned || FALLBACK_SEGMENT;
}

/**
 * Arbitrary filename-part string. Fast-check's default string generator already
 * covers empty and control characters; we additionally weave in whitespace and
 * the explicit filesystem-illegal set so those paths are exercised on most
 * runs rather than only by chance.
 */
const partArb: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.constantFrom('', '   ', '\t\n', '***', '///', '<>:"/\\|?*', '  .Name. '),
  // Strings built from an alphabet rich in illegal/whitespace characters.
  fc.stringOf(
    fc.constantFrom(
      'a', 'B', '9', '-', ' ', '.', '_',
      '<', '>', ':', '"', '/', '\\', '|', '?', '*',
    ),
    { maxLength: 24 },
  ),
);

describe('Property 17: Download filename format', () => {
  it('derives <customer>_<testDate>.xlsx, sanitized, from both parts (R9.3)', () => {
    fc.assert(
      fc.property(partArb, partArb, (customerName, testDate) => {
        const name = suggestedFileName({ customerName, testDate });

        // (1) Always ends with .xlsx.
        expect(name.endsWith(REPORT_FILE_EXTENSION)).toBe(true);

        // (2) Never contains a filesystem-illegal character.
        expect(ILLEGAL_FILENAME_CHARS.test(name)).toBe(false);

        // (3) Derived from both parts: <customerSegment>_<dateSegment>.xlsx.
        // Sanitized segments may themselves contain underscores (whitespace is
        // collapsed to `_`), so we compare against the full expected name
        // rather than splitting on `_`.
        const customerSeg = expectedSegment(customerName);
        const dateSeg = expectedSegment(testDate);
        expect(name).toBe(`${customerSeg}_${dateSeg}${REPORT_FILE_EXTENSION}`);

        // Both segments are non-empty (the fallback guarantees this), so the
        // name genuinely carries a customer part and a date part.
        expect(customerSeg.length).toBeGreaterThan(0);
        expect(dateSeg.length).toBeGreaterThan(0);
        const stem = name.slice(0, -REPORT_FILE_EXTENSION.length);
        expect(stem).toBe(`${customerSeg}_${dateSeg}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('substitutes the `report` fallback for any part that sanitizes to empty (R9.3)', () => {
    // Parts that sanitize to nothing: empty, whitespace-only, or symbol-only.
    const emptyingPartArb = fc.constantFrom('', '   ', '\t', '\n\n', '***', '///', '<>|?*', '...');
    const anyPartArb = fc.oneof(emptyingPartArb, partArb);

    fc.assert(
      fc.property(anyPartArb, anyPartArb, (customerName, testDate) => {
        const customerSeg = expectedSegment(customerName);
        const dateSeg = expectedSegment(testDate);
        const name = suggestedFileName({ customerName, testDate });

        // The final name is the two segments joined by `_`; when a part
        // sanitizes to empty, its segment is the `report` fallback.
        expect(name).toBe(`${customerSeg}_${dateSeg}${REPORT_FILE_EXTENSION}`);

        const customerSanitizesEmpty = customerName.trim() === '' || customerSeg === FALLBACK_SEGMENT;
        const dateSanitizesEmpty = testDate.trim() === '' || dateSeg === FALLBACK_SEGMENT;
        if (customerSanitizesEmpty) {
          expect(name.startsWith(`${FALLBACK_SEGMENT}_`)).toBe(true);
        }
        if (dateSanitizesEmpty) {
          expect(name.endsWith(`_${FALLBACK_SEGMENT}${REPORT_FILE_EXTENSION}`)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
