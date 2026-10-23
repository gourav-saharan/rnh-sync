// Header fields and per-tyre details on the laptop (R10.3, R10.5). Edits are
// committed on blur; missing required fields are highlighted.

import { useEffect, useState } from 'react';
import {
  orderedTyreSets,
  setHeaderV2,
  updateTyreSetV2,
  type EditContext,
  type HeaderValue,
  type LocalTestSessionV2,
  type TemplateVersion,
  type TestSessionV2,
  type TyreSetV2,
} from '@rnh/shared/v2';

type Edit = (fn: (x: LocalTestSessionV2, ctx: EditContext) => LocalTestSessionV2) => Promise<void>;

function BlurInput(props: {
  value: string;
  label: string;
  type?: string;
  missing?: boolean;
  onCommit: (v: string) => void;
}): JSX.Element {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <label className={`l-field${props.missing ? ' l-field--missing' : ''}`}>
      <span className="l-field__label">
        {props.label}
        {props.missing ? <span className="l-req"> · required</span> : null}
      </span>
      <input
        type={props.type ?? 'text'}
        value={v}
        aria-label={props.label}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== props.value && props.onCommit(v)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

const DETAIL_COLS: { key: keyof TyreSetV2; label: string; numeric?: boolean }[] = [
  { key: 'label', label: 'Label' },
  { key: 'make', label: 'Make' },
  { key: 'pattern', label: 'Pattern' },
  { key: 'size', label: 'Size' },
  { key: 'srlr', label: 'SR/LR' },
  { key: 'weekCode', label: 'Week code' },
  { key: 'dot', label: 'DOT' },
  { key: 'compound', label: 'Compound' },
  { key: 'airTempC', label: 'Air °C', numeric: true },
  { key: 'roadTempC', label: 'Road °C', numeric: true },
  { key: 'overallComment', label: 'Overall comment' },
];

export function SessionDetails({
  session,
  version,
  onEdit,
}: {
  session: TestSessionV2;
  version: TemplateVersion;
  onEdit: Edit;
}): JSX.Element {
  const fields = version.schema.headerFields;
  const sets = orderedTyreSets(session);
  const slotCount = version.schema.slotCount;

  return (
    <details className="l-card" open>
      <summary className="l-card__summary">Test details and tyre sets</summary>
      {fields.length > 0 ? (
        <div className="l-fields">
          {fields.map((f) => {
            const raw = session.header[f.fieldId];
            const text = raw === null || raw === undefined ? '' : String(raw);
            return (
              <BlurInput
                key={f.fieldId}
                label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`}
                type={
                  f.type === 'date'
                    ? 'date'
                    : f.type === 'number' || f.type === 'pressure'
                      ? 'number'
                      : 'text'
                }
                value={text}
                missing={f.required && text.trim() === ''}
                onCommit={(v) => {
                  const value: HeaderValue =
                    v.trim() === ''
                      ? null
                      : f.type === 'number' || f.type === 'pressure'
                        ? Number(v)
                        : v;
                  void onEdit((x, c) => setHeaderV2(x, f.fieldId, value, c));
                }}
              />
            );
          })}
        </div>
      ) : null}

      <div className="l-table-wrap">
        <table className="l-table" aria-label="Tyre sets">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              {DETAIL_COLS.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sets.map((t) => (
              <tr key={t.tyreSetId} className={t.slot > slotCount ? 'l-row--error' : ''}>
                <td>
                  {t.slot}
                  {t.isReference ? <span className="l-tag">REF</span> : null}
                  {t.slot > slotCount ? <span className="l-req"> no column</span> : null}
                </td>
                {DETAIL_COLS.map((c) => {
                  const raw = t[c.key];
                  return (
                    <td key={c.key}>
                      <BlurInput
                        label={`${t.label} ${c.label}`}
                        type={c.numeric ? 'number' : 'text'}
                        value={raw === null || raw === undefined ? '' : String(raw)}
                        onCommit={(v) => {
                          const value = c.numeric ? (v.trim() === '' ? null : Number(v)) : v;
                          void onEdit((x, ctx) =>
                            updateTyreSetV2(x, t.tyreSetId, { [c.key]: value }, ctx),
                          );
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
