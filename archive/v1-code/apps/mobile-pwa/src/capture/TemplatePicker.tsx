// Template_Picker — selects the Customer_Template that drives the capture
// surface's active R&H_Parameter set (Requirements 6.6, 6.7).
//
// On mount it lists the available Customer_Templates via the shared
// Template_Manager (createTemplateManager().list(), R2.4). When the Tester
// selects one, it loads that template's Field_Mappings via the shared
// Mapping_Editor store (createMappingEditorStore().loadExisting(), R3.6) and
// hands the templateId + mappings up to the parent, which forwards them into
// the CaptureForm so deriveActiveRHParameters presents exactly that template's
// R&H_Parameters (R6.6). A "Default parameters" option (no template) yields the
// default set (R6.7).
//
// Both persistence surfaces are injectable and default to the shared,
// env-initialized factories (the same seam the laptop app uses), so tests drive
// it with fakes and no Firebase. If listing fails — offline, or Firebase is not
// configured — the picker degrades gracefully to the default parameter set
// without crashing the capture flow (R6.7), surfacing a subtle note.

import { useEffect, useMemo, useState } from 'react';
import {
  createMappingEditorStore,
  createTemplateManager,
  type CustomerTemplateSummary,
  type FieldMapping,
  type MappingEditorStore,
  type TemplateManager,
} from '@rnh/shared';

/** The current template selection reported to the parent. */
export interface TemplateSelection {
  /** The selected template id, or null for the default (no-template) option. */
  templateId: string | null;
  /** The selected template's Field_Mappings, empty for the default option. */
  mappings: readonly FieldMapping[];
}

export interface TemplatePickerProps {
  /** Notified whenever the selection (and its loaded mappings) changes. */
  onSelectionChange: (selection: TemplateSelection) => void;
  /** Template listing surface. Defaults to the shared, env-initialized manager. */
  templateManager?: TemplateManager;
  /** Mapping loading surface. Defaults to the shared, env-initialized store. */
  mappingEditorStore?: MappingEditorStore;
}

/** The sentinel select value for the "Default parameters" (no template) option. */
const DEFAULT_OPTION_VALUE = '';

/**
 * Template selector for the capture surface. Lists Customer_Templates and, on
 * selection, loads the template's mappings and reports them upward so the
 * capture form can present the template's R&H_Parameters (R6.6/R6.7).
 */
export function TemplatePicker({
  onSelectionChange,
  templateManager,
  mappingEditorStore,
}: TemplatePickerProps): JSX.Element {
  // Default to the shared, env-initialized factories (same seam as the laptop
  // app). Memoized so we do not rebuild the adapters on every render.
  const manager = useMemo<TemplateManager>(
    () => templateManager ?? createTemplateManager(),
    [templateManager],
  );
  const mappingStore = useMemo<MappingEditorStore>(
    () => mappingEditorStore ?? createMappingEditorStore(),
    [mappingEditorStore],
  );

  const [templates, setTemplates] = useState<CustomerTemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_OPTION_VALUE);
  const [note, setNote] = useState<string | null>(null);
  const [loadingMappings, setLoadingMappings] = useState(false);

  // Load the available templates once on mount. On failure (offline / no
  // Firebase), degrade to the default parameter set without crashing (R6.7).
  useEffect(() => {
    let active = true;
    manager
      .list()
      .then((list) => {
        if (!active) {
          return;
        }
        setTemplates(list);
        if (list.length === 0) {
          setNote('No templates available — using default parameters.');
        }
      })
      .catch(() => {
        if (active) {
          setTemplates([]);
          setNote('Templates unavailable offline — using default parameters.');
        }
      });
    return () => {
      active = false;
    };
  }, [manager]);

  const handleChange = (templateId: string) => {
    setSelectedId(templateId);

    // The default (no-template) option resets to the default parameter set.
    if (templateId === DEFAULT_OPTION_VALUE) {
      setNote(null);
      onSelectionChange({ templateId: null, mappings: [] });
      return;
    }

    setLoadingMappings(true);
    setNote(null);
    mappingStore
      .loadExisting(templateId)
      .then((mappings) => {
        setLoadingMappings(false);
        onSelectionChange({ templateId, mappings });
      })
      .catch(() => {
        // Mapping load failed: fall back to the default set for this template
        // rather than blocking capture (R6.7).
        setLoadingMappings(false);
        setNote('Could not load template parameters — using default parameters.');
        onSelectionChange({ templateId, mappings: [] });
      });
  };

  return (
    <section aria-label="Template selection" className="card">
      <h2 className="card__title">Customer template</h2>
      <label className="field">
        Template
        <select
          aria-label="Customer template"
          className="template-picker__select"
          value={selectedId}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value={DEFAULT_OPTION_VALUE}>Default parameters</option>
          {templates.map((t) => (
            <option key={t.templateId} value={t.templateId}>
              {t.customerName}
            </option>
          ))}
        </select>
      </label>
      {loadingMappings ? (
        <p className="template-picker__note" aria-live="polite">
          Loading template parameters…
        </p>
      ) : null}
      {note ? (
        <p className="template-picker__note" aria-live="polite">
          {note}
        </p>
      ) : null}
    </section>
  );
}
