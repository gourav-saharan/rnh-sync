// Upload a new customer workbook as a draft Customer_Template (R2.1, R2.2).
// The file is checked (xlsx, not encrypted, <= 10 MB) and parsed before
// anything is stored, so a bad file never creates a half template.

import { useState, type FormEvent } from 'react';
import { checkTemplateBytes, readSheetGrids, structureOf } from '@rnh/shared/v2';
import { plainError, useLaptop } from './context';

export function UploadTemplateForm({
  onCreated,
}: {
  onCreated: (templateId: string) => void;
}): JSX.Element {
  const { templates, user } = useLaptop();
  const [customer, setCustomer] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      checkTemplateBytes(bytes);
      const grids = await readSheetGrids(bytes);
      const tpl = await templates.createTemplate({
        customerName: customer,
        templateName: name.trim() || file.name.replace(/\.xlsx$/i, ''),
        userId: user.uid,
        bytes,
        structure: structureOf(grids),
      });
      setCustomer('');
      setName('');
      setFile(null);
      onCreated(tpl.templateId);
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="l-card l-form-row"
      onSubmit={(e) => void create(e)}
      aria-label="Upload a new template"
    >
      <h3 className="l-card__title">New template from a customer workbook</h3>
      <label className="l-field">
        <span>Customer</span>
        <input
          value={customer}
          required
          placeholder="e.g. MSIL, M&M, TATA"
          onChange={(e) => setCustomer(e.target.value)}
        />
      </label>
      <label className="l-field">
        <span>Template name</span>
        <input
          value={name}
          placeholder="e.g. Dry handling R&H"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="l-field">
        <span>Excel file (.xlsx, max 10 MB)</span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <button
        type="submit"
        className="l-btn l-btn--primary"
        disabled={busy || !file || !customer.trim()}
      >
        {busy ? 'Reading workbook…' : 'Upload and set up'}
      </button>
      {error ? (
        <p className="l-alert l-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
