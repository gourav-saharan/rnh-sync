// Component tests for the Customer_Template picker (Requirements 6.6, 6.7).
//
// These example-based tests use @testing-library/react with injected fakes for
// the shared Template_Manager and Mapping_Editor store — no Firebase. They
// assert:
//   - the picker lists available Customer_Templates (R2.4 feeding R6.6),
//   - selecting a template loads its Field_Mappings and reports them upward so
//     the template's R&H_Parameters can be presented (R6.6),
//   - selecting the "Default parameters" option reports the default (empty)
//     set (R6.7),
//   - a failed listing degrades to the default set without crashing (R6.7),
//   - a failed mapping load falls back to the default set for the template.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomerTemplateSummary,
  FieldMapping,
  MappingEditorStore,
  TemplateManager,
} from '@rnh/shared';
import { TemplatePicker } from './TemplatePicker';

const templates: CustomerTemplateSummary[] = [
  { templateId: 't1', customerName: 'Maruti', uploadDate: 1_700_000_000_000 },
  { templateId: 't2', customerName: 'Tata', uploadDate: 1_700_000_100_000 },
];

const t1Mappings: FieldMapping[] = [
  {
    mappingId: 'm1',
    templateId: 't1',
    sheetName: 'R&H',
    cellAddress: 'C7',
    inputFieldKey: 'rhRating.ride.customRide',
    fieldType: 'rhRating',
    rhParameterName: 'Custom Ride Feel',
    required: true,
  },
];

function makeManager(overrides: Partial<TemplateManager> = {}): TemplateManager {
  return {
    upload: vi.fn(),
    list: vi.fn(async () => templates),
    inspect: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as TemplateManager;
}

function makeMappingStore(
  overrides: Partial<MappingEditorStore> = {},
): MappingEditorStore {
  return {
    begin: vi.fn(),
    loadExisting: vi.fn(async () => t1Mappings),
    save: vi.fn(),
    ...overrides,
  } as unknown as MappingEditorStore;
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

describe('TemplatePicker', () => {
  it('lists available Customer_Templates by customer name (R2.4, R6.6)', async () => {
    render(
      <TemplatePicker
        onSelectionChange={() => {}}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    // Both templates plus the default option are offered.
    expect(
      await screen.findByRole('option', { name: 'Maruti' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tata' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Default parameters' }),
    ).toBeInTheDocument();
  });

  it('loads and reports a template\u2019s mappings on selection (R6.6)', async () => {
    const onSelectionChange = vi.fn();
    render(
      <TemplatePicker
        onSelectionChange={onSelectionChange}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    await screen.findByRole('option', { name: 'Maruti' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Customer template' }),
      't1',
    );

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith({
        templateId: 't1',
        mappings: t1Mappings,
      });
    });
  });

  it('reports the default (empty) set for the default option (R6.7)', async () => {
    const onSelectionChange = vi.fn();
    render(
      <TemplatePicker
        onSelectionChange={onSelectionChange}
        templateManager={makeManager()}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    await screen.findByRole('option', { name: 'Maruti' });
    // Select a template, then switch back to the default option.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Customer template' }),
      't1',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Customer template' }),
      '',
    );

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenLastCalledWith({
        templateId: null,
        mappings: [],
      });
    });
  });

  it('degrades to the default set without crashing when listing fails (R6.7)', async () => {
    const manager = makeManager({
      list: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    render(
      <TemplatePicker
        onSelectionChange={() => {}}
        templateManager={manager}
        mappingEditorStore={makeMappingStore()}
      />,
    );

    // The picker still renders with only the default option and a subtle note.
    expect(
      await screen.findByText(/using default parameters/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Default parameters' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Maruti' })).toBeNull();
  });

  it('falls back to the default set when a mapping load fails', async () => {
    const onSelectionChange = vi.fn();
    const mappingStore = makeMappingStore({
      loadExisting: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    render(
      <TemplatePicker
        onSelectionChange={onSelectionChange}
        templateManager={makeManager()}
        mappingEditorStore={mappingStore}
      />,
    );

    await screen.findByRole('option', { name: 'Maruti' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Customer template' }),
      't1',
    );

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenLastCalledWith({
        templateId: 't1',
        mappings: [],
      });
    });
    expect(
      screen.getByText(/could not load template parameters/i),
    ).toBeInTheDocument();
  });
});
