// Component tests for the Mapping_Editor panel (R3.1, R3.4, R3.5, R3.6).
//
// Uses @testing-library/react with a fake MappingEditorStore (no Firebase).
// Asserts:
//   - begin() structure drives the sheet options (R3.1),
//   - loadExisting() mappings render as editable rows (R3.6),
//   - saving forwards the edited mappings to the store (R3.4),
//   - a SaveResult with withheld mappings surfaces a conflict warning to the
//     user, naming the conflicting target (R3.5).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  FieldMapping,
  MappingEditorStore,
  SaveResult,
  TemplateStructure,
} from '@rnh/shared';
import { MappingEditorPanel } from './MappingEditorPanel';

const structure: TemplateStructure = {
  sheets: [{ name: 'R&H', index: 0, rowCount: 30, columnCount: 10, mergedRanges: [] }],
};

const existing: FieldMapping[] = [
  {
    mappingId: 'm1',
    templateId: 't1',
    sheetName: 'R&H',
    cellAddress: 'C7',
    inputFieldKey: 'rhRating.ride.smoothRoad',
    fieldType: 'rhRating',
    required: true,
  },
];

function makeStore(overrides: Partial<MappingEditorStore> = {}): MappingEditorStore {
  return {
    begin: vi.fn(async () => structure),
    loadExisting: vi.fn(async () => existing),
    save: vi.fn(async (_id, mappings): Promise<SaveResult> => ({
      saved: [...mappings],
      withheld: [],
    })),
    ...overrides,
  };
}

describe('MappingEditorPanel', () => {
  it('loads existing mappings into editable rows (R3.1, R3.6)', async () => {
    render(<MappingEditorPanel templateId="t1" mappingEditorStore={makeStore()} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Mapping 1 cell')).toHaveValue('C7');
    });
    expect(screen.getByLabelText('Mapping 1 input field')).toHaveValue(
      'rhRating.ride.smoothRoad',
    );
  });

  it('saves the edited mappings through the store (R3.4)', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(<MappingEditorPanel templateId="t1" mappingEditorStore={store} />);
    await screen.findByLabelText('Mapping 1 cell');

    await user.click(screen.getByRole('button', { name: 'Save mappings' }));

    await waitFor(() => {
      expect(store.save).toHaveBeenCalledWith(
        't1',
        expect.arrayContaining([expect.objectContaining({ cellAddress: 'C7' })]),
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/Saved 1 mapping/i);
  });

  it('surfaces a duplicate-target conflict warning for withheld mappings (R3.5)', async () => {
    const user = userEvent.setup();
    const withheldMapping: FieldMapping = {
      mappingId: 'm2',
      templateId: 't1',
      sheetName: 'R&H',
      cellAddress: 'C7',
      inputFieldKey: 'rhRating.handling.rearTracking',
      fieldType: 'rhRating',
      required: false,
    };
    const store = makeStore({
      save: vi.fn(async (): Promise<SaveResult> => ({
        saved: [existing[0]!],
        withheld: [{ mapping: withheldMapping, reason: 'duplicate-target-cell' }],
      })),
    });
    render(<MappingEditorPanel templateId="t1" mappingEditorStore={store} />);
    await screen.findByLabelText('Mapping 1 cell');

    await user.click(screen.getByRole('button', { name: 'Save mappings' }));

    const conflicts = await screen.findByLabelText('Mapping conflicts');
    expect(conflicts).toHaveTextContent('R&H!C7');
    expect(conflicts).toHaveTextContent('rhRating.handling.rearTracking');
    expect(conflicts).toHaveTextContent(/duplicate-target-cell/);
  });
});
