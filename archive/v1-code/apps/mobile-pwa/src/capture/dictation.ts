// Voice / dictated note entry for the Mobile_PWA capture form (R5.5).
//
// R5.5: "WHERE voice or dictated text entry is available on the device, THE
// Mobile_PWA SHALL allow the Tester to enter note text by dictation." This is a
// progressive enhancement — testers who have no speech support (or deny mic
// permission) always keep the plain keyboard <textarea>.
//
// This module wraps the Web Speech API (SpeechRecognition /
// webkitSpeechRecognition). Everything here is SSR/test-safe: all access to
// `window` and browser globals is guarded so importing or calling these helpers
// never throws in jsdom or on the server, where SpeechRecognition is absent.

/**
 * The subset of the Web Speech API SpeechRecognition surface this module uses.
 * We model it locally rather than depend on lib.dom's (partial) typings so the
 * code compiles the same across browsers/CI.
 */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

/** Minimal shape of the result event we read a transcript out of. */
export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
}

/** Constructor shape for a SpeechRecognition implementation. */
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Resolve the SpeechRecognition constructor from the current global scope, if
 * one exists. Guards every access so it is safe under SSR/jsdom where neither
 * `window` nor the constructors are defined. Returns `null` when unsupported.
 */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Feature-detect dictation support. `true` only when a SpeechRecognition
 * implementation is present on the current device/environment (R5.5). Callers
 * use this to decide whether to render the "Dictate" control at all.
 */
export function isDictationSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/**
 * Append a freshly dictated fragment onto an existing note value without
 * clobbering prior text. A single separating space is inserted between the
 * existing text and the new fragment (unless either side is empty), and
 * surrounding whitespace is normalised so repeated dictations don't accumulate
 * stray spaces. Autosave then flows through the same note-update path as typed
 * text, so dictated notes persist exactly like keyboard entry.
 */
export function appendTranscript(existing: string, addition: string): string {
  const base = (existing ?? '').replace(/\s+$/, '');
  const extra = (addition ?? '').trim();
  if (extra.length === 0) {
    return existing ?? '';
  }
  if (base.length === 0) {
    return extra;
  }
  return `${base} ${extra}`;
}

/** Options for {@link startDictation}. */
export interface DictationOptions {
  /** BCP-47 language tag for recognition. Defaults to the document language. */
  lang?: string;
  /**
   * Called with the recognized final transcript fragment(s). May be invoked
   * multiple times over a session as phrases are finalised.
   */
  onTranscript: (finalText: string) => void;
  /** Called on recognition error (including permission denial). */
  onError?: (error: unknown) => void;
  /** Called when the recognition session ends (naturally or via stop). */
  onEnd?: () => void;
}

/** Handle returned by {@link startDictation} to control the live session. */
export interface DictationSession {
  /** Stop listening. Safe to call multiple times. */
  stop: () => void;
}

/**
 * Start a dictation session for a single field. Returns a handle to stop it, or
 * `null` when dictation is unsupported in this environment (the caller should
 * simply not offer dictation in that case — R5.5 progressive enhancement).
 *
 * Only finalised results are forwarded to `onTranscript`; interim results are
 * ignored so we only ever append settled text. All failure modes (permission
 * denial, no-speech, network) route through `onError` and stop cleanly without
 * throwing.
 */
export function startDictation(
  options: DictationOptions,
): DictationSession | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return null;
  }

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch (error) {
    options.onError?.(error);
    return null;
  }

  recognition.lang =
    options.lang ??
    ((typeof document !== 'undefined' && document.documentElement.lang) ||
      'en-US');
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event: SpeechRecognitionResultEventLike) => {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result && result.isFinal) {
        const alt = result[0];
        if (alt && typeof alt.transcript === 'string') {
          finalText += alt.transcript;
        }
      }
    }
    const trimmed = finalText.trim();
    if (trimmed.length > 0) {
      options.onTranscript(trimmed);
    }
  };

  recognition.onerror = (error: unknown) => {
    options.onError?.(error);
  };

  recognition.onend = () => {
    options.onEnd?.();
  };

  try {
    recognition.start();
  } catch (error) {
    // Some browsers throw if start() is called while already started, or when
    // the mic is unavailable. Surface it and bail without crashing.
    options.onError?.(error);
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // Ignore stop() errors (e.g. already stopped) — best-effort teardown.
      }
    },
  };
}
