// Comprehensive unit tests for the report export + preview UI (task 16.2).
//
// Task 16.1 shipped ReportGenerationPanel.test.tsx with three baseline cases
// (preview + missing fields, download, generation failure). This file ADDS the
// coverage that task 16.2 calls for so the export/preview surface is fully
// exercised:
//
//   - Preview rendering (R9.4): the populated sheet(s), each cell's address /
//     mapped field / value, the total populated-cell count, and multi-sheet
//     rendering.
//   - Missing-required-fields surfacing (R8.5): the missing list renders each
//     field label, AND the "nothing missing" case shows a clear all-present
//     message.
//   - .xlsx download name + format (R9.1, R9.3): clicking Download hands the
//     injected downloader a Blob tagged with XLSX_MIME_TYPE and the suggested
//     filename (customer name + test date, .xlsx).
//   - Generation-failure messaging (R9.2): a thrown generation shows an
//     explicit error and leaves no preview or download available.
//
// The shared generator is module-mocked and the store / byte loader /
// downloader are injected fakes, so tests are deterministic and Firebase-free.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomerTemplateSummary,
  GeneratedReportWithPreview,
  TestSession,
} from '@rnh/shared';
import { XLSX_MIME_TYPE } from '@rnh/shared';
import type { ReportViewerStore } from '../data-access';
import { ReportGenerationPanel } from './ReportGenerationPanel';

const generateReportWithPreview = vi.hoisted(() => vi.fn());

vi.mock('@rnh/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rnh/shared')>();
  return { ...actual, generateReportWithPreview };
});

const templates: CustomerTemplateSummary[] = [
  { templateId: 't1', customerName: 'Hyundai', uploadDate: 1_700_000_000_000 },
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

/** A report spanning two sheets with several populated cells and a missing field. */
const multiSheetReport: GeneratedReportWithPreview = {
  bytes: new Uint8Array([80, 75, 3, 4]),
  mimeType: XLSX_MIME_TYPE,
  suggestedFileName: 'Hyundai_2026-09-15.xlsx',
  missingRequiredFields: [
    {
      inputFieldKey: 'vehicle.rimSize',
      sheetName: 'MU1',
      cellAddress: 'D4',
      label: 'MU1!D4 (Rim size)',
    },
    {
      inputFieldKey: 'conditions.tyrePressure',
      sheetName: 'MU2',
      cellAddress: 'F9',
      label: 'MU2!F9 (Tyre pressure)',
    },
  ],
  preview: {
    sheets: [
      {
        sheetName: 'MU1',
        cells: [
          { cellAddress: 'C7', inputFieldKey: 'vehicle.vehicleId', value: 'CAR-1' },
          { cellAddress: 'C8', inputFieldKey: 'conditions.driverName', value: 'Ada' },
        ],
      },
      {
        sheetName: 'MU2',
        cells: [
          { cellAddress: 'B3', inputFieldKey: 'conditions.testTrack', value: 'MU1' },
        ],
      },
    ],
    totalPopulatedCells: 3,
    populatedSheetNames: ['MU1', 'MU2'],
    missingRequiredFields: [],
  },
};

/** A report where every required field has a value (the "none missing" case). */
const allPresentReport: GeneratedReportWithPreview = {
  bytes: new Uint8Array([80, 75, 3, 4, 1, 2]),
  mimeType: XLSX_MIME_TYPE,
  suggestedFileName: 'Hyundai_2026-09-15.xlsx',
  missingRequiredFields: [],
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

async function selectAndGenerate(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Report template'), 't1');
  await user.selectOptions(screen.getByLabelText('Report session'), 's1');
  await user.click(screen.getByRole('button', { name: 'Generate' }));
}

function renderPanel(download = vi.fn()) {
  render(
    <ReportGenerationPanel
      reportViewerStore={makeStore()}
      loadTemplateBytes={async () => new Uint8Array([1, 2, 3])}
      download={download}
    />,
  );
  return { download };
}

beforeEach(() => {
  generateReportWithPreview.mockReset();
});

describe('Report export + preview UI (task 16.2)', () => {
  describe('preview rendering (R9.4)', () => {
    it('renders every populated sheet with each cell address, field, and value', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockResolvedValue(multiSheetReport);
      renderPanel();

      await selectAndGenerate(user);
      await screen.findByLabelText('Report preview');

      // Both sheets from the preview are rendered as their own sections.
      const mu1 = screen.getByTestId('preview-sheet-MU1');
      const mu2 = screen.getByTestId('preview-sheet-MU2');

      // MU1 shows each mapped cell's address, field key, and value.
      expect(within(mu1).getByText('C7')).toBeInTheDocument();
      expect(within(mu1).getByText('vehicle.vehicleId')).toBeInTheDocument();
      expect(within(mu1).getByText('CAR-1')).toBeInTheDocument();
      expect(within(mu1).getByText('C8')).toBeInTheDocument();
      expect(within(mu1).getByText('conditions.driverName')).toBeInTheDocument();
      expect(within(mu1).getByText('Ada')).toBeInTheDocument();

      // MU2's cell renders in its own section.
      expect(within(mu2).getByText('B3')).toBeInTheDocument();
      expect(within(mu2).getByText('conditions.testTrack')).toBeInTheDocument();
      expect(within(mu2).getByText('MU1')).toBeInTheDocument();
    });

    it('shows the total populated cell count from the preview', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockResolvedValue(multiSheetReport);
      renderPanel();

      await selectAndGenerate(user);

      const preview = await screen.findByLabelText('Report preview');
      expect(preview).toHaveTextContent('3 populated cell');
    });

    it('shows no preview until a report has been generated', () => {
      generateReportWithPreview.mockResolvedValue(multiSheetReport);
      renderPanel();

      expect(screen.queryByLabelText('Report preview')).toBeNull();
    });
  });

  describe('missing required fields (R8.5)', () => {
    it('lists each missing required field by its label', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockResolvedValue(multiSheetReport);
      renderPanel();

      await selectAndGenerate(user);
      await screen.findByLabelText('Report preview');

      const missing = screen.getByLabelText('Missing required fields');
      const items = within(missing).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(missing).toHaveTextContent('MU1!D4 (Rim size)');
      expect(missing).toHaveTextContent('MU2!F9 (Tyre pressure)');
    });

    it('shows an all-present message when no required fields are missing', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockResolvedValue(allPresentReport);
      renderPanel();

      await selectAndGenerate(user);
      await screen.findByLabelText('Report preview');

      const missing = screen.getByLabelText('Missing required fields');
      expect(missing).toHaveTextContent(/all required fields have values/i);
      expect(within(missing).queryByRole('listitem')).toBeNull();
    });
  });

  describe('.xlsx download name + format (R9.1, R9.3)', () => {
    it('downloads a Blob tagged with the .xlsx mime type and the suggested filename', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockResolvedValue(multiSheetReport);
      const { download } = renderPanel();

      await selectAndGenerate(user);
      await screen.findByLabelText('Report preview');
      await user.click(
        screen.getByRole('button', { name: /Download Hyundai_2026-09-15\.xlsx/ }),
      );

      await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
      const [blob, fileName] = download.mock.calls[0]!;

      expect(blob).toBeInstanceOf(Blob);
      expect((blob as Blob).type).toBe(XLSX_MIME_TYPE);
      // Filename is the customer name + test date + .xlsx extension (R9.3).
      expect(fileName).toBe('Hyundai_2026-09-15.xlsx');
      expect(fileName).toMatch(/\.xlsx$/);
      expect(fileName).toContain('Hyundai');
      expect(fileName).toContain('2026-09-15');
    });

    it('carries the generated report bytes into the downloaded Blob', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockResolvedValue(multiSheetReport);
      const { download } = renderPanel();

      await selectAndGenerate(user);
      await screen.findByLabelText('Report preview');
      await user.click(
        screen.getByRole('button', { name: /Download Hyundai_2026-09-15\.xlsx/ }),
      );

      await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
      const [blob] = download.mock.calls[0]!;
      expect((blob as Blob).size).toBe(multiSheetReport.bytes.byteLength);
    });
  });

  describe('generation-failure messaging (R9.2)', () => {
    it('shows an explicit error and leaves no preview or download when generation throws', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockRejectedValue(new Error('template workbook is corrupt'));
      const { download } = renderPanel();

      await selectAndGenerate(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'template workbook is corrupt',
      );
      // No preview surface, and therefore no download control, and no download call.
      expect(screen.queryByLabelText('Report preview')).toBeNull();
      expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
      expect(download).not.toHaveBeenCalled();
    });

    it('surfaces a non-Error rejection as a message string', async () => {
      const user = userEvent.setup();
      generateReportWithPreview.mockRejectedValue('unexpected serialization fault');
      renderPanel();

      await selectAndGenerate(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'unexpected serialization fault',
      );
    });
  });
});
