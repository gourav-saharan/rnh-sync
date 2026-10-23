// The Mobile_PWA Test_Session capture form (Requirements 5 and 6).
//
// This component is the tester's capture surface. It holds a single
// LocalTestSession in state and autosaves it to the IndexedDB store on every
// change (R5.3, R10.1). It renders:
//   - one or more Tyre_Set groups (add/edit): groupName, make, pattern, srlr,
//     weekCode, dot (R6.1)
//   - vehicle details (R6.2) and test conditions (R6.3)
//   - per-R&H-parameter single-tap rating + note entry (R5.2, R6.4), with the
//     active parameter set derived from the selected template's Field_Mappings
//     via deriveActiveRHParameters, falling back to the default set (R6.6, R6.7)
//   - an unsynced indicator while local edits are not yet confirmed (R10.3)
//
// The sync-to-Firestore path is intentionally out of scope here (that is task
// 14); this component only persists locally.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveActiveRHParameters,
  rangeForParameter,
  type FieldMapping,
  type LocalTestSession,
  type RHCategory,
  type RHParameterEntry,
  type TestConditions,
  type TyreSet,
  type VehicleDetails,
} from '@rnh/shared';
import type { LocalSessionStore } from '../local';
import { RatingControl } from './RatingControl';
import { NoteDictationButton } from './NoteDictationButton';
import {
  blankTyreSet,
  createBlankSession,
  withDerivedAverage,
} from './session';

/** Debounce window for autosave; well within the 2s requirement (R5.3). */
export const AUTOSAVE_DELAY_MS = 500;

interface CaptureFormProps {
  /** The store to persist to (injected for testability). */
  store: LocalSessionStore;
  /** The signed-in Tester's uid. */
  createdBy: string;
  /** Selected Customer_Template id, or null when none is chosen. */
  templateId?: string | null;
  /**
   * Field_Mappings for the selected template. Their `rhParameterName` values
   * drive the active parameter set (R6.6); an empty list yields the default
   * set (R6.7).
   */
  templateMappings?: readonly FieldMapping[];
  /** An existing session to resume, if any (R5.6). */
  initialSession?: LocalTestSession | null;
  /**
   * Called after each successful debounced local autosave with the persisted
   * session. The app wires this to the Sync_Service so a saved change is pushed
   * to Firestore in the background (R7.1, R10.4). Optional so tests that only
   * exercise local capture are unaffected.
   */
  onSaved?: (session: LocalTestSession) => void;
  /** Injected clock for deterministic tests. */
  now?: () => number;
  /** Injected id factory for deterministic tests. */
  makeSessionId?: () => string;
}

/**
 * Capture form. Manages the in-progress session, autosaves on change, and
 * renders the tyre/vehicle/condition/rating inputs.
 */
export function CaptureForm({
  store,
  createdBy,
  templateId = null,
  templateMappings = [],
  initialSession = null,
  onSaved,
  now = () => Date.now(),
  makeSessionId = () =>
    `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
}: CaptureFormProps): JSX.Element {
  // The active R&H_Parameter set is derived from the template mappings, or the
  // default set when none define parameters (R6.6, R6.7).
  const activeParameters = useMemo(
    () => deriveActiveRHParameters(templateMappings),
    [templateMappings],
  );

  const [session, setSession] = useState<LocalTestSession>(() => {
    if (initialSession) {
      return initialSession;
    }
    return createBlankSession(
      makeSessionId(),
      createdBy,
      activeParameters,
      templateId,
      now(),
    );
  });

  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the active R&H_Parameter set changes after mount — e.g. the tester
  // picks a Customer_Template — re-derive the Ride/Handling entries so the form
  // presents exactly the template's parameters (R6.6) or the default set when
  // none define them (R6.7). Ratings/notes already entered for a parameter that
  // survives the change are preserved (matched by name); parameters that are no
  // longer part of the set drop out. The very first run (mount) is skipped so
  // an initial/resumed session is never rebuilt. Selecting a template also
  // stamps the session's templateId.
  const activeParamsRef = useRef(activeParameters);
  const templateIdRef = useRef(templateId);
  useEffect(() => {
    if (
      activeParamsRef.current === activeParameters &&
      templateIdRef.current === templateId
    ) {
      // Mount (or unchanged): nothing to re-derive.
      return;
    }
    activeParamsRef.current = activeParameters;
    templateIdRef.current = templateId;

    setSession((prev) => {
      const rebuildCategory = (category: 'ride' | 'handling'): RHCategory => {
        const existingByName = new Map(
          prev[category].parameters.map((entry) => [entry.name, entry]),
        );
        const parameters: RHParameterEntry[] = activeParameters
          .filter((param) => param.category === category)
          .map((param) => {
            const existing = existingByName.get(param.name);
            return (
              existing ?? { name: param.name, rating: param.range.min, note: '' }
            );
          });
        return withDerivedAverage(parameters);
      };

      return {
        ...prev,
        templateId,
        ride: rebuildCategory('ride'),
        handling: rebuildCategory('handling'),
        dirty: true,
        syncState: 'unsynced',
        updatedAt: now(),
        pendingSince: prev.pendingSince ?? now(),
      };
    });
  }, [activeParameters, templateId, now]);

  // Keep the latest onSaved in a ref so the autosave effect does not re-run
  // (and reset the debounce) just because the parent passed a new callback
  // identity. Only session/store changes should reschedule the save.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // Autosave: whenever the session changes, schedule a debounced write to the
  // IndexedDB store. The write is save-before-confirm — the "Saved" indicator
  // only appears after the store resolves (R5.3, R10.1). After the local write
  // commits, onSaved (if provided) hands the session to the Sync_Service so it
  // is pushed to Firestore in the background (R7.1, R10.4).
  useEffect(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    setSaved(false);
    saveTimer.current = setTimeout(() => {
      void store.save(session).then((persisted) => {
        setSaved(true);
        onSavedRef.current?.(persisted);
      });
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [session, store]);

  /** Apply a mutation, stamping the session dirty/updatedAt for autosave. */
  const mutate = useCallback(
    (updater: (prev: LocalTestSession) => LocalTestSession) => {
      setSession((prev) => ({
        ...updater(prev),
        dirty: true,
        syncState: 'unsynced',
        updatedAt: now(),
        pendingSince: prev.pendingSince ?? now(),
      }));
    },
    [now],
  );

  // --- Tyre_Set editing (R6.1) ---------------------------------------------

  const updateTyreSet = (index: number, patch: Partial<TyreSet>) => {
    mutate((prev) => ({
      ...prev,
      tyreSets: prev.tyreSets.map((ts, i) =>
        i === index ? { ...ts, ...patch } : ts,
      ),
    }));
  };

  const addTyreSet = () => {
    mutate((prev) => ({
      ...prev,
      tyreSets: [
        ...prev.tyreSets,
        blankTyreSet(`Set ${String.fromCharCode(65 + prev.tyreSets.length)}`),
      ],
    }));
  };

  const removeTyreSet = (index: number) => {
    mutate((prev) => ({
      ...prev,
      tyreSets:
        prev.tyreSets.length > 1
          ? prev.tyreSets.filter((_, i) => i !== index)
          : prev.tyreSets,
    }));
  };

  // --- Vehicle + conditions (R6.2, R6.3) -----------------------------------

  const updateVehicle = (patch: Partial<VehicleDetails>) => {
    mutate((prev) => ({ ...prev, vehicle: { ...prev.vehicle, ...patch } }));
  };

  const updateConditions = (patch: Partial<TestConditions>) => {
    mutate((prev) => ({ ...prev, conditions: { ...prev.conditions, ...patch } }));
  };

  // --- R&H ratings + notes (R5.2, R6.4, R6.5) ------------------------------

  const updateEntry = (
    category: 'ride' | 'handling',
    parameterName: string,
    patch: Partial<RHParameterEntry>,
  ) => {
    mutate((prev) => {
      const cat: RHCategory = prev[category];
      const parameters = cat.parameters.map((entry) =>
        entry.name === parameterName ? { ...entry, ...patch } : entry,
      );
      return { ...prev, [category]: withDerivedAverage(parameters) };
    });
  };

  const renderCategory = (category: 'ride' | 'handling', label: string) => {
    const cat = session[category];
    if (cat.parameters.length === 0) {
      return null;
    }
    return (
      <section aria-label={label} className="card">
        <h2 className="card__title">{label}</h2>
        {cat.parameters.map((entry) => {
          const range = rangeForParameter(entry.name, activeParameters);
          // Purely cosmetic: a value still sitting at the range floor is
          // likely an untouched seed rather than a deliberate score. We flag
          // it with a muted hint only — the stored value and the visible
          // "<name>: <rating>" node are left untouched (data model unchanged).
          const unrated = Math.abs(entry.rating - range.min) < 1e-9;
          return (
            <div key={entry.name} className="rating">
              <p className="rating__readout">
                {entry.name}: <span className="rating__value">{entry.rating}</span>
                {unrated ? (
                  <span className="rating__hint">not yet rated</span>
                ) : null}
              </p>
              <RatingControl
                parameterName={entry.name}
                value={entry.rating}
                range={range}
                onChange={(next) =>
                  updateEntry(category, entry.name, { rating: next })
                }
              />
              <label className="field">
                Note
                <textarea
                  aria-label={`${entry.name} note`}
                  value={entry.note}
                  onChange={(e) =>
                    updateEntry(category, entry.name, { note: e.target.value })
                  }
                />
                {/*
                  R5.5: hands-free note entry. The dictate control is a sibling
                  of the textarea and only renders where the device supports
                  speech recognition — feature-detected inside the component —
                  so keyboard entry via the textarea always remains available.
                  Dictated text is appended through the same updateEntry note
                  path, so it autosaves exactly like typed text.
                */}
                <NoteDictationButton
                  parameterName={entry.name}
                  currentNote={entry.note}
                  onAppend={(nextNote) =>
                    updateEntry(category, entry.name, { note: nextNote })
                  }
                />
              </label>
            </div>
          );
        })}
        <p className="card__average">
          {label} average: <strong>{cat.averageRating}</strong>
        </p>
      </section>
    );
  };

  return (
    <form aria-label="Test session capture" className="capture-form">
      <p aria-live="polite" className="status-bar">
        {session.syncState === 'synced' ? (
          <span className="status-chip status-chip--synced">Synced</span>
        ) : (
          <span
            data-testid="unsynced-indicator"
            className="status-chip status-chip--unsynced"
          >
            Unsynced
          </span>
        )}
        {saved ? (
          <span className="status-save status-save--done"> · Saved</span>
        ) : (
          <span className="status-save"> · Saving…</span>
        )}
      </p>

      <section aria-label="Tyre sets" className="card">
        <h2 className="card__title">Tyre sets</h2>
        {session.tyreSets.map((ts, index) => (
          <fieldset
            key={index}
            aria-label={`Tyre set ${index + 1}`}
            className="tyre-set"
          >
            <legend className="tyre-set__legend">Tyre set {index + 1}</legend>
            <div className="field-grid">
              <label className="field">
                Group name
                <input
                  aria-label={`Tyre set ${index + 1} group name`}
                  value={ts.groupName}
                  onChange={(e) =>
                    updateTyreSet(index, { groupName: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Make
                <input
                  aria-label={`Tyre set ${index + 1} make`}
                  value={ts.make}
                  onChange={(e) => updateTyreSet(index, { make: e.target.value })}
                />
              </label>
              <label className="field">
                Pattern
                <input
                  aria-label={`Tyre set ${index + 1} pattern`}
                  value={ts.pattern}
                  onChange={(e) =>
                    updateTyreSet(index, { pattern: e.target.value })
                  }
                />
              </label>
              <label className="field">
                SR/LR
                <input
                  aria-label={`Tyre set ${index + 1} srlr`}
                  value={ts.srlr}
                  onChange={(e) => updateTyreSet(index, { srlr: e.target.value })}
                />
              </label>
              <label className="field">
                Week code
                <input
                  aria-label={`Tyre set ${index + 1} week code`}
                  value={ts.weekCode}
                  onChange={(e) =>
                    updateTyreSet(index, { weekCode: e.target.value })
                  }
                />
              </label>
              <label className="field">
                DOT
                <input
                  aria-label={`Tyre set ${index + 1} dot`}
                  value={ts.dot}
                  onChange={(e) => updateTyreSet(index, { dot: e.target.value })}
                />
              </label>
            </div>
            {session.tyreSets.length > 1 && (
              <button
                type="button"
                className="btn btn--ghost-danger"
                onClick={() => removeTyreSet(index)}
              >
                Remove tyre set {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn--secondary btn--full"
          onClick={addTyreSet}
        >
          Add tyre set
        </button>
      </section>

      <section aria-label="Vehicle details" className="card">
        <h2 className="card__title">Vehicle details</h2>
        <div className="field-grid">
          <label className="field">
            Vehicle ID
            <input
              aria-label="Vehicle ID"
              value={session.vehicle.vehicleId}
              onChange={(e) => updateVehicle({ vehicleId: e.target.value })}
            />
          </label>
          <label className="field">
            Tyre size
            <input
              aria-label="Tyre size"
              value={session.vehicle.tyreSize}
              onChange={(e) => updateVehicle({ tyreSize: e.target.value })}
            />
          </label>
          <label className="field">
            Rim size
            <input
              aria-label="Rim size"
              value={session.vehicle.rimSize}
              onChange={(e) => updateVehicle({ rimSize: e.target.value })}
            />
          </label>
          <label className="field">
            Front axle pressure
            <input
              type="number"
              aria-label="Front axle pressure"
              value={session.vehicle.frontAxlePressure}
              onChange={(e) =>
                updateVehicle({ frontAxlePressure: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            Rear axle pressure
            <input
              type="number"
              aria-label="Rear axle pressure"
              value={session.vehicle.rearAxlePressure}
              onChange={(e) =>
                updateVehicle({ rearAxlePressure: Number(e.target.value) })
              }
            />
          </label>
        </div>
      </section>

      <section aria-label="Test conditions" className="card">
        <h2 className="card__title">Test conditions</h2>
        <div className="field-grid">
          <label className="field">
            Test track
            <input
              aria-label="Test track"
              value={session.conditions.testTrack}
              onChange={(e) => updateConditions({ testTrack: e.target.value })}
            />
          </label>
          <label className="field">
            Driver name
            <input
              aria-label="Driver name"
              value={session.conditions.driverName}
              onChange={(e) => updateConditions({ driverName: e.target.value })}
            />
          </label>
          <label className="field">
            Load of car
            <input
              aria-label="Load of car"
              value={session.conditions.loadOfCar}
              onChange={(e) => updateConditions({ loadOfCar: e.target.value })}
            />
          </label>
          <label className="field">
            Air temperature (C)
            <input
              type="number"
              aria-label="Air temperature"
              value={session.conditions.airTempC}
              onChange={(e) =>
                updateConditions({ airTempC: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            Road temperature (C)
            <input
              type="number"
              aria-label="Road temperature"
              value={session.conditions.roadTempC}
              onChange={(e) =>
                updateConditions({ roadTempC: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            Test date
            <input
              type="date"
              aria-label="Test date"
              value={session.conditions.testDate}
              onChange={(e) => updateConditions({ testDate: e.target.value })}
            />
          </label>
        </div>
      </section>

      {renderCategory('ride', 'Ride')}
      {renderCategory('handling', 'Handling')}
    </form>
  );
}
