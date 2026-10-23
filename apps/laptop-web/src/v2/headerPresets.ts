// Common header fields seen in the M&M / MSIL / Hyundai report sheets, so a
// new template's "Test details" can be set up in a few clicks (R3.7).

import { type HeaderFieldDef, type HeaderFieldType } from '@rnh/shared/v2';

export type HeaderPreset = Omit<HeaderFieldDef, 'fieldId'>;

export const HEADER_PRESETS: HeaderPreset[] = [
  { label: 'Report Nr.', type: 'text', required: false },
  { label: 'Test date', type: 'date', required: true, prefill: 'today' },
  { label: 'Test purpose', type: 'text', required: false, prefill: 'lastSession' },
  { label: 'Test vehicle', type: 'text', required: true, prefill: 'lastSession' },
  { label: 'Test tyre size', type: 'text', required: true, prefill: 'lastSession' },
  { label: 'Rim', type: 'text', required: false, prefill: 'lastSession' },
  { label: 'Test track', type: 'text', required: false, prefill: 'lastSession' },
  {
    label: 'Weather',
    type: 'choice',
    required: false,
    choices: ['Sunny', 'Cloudy', 'Rain', 'Wet track'],
  },
  { label: 'Air temperature', type: 'number', unit: '°C', required: false },
  { label: 'Road temperature', type: 'number', unit: '°C', required: false },
  {
    label: 'Load condition',
    type: 'choice',
    required: false,
    choices: ['Driver only', 'D + 1', 'D + 2', 'Full load'],
  },
  {
    label: 'Pressure front (FA)',
    type: 'pressure',
    unit: 'psi',
    required: false,
    prefill: 'lastSession',
  },
  {
    label: 'Pressure rear (RA)',
    type: 'pressure',
    unit: 'psi',
    required: false,
    prefill: 'lastSession',
  },
  { label: 'Test equipment', type: 'text', required: false, prefill: 'lastSession' },
  { label: 'Tested by', type: 'text', required: true, prefill: 'userDisplayName' },
];

export const HEADER_TYPES: HeaderFieldType[] = ['text', 'number', 'date', 'choice', 'pressure'];

/** Stable, unique field id from a label: "Test date" -> "h_test_date". */
export function fieldIdFor(label: string, taken: ReadonlySet<string>): string {
  const base = `h_${
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'field'
  }`;
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}
