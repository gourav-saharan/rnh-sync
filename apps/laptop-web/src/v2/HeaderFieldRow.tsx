// One editable header field row in Template Studio (R3.7).

import type { HeaderFieldDef, HeaderFieldType } from '@rnh/shared/v2';
import { HEADER_TYPES } from './headerPresets';

export interface HeaderFieldRowProps {
  field: HeaderFieldDef;
  first: boolean;
  last: boolean;
  onPatch: (change: Partial<HeaderFieldDef>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}

export function HeaderFieldRow({
  field: f,
  first,
  last,
  onPatch,
  onMove,
  onRemove,
}: HeaderFieldRowProps): JSX.Element {
  return (
    <tr>
      <td>
        <input
          aria-label="Field label"
          className="l-input"
          value={f.label}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </td>
      <td>
        <select
          aria-label={`Type of ${f.label}`}
          className="l-input"
          value={f.type}
          onChange={(e) => onPatch({ type: e.target.value as HeaderFieldType })}
        >
          {HEADER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td>
        {f.type === 'choice' ? (
          <input
            aria-label={`Choices for ${f.label}`}
            className="l-input"
            defaultValue={(f.choices ?? []).join(', ')}
            placeholder="Comma separated"
            onBlur={(e) =>
              onPatch({
                choices: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        ) : f.type === 'pressure' ? (
          <select
            aria-label={`Unit of ${f.label}`}
            className="l-input"
            value={f.unit ?? 'psi'}
            onChange={(e) => onPatch({ unit: e.target.value })}
          >
            <option value="psi">psi</option>
            <option value="kPa">kPa</option>
            <option value="bar">bar</option>
          </select>
        ) : (
          <input
            aria-label={`Unit of ${f.label}`}
            className="l-input l-input--num"
            value={f.unit ?? ''}
            onChange={(e) => onPatch({ unit: e.target.value || undefined })}
          />
        )}
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`${f.label} is required`}
          checked={f.required}
          onChange={(e) => onPatch({ required: e.target.checked })}
        />
      </td>
      <td>
        <select
          aria-label={`Prefill for ${f.label}`}
          className="l-input"
          value={f.prefill ?? ''}
          onChange={(e) =>
            onPatch({ prefill: (e.target.value || undefined) as HeaderFieldDef['prefill'] })
          }
        >
          <option value="">None</option>
          <option value="today">Today</option>
          <option value="userDisplayName">Signed-in user</option>
          <option value="lastSession">Previous test</option>
        </select>
      </td>
      <td className="l-nowrap">
        <button
          type="button"
          className="l-btn l-btn--ghost"
          disabled={first}
          onClick={() => onMove(-1)}
          aria-label={`Move ${f.label} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className="l-btn l-btn--ghost"
          disabled={last}
          onClick={() => onMove(1)}
          aria-label={`Move ${f.label} down`}
        >
          ↓
        </button>
        <button
          type="button"
          className="l-btn l-btn--ghost-danger"
          onClick={onRemove}
          aria-label={`Remove ${f.label}`}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
