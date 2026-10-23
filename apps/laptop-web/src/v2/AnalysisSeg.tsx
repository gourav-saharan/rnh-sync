// Segmented radio buttons and option lists for the Analysis controls. The
// selected option is shown with a check mark as well as colour (R15.4).

import type { AnalysisGroupBy, AnalysisLevel, AnalysisValue, SessionStatus } from '@rnh/shared/v2';

export const LEVELS: { id: AnalysisLevel; label: string }[] = [
  { id: 'total', label: 'Total' },
  { id: 'category', label: 'Categories' },
  { id: 'parameter', label: 'Parameters' },
];

export const VALUES: { id: AnalysisValue; label: string }[] = [
  { id: 'rating', label: 'Average rating' },
  { id: 'diffToRef', label: 'Difference to Ref' },
];

export const GROUPS: { id: AnalysisGroupBy; label: string }[] = [
  { id: 'makePattern', label: 'Make + pattern' },
  { id: 'make', label: 'Make' },
  { id: 'pattern', label: 'Pattern' },
  { id: 'size', label: 'Tyre size' },
  { id: 'label', label: 'Tyre label (Ref, MU1…)' },
];

export const STATUSES: { id: '' | SessionStatus; label: string }[] = [
  { id: '', label: 'Any status' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'ready', label: 'Ready' },
  { id: 'reported', label: 'Reported' },
];

export function Seg<T extends string>(props: {
  label: string;
  value: T;
  items: { id: T; label: string }[];
  onPick: (v: T) => void;
}): JSX.Element {
  return (
    <div className="l-field">
      <span className="l-field__label">{props.label}</span>
      <div className="l-seg" role="radiogroup" aria-label={props.label}>
        {props.items.map((i) => (
          <button
            key={i.id}
            type="button"
            role="radio"
            aria-checked={props.value === i.id}
            className={`l-seg__btn${props.value === i.id ? ' l-seg__btn--on' : ''}`}
            onClick={() => props.onPick(i.id)}
          >
            {props.value === i.id ? '✓ ' : ''}
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}
