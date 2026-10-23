// Setup wizard review step (R5.2, R5.9): what will be rated, and which
// required details are still missing (driving is allowed anyway).

import type { HeaderFieldDef, TyreSetV2 } from '@rnh/shared/v2';

export interface ReviewStepProps {
  sets: TyreSetV2[];
  parameterCount: number;
  missing: HeaderFieldDef[];
}

export function ReviewStep({ sets, parameterCount, missing }: ReviewStepProps): JSX.Element {
  return (
    <section className="card" aria-label="Review">
      <h2 className="card__title">Ready to drive</h2>
      <p>
        {sets.length} tyre set{sets.length === 1 ? '' : 's'} × {parameterCount} parameters ={' '}
        {sets.length * parameterCount} ratings
      </p>
      <ul className="list list--plain">
        {sets.map((t) => (
          <li key={t.tyreSetId}>
            <strong>{t.label}</strong>
            {t.isReference ? <span className="tag">REF</span> : null}{' '}
            {[t.make, t.pattern, t.size].filter(Boolean).join(' · ')}
          </li>
        ))}
      </ul>
      {missing.length > 0 ? (
        <p className="note note--warn" role="status">
          Still missing: {missing.map((f) => f.label).join(', ')}. You can drive now and fill these
          in later.
        </p>
      ) : (
        <p className="note note--ok">All required details are filled in.</p>
      )}
    </section>
  );
}
