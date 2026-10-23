// Template Studio header fields (R3.7): label, type, unit, choices, required,
// prefill. Presets cover the fields seen in the customer sheets.

import type { HeaderFieldDef, TemplateSchema } from '@rnh/shared/v2';
import { HEADER_PRESETS, fieldIdFor, type HeaderPreset } from './headerPresets';
import { HeaderFieldRow } from './HeaderFieldRow';

export function HeaderFieldsEditor({
  schema,
  onChange,
}: {
  schema: TemplateSchema;
  onChange: (s: TemplateSchema) => void;
}): JSX.Element {
  const fields = schema.headerFields;
  const set = (list: HeaderFieldDef[]) => onChange({ ...schema, headerFields: list });
  const patch = (id: string, change: Partial<HeaderFieldDef>) =>
    set(fields.map((f) => (f.fieldId === id ? { ...f, ...change } : f)));
  const add = (p: HeaderPreset) => {
    const taken = new Set(fields.map((f) => f.fieldId));
    set([...fields, { ...p, fieldId: fieldIdFor(p.label, taken) }]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const list = [...fields];
    [list[i], list[j]] = [list[j], list[i]];
    set(list);
  };
  const used = new Set(fields.map((f) => f.label.toLowerCase()));

  return (
    <section className="l-card" aria-label="Header fields">
      <h3>Test details (header fields)</h3>
      <p className="l-muted l-small">
        Filled in on the phone before driving. Required fields stay flagged until completed.
      </p>
      <div className="l-chips" role="group" aria-label="Add a common field">
        {HEADER_PRESETS.filter((p) => !used.has(p.label.toLowerCase())).map((p) => (
          <button key={p.label} type="button" className="l-chip" onClick={() => add(p)}>
            + {p.label}
          </button>
        ))}
        <button
          type="button"
          className="l-chip"
          onClick={() => add({ label: 'New field', type: 'text', required: false })}
        >
          + Custom field
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="l-muted">No header fields yet.</p>
      ) : (
        <div className="l-table-wrap">
          <table className="l-table l-table--compact">
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Type</th>
                <th scope="col">Unit / choices</th>
                <th scope="col">Required</th>
                <th scope="col">Prefill</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => (
                <HeaderFieldRow
                  key={f.fieldId}
                  field={f}
                  first={i === 0}
                  last={i === fields.length - 1}
                  onPatch={(c) => patch(f.fieldId, c)}
                  onMove={(d) => move(i, d)}
                  onRemove={() => set(fields.filter((x) => x.fieldId !== f.fieldId))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
