// Template Studio · map the sheet (R4). Select a region (click + Shift+click)
// and declare it a rating block, or click one cell and bind it to a header
// field / tyre detail. Targets are colour-coded with a letter marker (R4.5);
// problems block saving (R4.6, R4.7); coverage + Test fill check it (R4.9-10).

import { useState } from 'react';
import {
  autoDetectRatingBlock,
  type Mapping,
  type SheetGrid,
  type TemplateSchema,
  type TemplateStructureV2,
} from '@rnh/shared/v2';
import { plainError } from './context';
import { SheetView } from './SheetView';
import { BlockMappingForm } from './BlockMappingForm';
import { CellMappingForm } from './CellMappingForm';
import { MappingCoverage } from './MappingCoverage';
import { MappingList } from './MappingList';
import { useMappingView, useTestFill } from './useMappingView';

export interface MappingEditorProps {
  grids: SheetGrid[];
  structure: TemplateStructureV2 | null;
  schema: TemplateSchema;
  mappings: Mapping[];
  loadBytes: () => Promise<Uint8Array>;
  saving: boolean;
  onSave: (mappings: Mapping[]) => Promise<void>;
  fileBase: string;
}

export function MappingEditor(p: MappingEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Mapping[]>(p.mappings);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [region, setRegion] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const grid = p.grids[sheetIdx];
  const dirty = JSON.stringify(draft) !== JSON.stringify(p.mappings);
  const view = useMappingView(p.structure, p.schema, draft, grid?.name, region);
  const fill = useTestFill(p.loadBytes, p.structure, p.schema, p.fileBase);

  const clearSel = () => {
    setRegion('');
    setAnchor(null);
  };
  const onCell = (address: string, shift: boolean) => {
    if (shift && anchor) setRegion(`${anchor}:${address}`);
    else {
      setAnchor(address);
      setRegion(address);
    }
  };
  const add = (m: Mapping) => {
    setDraft((d) => [...d, m]);
    clearSel();
    setMsg(null);
  };
  const save = async () => {
    setMsg(null);
    try {
      await p.onSave(draft);
      setMsg({ ok: true, text: 'Mappings saved to the draft.' });
    } catch (e) {
      setMsg({ ok: false, text: plainError(e) });
    }
  };

  const onAutoDetect = () => {
    setMsg(null);
    const mappedSheets = draft
      .filter((m): m is Extract<Mapping, { kind: 'block' }> => m.kind === 'block')
      .map((m) => m.sheetName);
    const result =
      autoDetectRatingBlock(p.grids, p.schema, {
        firstSlot: view.nextSlot,
        skipSheets: mappedSheets,
      }) || autoDetectRatingBlock(p.grids, p.schema, { firstSlot: view.nextSlot });

    if (result) {
      setDraft((d) => [...d, result.mapping]);
      setSheetIdx(result.gridIndex);
      clearSel();
      setMsg({
        ok: true,
        text: `Auto-detected rating block on sheet "${result.sheetName}" (${result.matchedCount} parameters mapped). Click "Save mappings" to save.`,
      });
    } else {
      setMsg({
        ok: false,
        text: 'Could not auto-detect a rating block. Please click a cell and Shift+click to select the rating table region manually.',
      });
    }
  };

  const isSingle = region !== '' && !region.includes(':');

  return (
    <section className="l-card" aria-label="Map the sheet">
      <div className="l-row l-row--between">
        <h3>Map the sheet</h3>
        <div className="l-row">
          <button
            type="button"
            className="l-btn l-btn--secondary"
            disabled={p.schema.parameters.length === 0 || p.grids.length === 0}
            onClick={onAutoDetect}
            title="Scan sheets and auto-detect rating blocks matching the parameters"
          >
            ⚡ Auto-detect rating block
          </button>
          <button
            type="button"
            className="l-btn"
            disabled={fill.busy || !p.structure || draft.length === 0}
            onClick={() => void fill.run(draft).then(setMsg)}
          >
            {fill.busy ? 'Filling…' : '⬇ Test fill'}
          </button>
          <button
            type="button"
            className="l-btn l-btn--primary"
            disabled={!dirty || view.blocking || p.saving}
            onClick={() => void save()}
          >
            {p.saving ? 'Saving…' : 'Save mappings'}
          </button>
        </div>
      </div>
      <p className="l-muted l-small">
        Click a cell, then Shift+click to select a region. Legend: R rating · C comment · H header ·
        T tyre detail · ƒ formula (cannot be mapped) · ! problem.
      </p>
      {msg ? (
        <p
          className={`l-alert ${msg.ok ? 'l-alert--ok' : 'l-alert--danger'}`}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      {view.blocking ? (
        <p className="l-alert l-alert--danger" role="alert">
          Fix the problems listed on the right before saving.
        </p>
      ) : null}

      <div className="l-tabs" role="tablist">
        {p.grids.map((g, i) => (
          <button
            key={g.name}
            type="button"
            role="tab"
            aria-selected={i === sheetIdx}
            className={`l-tab${i === sheetIdx ? ' l-tab--active' : ''}`}
            onClick={() => {
              setSheetIdx(i);
              clearSel();
            }}
          >
            {g.name}
          </button>
        ))}
      </div>

      <div className="l-studio">
        <div className="l-studio__sheet">
          {grid ? (
            <SheetView
              grid={grid}
              highlights={view.highlights}
              cellTitle={(a) => view.titles[a] ?? ''}
              onCellClick={onCell}
              maxRows={70}
            />
          ) : (
            <p className="l-muted">No sheets.</p>
          )}
        </div>
        <aside className="l-studio__side">
          <p className="l-small">
            Selection: <strong>{region || 'none'}</strong>
          </p>
          {grid && region && !isSingle ? (
            <BlockMappingForm
              grid={grid}
              schema={p.schema}
              region={region}
              nextSlot={view.nextSlot}
              onAdd={add}
            />
          ) : null}
          {grid && isSingle ? (
            <CellMappingForm sheetName={grid.name} schema={p.schema} cell={region} onAdd={add} />
          ) : null}
          <MappingList
            mappings={draft}
            problems={view.expanded.problems}
            onRemove={(id) => setDraft((d) => d.filter((m) => m.mappingId !== id))}
          />
          <MappingCoverage input={view.input} targets={view.expanded.targets} />
        </aside>
      </div>
    </section>
  );
}
