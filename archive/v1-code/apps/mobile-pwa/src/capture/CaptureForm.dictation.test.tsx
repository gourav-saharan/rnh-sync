// Component tests for voice-dictated note entry in the capture form (R5.5).
//
// These complement CaptureForm.test.tsx (which runs in the default jsdom
// environment where SpeechRecognition is absent) by stubbing a controllable
// SpeechRecognition on `window`. They assert:
//   - when dictation is supported, a "Dictate <param> note" button renders next
//     to each note textarea, toggling it feeds a transcript that is APPENDED to
//     the note (never clobbering typed text) and autosaved via the same path
//   - when unsupported (no SpeechRecognition), NO dictate button renders and
//     the textarea still accepts keyboard entry (progressive enhancement)
//
// A real Dexie store (fake-indexeddb, registered in src/test/setup.ts) is used
// so the autosave assertion exercises the genuine persistence path.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FieldMapping } from '@rnh/shared';
import { LocalSessionDatabase, LocalSessionStore } from '../local';
import { CaptureForm } from './CaptureForm';

let store: LocalSessionStore;
let db: LocalSessionDatabase;
let user: ReturnType<typeof userEvent.setup>;
let dbCounter = 0;

const SESSION_ID = 'session-under-test';
const fixedNow = () => 1_000;
const fixedId = () => SESSION_ID;

// --- Controllable SpeechRecognition stub ---------------------------------

interface ResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: ResultEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  stop() {}
  abort() {}

  emitFinal(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript }], { isFinal: true })],
    });
  }
}

function installSpeech() {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
    FakeRecognition;
}
function uninstallSpeech() {
  delete (window as unknown as { SpeechRecognition?: unknown })
    .SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
  FakeRecognition.last = null;
}

beforeEach(async () => {
  db = new LocalSessionDatabase(`test-capture-dictation-${dbCounter++}`);
  store = new LocalSessionStore(db);
  await store.clear();
  user = userEvent.setup();
});

afterEach(() => {
  db.close();
  uninstallSpeech();
});

// A single-parameter template keeps the DOM focused on one note field.
const singleRideMapping: FieldMapping[] = [
  {
    mappingId: 'm1',
    templateId: 't1',
    sheetName: 'R&H',
    cellAddress: 'C7',
    inputFieldKey: 'rhRating.ride.smoothRoad',
    fieldType: 'rhRating',
    rhParameterName: 'Smooth Road',
    required: true,
  },
];

function renderForm(mappings: readonly FieldMapping[] = singleRideMapping) {
  return render(
    <CaptureForm
      store={store}
      createdBy="tester-1"
      templateMappings={mappings}
      now={fixedNow}
      makeSessionId={fixedId}
    />,
  );
}

describe('CaptureForm voice dictation (R5.5)', () => {
  it('does NOT render a dictate button when dictation is unsupported', () => {
    // No SpeechRecognition installed (default jsdom) — keyboard-only path.
    renderForm();
    expect(
      screen.queryByRole('button', { name: 'Dictate Smooth Road note' }),
    ).toBeNull();
    // The note textarea is still present and usable.
    expect(
      screen.getByRole('textbox', { name: 'Smooth Road note' }),
    ).toBeInTheDocument();
  });

  it('still accepts keyboard note entry when unsupported', async () => {
    renderForm();
    await user.type(
      screen.getByRole('textbox', { name: 'Smooth Road note' }),
      'typed note',
    );
    await waitFor(async () => {
      const saved = await store.load(SESSION_ID);
      expect(
        saved?.ride.parameters.find((p) => p.name === 'Smooth Road')?.note,
      ).toBe('typed note');
    });
  });

  it('renders a dictate button per note when supported, with aria-pressed state', async () => {
    installSpeech();
    renderForm();

    const button = screen.getByRole('button', {
      name: 'Dictate Smooth Road note',
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');

    // Toggling on reflects the listening state.
    await user.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('appends a dictated transcript to the note and autosaves it', async () => {
    installSpeech();
    renderForm();

    // Seed some typed text first so we can prove dictation APPENDS, not clobbers.
    await user.type(
      screen.getByRole('textbox', { name: 'Smooth Road note' }),
      'firm ride',
    );

    const button = screen.getByRole('button', {
      name: 'Dictate Smooth Road note',
    });
    await user.click(button);

    // Drive a final transcript the way the browser would.
    FakeRecognition.last!.emitFinal('slight understeer');

    const textarea = screen.getByRole('textbox', {
      name: 'Smooth Road note',
    }) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toBe('firm ride slight understeer');
    });

    // The appended text flows through the same autosave path as typing.
    await waitFor(async () => {
      const saved = await store.load(SESSION_ID);
      expect(
        saved?.ride.parameters.find((p) => p.name === 'Smooth Road')?.note,
      ).toBe('firm ride slight understeer');
    });

    // Toggling off returns aria-pressed to false.
    await user.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});
