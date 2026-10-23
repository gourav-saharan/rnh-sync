// Template Studio draft hook: loads a Customer_Template, its draft workbook
// grids (for the sheet preview, detection and formula protection) and saves
// schema / mapping changes back to the draft (never to published versions).

import { useCallback, useEffect, useState } from 'react';
import {
  checkTemplateBytes,
  readSheetGrids,
  structureOf,
  type CustomerTemplateV2,
  type Mapping,
  type SheetGrid,
  type TemplateSchema,
} from '@rnh/shared/v2';
import { plainError, useLaptop, useLiveTemplates } from './context';

export interface TemplateDraft {
  template: CustomerTemplateV2 | null;
  grids: SheetGrid[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveSchema: (schema: TemplateSchema) => Promise<void>;
  saveMappings: (mappings: Mapping[]) => Promise<void>;
  rename: (customerName: string, templateName: string) => Promise<void>;
  replaceWorkbook: (file: File) => Promise<void>;
}

export function useTemplateDraft(templateId: string): TemplateDraft {
  const { templates, user } = useLaptop();
  const live = useLiveTemplates();
  const template = live.data.find((t) => t.templateId === templateId) ?? null;
  const [grids, setGrids] = useState<SheetGrid[]>([]);
  const [loadingGrids, setLoadingGrids] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadingGrids(true);
    templates
      .loadDraftBytes(templateId)
      .then((bytes) => readSheetGrids(bytes))
      .then((g) => {
        if (active) {
          setGrids(g);
          setError(null);
        }
      })
      .catch((e) => active && setError(`The workbook could not be loaded: ${plainError(e)}`))
      .finally(() => active && setLoadingGrids(false));
    return () => {
      active = false;
    };
  }, [templates, templateId, reload]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(plainError(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    template,
    grids,
    loading: live.loading || loadingGrids,
    error: error ?? live.error,
    saving,
    saveSchema: (schema) => run(() => templates.saveDraft(templateId, { schema }, user.uid)),
    saveMappings: (mappings) => run(() => templates.saveDraft(templateId, { mappings }, user.uid)),
    rename: (customerName, templateName) =>
      run(() => templates.saveDraft(templateId, { customerName, templateName }, user.uid)),
    replaceWorkbook: (file) =>
      run(async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        checkTemplateBytes(bytes);
        const g = await readSheetGrids(bytes);
        await templates.replaceDraftWorkbook(templateId, bytes, structureOf(g), user.uid);
        setReload((n) => n + 1);
      }),
  };
}
