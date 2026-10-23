// Template Studio (R2–R4): one customer template, edited as a draft in steps
// Parameters -> Test details -> Settings -> Mapping -> Publish. Every change
// is saved to the draft; published versions are never changed.

import { useState } from 'react';
import { emptySchema, type SchemaProposal, type TemplateSchema } from '@rnh/shared/v2';
import { useLaptop } from './context';
import { useTemplateDraft } from './useTemplateDraft';
import { SchemaDetect } from './SchemaDetect';
import { ParameterEditor } from './ParameterEditor';
import { HeaderFieldsEditor } from './HeaderFieldsEditor';
import { SettingsEditor } from './SettingsEditor';
import { MappingEditor } from './MappingEditor';
import { PublishPanel } from './PublishPanel';

const STEPS = ['Parameters', 'Test details', 'Settings', 'Mapping', 'Publish'] as const;

export function TemplateStudio({
  templateId,
  onBack,
}: {
  templateId: string;
  onBack: () => void;
}): JSX.Element {
  const { templates } = useLaptop();
  const draft = useTemplateDraft(templateId);
  const [step, setStep] = useState(0);
  const t = draft.template;

  if (draft.loading && !t) return <p className="l-loading">Loading template…</p>;
  if (!t) {
    return (
      <main className="l-page">
        <p className="l-alert l-alert--danger">{draft.error ?? 'Template not found.'}</p>
        <button type="button" className="l-btn l-btn--secondary" onClick={onBack}>
          ‹ Templates
        </button>
      </main>
    );
  }

  const schema = t.draft?.schema ?? emptySchema();
  const save = (s: TemplateSchema) => void draft.saveSchema(s).catch(() => undefined);

  const applyProposal = (p: SchemaProposal) => {
    save({ ...schema, categories: p.categories, parameters: p.parameters });
  };

  return (
    <main className="l-page">
      <header className="l-page__head">
        <button type="button" className="l-btn l-btn--ghost" onClick={onBack}>
          ‹ Templates
        </button>
        <div className="l-page__titles">
          <h1 className="l-page__title">
            {t.customerName} · {t.templateName}
          </h1>
          <p className="l-muted l-small">
            Draft · {t.latestVersion ? `latest published v${t.latestVersion}` : 'not published yet'}
            {t.archived ? ' · archived' : ''}
            {draft.saving ? ' · saving…' : ''}
          </p>
        </div>
        <label className="l-btn l-btn--secondary">
          Replace workbook
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void draft.replaceWorkbook(f).catch(() => undefined);
              e.target.value = '';
            }}
          />
        </label>
      </header>

      {draft.error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {draft.error}
        </p>
      ) : null}

      <nav className="l-tabs" role="tablist" aria-label="Template steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={i === step}
            className={`l-tab${i === step ? ' l-tab--active' : ''}`}
            onClick={() => setStep(i)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>

      {step === 0 ? (
        <>
          <SchemaDetect
            grids={draft.grids}
            hasParameters={schema.parameters.length > 0}
            onApply={applyProposal}
          />
          <ParameterEditor schema={schema} onChange={save} />
        </>
      ) : null}
      {step === 1 ? <HeaderFieldsEditor schema={schema} onChange={save} /> : null}
      {step === 2 ? <SettingsEditor schema={schema} onChange={save} /> : null}
      {step === 3 ? (
        draft.grids.length === 0 ? (
          <p className="l-muted">Loading workbook…</p>
        ) : (
          <MappingEditor
            grids={draft.grids}
            structure={t.draft.structure}
            schema={schema}
            mappings={t.draft.mappings}
            loadBytes={() => templates.loadDraftBytes(templateId)}
            saving={draft.saving}
            onSave={(m) => draft.saveMappings(m)}
            fileBase={`${t.customerName} ${t.templateName}`}
          />
        )
      ) : null}
      {step === 4 ? <PublishPanel template={t} onGoToStep={setStep} /> : null}

      <nav className="l-row l-row--between" aria-label="Step navigation">
        <button
          type="button"
          className="l-btn l-btn--secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          ‹ Back
        </button>
        <button
          type="button"
          className="l-btn l-btn--primary"
          disabled={step === STEPS.length - 1}
          onClick={() => setStep(step + 1)}
        >
          Next ›
        </button>
      </nav>
    </main>
  );
}
