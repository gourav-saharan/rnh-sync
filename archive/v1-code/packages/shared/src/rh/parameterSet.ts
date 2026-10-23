// Active R&H_Parameter set selection from a Customer_Template's Field_Mappings.
//
// This module holds the pure logic the Mobile_PWA uses to decide which
// R&H_Parameters to present for a selected Customer_Template. It is free of any
// framework or storage dependency so both apps (and the property tests) can
// consume it directly.
//
// Semantics come from the design document
// (.kiro/specs/rnh-tyre-testing-system/design.md):
//   - "When mappings carry `rhParameterName`, the set of R&H_Parameters they
//     define drives what the Mobile_PWA presents for that template (R6.6);
//     absent such mappings, the app presents a default parameter set (R6.7)."
//   - Property 10 (R&H_Parameter set selection): for any Customer_Template, the
//     presented R&H_Parameters equal exactly the parameters defined by that
//     template's Field_Mappings when such mappings exist, and equal the default
//     parameter set when no such mappings exist.

import {
  DEFAULT_RATING_RANGE,
  DEFAULT_RH_PARAMETERS,
  type FieldMapping,
  type RHParameterDef,
} from '../index';

/**
 * A Field_Mapping "defines" an R&H_Parameter when it carries a non-empty
 * `rhParameterName`. The `rhParameterName` is the authoritative signal per the
 * design; `fieldType` is not required to be `'rhRating'` (a template may bind
 * both a rating cell and a note cell for the same parameter), so selection is
 * driven purely by the presence of a parameter name.
 */
function definesRHParameter(
  mapping: FieldMapping,
): mapping is FieldMapping & { rhParameterName: string } {
  return (
    typeof mapping.rhParameterName === 'string' &&
    mapping.rhParameterName.trim().length > 0
  );
}

/**
 * Infers the category ('ride' | 'handling') for a mapping that defines an
 * R&H_Parameter.
 *
 * The `inputFieldKey` convention for R&H fields is
 * `rhRating.<category>.<param>` / `rhNote.<category>.<param>` (see
 * `inputFieldKey` in the shared index). When the key encodes a recognised
 * category we use it; otherwise we default to 'ride' so an under-specified
 * mapping still yields a usable parameter definition.
 */
function inferCategory(mapping: FieldMapping): 'ride' | 'handling' {
  const parts = mapping.inputFieldKey.split('.');
  const maybeCategory = parts[1];
  if (maybeCategory === 'ride' || maybeCategory === 'handling') {
    return maybeCategory;
  }
  return 'ride';
}

/**
 * Derives the active set of R&H_Parameter definitions for a session from the
 * selected Customer_Template's Field_Mappings.
 *
 * Selection rule (Property 10, R6.6/R6.7):
 *  - When one or more mappings carry an `rhParameterName`, the returned set is
 *    exactly those named parameters (deduplicated by name, preserving first-seen
 *    order). Each parameter's range defaults to {@link DEFAULT_RATING_RANGE}
 *    since Field_Mappings do not carry a per-parameter range.
 *  - When no mapping defines an R&H_Parameter, the returned set is the default
 *    set {@link DEFAULT_RH_PARAMETERS}.
 *
 * The result is a fresh, mutable array (a copy of the defaults in the fallback
 * case) so callers can safely adapt it without mutating shared constants.
 *
 * @param mappings the Field_Mappings of the selected Customer_Template. Pass an
 *   empty array (or a template with no R&H mappings) to get the default set.
 * @returns the ordered R&H_Parameter definitions to present.
 */
export function deriveActiveRHParameters(
  mappings: readonly FieldMapping[] = [],
): RHParameterDef[] {
  const seen = new Set<string>();
  const defined: RHParameterDef[] = [];

  for (const mapping of mappings) {
    if (!definesRHParameter(mapping)) {
      continue;
    }
    const name = mapping.rhParameterName.trim();
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    defined.push({
      name,
      category: inferCategory(mapping),
      range: { ...DEFAULT_RATING_RANGE },
    });
  }

  if (defined.length > 0) {
    return defined;
  }

  // Fallback: no template-defined R&H_Parameters — present the default set
  // (R6.7). Return copies so the shared constant is never mutated by callers.
  return DEFAULT_RH_PARAMETERS.map((param) => ({
    name: param.name,
    category: param.category,
    range: { ...param.range },
  }));
}

/**
 * Looks up the configured rating range for a named parameter within an active
 * set, falling back to {@link DEFAULT_RATING_RANGE} when the parameter is not
 * found. Convenience for rating-validation callers (R5.4) that hold the active
 * set from {@link deriveActiveRHParameters}.
 *
 * @param parameterName the R&H_Parameter name to look up.
 * @param activeParameters the active set as returned by
 *   {@link deriveActiveRHParameters}.
 */
export function rangeForParameter(
  parameterName: string,
  activeParameters: readonly RHParameterDef[],
): RatingRangeLike {
  const match = activeParameters.find((param) => param.name === parameterName);
  return match ? match.range : { ...DEFAULT_RATING_RANGE };
}

/** Local alias to avoid an extra import solely for the return type. */
type RatingRangeLike = RHParameterDef['range'];
