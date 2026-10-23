export { CaptureForm, AUTOSAVE_DELAY_MS } from './CaptureForm';
export {
  TemplatePicker,
  type TemplatePickerProps,
  type TemplateSelection,
} from './TemplatePicker';
export { RatingControl, MIN_TOUCH_TARGET_PX } from './RatingControl';
export { NoteDictationButton } from './NoteDictationButton';
export {
  isDictationSupported,
  startDictation,
  appendTranscript,
  getSpeechRecognitionCtor,
  type SpeechRecognitionLike,
  type SpeechRecognitionCtor,
  type DictationOptions,
  type DictationSession,
} from './dictation';
export {
  createBlankSession,
  blankTyreSet,
  withDerivedAverage,
  presetRatingsFor,
} from './session';
