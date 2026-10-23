// Mobile_PWA v2 setup wizard (R5.2): Test details -> Tyre sets -> Review,
// with progress and back/next. Every edit is persisted locally first
// (useSession). Driving may start with required fields missing (R5.9).

import { useEffect, useState } from 'react';
import {
  addTyreSetV2,
  moveTyreSetV2,
  orderedTyreSets,
  removeTyreSetV2,
  setCursorV2,
  setHeaderV2,
  setReferenceV2,
  updateTyreSetV2,
} from '@rnh/shared/v2';
import { useServices } from './context';
import { useSession } from './useSession';
import { HeaderStep, missingRequired } from './HeaderStep';
import { TyreSetsStep } from './TyreSetsStep';
import { ReviewStep } from './ReviewStep';
import { SaveBadge } from './SaveBadge';
import { addPhoto, PhotoError } from './photos';

export interface SetupWizardProps {
  sessionId: string;
  onExit: () => void;
  onDrive: () => void;
}

const STEPS = ['Test details', 'Tyre sets', 'Review'] as const;

type Suggestions = { make: string[]; pattern: string[]; size: string[] };

function uniq(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function SetupWizard({ sessionId, onExit, onDrive }: SetupWizardProps): JSX.Element {
  const { local } = useServices();
  const ed = useSession(sessionId);
  const { session, version, apply } = ed;
  const [step, setStep] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestions>({ make: [], pattern: [], size: [] });
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Suggest tyre details typed in earlier tests on this phone (R5.6).
  useEffect(() => {
    void local.listSessions().then((all) => {
      const sets = all.flatMap((s) => Object.values(s.tyreSets));
      setSuggestions({
        make: uniq(sets.map((t) => t.make)),
        pattern: uniq(sets.map((t) => t.pattern)),
        size: uniq(sets.map((t) => t.size)),
      });
    });
  }, [local]);

  if (ed.loading) return <p className="app-loading">Opening test…</p>;
  if (ed.notFound || !session || !version) {
    return (
      <main className="screen">
        <p className="note note--warn">This test or its template is not on this phone.</p>
        <button type="button" className="btn btn--primary" onClick={onExit}>
          Back to tests
        </button>
      </main>
    );
  }

  const schema = version.schema;
  const sets = orderedTyreSets(session);
  const missing = missingRequired(schema.headerFields, session.header);

  const startDrive = () => {
    void apply((s) => setCursorV2(s, { screen: 'drive' })).then(() => onDrive());
  };

  return (
    <main className="screen">
      <header className="topbar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onExit}
          aria-label="Back to tests"
        >
          ‹ Tests
        </button>
        <h1 className="topbar__title">{session.customerName}</h1>
        <SaveBadge state={ed.saveState} error={ed.saveError} />
      </header>

      <ol className="steps" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`steps__item${i === step ? ' steps__item--active' : ''}${i < step ? ' steps__item--done' : ''}`}
          >
            <button
              type="button"
              className="steps__btn"
              aria-current={i === step ? 'step' : undefined}
              onClick={() => setStep(i)}
            >
              <span className="steps__n">{i < step ? '✓' : i + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        schema.headerFields.length === 0 ? (
          <p className="note">This template has no test details to fill in.</p>
        ) : (
          <HeaderStep
            fields={schema.headerFields}
            values={session.header}
            onChange={(fieldId, value) =>
              void apply((s, ctx) => setHeaderV2(s, fieldId, value, ctx))
            }
          />
        )
      ) : null}

      {step === 1 ? (
        <TyreSetsStep
          sets={sets}
          slotCount={schema.slotCount}
          suggestions={suggestions}
          onAdd={(copy) => void apply((s, ctx) => addTyreSetV2(s, ctx, copy))}
          onUpdate={(id, patch) => void apply((s, ctx) => updateTyreSetV2(s, id, patch, ctx))}
          onRemove={(id) => void apply((s, ctx) => removeTyreSetV2(s, id, ctx))}
          onMove={(id, d) => void apply((s, ctx) => moveTyreSetV2(s, id, d, ctx))}
          onReference={(id) => void apply((s, ctx) => setReferenceV2(s, id, ctx))}
          photoError={photoError}
          onPhoto={(id, file) => {
            setPhotoError(null);
            void addPhoto(local, session.sessionId, id, file)
              .then((path) =>
                apply((s, ctx) =>
                  updateTyreSetV2(
                    s,
                    id,
                    { photoPaths: [...(s.tyreSets[id]?.photoPaths ?? []), path] },
                    ctx,
                  ),
                ),
              )
              .catch((e) =>
                setPhotoError(
                  e instanceof PhotoError ? e.message : 'Could not save the photo on this phone.',
                ),
              );
          }}
        />
      ) : null}

      {step === 2 ? (
        <ReviewStep sets={sets} parameterCount={schema.parameters.length} missing={missing} />
      ) : null}

      <nav className="wizard__nav" aria-label="Setup navigation">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={step === 0}
          onClick={() => setStep((s) => s - 1)}
        >
          ‹ Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn--primary" onClick={() => setStep((s) => s + 1)}>
            Next ›
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--xl" onClick={startDrive}>
            ▶ Start driving
          </button>
        )}
      </nav>
    </main>
  );
}
