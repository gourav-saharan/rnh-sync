// Drive_Mode comment entry (R6.6): one-tap Quick_Comments, voice dictation
// where supported, or typing. New text is always appended to what is already
// there, never replacing it.

import { useEffect, useRef, useState } from 'react';
import { isDictationSupported, startDictation, type DictationSession } from './dictation';

export interface CommentPanelProps {
  comment: string;
  quickComments: readonly string[];
  onAppend: (text: string) => void;
  onReplace: (text: string) => void;
}

export function CommentPanel({
  comment,
  quickComments,
  onAppend,
  onReplace,
}: CommentPanelProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const session = useRef<DictationSession | null>(null);
  const voice = isDictationSupported();

  useEffect(() => {
    if (!editing) setDraft(comment);
  }, [comment, editing]);

  useEffect(() => () => session.current?.stop(), []);

  const toggleVoice = () => {
    if (listening) {
      session.current?.stop();
      session.current = null;
      setListening(false);
      return;
    }
    setVoiceError(null);
    const s = startDictation({
      onTranscript: (t) => onAppend(t),
      onError: () => setVoiceError('Voice input stopped. Check microphone permission.'),
      onEnd: () => {
        session.current = null;
        setListening(false);
      },
    });
    if (s) {
      session.current = s;
      setListening(true);
    }
  };

  return (
    <section className="comment" aria-label="Comment">
      <div className="comment__text" aria-live="polite">
        {comment ? comment : <span className="comment__empty">No comment yet</span>}
      </div>
      <div className="chips" role="group" aria-label="Quick comments">
        {quickComments.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => onAppend(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="comment__actions">
        {voice ? (
          <button
            type="button"
            className={`btn ${listening ? 'btn--danger' : 'btn--secondary'}`}
            aria-pressed={listening}
            onClick={toggleVoice}
          >
            {listening ? '■ Stop voice' : '🎤 Voice'}
          </button>
        ) : null}
        <button type="button" className="btn btn--secondary" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Close' : '✎ Type'}
        </button>
        {comment ? (
          <button type="button" className="btn btn--ghost" onClick={() => onReplace('')}>
            Clear
          </button>
        ) : null}
      </div>
      {voiceError ? (
        <p className="note note--warn" role="status">
          {voiceError}
        </p>
      ) : null}
      {editing ? (
        <div className="comment__edit">
          <label className="field">
            <span className="field__label">Comment</span>
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onReplace(draft.trim())}
            />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              onReplace(draft.trim());
              setEditing(false);
            }}
          >
            Save comment
          </button>
        </div>
      ) : null}
    </section>
  );
}
