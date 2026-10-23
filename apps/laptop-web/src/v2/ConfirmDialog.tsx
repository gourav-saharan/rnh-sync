// In-app confirmation dialog (replaces window.confirm / window.prompt).
// Accessible: role="dialog", focus moves into the dialog on open, Escape
// cancels, and focus returns to the element that opened it on close.

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the user must type this word before confirming. */
  requireText?: string;
  /** When set, shows a text input with this label and passes its value. */
  inputLabel?: string;
  inputDefault?: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog(p: ConfirmDialogProps): JSX.Element {
  const [text, setText] = useState(p.inputDefault ?? '');
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsInput = p.requireText !== undefined || p.inputLabel !== undefined;
  const ok =
    !p.busy &&
    (p.requireText !== undefined
      ? text.trim().toUpperCase() === p.requireText.toUpperCase()
      : p.inputLabel !== undefined
        ? text.trim() !== ''
        : true);

  return (
    <div className="l-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="l-dialog__panel l-dialog__panel--small" ref={panel}>
        <h2 id="confirm-title" className="l-card__title">
          {p.title}
        </h2>
        {p.children ? <div className="l-confirm__body">{p.children}</div> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) p.onConfirm(text.trim());
          }}
        >
          {needsInput ? (
            <label className="l-field">
              <span className="l-field__label">
                {p.requireText !== undefined ? `Type ${p.requireText} to confirm` : p.inputLabel}
              </span>
              <input
                className="l-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
              />
            </label>
          ) : null}
          <div className="l-row l-confirm__actions">
            <button type="button" className="l-btn" onClick={p.onCancel}>
              {p.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="submit"
              className={`l-btn ${p.danger ? 'l-btn--danger' : 'l-btn--primary'}`}
              disabled={!ok}
            >
              {p.busy ? 'Please wait…' : p.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
