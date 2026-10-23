// Component tests for the report generation panel (R8.1, R9.1, R9.2, R9.3, R9.4).
//
// The shared generator is module-mocked so these tests focus on the UI wiring:
// picking a template + session, generating, showing the preview + missing
// required fields, and downloading a Blob named with the suggested filename.
// The report-viewer store, byte loader, and downloader are injected fakes so
// nothing touches Firebase or produces a real .xlsx.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomerTemplateSummary,
  GeneratedReportWithPreview,
  TestSession,
} from '@rnh/shared';
import type { ReportViewerStore } from '../data-access';
import { ReportGenerationPanel } from './ReportGenerationPanel';

const generateReportWithPreview = vi.hoisted(() => vi.fn());

vi.mock('@rnh/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rnh/shared')>();
  return { ...actual, generateReportWithPreview };
});

const templates: CustomerTemplateSummary[] = [
  { templateId: 't1', customerName: 'Maruti', uploadDate: 1_700_000_000_000 },
];

const session = {
  sessionId: 's1',
  templateId: 't1',
  conditions: { testDate: '2026-09-15', driverName: 'Ada', testTrack: 'MU1' },
  vehicle: { vehicleId: 'CAR-1' },
  tyreSets: [],
  ride: { parameters: [], averageRating: 0 },
  handling: { parameters: [], averageRating: 0 },
  syncState: 'synced',
} as unknown as TestSession;

function makeStore(): ReportViewerStore {
  return {
    subscribeCustomerTemplates(onData) {
      onData(templates);
      return () => {};
    },
    subscribeTestSessions(onData) {
      onData([session]);
      return () => {};
    },
    subscribeFieldMappings(_templateId, onData) {
      onData([]);
      return () => {};
    },
    deleteTestSession: vi.fn(async () => {}),
  };
}

const generated: GeneratedReportWithPreview = {
  bytes: new Uint8Array([9, 8, 7]),
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  suggestedFileName: 'Maruti_2026-09-15.xlsx',
  missingRequiredFields: [
    {
      inputFieldKey: 'vehicle.rimSize',
      sheetName: 'MU1',
      cellAddress: 'D4',
      label: 'MU1!D4 (vehicle.rimSize)',
    },
  ],
  preview: {
    sheets: [
      {
        sheetName: 'MU1',
        cells: [
          { cellAddress: 'C7', inputFieldKey: 'vehicle.vehicleId', value: 'CAR-1' },
        ],
      },
    ],
    totalPopulatedCells: 1,
    populatedSheetNames: ['MU1'],
    missingRequiredFields: [],
  },
};

beforeEach(() => {
  generateReportWithPreview.mockReset();
});

describe('ReportGenerationPanel', () => {
  async function selectAndGenerate(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText('Report template'), 't1');
    await user.selectOptions(screen.getByLabelText('Report session'), 's1');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
  }

  it('generates and shows the preview + missing required fields (R8.1, R9.4, R8.5)', async () => {
    const user = userEvent.setup();
    generateReportWithPreview.mockResolvedValue(generated);
    render(
      <ReportGenerationPanel
        reportViewerStore={makeStore()}
        loadTemplateBytes={async () => new Uint8Array([1, 2, 3])}
        download={vi.fn()}
      />,
    );

    await selectAndGenerate(user);

    const preview = await screen.findByLabelText('Report preview');
    expect(preview).toHaveTextContent('1 populated cell');
    expect(preview).toHaveTextContent('CAR-1');

    const missing = screen.getByLabelText('Missing required fields');
    expect(missing).toHaveTextContent('MU1!D4 (vehicle.rimSize)');
  });

  it('downloads a Blob named with the suggested filename (R9.1, R9.3)', async () => {
    const user = userEvent.setup();
    generateReportWithPreview.mockResolvedValue(generated);
    const download = vi.fn();
    render(
      <ReportGenerationPanel
        reportViewerStore={makeStore()}
        loadTemplateBytes={async () => new Uint8Array([1, 2, 3])}
        download={download}
      />,
    );

    await selectAndGenerate(user);
    await screen.findByLabelText('Report preview');
    await user.click(screen.getByRole('button', { name: /Download Maruti_2026-09-15\.xlsx/ }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [blob, fileName] = download.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(fileName).toBe('Maruti_2026-09-15.xlsx');
  });

  it('shows an explicit error and offers no download when generation fails (R9.2)', async () => {
    const user = userEvent.setup();
    generateReportWithPreview.mockRejectedValue(new Error('workbook is corrupt'));
    const download = vi.fn();
    render(
      <ReportGenerationPanel
        reportViewerStore={makeStore()}
        loadTemplateBytes={async () => new Uint8Array([1, 2, 3])}
        download={download}
      />,
    );

    await selectAndGenerate(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('workbook is corrupt');
    expect(screen.queryByLabelText('Report preview')).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
});
