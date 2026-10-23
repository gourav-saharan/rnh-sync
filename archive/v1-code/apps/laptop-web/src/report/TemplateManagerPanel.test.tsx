// Component tests for the Template_Manager panel (R2.1, R2.4, R2.5, R2.6).
//
// Uses @testing-library/react with fake Template_Manager + report-viewer store
// implementations (no Firebase). Asserts:
//   - the live template list renders customer name + upload date (R2.4),
//   - uploading calls the manager with the file + customer name (R2.1),
//   - an invalid-file upload surfaces the manager's descriptive error (R2.3),
//   - inspecting shows sheet names + dimensions (R2.5),
//   - deletion is confirmation-gated: the manager delete runs only after the
//     user confirms in the inline prompt (R2.6).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerTemplate,
  CustomerTemplateSummary,
  TemplateManager,
  TemplateStructure,
} from '@rnh/shared';
import type { ReportViewerStore } from '../data-access';
import { TemplateManagerPanel } from './TemplateManagerPanel';

function makeStore(
  templates: CustomerTemplateSummary[],
): ReportViewerStore {
  return {
    subscribeCustomerTemplates(onData) {
      onData(templates);
      return () => {};
    },
    subscribeTestSessions() {
      return () => {};
    },
    subscribeFieldMappings() {
      return () => {};
    },
    deleteTestSession: vi.fn(async () => {}),
  };
}

const structure: TemplateStructure = {
  sheets: [
    { name: 'MU1', index: 0, rowCount: 20, columnCount: 8, mergedRanges: [] },
    { name: 'Description', index: 1, rowCount: 5, columnCount: 3, mergedRanges: [] },
  ],
};

function makeManager(overrides: Partial<TemplateManager> = {}): TemplateManager {
  return {
    upload: vi.fn(async (_file, customerName) => ({
      templateId: 't-new',
      customerName,
    } as CustomerTemplate)),
    list: vi.fn(async () => []),
    inspect: vi.fn(async () => structure),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('TemplateManagerPanel', () => {
  it('lists stored templates with customer name and upload date (R2.4)', () => {
    const store = makeStore([
      { templateId: 't1', customerName: 'Maruti', uploadDate: 1_700_000_000_000 },
    ]);
    render(<TemplateManagerPanel templateManager={makeManager()} reportViewerStore={store} />);
    expect(screen.getByText('Maruti')).toBeInTheDocument();
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument();
  });

  it('uploads a chosen .xlsx for a named customer (R2.1)', async () => {
    const user = userEvent.setup();
    const manager = makeManager();
    render(<TemplateManagerPanel templateManager={manager} reportViewerStore={makeStore([])} />);

    await user.type(screen.getByLabelText('Customer name'), 'Renault');
    const file = new File([new Uint8Array([1, 2, 3])], 'template.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByLabelText('Template file'), file);
    await user.click(screen.getByRole('button', { name: 'Upload template' }));

    await waitFor(() => {
      expect(manager.upload).toHaveBeenCalledWith(file, 'Renault');
    });
  });

  it('surfaces a descriptive error when the upload is rejected (R2.3)', async () => {
    const user = userEvent.setup();
    const manager = makeManager({
      upload: vi.fn(async () => {
        throw new Error('Uploaded file is not a valid .xlsx workbook.');
      }),
    });
    render(<TemplateManagerPanel templateManager={manager} reportViewerStore={makeStore([])} />);

    await user.type(screen.getByLabelText('Customer name'), 'BadCo');
    const file = new File([new Uint8Array([0])], 'bad.xlsx');
    await user.upload(screen.getByLabelText('Template file'), file);
    await user.click(screen.getByRole('button', { name: 'Upload template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid .xlsx/i);
  });

  it('inspects a template and shows sheet names + dimensions (R2.5)', async () => {
    const user = userEvent.setup();
    const manager = makeManager();
    const store = makeStore([
      { templateId: 't1', customerName: 'TATA', uploadDate: 1_700_000_000_000 },
    ]);
    render(<TemplateManagerPanel templateManager={manager} reportViewerStore={store} />);

    await user.click(screen.getByRole('button', { name: 'Inspect' }));

    expect(await screen.findByText(/MU1: 20 rows × 8 columns/)).toBeInTheDocument();
    expect(screen.getByText(/Description: 5 rows × 3 columns/)).toBeInTheDocument();
    expect(manager.inspect).toHaveBeenCalledWith('t1');
  });

  it('deletes only after the user confirms (R2.6)', async () => {
    const user = userEvent.setup();
    const manager = makeManager();
    const store = makeStore([
      { templateId: 't1', customerName: 'Hyundai', uploadDate: 1_700_000_000_000 },
    ]);
    render(<TemplateManagerPanel templateManager={manager} reportViewerStore={store} />);

    // First click only arms the confirmation — nothing is deleted yet.
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(manager.delete).not.toHaveBeenCalled();

    // Confirming performs the (confirmed) deletion.
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => {
      expect(manager.delete).toHaveBeenCalledWith('t1', true);
    });
  });
});
