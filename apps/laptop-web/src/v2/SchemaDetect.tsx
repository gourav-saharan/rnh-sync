// Template Studio · detect parameters from the sheet (R3.1, R3.2). The admin
// picks a sheet and the parameter-name range (e.g. "C8:C26"); categories come
// from the merged labels on the left, Average / formula / heading rows are
// skipped and listed so they can be re-included.

import { useState } from 'react';
import {
  proposeSchema,
  type ExcludedRow,
  type SchemaProposal,
  type SheetGrid,
} from '@rnh/shared/v2';
import { SheetView } from './SheetView';
import { ConfirmDialog } from './ConfirmDialog';

export interface SchemaDetectProps {
  grids: SheetGrid[];
  hasParameters: boolean;
  onApply: (proposal: SchemaProposal, sheetName: string) => void;
}

const REASON: Record<ExcludedRow['reason'], string> = {
  average: 'Average row',
  formula: 'Formula',
  heading: 'Section heading',
};

export function SchemaDetect({ grids, hasParameters, onApply }: SchemaDetectProps): JSX.Element {
  const [sheetIdx, setSheetIdx] = useState(0);
  const [range, setRange] = useState('');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [proposal, setProposal] = useState<SchemaProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const grid = grids[sheetIdx];

  const detect = () => {
    setError(null);
    if (!grid) return;
    try {
      const p = proposeSchema(grid, range.trim().toUpperCase());
      if (p.parameters.length === 0) setError('No parameter names found in that range.');
      setProposal(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that range.');
      setProposal(null);
    }
  };

  const onCell = (address: string, shift: boolean) => {
    // Click = start, shift+click = end of the name column range.
    if (shift && anchor) setRange(`${anchor}:${address}`);
    else {
      setAnchor(address);
      setRange(address);
    }
  };

  return (
    <section className="l-card" aria-label="Detect parameters">
      <h3>1 · Detect parameters from the sheet</h3>
      <p className="l-muted l-small">
        Click the first parameter name, then Shift+click the last one (or type the range). Category
        labels are read from the column on the left.
      </p>
      <div className="l-row">
        <label className="l-field">
          <span>Sheet</span>
          <select value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>
            {grids.map((g, i) => (
              <option key={g.name} value={i}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="l-field">
          <span>Parameter name range</span>
          <input
            value={range}
            placeholder="e.g. C8:C26"
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="l-btn l-btn--primary"
          disabled={!range.trim()}
          onClick={detect}
        >
          Detect
        </button>
      </div>
      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}

      {proposal && proposal.parameters.length > 0 ? (
        <div className="l-alert l-alert--ok">
          <p>
            Found <strong>{proposal.parameters.length}</strong> parameters in{' '}
            <strong>{proposal.categories.length}</strong> categories
            {proposal.weightColumn ? ' (weights read from the Weight column)' : ''}:{' '}
            {proposal.categories.map((c) => c.name).join(', ')}.
          </p>
          {proposal.excludedRows.length > 0 ? (
            <p className="l-small">
              Skipped:{' '}
              {proposal.excludedRows
                .map((r) => `row ${r.row} "${r.text}" (${REASON[r.reason]})`)
                .join('; ')}
              . Add any of them back in the list below if needed.
            </p>
          ) : null}
          <button
            type="button"
            className="l-btn l-btn--primary"
            onClick={() => {
              if (hasParameters) {
                setConfirmReplace(true);
                return;
              }
              onApply(proposal, grid?.name ?? '');
              setProposal(null);
            }}
          >
            Use these parameters
          </button>
        </div>
      ) : null}

      {confirmReplace && proposal ? (
        <ConfirmDialog
          title="Replace the current parameters?"
          confirmLabel="Replace parameters"
          danger
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => {
            onApply(proposal, grid?.name ?? '');
            setProposal(null);
            setConfirmReplace(false);
          }}
        >
          <p>
            The draft's parameter list is replaced with the {proposal.parameters.length} detected
            ones. Existing mappings may need to be redone. Published versions are not affected.
          </p>
        </ConfirmDialog>
      ) : null}

      {grid ? (
        <SheetView
          grid={grid}
          maxRows={60}
          highlights={range ? highlightRange(range) : {}}
          onCellClick={onCell}
        />
      ) : null}
    </section>
  );
}

function highlightRange(range: string): Record<string, 'select'> {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(range.trim());
  if (!m) return {};
  const col = m[1].toUpperCase();
  const top = Number(m[2]);
  const bottom = m[4] ? Number(m[4]) : top;
  const out: Record<string, 'select'> = {};
  for (let r = Math.min(top, bottom); r <= Math.max(top, bottom); r += 1)
    out[`${col}${r}`] = 'select';
  return out;
}
