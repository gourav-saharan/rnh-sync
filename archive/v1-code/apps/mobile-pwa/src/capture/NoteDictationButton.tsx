// Per-parameter "Dictate note" toggle for the capture form (R5.5).
//
// This is a progressive enhancement that sits next to a parameter's note
// <textarea>. It renders ONLY when the device supports speech recognition
// (feature-detected via isDictationSupported); when unsupported it renders
// nothing, so the textarea alone remains and keyboard entry always works.
//
// Toggling the button starts/stops a single-field dictation session. Recognized
// final transcript fragments are appended (never clobbering) to the current
// note via onAppend, which the parent wires to the same updateEntry(...note...)
// path used for typed text — so dictated notes autosave identically.

import { useEffect, useRef, useState } from 'react';
import {
  appendTranscript,
  isDictationSupported,
  startDictation,
  type DictationSession,
} from './dictation';

interface NoteDictationButtonProps {
  /** The R&H_Parameter name this note belongs to (used for the aria-label). */
  parameterName: string;
  /** The current note text; new transcript is appended onto this value. */
  currentNote: string;
  /** Called with the new note value (existing + appended transcript). */
  onAppend: (nextNote: string) => void;
}

/**
 * Renders a "Dictate <param> note" toggle where dictation is supported. While
 * listening, aria-pressed is true and the label reflects the active state.
 */
export function NoteDictationButton({
  parameterName,
  currentNote,
  onAppend,
}: NoteDictationButtonProps): JSX.Element | null {
  // Feature-detect once. Under jsdom/SSR (no SpeechRecognition) this is false,
  // so the component renders nothing and the plain textarea is the only control
  // — existing keyboard-only tests naturally hit this path.
  const [supported] = useState(() => isDictationSupported());
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<DictationSession | null>(null);

  // Keep the latest note in a ref so the async onresult callback always appends
  // onto the freshest value rather than a stale closure capture.
  const noteRef = useRef(currentNote);
  noteRef.current = currentNote;

  // Best-effort teardown: stop any live session if the field unmounts.
  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  if (!supported) {
    return null;
  }

  const stop = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setListening(false);
  };

  const start = () => {
    const session = startDictation({
      onTranscript: (finalText) => {
        onAppend(appendTranscript(noteRef.current, finalText));
      },
      onError: () => {
        // Permission denial / recognition error: stop cleanly, no crash.
        sessionRef.current = null;
        setListening(false);
      },
      onEnd: () => {
        sessionRef.current = null;
        setListening(false);
      },
    });
    if (session) {
      sessionRef.current = session;
      setListening(true);
    }
  };

  const toggle = () => {
    if (listening) {
      stop();
    } else {
      start();
    }
  };

  return (
    <button
      type="button"
      className={
        listening
          ? 'btn btn--secondary dictate-btn dictate-btn--listening'
          : 'btn btn--secondary dictate-btn'
      }
      aria-label={`Dictate ${parameterName} note`}
      aria-pressed={listening}
      onClick={toggle}
    >
      {listening ? 'Stop dictation' : 'Dictate'}
    </button>
  );
}
