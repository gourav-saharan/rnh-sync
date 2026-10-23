// Report generation (R11, R12): pre-flight -> fill the pinned Template_Version
// workbook -> preview every sheet with written cells outlined -> download.
// On failure an explicit error is shown and no file is offered (R12.3).

import { useMemo, useState } from 'react';
import {
  fillWorkbookV2,
  preflight as runPreflight,
  readSheetGrids,
  reportFileName,
  type SheetGrid,
  type TemplateVersion,
  type TestSessionV2,
} from '@rnh/shared/v2';
import { XLSX_MIME } from '@rnh/shared/v2data';
import { downloadBytes, plainError, useLaptop } from './context';
import { headerGuess, testDateOf } from './Dashboard';
import { PreflightPanel } from './PreflightPanel';
import { SheetView, type HighlightKind } from './SheetView';

export interface ReportDialogProps {
  session: TestSessionV2;
  version: TemplateVersion;
  onClose: () => void;
}

interface Generated {
  bytes: Uint8Array;
  grids: SheetGrid[];
  written: Record<string, Record<string, HighlightKind>>;
  fileName: string;
}

export function ReportDialog({ session, version, onClose }: ReportDialogProps): JSX.Element {
  const { templates, sessions, user } = useLaptop();
  const pf = useMemo(() => runPreflight(session, version), [session, version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Generated | null>(null);
  const [sheet, setSheet] = useState(0);
  const [done, setDone] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const templateBytes = await templates.loadVersionBytes(
        session.templateId,
        session.templateVersion,
      );
      const filled = await fillWorkbookV2(templateBytes, session, version);
      // Re-parse the output: proves it opens and feeds the preview (R11.8, R12.1).
      const grids = await readSheetGrids(filled.bytes);
      const written: Generated['written'] = {};
      for (const w of filled.writes) {
        (written[w.target.sheetName] ??= {})[w.target.cellAddress] = 'written';
      }
      const fileName = reportFileName(version.schema.fileNamePattern, {
        customer: session.customerName,
        template: session.templateName,
        vehicle: headerGuess(session, ['vehicle']),
        tyreSize: headerGuess(session, ['tyre size', 'tire size', 'size']),
        testDate: testDateOf(session),
      });
      setResult({ bytes: filled.bytes, grids, written, fileName });
      setSheet(0);
    } catch (e) {
      setError(`Report could not be generated: ${plainError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!result) return;
    downloadBytes(result.bytes, result.fileName, XLSX_MIME);
    try {
      await sessions.updateFields(
        session.sessionId,
        [
          { path: 'status', before: session.status, after: 'reported' },
          {
            path: 'lastReport',
            before: session.lastReport ?? null,
            after: { at: Date.now(), by: user.uid, templateVersion: session.templateVersion },
          },
        ],
        { uid: user.uid, name: user.displayName },
      );
      setDone(true);
    } catch (e) {
      setError(`Downloaded, but the report could not be recorded: ${plainError(e)}`);
    }
  };

  const grid = result?.grids[sheet];

  return (
    <div className="l-dialog" role="dialog" aria-modal="true" aria-label="Generate report">
      <div className="l-dialog__panel">
        <header className="l-dialog__head">
          <h2>
            Report · {session.customerName} · {session.templateName} v{session.templateVersion}
          </h2>
          <button type="button" className="l-btn l-btn--ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <PreflightPanel preflight={pf} />

        <div className="l-row">
          <button
            type="button"
            className="l-btn l-btn--primary"
            disabled={busy || pf.blockers.length > 0}
            onClick={() => void generate()}
          >
            {busy
              ? 'Generating…'
              : result
                ? 'Generate again'
                : pf.warnings.length
                  ? 'Continue and generate'
                  : 'Generate'}
          </button>
          {result ? (
            <button type="button" className="l-btn l-btn--success" onClick={() => void download()}>
              ⬇ Download {result.fileName}
            </button>
          ) : null}
        </div>

        {error ? (
          <p className="l-alert l-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="l-alert l-alert--ok">Report downloaded and marked as reported.</p>
        ) : null}

        {result && grid ? (
          <section aria-label="Report preview" className="l-preview">
            <div className="l-tabs" role="tablist">
              {result.grids.map((g, i) => (
                <button
                  key={g.name}
                  type="button"
                  role="tab"
                  aria-selected={i === sheet}
                  className={`l-tab${i === sheet ? ' l-tab--active' : ''}`}
                  onClick={() => setSheet(i)}
                >
                  {g.name} ({Object.keys(result.written[g.name] ?? {}).length})
                </button>
              ))}
            </div>
            <p className="l-muted l-small">
              Outlined cells were written. ƒ cells are the customer's formulas and recalculate when
              opened in Excel.
            </p>
            <SheetView grid={grid} highlights={result.written[grid.name] ?? {}} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
