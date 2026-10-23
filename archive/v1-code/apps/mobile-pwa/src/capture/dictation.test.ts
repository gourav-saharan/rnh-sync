// Unit tests for the voice dictation utility (R5.5).
//
// jsdom provides no SpeechRecognition, so these tests exercise:
//   - the unsupported-environment path (no globals present)
//   - support detection + session lifecycle against a stubbed
//     SpeechRecognition installed on `window`
//   - append semantics that never clobber prior note text
//   - graceful error/permission-denial handling (stop, no crash)
//
// The stub captures the constructed recognition instance so a test can drive
// its onresult/onerror/onend handlers deterministically.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendTranscript,
  getSpeechRecognitionCtor,
  isDictationSupported,
  startDictation,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultEventLike,
} from './dictation';

/** A controllable fake SpeechRecognition instance. */
class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;

  lang = '';
  continuous = false;
  interimResults = false;
  started = false;
  stopped = false;
  aborted = false;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }

  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }

  /** Test helper: emit a final result the way the browser would. */
  emitFinal(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript }], { isFinal: true })],
    });
  }

  /** Test helper: emit an interim (non-final) result. */
  emitInterim(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript }], { isFinal: false })],
    });
  }
}

function installFakeRecognition(): void {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
    FakeRecognition;
}

function uninstallRecognition(): void {
  delete (window as unknown as { SpeechRecognition?: unknown })
    .SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
  FakeRecognition.last = null;
}

afterEach(() => {
  uninstallRecognition();
});

describe('appendTranscript', () => {
  it('returns the addition when the note is empty', () => {
    expect(appendTranscript('', 'turns in nicely')).toBe('turns in nicely');
  });

  it('appends onto existing text with a single separating space', () => {
    expect(appendTranscript('good grip', 'slight understeer')).toBe(
      'good grip slight understeer',
    );
  });

  it('never clobbers prior text and normalises stray whitespace', () => {
    // Repeated dictations should not accumulate double spaces.
    const first = appendTranscript('firm ride', ' comfortable ');
    expect(first).toBe('firm ride comfortable');
    const second = appendTranscript(first + '  ', 'quiet');
    expect(second).toBe('firm ride comfortable quiet');
  });

  it('leaves the note unchanged for an empty/whitespace addition', () => {
    expect(appendTranscript('firm ride', '   ')).toBe('firm ride');
  });
});

describe('support detection (unsupported environment)', () => {
  it('reports unsupported and returns null when no SpeechRecognition exists', () => {
    expect(isDictationSupported()).toBe(false);
    expect(getSpeechRecognitionCtor()).toBeNull();
  });

  it('startDictation returns null when unsupported (no crash)', () => {
    const onTranscript = vi.fn();
    const session = startDictation({ onTranscript });
    expect(session).toBeNull();
    expect(onTranscript).not.toHaveBeenCalled();
  });
});

describe('support detection + session lifecycle (supported)', () => {
  it('detects support once a SpeechRecognition constructor is present', () => {
    installFakeRecognition();
    expect(isDictationSupported()).toBe(true);
    expect(getSpeechRecognitionCtor()).toBe(
      FakeRecognition as unknown as ReturnType<typeof getSpeechRecognitionCtor>,
    );
  });

  it('detects the webkit-prefixed constructor', () => {
    (
      window as unknown as { webkitSpeechRecognition: unknown }
    ).webkitSpeechRecognition = FakeRecognition;
    expect(isDictationSupported()).toBe(true);
  });

  it('starts a session, forwards only final transcripts, and stops', () => {
    installFakeRecognition();
    const onTranscript = vi.fn();
    const onEnd = vi.fn();

    const session = startDictation({ onTranscript, onEnd });
    expect(session).not.toBeNull();

    const rec = FakeRecognition.last!;
    expect(rec.started).toBe(true);
    expect(rec.continuous).toBe(true);

    // Interim results are ignored; only final ones are forwarded (trimmed).
    rec.emitInterim('turns');
    expect(onTranscript).not.toHaveBeenCalled();

    rec.emitFinal('  turns in nicely  ');
    expect(onTranscript).toHaveBeenCalledWith('turns in nicely');

    session!.stop();
    expect(rec.stopped).toBe(true);

    // onend from the browser propagates to the caller.
    rec.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('routes recognition errors to onError without throwing', () => {
    installFakeRecognition();
    const onError = vi.fn();
    const session = startDictation({ onTranscript: vi.fn(), onError });
    expect(session).not.toBeNull();

    const rec = FakeRecognition.last!;
    expect(() => rec.onerror?.({ error: 'not-allowed' })).not.toThrow();
    expect(onError).toHaveBeenCalledWith({ error: 'not-allowed' });
  });

  it('returns null and reports error when start() throws (mic unavailable)', () => {
    installFakeRecognition();
    const throwingStart = vi
      .spyOn(FakeRecognition.prototype, 'start')
      .mockImplementation(() => {
        throw new Error('mic busy');
      });
    const onError = vi.fn();

    const session = startDictation({ onTranscript: vi.fn(), onError });
    expect(session).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);

    throwingStart.mockRestore();
  });

  it('swallows stop() errors (best-effort teardown)', () => {
    installFakeRecognition();
    const session = startDictation({ onTranscript: vi.fn() });
    const rec = FakeRecognition.last!;
    vi.spyOn(rec, 'stop').mockImplementation(() => {
      throw new Error('already stopped');
    });
    expect(() => session!.stop()).not.toThrow();
  });
});
