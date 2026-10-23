// Mapping_Editor UI (Laptop_Web_App, task 16.1).
//
// The Report_Viewer's surface for mapping a Customer_Template's cells to
// Mobile_PWA input fields (R3.1, R3.4, R3.5, R3.6):
//   - begin(templateId): loads the template structure so the editor can show
//     which sheets/cells exist to map (R3.1),
//   - loadExisting(templateId): starts editing from the previously saved
//     Field_Mappings (R3.6),
//   - the user edits a list of mapping rows (sheet, cell, input field key,
//     field type, required),
//   - save(templateId, mappings): persists the non-conflicting mappings and
//     surfaces the withheld duplicate-target conflicts to the user (R3.4, R3.5).
//
// Persistence is delegated entirely to the shared Mapping_Editor store
// (createMappingEditorStore from @rnh/shared), which reuses the pure conflict
// engine — this component neither re-detects conflicts nor writes Firestore
// directly. The store is injectable so tests drive it with a fake.

import { useEffect, useMemo, useState } from 'react';
import {
  createMappingEditorStore,
  type FieldMapping,
  type FieldType,
  type MappingEditorStore,
  type SaveResult,
  type TemplateStructure,
  type WithheldMapping,
} from '@rnh/shared';

export interface MappingEditorPanelProps {
  /** The Customer_Template being mapped. */
  templateId: string;
  /** Persistence surface. Defaults to the shared, env-initialized store. */
  mappingEditorStore?: MappingEditorStore;
}

const FIELD_TYPES: readonly FieldType[] = [
  'tyreSet',
  'vehicle',
  'condition',
  'rhRating',
  'rhNote',
  'meta',
];

/** A locally-edited mapping row before it is persisted. */
interface DraftRow {
  key: string;
  mappingId: string;
  sheetName: string;
  cellAddress: string;
  inputFieldKey: string;
  fieldType: FieldType;
  required: boolean;
}

let rowSeq = 0;
function newRow(templateId: string, defaultSheet: string): DraftRow {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    mappingId: `${templateId}-m${rowSeq}`,
    sheetName: defaultSheet,
    cellAddress: '',
    inputFieldKey: '',
    fieldType: 'meta',
    required: false,
  };
}

function toFieldMapping(templateId: string, row: DraftRow): FieldMapping {
  return {
    mappingId: row.mappingId,
    templateId,
    sheetName: row.sheetName,
    cellAddress: row.cellAddress,
    inputFieldKey: row.inputFieldKey,
    fieldType: row.fieldType,
    required: row.required,
  };
}

function toRow(mapping: FieldMapping): DraftRow {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    mappingId: mapping.mappingId,
    sheetName: mapping.sheetName,
    cellAddress: mapping.cellAddress,
    inputFieldKey: mapping.inputFieldKey,
    fieldType: mapping.fieldType,
    required: mapping.required,
  };
}

/**
 * The Mapping_Editor panel. Loads the template structure + existing mappings,
 * lets the Report_Viewer edit mapping rows, and on save surfaces any
 * duplicate-target conflicts that were withheld (R3.5).
 */
export function MappingEditorPanel({
  templateId,
  mappingEditorStore,
}: MappingEditorPanelProps): JSX.Element {
  const store = useMemo<MappingEditorStore>(
    () => mappingEditorStore ?? createMappingEditorStore(),
    [mappingEditorStore],
  );

  const [structure, setStructure] = useState<TemplateStructure | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [conflicts, setConflicts] = useState<WithheldMapping[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const sheetNames = structure?.sheets.map((s) => s.name) ?? [];
  const defaultSheet = sheetNames[0] ?? '';

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNotice(null);
    setConflicts([]);
    setLoaded(false);
    (async () => {
      try {
        // Present the template's sheets/cells (R3.1) and start editing from the
        // previously saved mappings (R3.6).
        const [loadedStructure, existing] = await Promise.all([
          store.begin(templateId),
          store.loadExisting(templateId),
        ]);
        if (cancelled) {
          return;
        }
        setStructure(loadedStructure);
        setRows(existing.map(toRow));
        setLoaded(true);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, templateId]);

  function updateRow(key: string, patch: Partial<DraftRow>): void {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow(): void {
    setRows((prev) => [...prev, newRow(templateId, defaultSheet)]);
  }

  function removeRow(key: string): void {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setNotice(null);
    setConflicts([]);
    setSaving(true);
    try {
      const mappings = rows.map((row) => toFieldMapping(templateId, row));
      const result: SaveResult = await store.save(templateId, mappings);
      setNotice(`Saved ${result.saved.length} mapping(s).`);
      // Surface the duplicate-target conflicts that were withheld (R3.5).
      setConflicts(result.withheld);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="mapping-editor-heading">
      <h2 id="mapping-editor-heading">Field mappings</h2>

      {error !== null && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" style={{ color: '#0a6b0a' }}>
          {notice}
        </p>
      )}

      {!loaded && error === null && (
        <p className="loading-indicator">Loading template…</p>
      )}

      {conflicts.length > 0 && (
        <div role="alert" aria-label="Mapping conflicts" style={{ color: '#b00020' }}>
          <p>
            {conflicts.length} mapping(s) were withheld because they target a cell
            already in use:
          </p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.mapping.mappingId} data-testid={`conflict-${c.mapping.mappingId}`}>
                {c.mapping.sheetName}!{c.mapping.cellAddress} ({c.mapping.inputFieldKey}) —{' '}
                {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th scope="col">Sheet</th>
            <th scope="col">Cell</th>
            <th scope="col">Input field</th>
            <th scope="col">Type</th>
            <th scope="col">Required</th>
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} data-testid={`mapping-row-${index}`}>
              <td>
                {sheetNames.length > 0 ? (
                  <select
                    aria-label={`Mapping ${index + 1} sheet`}
                    value={row.sheetName}
                    onChange={(e) => updateRow(row.key, { sheetName: e.target.value })}
                  >
                    {sheetNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label={`Mapping ${index + 1} sheet`}
                    value={row.sheetName}
                    onChange={(e) => updateRow(row.key, { sheetName: e.target.value })}
                  />
                )}
              </td>
              <td>
                <input
                  type="text"
                  aria-label={`Mapping ${index + 1} cell`}
                  value={row.cellAddress}
                  onChange={(e) => updateRow(row.key, { cellAddress: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  aria-label={`Mapping ${index + 1} input field`}
                  value={row.inputFieldKey}
                  onChange={(e) => updateRow(row.key, { inputFieldKey: e.target.value })}
                />
              </td>
              <td>
                <select
                  aria-label={`Mapping ${index + 1} type`}
                  value={row.fieldType}
                  onChange={(e) =>
                    updateRow(row.key, { fieldType: e.target.value as FieldType })
                  }
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Mapping ${index + 1} required`}
                  checked={row.required}
                  onChange={(e) => updateRow(row.key, { required: e.target.checked })}
                />
              </td>
              <td>
                <button type="button" onClick={() => removeRow(row.key)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" onClick={addRow}>
        Add mapping
      </button>
      <button type="button" onClick={() => void handleSave()} disabled={saving}>
        {saving ? 'Saving…' : 'Save mappings'}
      </button>
    </section>
  );
}
