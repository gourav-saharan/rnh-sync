// One editable parameter row in the Template Studio (R3.3, R3.4).

import type { CategoryDef, ParameterDef } from '@rnh/shared/v2';

export interface ParameterRowProps {
  p: ParameterDef;
  categories: CategoryDef[];
  first: boolean;
  last: boolean;
  onPatch: (change: Partial<ParameterDef>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

export function ParameterRow({
  p,
  categories,
  first,
  last,
  onPatch,
  onMove,
  onRemove,
}: ParameterRowProps): JSX.Element {
  return (
    <tr>
      <td>
        <input
          aria-label="Parameter name"
          className="l-input"
          value={p.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
      </td>
      <td>
        <input
          aria-label={`Short name for ${p.name}`}
          className="l-input"
          value={p.shortName ?? ''}
          placeholder={p.name}
          onChange={(e) => onPatch({ shortName: e.target.value || undefined })}
        />
      </td>
      <td>
        <input
          aria-label={`Weight for ${p.name}`}
          className="l-input l-input--num"
          type="number"
          step="0.05"
          min="0"
          value={p.weight ?? ''}
          onChange={(e) =>
            onPatch({ weight: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </td>
      <td>
        <select
          aria-label={`Category for ${p.name}`}
          className="l-input"
          value={p.categoryId}
          onChange={(e) => onPatch({ categoryId: e.target.value })}
        >
          {categories.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="l-nowrap">
        <button
          type="button"
          className="l-btn l-btn--ghost"
          disabled={first}
          onClick={() => onMove(-1)}
          aria-label={`Move ${p.name} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className="l-btn l-btn--ghost"
          disabled={last}
          onClick={() => onMove(1)}
          aria-label={`Move ${p.name} down`}
        >
          ↓
        </button>
        <button
          type="button"
          className="l-btn l-btn--ghost-danger"
          onClick={onRemove}
          aria-label={`Remove ${p.name}`}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
