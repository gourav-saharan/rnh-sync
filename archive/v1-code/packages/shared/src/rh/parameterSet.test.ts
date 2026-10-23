import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING_RANGE,
  DEFAULT_RH_PARAMETERS,
  type FieldMapping,
} from '../index';
import { deriveActiveRHParameters, rangeForParameter } from './parameterSet';

/** Builds a Field_Mapping with sensible defaults for a test. */
function mapping(overrides: Partial<FieldMapping> = {}): FieldMapping {
  return {
    mappingId: 'm1',
    templateId: 't1',
    sheetName: 'MU1',
    cellAddress: 'C7',
    inputFieldKey: 'meta.customerName',
    fieldType: 'meta',
    required: false,
    ...overrides,
  };
}

describe('deriveActiveRHParameters — fallback to default set (R6.7)', () => {
  it('returns the default set when given no mappings', () => {
    const result = deriveActiveRHParameters();
    expect(result.map((p) => p.name)).toEqual(
      DEFAULT_RH_PARAMETERS.map((p) => p.name),
    );
  });

  it('returns the default set for an empty mapping array', () => {
    expect(deriveActiveRHParameters([]).map((p) => p.name)).toEqual(
      DEFAULT_RH_PARAMETERS.map((p) => p.name),
    );
  });

  it('returns the default set when mappings define no R&H_Parameters', () => {
    const mappings = [
      mapping({ inputFieldKey: 'vehicle.frontAxlePressure', fieldType: 'vehicle' }),
      mapping({ inputFieldKey: 'tyreSet[0].make', fieldType: 'tyreSet' }),
    ];
    expect(deriveActiveRHParameters(mappings).map((p) => p.name)).toEqual(
      DEFAULT_RH_PARAMETERS.map((p) => p.name),
    );
  });

  it('ignores mappings whose rhParameterName is blank/whitespace', () => {
    const mappings = [
      mapping({ rhParameterName: '', fieldType: 'rhRating' }),
      mapping({ rhParameterName: '   ', fieldType: 'rhRating' }),
    ];
    expect(deriveActiveRHParameters(mappings).map((p) => p.name)).toEqual(
      DEFAULT_RH_PARAMETERS.map((p) => p.name),
    );
  });

  it('returns a fresh copy of the defaults that callers can mutate safely', () => {
    const result = deriveActiveRHParameters([]);
    result[0].range.min = 999;
    // The shared constant must be untouched.
    expect(DEFAULT_RH_PARAMETERS[0].range.min).toBe(DEFAULT_RATING_RANGE.min);
  });
});

describe('deriveActiveRHParameters — template-defined set (R6.6)', () => {
  it('returns exactly the parameters named by the mappings', () => {
    const mappings = [
      mapping({
        inputFieldKey: 'rhRating.ride.smoothRoad',
        fieldType: 'rhRating',
        rhParameterName: 'Smooth Road',
      }),
      mapping({
        mappingId: 'm2',
        cellAddress: 'C8',
        inputFieldKey: 'rhRating.handling.steeringFeel',
        fieldType: 'rhRating',
        rhParameterName: 'Steering Feel',
      }),
    ];
    const result = deriveActiveRHParameters(mappings);
    expect(result).toEqual([
      { name: 'Smooth Road', category: 'ride', range: { ...DEFAULT_RATING_RANGE } },
      {
        name: 'Steering Feel',
        category: 'handling',
        range: { ...DEFAULT_RATING_RANGE },
      },
    ]);
  });

  it('infers category from the inputFieldKey convention', () => {
    const mappings = [
      mapping({
        inputFieldKey: 'rhRating.handling.rearTracking',
        fieldType: 'rhRating',
        rhParameterName: 'Rear Tracking',
      }),
    ];
    expect(deriveActiveRHParameters(mappings)[0].category).toBe('handling');
  });

  it('defaults category to ride when the key does not encode one', () => {
    const mappings = [
      mapping({
        inputFieldKey: 'meta.custom',
        fieldType: 'meta',
        rhParameterName: 'Mystery Parameter',
      }),
    ];
    expect(deriveActiveRHParameters(mappings)[0].category).toBe('ride');
  });

  it('deduplicates by name, preserving first-seen order (rating + note mappings)', () => {
    const mappings = [
      mapping({
        inputFieldKey: 'rhRating.ride.damping',
        fieldType: 'rhRating',
        rhParameterName: 'Damping',
      }),
      mapping({
        mappingId: 'm2',
        cellAddress: 'D8',
        inputFieldKey: 'rhNote.ride.damping',
        fieldType: 'rhNote',
        rhParameterName: 'Damping',
      }),
      mapping({
        mappingId: 'm3',
        cellAddress: 'C9',
        inputFieldKey: 'rhRating.ride.rollLevel',
        fieldType: 'rhRating',
        rhParameterName: 'Roll Level',
      }),
    ];
    const result = deriveActiveRHParameters(mappings);
    expect(result.map((p) => p.name)).toEqual(['Damping', 'Roll Level']);
  });

  it('trims surrounding whitespace from parameter names', () => {
    const mappings = [
      mapping({
        inputFieldKey: 'rhRating.ride.smoothRoad',
        fieldType: 'rhRating',
        rhParameterName: '  Smooth Road  ',
      }),
    ];
    expect(deriveActiveRHParameters(mappings)[0].name).toBe('Smooth Road');
  });

  it('assigns the default rating range to each derived parameter', () => {
    const mappings = [
      mapping({
        inputFieldKey: 'rhRating.ride.smoothRoad',
        fieldType: 'rhRating',
        rhParameterName: 'Smooth Road',
      }),
    ];
    expect(deriveActiveRHParameters(mappings)[0].range).toEqual(DEFAULT_RATING_RANGE);
  });
});

describe('rangeForParameter', () => {
  it('returns the matching parameter range', () => {
    const active = deriveActiveRHParameters([]);
    expect(rangeForParameter('Smooth Road', active)).toEqual(DEFAULT_RATING_RANGE);
  });

  it('falls back to the default range for an unknown parameter', () => {
    const active = deriveActiveRHParameters([]);
    expect(rangeForParameter('Not A Parameter', active)).toEqual(DEFAULT_RATING_RANGE);
  });
});
