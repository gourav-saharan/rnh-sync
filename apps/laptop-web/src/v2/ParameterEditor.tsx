// Template Studio parameter editor (R3.3, R3.4): categories and parameters
// can be renamed, re-categorised, reordered, added and removed. Short names
// are what Drive_Mode shows; weights feed the weighted average (R7.4).

import { useState } from 'react';
import { orderedCategories, parametersIn, type TemplateSchema } from '@rnh/shared/v2';
import { ParameterRow } from './ParameterRow';
import { ConfirmDialog } from './ConfirmDialog';
import {
  addCategory,
  addParam,
  moveCategory,
  moveParam,
  patchParam,
  removeCategory,
  removeParam,
  renameCategory,
} from './schemaOps';

export interface ParameterEditorProps {
  schema: TemplateSchema;
  onChange: (schema: TemplateSchema) => void;
}

export function ParameterEditor({ schema, onChange }: ParameterEditorProps): JSX.Element {
  const [newCat, setNewCat] = useState('');
  const [removing, setRemoving] = useState<{ id: string; name: string; count: number } | null>(
    null,
  );
  const cats = orderedCategories(schema);

  return (
    <section className="l-card" aria-label="Parameters">
      {removing ? (
        <ConfirmDialog
          title={`Remove "${removing.name}"?`}
          confirmLabel="Remove category"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            onChange(removeCategory(schema, removing.id));
            setRemoving(null);
          }}
        >
          <p>
            Its {removing.count} parameters are removed from the draft, and any mapping rows bound
            to them stop working. Published versions are not affected.
          </p>
        </ConfirmDialog>
      ) : null}
      <h3>Categories and parameters</h3>
      <p className="l-muted l-small">
        {schema.parameters.length} parameters in {cats.length} categories. The short name is what
        the tester sees while driving.
      </p>
      {cats.map((c, ci) => {
        const params = parametersIn(schema, c.categoryId);
        return (
          <fieldset key={c.categoryId} className="l-cat">
            <legend className="l-cat__head">
              <input
                aria-label="Category name"
                className="l-input l-input--strong"
                value={c.name}
                onChange={(e) => onChange(renameCategory(schema, c.categoryId, e.target.value))}
              />
              <button
                type="button"
                className="l-btn l-btn--ghost"
                disabled={ci === 0}
                onClick={() => onChange(moveCategory(schema, c.categoryId, -1))}
                aria-label={`Move ${c.name} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="l-btn l-btn--ghost"
                disabled={ci === cats.length - 1}
                onClick={() => onChange(moveCategory(schema, c.categoryId, 1))}
                aria-label={`Move ${c.name} down`}
              >
                ↓
              </button>
              <button
                type="button"
                className="l-btn l-btn--ghost-danger"
                onClick={() => {
                  if (params.length === 0) onChange(removeCategory(schema, c.categoryId));
                  else setRemoving({ id: c.categoryId, name: c.name, count: params.length });
                }}
              >
                Remove category
              </button>
            </legend>
            <table className="l-table l-table--compact">
              <thead>
                <tr>
                  <th scope="col">Name in sheet</th>
                  <th scope="col">Short name (phone)</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Category</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {params.map((p, pi) => (
                  <ParameterRow
                    key={p.paramId}
                    p={p}
                    categories={cats}
                    first={pi === 0}
                    last={pi === params.length - 1}
                    onPatch={(change) => onChange(patchParam(schema, p.paramId, change))}
                    onMove={(d) => onChange(moveParam(schema, p.paramId, d))}
                    onRemove={() => onChange(removeParam(schema, p.paramId))}
                  />
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className="l-btn l-btn--secondary"
              onClick={() => onChange(addParam(schema, c.categoryId))}
            >
              + Add parameter to {c.name}
            </button>
          </fieldset>
        );
      })}
      <div className="l-row">
        <input
          aria-label="New category name"
          className="l-input"
          placeholder="New category, e.g. Noise & Vibration"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
        />
        <button
          type="button"
          className="l-btn l-btn--secondary"
          disabled={!newCat.trim()}
          onClick={() => {
            onChange(addCategory(schema, newCat));
            setNewCat('');
          }}
        >
          + Add category
        </button>
      </div>
    </section>
  );
}
